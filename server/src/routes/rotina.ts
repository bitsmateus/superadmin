import { FastifyInstance } from 'fastify';
import { pool, query, queryOne } from '../db.js';
import { ABAS_JUNTAS, abaDeFora } from '../lib/abasJuntas.js';
import { dateParaAgendamento } from '../lib/reuniaoResultado.js';
import { PAGINA_DO_CLOSER, PAGINA_DO_SDR } from '../lib/notificacoes.js';
import {
  agoraLocal, ehDiaDeRotina, estadoDoBloco, marcouAtrasado, podeMarcar, segundaDaSemana, somarDias, validarBlocos,
  validarMarcacao, type Bloco, type Marcacao, type StatusDaMarcacao, type TipoDeBloco,
} from '../lib/rotina.js';
import { donoDaPagina } from './notificacoes.js';

/**
 * Rotina do dia (barra lateral à direita, ver lib/rotina.ts). A rotina é da aba — CRM ARTHUR (SDR) e CRM LUIS CLOSER —
 * e quem vê a barra e marca é o dono da aba (pelo nome, a mesma regra do sininho). Admin, dentro de uma dessas abas, vê
 * a semana, marca folga e edita os blocos; não marca bloco por ninguém.
 */
export const PAGINAS_COM_ROTINA = [PAGINA_DO_SDR, PAGINA_DO_CLOSER];

export interface ReuniaoDoBloco { card_id: string; pagina: string; nome: string; empresa: string; agendamento: string }

export async function blocosDaPagina(pagina: string): Promise<Bloco[]> {
  const rows = await query<Bloco & { created_at: Date }>(
    `SELECT id, inicio, fim, titulo, itens, tipo, created_at FROM rotina_blocos
     WHERE pagina = $1 AND removido_em IS NULL ORDER BY inicio, fim`,
    [pagina]
  );
  return rows.map(({ created_at, ...b }) => ({ ...b, criado_em: dateParaAgendamento(new Date(created_at)) }));
}

/** Reuniões (Agendamento com hora) da aba e das abas de dentro, de `de` até antes de `ate` — uma por lead. */
export async function reunioesNoPeriodo(pagina: string, de: string, ate: string): Promise<ReuniaoDoBloco[]> {
  return query<ReuniaoDoBloco>(
    `SELECT DISTINCT ON (COALESCE(r.espelho_origem_id, r.copia_ia_origem_id, r.id))
            r.id AS card_id, lb.page AS pagina, COALESCE(r.nome, '') AS nome, COALESCE(r.empresa, '') AS empresa, left(r.agendamento, 16) AS agendamento
     FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id
     WHERE r.deleted_at IS NULL AND lb.page = ANY($1) AND NOT lb.is_vendas AND NOT lb.is_contrato
       AND r.agendamento ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}' AND r.agendamento >= $2 AND r.agendamento < $3
     ORDER BY COALESCE(r.espelho_origem_id, r.copia_ia_origem_id, r.id), (r.espelho_origem_id IS NOT NULL) DESC`,
    [[pagina, ...(ABAS_JUNTAS[pagina] ?? [])], de, ate]
  );
}

export const reunioesDoBloco = (reunioes: ReuniaoDoBloco[], b: Pick<Bloco, 'inicio' | 'fim'>, data: string) =>
  reunioes.filter((r) => r.agendamento >= `${data}T${b.inicio}` && r.agendamento < `${data}T${b.fim}`)
    .sort((a, b2) => a.agendamento.localeCompare(b2.agendamento));

interface LinhaDeMarcacao { bloco_id: string; data: string; status: StatusDaMarcacao; motivo: string; marcado_em: Date }

async function marcacoesNoPeriodo(pagina: string, de: string, ate: string): Promise<LinhaDeMarcacao[]> {
  return query<LinhaDeMarcacao>(
    `SELECT m.bloco_id, to_char(m.data, 'YYYY-MM-DD') AS data, m.status, m.motivo, m.marcado_em
     FROM rotina_marcacoes m JOIN rotina_blocos b ON b.id = m.bloco_id
     WHERE b.pagina = $1 AND m.data BETWEEN $2::date AND $3::date`,
    [pagina, de, ate]
  );
}

export async function folgasNoPeriodo(pagina: string, de: string, ate: string): Promise<Set<string>> {
  const rows = await query<{ data: string }>(
    `SELECT to_char(data, 'YYYY-MM-DD') AS data FROM rotina_folgas WHERE pagina = $1 AND data BETWEEN $2::date AND $3::date`,
    [pagina, de, ate]
  );
  return new Set(rows.map((r) => r.data));
}

const paraMarcacao = (m: LinhaDeMarcacao | undefined): Marcacao | null =>
  m ? { status: m.status, motivo: m.motivo, marcado_em: dateParaAgendamento(new Date(m.marcado_em)) } : null;

/** O dia de uma aba visto de agora: cada bloco com estado, marcação e as reuniões do horário. */
export async function diaDaRotina(pagina: string, data: string, agora = agoraLocal()) {
  const [blocos, marcacoes, folgas, reunioes] = await Promise.all([
    blocosDaPagina(pagina),
    marcacoesNoPeriodo(pagina, data, data),
    folgasNoPeriodo(pagina, data, data),
    reunioesNoPeriodo(pagina, `${data}T00:00`, `${somarDias(data, 1)}T00:00`),
  ]);
  const folga = folgas.has(data);
  const diaUtil = ehDiaDeRotina(data);
  return {
    data,
    agora: agora.hora,
    folga,
    dia_util: diaUtil,
    blocos: blocos.map((b) => {
      const marcacao = paraMarcacao(marcacoes.find((m) => m.bloco_id === b.id));
      const doBloco = b.tipo === 'reuniao' ? reunioesDoBloco(reunioes, b, data) : [];
      return {
        ...b,
        estado: estadoDoBloco(b, data, agora, marcacao, doBloco.length > 0, b.criado_em),
        pode_marcar: diaUtil && !folga && podeMarcar(b, data, agora, b.criado_em),
        marcacao: marcacao && { ...marcacao, atrasado: marcouAtrasado(b, data, marcacao) },
        reunioes: doBloco,
      };
    }),
  };
}

/** De quem é a rotina pedida: a do usuário logado (dono de uma das abas) ou, pro admin, a da aba que ele está olhando. */
async function rotinaPedida(sub: string, role: string, pagina?: string) {
  if (pagina) {
    const alvo = abaDeFora(pagina) ?? pagina;
    if (!PAGINAS_COM_ROTINA.includes(alvo)) return null;
    const dono = await donoDaPagina(alvo);
    if (dono?.id === sub) return { pagina: alvo, dono, somente_leitura: false };
    return role === 'admin' ? { pagina: alvo, dono, somente_leitura: true } : null;
  }
  for (const p of PAGINAS_COM_ROTINA) {
    const dono = await donoDaPagina(p);
    if (dono?.id === sub) return { pagina: p, dono, somente_leitura: false };
  }
  return null;
}

async function nomeDaPagina(pagina: string): Promise<string> {
  return (await queryOne<{ name: string }>('SELECT name FROM lead_pages WHERE id = $1', [pagina]))?.name ?? pagina;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export async function rotinaRoutes(app: FastifyInstance) {
  // GET /api/rotina/hoje — a rotina de hoje de quem está logado ({ tem: false } se não tem). ?pagina= (admin): a do
  // dono daquela aba, só pra olhar.
  app.get<{ Querystring: { pagina?: string } }>('/api/rotina/hoje', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    const r = await rotinaPedida(sub, role, req.query.pagina);
    if (!r) return { tem: false };
    const agora = agoraLocal();
    return {
      tem: true, pagina: r.pagina, nome_da_pagina: await nomeDaPagina(r.pagina), dono: r.dono?.nome ?? '',
      somente_leitura: r.somente_leitura, ...(await diaDaRotina(r.pagina, agora.data, agora)),
    };
  });

  // POST /api/rotina/blocos/:id/marcar — { status: feito|parcial|nao_deu, motivo? }. Só o dono da aba, no dia, depois
  // que o bloco começou. Marcar de novo troca a marcação.
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/api/rotina/blocos/:id/marcar',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub } = req.user as { sub: string };
      const v = validarMarcacao(req.body);
      if ('erro' in v) return reply.status(400).send({ message: v.erro });
      const bloco = await queryOne<Bloco & { pagina: string; created_at: Date }>(
        `SELECT id, pagina, inicio, fim, titulo, itens, tipo, created_at FROM rotina_blocos WHERE id = $1 AND removido_em IS NULL`,
        [req.params.id]
      );
      if (!bloco) return reply.status(404).send({ message: 'Bloco não encontrado.' });
      const dono = await donoDaPagina(bloco.pagina);
      if (dono?.id !== sub) return reply.status(403).send({ message: 'Só o dono dessa rotina marca os blocos.' });
      const agora = agoraLocal();
      if (!ehDiaDeRotina(agora.data) || (await folgasNoPeriodo(bloco.pagina, agora.data, agora.data)).has(agora.data)) {
        return reply.status(409).send({ message: 'Hoje não tem rotina (fim de semana ou folga).' });
      }
      if (!podeMarcar(bloco, agora.data, agora, dateParaAgendamento(new Date(bloco.created_at)))) {
        return reply.status(409).send({ message: 'Esse bloco não está aberto pra marcar.' });
      }
      await query(
        `INSERT INTO rotina_marcacoes (bloco_id, data, status, motivo, user_id, user_name)
         VALUES ($1, $2::date, $3, $4, $5, $6)
         ON CONFLICT (bloco_id, data) DO UPDATE SET status = EXCLUDED.status, motivo = EXCLUDED.motivo,
           user_id = EXCLUDED.user_id, user_name = EXCLUDED.user_name, marcado_em = NOW()`,
        [bloco.id, agora.data, v.ok.status, v.ok.motivo, sub, dono.nome]
      );
      return { ok: true };
    }
  );

  // GET /api/rotina/semana?pagina=&semana=YYYY-MM-DD (admin) — os blocos de segunda a sexta da semana, com o estado
  // de cada dia, e as folgas.
  app.get<{ Querystring: { pagina?: string; semana?: string } }>(
    '/api/rotina/semana',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      const r = await rotinaPedida(sub, role, req.query.pagina);
      if (!r) return reply.status(400).send({ message: 'Aba sem rotina.' });
      const agora = agoraLocal();
      const segunda = segundaDaSemana(DATA.test(req.query.semana ?? '') ? req.query.semana! : agora.data);
      const dias = [0, 1, 2, 3, 4].map((n) => somarDias(segunda, n));
      const sexta = dias[4];
      const [blocos, marcacoes, folgas, reunioes] = await Promise.all([
        blocosDaPagina(r.pagina),
        marcacoesNoPeriodo(r.pagina, segunda, sexta),
        folgasNoPeriodo(r.pagina, segunda, sexta),
        reunioesNoPeriodo(r.pagina, `${segunda}T00:00`, `${somarDias(sexta, 1)}T00:00`),
      ]);
      return {
        pagina: r.pagina,
        nome_da_pagina: await nomeDaPagina(r.pagina),
        dono: r.dono?.nome ?? '',
        hoje: agora.data,
        dias: dias.map((d) => ({ data: d, folga: folgas.has(d) })),
        blocos: blocos.map((b) => ({
          ...b,
          dias: dias.map((d) => {
            const marcacao = paraMarcacao(marcacoes.find((m) => m.bloco_id === b.id && m.data === d));
            const doBloco = b.tipo === 'reuniao' ? reunioesDoBloco(reunioes, b, d) : [];
            return {
              data: d,
              estado: folgas.has(d) ? 'folga' : estadoDoBloco(b, d, agora, marcacao, doBloco.length > 0, b.criado_em),
              marcacao: marcacao && { ...marcacao, atrasado: marcouAtrasado(b, d, marcacao) },
              reunioes: doBloco,
            };
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
              [pagina, b.inicio, b.fim, b.titulo, b.itens, b.tipo as TipoDeBloco]
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
