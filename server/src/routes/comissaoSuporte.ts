import { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';
import { podeVerFinanceiro } from '../lib/financeiro.js';
import { pessoaDaAba, sincronizarComissoesDoSuporte } from '../lib/comissaoSuporte.js';

/**
 * Comissão de suporte dentro do CRM do Jean/João (Dashboard da aba). Cada um vê só a própria: o dono da aba (o
 * primeiro nome do perfil bate com o nome da aba) e quem vê o Financeiro. O resto (inclusive o outro do suporte, mesmo
 * com a aba liberada) recebe 403 — e a tela nem mostra a seção.
 */
export async function comissaoSuporteRoutes(app: FastifyInstance) {
  app.get<{ Params: { pagina: string }; Querystring: { de?: string; ate?: string } }>(
    '/api/comissao-suporte/:pagina',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const eu = req.user as { sub: string; role?: string };
      const aba = await queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM lead_pages WHERE id = $1 AND section = 'demandas' AND no_pipeline`,
        [req.params.pagina]
      );
      if (!aba) return reply.status(404).send({ message: 'CRM do suporte não encontrado.' });
      const pessoa = pessoaDaAba(aba.name);
      const perfil = await queryOne<{ name: string | null }>('SELECT name FROM profiles WHERE id = $1', [eu.sub]);
      const ehDono = !!pessoa && pessoaDaAba(perfil?.name ?? '') === pessoa;
      if (!ehDono && !podeVerFinanceiro(eu.sub, eu.role)) {
        return reply.status(403).send({ message: 'A comissão é só de quem é o CRM.' });
      }
      const mes = /^\d{4}-\d{2}$/;
      const de = mes.test(req.query.de ?? '') ? req.query.de! : '0000-00';
      const ate = mes.test(req.query.ate ?? '') ? req.query.ate! : '9999-99';
      await sincronizarComissoesDoSuporte();
      // Tudo dessa pessoa: as que nasceram dos cards e as lançadas à mão em "Registrar comissão" (de Suporte ou SDR).
      // A Pessoa lá é texto livre: casa pelo primeiro nome, sem acento nem maiúscula ("João Pedro" = "joao" = "Joao").
      const entradas = await query<{
        id: string; nome: string; type_label: string; reference: string; amount_cents: number; month: string;
        status: string; lead_row_id: string | null;
      }>(
        `SELECT id, nome, type_label, reference, amount_cents, month, status, lead_row_id
         FROM commission_entries
         WHERE translate(lower(split_part(btrim(person), ' ', 1)), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') = lower($1)
           AND month >= $2 AND month <= $3
         ORDER BY month DESC, created_at DESC`,
        [pessoa, de, ate]
      );
      return {
        pessoa,
        nomeDaAba: aba.name,
        entradas: entradas.map((e) => ({
          id: e.id, nome: e.nome, tipo: e.type_label, referencia: e.reference, valorCentavos: e.amount_cents,
          mes: e.month, pago: e.status === 'pago', cardId: e.lead_row_id,
        })),
      };
    }
  );
}
