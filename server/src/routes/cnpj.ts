import { FastifyInstance } from 'fastify';

/**
 * Consulta pública de CNPJ (BrasilAPI, agrega dados da Receita Federal) — usada pra auto-preencher
 * os campos do formulário da aba Contrato quando o usuário digita o CNPJ do cliente. Chamada do
 * BACKEND (evita CORS no navegador e não expõe rate-limit externo direto pro cliente).
 */

type BrasilApiCnpj = {
  razao_social?: string;
  nome_fantasia?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
};

export async function cnpjRoutes(app: FastifyInstance) {
  app.get<{ Params: { cnpj: string } }>(
    '/api/cnpj/:cnpj',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const digits = req.params.cnpj.replace(/\D/g, '');
      if (digits.length !== 14) return reply.status(400).send({ message: 'CNPJ inválido — precisa ter 14 dígitos' });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        // User-Agent é OBRIGATÓRIO: a BrasilAPI roda atrás da Vercel, que responde 403 Forbidden
        // pro fetch do Node (que não manda User-Agent por padrão). Pelo navegador ou por curl
        // funciona, e foi isso que mascarou o problema — a consulta falhava só em produção.
        const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'superadmin-nx/1.0 (+https://app.nxdigital.com.br)',
            Accept: 'application/json',
          },
        });
        if (res.status === 404) return reply.status(404).send({ message: 'CNPJ não encontrado' });
        if (!res.ok) {
          // O status vai junto na mensagem: sem isso qualquer falha virava "tenta de novo" na tela,
          // e não dava pra distinguir bloqueio (403) de excesso de consultas (429) ou queda (5xx).
          app.log.error({ status: res.status, cnpj: digits }, 'BrasilAPI recusou a consulta de CNPJ');
          const motivo = res.status === 429
            ? 'muitas consultas seguidas, espere um instante'
            : `serviço de consulta indisponível (erro ${res.status})`;
          return reply.status(502).send({ message: `Falha ao consultar o CNPJ — ${motivo}.` });
        }

        const data = (await res.json()) as BrasilApiCnpj;
        return {
          razaoSocial: data.razao_social ?? '',
          nomeFantasia: data.nome_fantasia || data.razao_social || '',
          logradouro: data.logradouro ?? '',
          numero: data.numero ?? '',
          complemento: data.complemento ?? '',
          bairro: data.bairro ?? '',
          municipio: data.municipio ?? '',
          uf: data.uf ?? '',
          cep: data.cep ?? '',
        };
      } catch (err) {
        app.log.error({ err }, 'Falha ao consultar CNPJ na BrasilAPI');
        const abortou = (err as Error)?.name === 'AbortError';
        return reply.status(502).send({
          message: abortou
            ? 'A consulta de CNPJ demorou demais — tente de novo.'
            : 'Não foi possível falar com o serviço de consulta de CNPJ.',
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  );
}
