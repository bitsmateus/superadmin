import { FastifyInstance } from 'fastify';
import https from 'https';
import http from 'http';
import { URL } from 'url';

/**
 * Proxy server-to-server para o NX Monitor (serviço separado de monitoramento
 * de canais WhatsApp). O navegador chama same-origin /api/canais/* com o JWT do
 * painel; aqui validamos o JWT, reescrevemos o path para {NX_MONITOR_URL}/api/*
 * e injetamos a API key via header x-api-key. A key vive só no servidor (env),
 * nunca trafega pelo navegador. Espelha o estilo de routes/proxy.ts.
 */
export async function canaisRoutes(app: FastifyInstance) {
  app.all('/api/canais/*', { preHandler: [app.authenticate] }, async (req, reply) => {
    const monitorUrl = process.env.NX_MONITOR_URL;
    const apiKey = process.env.NX_MONITOR_API_KEY;
    if (!monitorUrl || !apiKey) {
      return reply
        .status(503)
        .send({ error: 'NX Monitor não configurado (defina NX_MONITOR_URL e NX_MONITOR_API_KEY).' });
    }

    // /api/canais/channels?all=1 -> /channels?all=1
    const suffix = (req.url as string).replace(/^\/api\/canais/, '');
    const base = monitorUrl.replace(/\/$/, '');

    let targetUrl: URL;
    try {
      targetUrl = new URL(`${base}/api${suffix}`);
    } catch {
      return reply.status(400).send({ error: 'URL de destino inválida' });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-api-key': apiKey,
      Authorization: `Bearer ${apiKey}`,
    };
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

    return new Promise<void>((resolve) => {
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
        proxyRes.on('error', () => {
          if (!reply.sent) reply.status(502).send({ error: 'Erro lendo resposta do NX Monitor' });
          resolve();
        });
      });

      proxyReq.on('error', (err) => {
        app.log.error({ err }, 'NX Monitor proxy error');
        if (!reply.sent) {
          reply.status(502).send({ error: 'Falha ao falar com o NX Monitor: ' + err.message });
        }
        resolve();
      });

      if (bodyStr) proxyReq.write(bodyStr);
      proxyReq.end();
    });
  });
}
