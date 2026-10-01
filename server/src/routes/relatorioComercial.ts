import { randomInt } from 'crypto';
import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';
import { montarRelatorioDoMes, mesesDisponiveis } from '../lib/relatorioComercial.js';

/**
 * Link público do relatório comercial — o mesmo painel do mês que a equipe vê, só que de fora e
 * só pra ler.
 *
 * O endereço carrega um token aleatório guardado em settings.relatorio_token: quem tem o link vê,
 * quem não tem recebe 404. É o mesmo arranjo da ficha de cadastro e do briefing. Trocar o token
 * (botão "gerar link novo") derruba todos os links antigos de uma vez — é a forma de revogar
 * quando um link circulou além da conta.
 *
 * A rota pública devolve SÓ números agregados: nenhum nome de lead, telefone ou valor por cliente.
 */
/** Alfabeto sem 0/O/1/l/I: o link é lido em voz alta e digitado à mão, e esses pares são a
 * fonte clássica de "não abre aqui". 8 caracteres dão 35^8 combinações — adivinhar é inviável. */
const ALFABETO = 'abcdefghijkmnpqrstuvwxyz23456789';

function tokenCurto(): string {
  let saida = '';
  for (let i = 0; i < 8; i++) saida += ALFABETO[randomInt(ALFABETO.length)];
  return saida;
}

export async function relatorioComercialRoutes(app: FastifyInstance) {
  // ---------------- interno (precisa de login) ----------------

  /** O link de hoje. Cria o token na primeira vez que alguém abre a tela. */
  app.get('/api/relatorio-comercial/link', { onRequest: [app.authenticate] }, async () => {
    const atual = await queryOne<{ relatorio_token: string | null }>(
      'SELECT relatorio_token FROM settings WHERE id = true'
    );
    // Token comprido de versão anterior (UUID) vira curto na primeira visita — o endereço com
    // 36 caracteres não cabia na barra do navegador nem numa mensagem.
    if (atual?.relatorio_token && atual.relatorio_token.length <= 12) return { token: atual.relatorio_token };
    const token = tokenCurto();
    await query('UPDATE settings SET relatorio_token = $1 WHERE id = true', [token]);
    return { token };
  });

  /** Gera um token novo e invalida o anterior. */
  app.post('/api/relatorio-comercial/link', { onRequest: [app.authenticate] }, async () => {
    const token = tokenCurto();
    await query('UPDATE settings SET relatorio_token = $1 WHERE id = true', [token]);
    return { token };
  });

  // ---------------- público (sem login) ----------------

  app.get<{ Params: { token: string }; Querystring: { mes?: string } }>(
    '/api/public/relatorio-comercial/:token',
    async (req, reply) => {
      const linha = await queryOne<{ relatorio_token: string | null }>(
        'SELECT relatorio_token FROM settings WHERE id = true'
      );
      const token = linha?.relatorio_token;
      if (!token || req.params.token !== token) {
        return reply.status(404).send({ message: 'Relatório não encontrado ou link expirado.' });
      }

      const meses = await mesesDisponiveis();
      if (!meses.length) return reply.status(404).send({ message: 'Nenhum mês cadastrado ainda.' });

      const pedido = (req.query.mes ?? '').trim();
      const mes = meses.includes(pedido) ? pedido : meses[0];
      const relatorio = await montarRelatorioDoMes(mes);
      if (!relatorio) return reply.status(404).send({ message: 'Mês inválido.' });
      return { ...relatorio, meses };
    }
  );
}
