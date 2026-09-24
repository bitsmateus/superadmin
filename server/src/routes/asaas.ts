import { FastifyInstance } from 'fastify';
import { queryOne } from '../db.js';
import { sincronizarAsaas } from '../jobs/asaasSync.js';

/**
 * Asaas visto pelo painel. A chave fica só aqui no servidor (ver settings.asaas_api_key): o
 * navegador nunca a recebe, e nem poderia chamar a API do Asaas direto de qualquer jeito.
 */
export async function asaasRoutes(app: FastifyInstance) {
  // GET /api/asaas/status — se está configurado e quando foi a última leitura.
  app.get('/api/asaas/status', { onRequest: [app.authenticate] }, async () => {
    const row = await queryOne<{ tem_chave: boolean; asaas_environment: string | null; asaas_last_sync_at: string | null }>(
      `SELECT (COALESCE(asaas_api_key, '') <> '') AS tem_chave, asaas_environment, asaas_last_sync_at
       FROM settings WHERE id = true`
    );
    return {
      configurado: !!row?.tem_chave || !!process.env.ASAAS_API_KEY,
      ambiente: row?.asaas_environment ?? 'production',
      ultimaSync: row?.asaas_last_sync_at ?? null,
    };
  });

  // POST /api/asaas/sync — força a leitura agora, sem esperar a rodada de 15 min. Só leitura:
  // nada é criado, alterado ou cancelado no Asaas por aqui.
  app.post<{ Querystring: { dryRun?: string } }>(
    '/api/asaas/sync',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      try {
        const resultado = await sincronizarAsaas({ dryRun: req.query?.dryRun === '1' });
        if (!resultado) return reply.status(400).send({ message: 'Asaas não configurado (falta a chave de API em Configurações).' });
        return resultado;
      } catch (err) {
        return reply.status(502).send({ message: (err as Error).message });
      }
    }
  );
}
