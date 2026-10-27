import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pool, query, queryOne } from '../db.js';
import { abaDeFora } from '../lib/abasJuntas.js';
import { dateParaAgendamento } from '../lib/reuniaoResultado.js';
import { PAGINA_DO_CLOSER, PAGINA_DO_SDR } from '../lib/notificacoes.js';
import {
  agoraLocal, ehDiaDeRotina, estadoDoBloco, podeMarcar, segundaDaSemana, somarDias, validarBlocos, type Bloco,
} from '../lib/rotina.js';
import { donoDaPagina } from './notificacoes.js';

/**
 * Rotina do dia: checklist do botão "Rotina" (ver lib/rotina.ts). A rotina é da aba — CRM ARTHUR (SDR) e CRM LUIS
 * CLOSER — e quem marca é o dono da aba (pelo nome, a mesma regra do sininho). Admin, dentro de uma dessas abas, vê a
 * semana, marca folga e edita os blocos; não marca bloco por ninguém.
 */
const PAGINAS_COM_ROTINA = [PAGINA_DO_SDR, PAGINA_DO_CLOSER];

async function blocosDaPagina(pagina: string): Promise<Bloco[]> {
  const rows = await query<Bloco & { created_at: Date }>(
    `SELECT id, inicio, fim, titulo, itens, tipo, created_at FROM rotina_blocos
     WHERE pagina = $1 AND removido_em IS NULL ORDER BY inicio, fim`,
    [pagina]
  );
  return rows.map(({ created_at, ...b }) => ({ ...b, criado_em: dateParaAgendamento(new Date(created_at)) }));
}

/** Os blocos marcados como feitos no período: "bloco_id|YYYY-MM-DD" -> "YYYY-MM-DDTHH:MM" (quando marcou). */
async function feitosNoPeriodo(pagina: string, de: string, ate: string): Promise<Map<string, string>> {
  const rows = await query<{ bloco_id: string; data: string; marcado_em: Date }>(
    `SELECT m.bloco_id, to_char(m.data, 'YYYY-MM-DD') AS data, m.marcado_em
     FROM rotina_marcacoes m JOIN rotina_blocos b ON b.id = m.bloco_id
     WHERE b.pagina = $1 AND m.status = 'feito' AND m.data BETWEEN $2::date AND $3::date`,
    [pagina, de, ate]
  );
  return new Map(rows.map((r) => [`${r.bloco_id}|${r.data}`, dateParaAgendamento(new Date(r.marcado_em))]));
}

async function folgasNoPeriodo(pagina: string, de: string, ate: string): Promise<Set<string>> {
  const rows = await query<{ data: string }>(
    `SELECT to_char(data, 'YYYY-MM-DD') AS data FROM rotina_folgas WHERE pagina = $1 AND data BETWEEN $2::date AND $3::date`,
    [pagina, de, ate]
  );
  return new Set(rows.map((r) => r.data));
}

/** De quem é a rotina pedida: a do dono daquela aba (pra ele marcar) ou, pro admin, só pra olhar. */
async function rotinaPedida(sub: string, role: string, pagina: string) {
  const alvo = abaDeFora(pagina) ?? pagina;
  if (!PAGINAS_COM_ROTINA.includes(alvo)) return null;
  const dono = await donoDaPagina(alvo);
  if (dono?.id === sub) return { pagina: alvo, dono, somente_leitura: false };
  return role === 'admin' ? { pagina: alvo, dono, somente_leitura: true } : null;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Marca (feito = true) ou desmarca um bloco de hoje. Só o dono da aba. */
function marcarBloco(feito: boolean) {
  return async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { sub } = req.user as { sub: string };
    const bloco = await queryOne<{ id: string; pagina: string }>(
      'SELECT id, pagina FROM rotina_blocos WHERE id = $1 AND removido_em IS NULL', [req.params.id]
    );
    if (!bloco) return reply.status(404).send({ message: 'Bloco não encontrado.' });
    const dono = await donoDaPagina(bloco.pagina);
    if (dono?.id !== sub) return reply.status(403).send({ message: 'Só o dono dessa rotina marca os blocos.' });
    const agora = agoraLocal();
    if (!ehDiaDeRotina(agora.data) || (await folgasNoPeriodo(bloco.pagina, agora.data, agora.data)).has(agora.data)) {
      return reply.status(409).send({ message: 'Hoje não tem rotina (fim de semana ou folga).' });
    }
    if (!podeMarcar(agora.data, agora)) return reply.status(409).send({ message: 'Só dá pra marcar o dia de hoje.' });
    if (feito) {
      await query(
        `INSERT INTO rotina_marcacoes (bloco_id, data, status, motivo, user_id, user_name)
         VALUES ($1, $2::date, 'feito', '', $3, $4)
         ON CONFLICT (bloco_id, data) DO UPDATE SET status = 'feito', motivo = '', marcado_em = NOW()`,
        [bloco.id, agora.data, sub, dono.nome]
      );
    } else {
      await query('DELETE FROM rotina_marcacoes WHERE bloco_id = $1 AND data = $2::date', [bloco.id, agora.data]);
    }
    return { ok: true };
  };
}

export async function rotinaRoutes(app: FastifyInstance) {
  // GET /api/rotina/hoje?pagina= — o checklist de hoje do dono da aba ({ tem: false } pra quem não é dono nem admin).
  app.get<{ Querystring: { pagina?: string } }>('/api/rotina/hoje', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    const r = await rotinaPedida(sub, role, req.query.pagina ?? '');
    if (!r) return { tem: false };
    const agora = agoraLocal();
    const [blocos, feitos, folgas] = await Promise.all([
      blocosDaPagina(r.pagina),
      feitosNoPeriodo(r.pagina, agora.data, agora.data),
      folgasNoPeriodo(r.pagina, agora.data, agora.data),
    ]);
    return {
      tem: true, pagina: r.pagina, dono: r.dono?.nome ?? '', somente_leitura: r.somente_leitura,
      data: agora.data, dia_util: ehDiaDeRotina(agora.data), folga: folgas.has(agora.data),
      blocos: blocos.map((b) => {
        const feitoEm = feitos.get(`${b.id}|${agora.data}`) ?? null;
        return { ...b, estado: estadoDoBloco(b, agora.data, agora, !!feitoEm, b.criado_em), feito_em: feitoEm };
      }),
    };
  });

  // POST (marca feito) / DELETE (desmarca) /api/rotina/blocos/:id/feito — só o dono da aba, só hoje.
  app.post<{ Params: { id: string } }>('/api/rotina/blocos/:id/feito', { onRequest: [app.authenticate] }, marcarBloco(true));
  app.delete<{ Params: { id: string } }>('/api/rotina/blocos/:id/feito', { onRequest: [app.authenticate] }, marcarBloco(false));

  // GET /api/rotina/semana?pagina=&semana=YYYY-MM-DD (admin) — os blocos de segunda a sexta da semana, com o estado de
  // cada dia, e as folgas.
  app.get<{ Querystring: { pagina?: string; semana?: string } }>(
    '/api/rotina/semana',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const r = await rotinaPedida(sub, role, req.query.pagina ?? '');
      if (!r) return reply.status(400).send({ message: 'Aba sem rotina.' });
      const agora = agoraLocal();
      const segunda = segundaDaSemana(DATA.test(req.query.semana ?? '') ? req.query.semana! : agora.data);
      const dias = [0, 1, 2, 3, 4].map((n) => somarDias(segunda, n));
      const [blocos, feitos, folgas] = await Promise.all([
        blocosDaPagina(r.pagina),
        feitosNoPeriodo(r.pagina, segunda, dias[4]),
        folgasNoPeriodo(r.pagina, segunda, dias[4]),
      ]);
      return {
        pagina: r.pagina,
        dono: r.dono?.nome ?? '',
        hoje: agora.data,
        dias: dias.map((d) => ({ data: d, folga: folgas.has(d) })),
        blocos: blocos.map((b) => ({
          ...b,
          dias: dias.map((d) => {
            const feitoEm = feitos.get(`${b.id}|${d}`) ?? null;
            return { data: d, estado: folgas.has(d) ? 'folga' : estadoDoBloco(b, d, agora, !!feitoEm, b.criado_em), feito_em: feitoEm };
          }),
        })),
      };
    }
  );

  // PUT /api/rotina/folga (admin) — { pagina, data, folga: boolean }
  app.put<{ Body: { pagina?: string; data?: string; folga?: boolean } }>(
    '/api/rotina/folga',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const pagina = abaDeFora(req.body?.pagina ?? '') ?? req.body?.pagina ?? '';
      const data = req.body?.data ?? '';
      if (!PAGINAS_COM_ROTINA.includes(pagina) || !DATA.test(data)) return reply.status(400).send({ message: 'Aba ou data inválida.' });
      if (req.body?.folga) {
        const quem = await queryOne<{ name: string | null; email: string }>('SELECT name, email FROM profiles WHERE id = $1', [sub]);
        await query(
          `INSERT INTO rotina_folgas (pagina, data, criado_por) VALUES ($1, $2::date, $3) ON CONFLICT DO NOTHING`,
          [pagina, data, quem?.name || quem?.email || '']
        );
      } else {
        await query('DELETE FROM rotina_folgas WHERE pagina = $1 AND data = $2::date', [pagina, data]);
      }
      return { ok: true };
    }
  );

  // PUT /api/rotina/blocos (admin) — { pagina, blocos: [{ id?, inicio, fim, titulo, itens[], tipo }] }: substitui a
  // lista inteira. Bloco que sai da lista fica com removido_em (as marcações antigas continuam no banco).
  app.put<{ Body: { pagina?: string; blocos?: unknown } }>(
    '/api/rotina/blocos',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const pagina = abaDeFora(req.body?.pagina ?? '') ?? req.body?.pagina ?? '';
      if (!PAGINAS_COM_ROTINA.includes(pagina)) return reply.status(400).send({ message: 'Aba sem rotina.' });
      const v = validarBlocos(req.body);
      if ('erro' in v) return reply.status(400).send({ message: v.erro });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const atuais = (await client.query<{ id: string }>(
          'SELECT id FROM rotina_blocos WHERE pagina = $1 AND removido_em IS NULL FOR UPDATE', [pagina]
        )).rows.map((x) => x.id);
        const mantidos = new Set<string>();
        for (const b of v.ok) {
          if (b.id && atuais.includes(b.id)) {
            mantidos.add(b.id);
            await client.query(
              `UPDATE rotina_blocos SET inicio = $2, fim = $3, titulo = $4, itens = $5, tipo = $6, updated_at = NOW() WHERE id = $1`,
              [b.id, b.inicio, b.fim, b.titulo, b.itens, b.tipo]
            );
          } else {
            await client.query(
              `INSERT INTO rotina_blocos (pagina, inicio, fim, titulo, itens, tipo) VALUES ($1, $2, $3, $4, $5, $6)`,
              [pagina, b.inicio, b.fim, b.titulo, b.itens, b.tipo]
            );
          }
        }
        const sair = atuais.filter((id) => !mantidos.has(id));
        if (sair.length) await client.query('UPDATE rotina_blocos SET removido_em = NOW() WHERE id = ANY($1::uuid[])', [sair]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      return { ok: true, blocos: await blocosDaPagina(pagina) };
    }
  );
}
