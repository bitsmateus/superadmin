const configuredOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

/** Mesma allowlist usada pelo plugin @fastify/cors — reaproveitada pela rota de SSE (/api/events),
 * que escreve direto em reply.raw e nunca chama reply.send(), então pula os hooks automáticos de
 * CORS do plugin e precisa setar o header Access-Control-Allow-Origin na mão. */
export function isOriginAllowed(origin: string | undefined): boolean {
  if (!configuredOrigins.length) return true;
  return !origin || configuredOrigins.includes(origin.replace(/\/$/, ''));
}
