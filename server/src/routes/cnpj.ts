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
        const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, { signal: controller.signal });
        if (res.status === 404) return reply.status(404).send({ message: 'CNPJ não encontrado' });
        if (!res.ok) return reply.status(502).send({ message: 'Falha ao consultar o CNPJ, tenta de novo' });

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
      } catch {
        return reply.status(502).send({ message: 'Falha ao consultar o CNPJ, tenta de novo' });
      } finally {
        clearTimeout(timeout);
      }
    }
  );
}
