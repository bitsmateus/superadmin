import { FastifyInstance } from 'fastify';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { queryOne } from '../db.js';

type StoredServer = { id?: string; baseUrl?: string; apiToken?: string };

// Cache curto dos servers (com token real) — o token nunca trafega pelo
// navegador; é resolvido aqui no servidor a partir das settings.
let serversCache: { at: number; servers: StoredServer[] } | null = null;

async function resolveServerToken(targetBase: string): Promise<string | undefined> {
  const now = Date.now();
  if (!serversCache || now - serversCache.at > 15_000) {
    try {
      const row = await queryOne<{ servers: StoredServer[] | null }>(
        'SELECT servers FROM settings WHERE id = true'
      );
      serversCache = {
        at: now,
        servers: Array.isArray(row?.servers) ? (row!.servers as StoredServer[]) : [],
      };
    } catch {
      serversCache = { at: now, servers: [] };
    }
  }
  const base = targetBase.replace(/\/$/, '');
  const match = serversCache.servers.find(
    (s) => (s.baseUrl ?? '').replace(/\/$/, '') === base
  );
  return match?.apiToken || undefined;
}

export async function proxyRoutes(app: FastifyInstance) {
  // Forward all requests to an external API server-to-server, avoiding browser CORS restrictions.
  // Frontend sends:  X-Proxy-Target: https://chatapi.nxsystems.com.br
  //                  X-Api-Token: <server api token>
  // and the path/method/body as-is.
  app.all('/api/proxy/*', {
    preHandler: [app.authenticate],
  }, async (req, reply) => {
    const targetBase = req.headers['x-proxy-target'] as string | undefined;
    const headerToken = req.headers['x-api-token'] as string | undefined;

    if (!targetBase) {
      return reply.status(400).send({ message: 'Missing X-Proxy-Target header' });
    }

    // Um token explícito no header (ex.: token da API do tenant para
    // /v2/api/external/{apiId}/...) tem precedência. Caso contrário, o token
    // do servidor é resolvido aqui no backend — nunca é exposto no front.
    const apiToken =
      headerToken && headerToken.trim()
        ? headerToken
        : await resolveServerToken(targetBase);

    // Strip the '/api/proxy' prefix to get the rest of the path
    const suffix = (req.url as string).replace(/^\/api\/proxy/, '');

    let targetUrl: URL;
    try {
      targetUrl = new URL(suffix, targetBase);
    } catch {
      return reply.status(400).send({ message: 'Invalid proxy target URL' });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`;

    // Forward a subset of safe request headers
    const forwardHeaders = ['accept-language', 'user-agent'];
    for (const h of forwardHeaders) {
      const v = req.headers[h];
      if (typeof v === 'string') headers[h] = v;
    }

    const bodyStr =
      req.method !== 'GET' && req.method !== 'HEAD' && req.body != null
        ? JSON.stringify(req.body)
        : undefined;

    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr).toString();

    const options: http.RequestOptions = {
      method: req.method,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: targetUrl.pathname + targetUrl.search,
      headers,
    };

    const upstream = targetUrl.protocol === 'https:' ? https : http;

    return new Promise<void>((resolve, reject) => {
      const proxyReq = upstream.request(options, (proxyRes) => {
        reply.status(proxyRes.statusCode ?? 502);
        for (const [k, v] of Object.entries(proxyRes.headers)) {
          if (
            v != null &&
            !['transfer-encoding', 'connection', 'keep-alive'].includes(k.toLowerCase())
          ) {
            reply.header(k, v as string);
          }
        }

        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          reply.send(Buffer.concat(chunks));
          resolve();
        });
        proxyRes.on('error', reject);
      });

      proxyReq.on('error', (err) => {
        app.log.error({ err }, 'Proxy upstream error');
        if (!reply.sent) {
          reply.status(502).send({ message: 'Proxy upstream error: ' + err.message });
        }
        resolve();
      });

      if (bodyStr) proxyReq.write(bodyStr);
      proxyReq.end();
    });
  });
}
