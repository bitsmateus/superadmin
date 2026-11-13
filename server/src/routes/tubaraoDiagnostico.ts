import { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { chaveTelefone, mesmoTelefone } from '../lib/integracaoCards.js';

/**
 * Conferência do CRM TUBARAO (pedido de 13/11) — SÓ LEITURA, nada aqui escreve no banco.
 *  1) As colunas que a automação da Luiza usa existem no CRM TUBARAO com o nome exato?
 *  2) Todos os cards (em todos os quadros) dos leads que vão ser acertados — pra conferir ANTES de mexer.
 * Só administrador.
 */
const PAGINA_TUBARAO = 'crm-outbound';
const COLUNAS_DA_AUTOMACAO = [
  'Leads Novos', 'Primeiro contato', 'Qualificado', 'Reunião agendada', 'Reunião não comparecida',
  'Desqualificado', 'Disparo em massa', 'Follow up Propostas',
];
/** Os leads do pedido: por nome (só os "de Tubarão": Tipo "tubarao…" ou DDD 48) ou por telefone. */
const LEADS = [
  { rotulo: 'Rodolfo', nomes: ['rodolfo'], telefones: [] as string[] },
  { rotulo: 'Patrícia Rechia', nomes: ['patricia rechia', 'rechia'], telefones: [] as string[] },
  { rotulo: 'Luiz', nomes: ['luiz'], telefones: [] as string[] },
  { rotulo: 'Fabi / Fabiana', nomes: ['fabi', 'fabiana'], telefones: ['5548999184471'] },
];

const norm = (s: string) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const normCompacto = (s: string) => norm(s).replace(/[^a-z0-9]/g, '');
function dddDoTelefone(t: string): string {
  const d = String(t ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d.slice(2, 4);
  if (d.length === 10 || d.length === 11) return d.slice(0, 2);
  return '';
}
const ehDeTubarao = (c: { tipo: string; telefone: string }) => norm(c.tipo).startsWith('tubarao') || dddDoTelefone(c.telefone) === '48';
/** O termo aparece como palavra(s) inteira(s) no nome/empresa ("luiz" não casa com "luiza"). */
function casaNome(texto: string, termo: string): boolean {
  const t = ` ${norm(texto).replace(/[^a-z0-9]+/g, ' ')} `;
  return t.includes(` ${termo} `);
}

interface CardLinha {
  id: string; nome: string; empresa: string; telefone: string; tipo: string; sdr: string; status: string;
  agendamento: string; created_at: string; deleted_at: string | null; notes_count: number;
  espelho_origem_id: string | null; copia_ia_origem_id: string | null; venda_origem_id: string | null;
  coluna: string; pagina_id: string; pagina: string; is_vendas: boolean;
}

export async function tubaraoDiagnosticoRoutes(app: FastifyInstance) {
  app.get('/api/admin/tubarao/diagnostico', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { role } = req.user as { role?: string };
    if (role !== 'admin') return reply.status(403).send({ message: 'Só administrador.' });

    // 1) colunas
    const quadros = await query<{ name: string; position: number }>(
      'SELECT name, position FROM lead_boards WHERE page = $1 ORDER BY position', [PAGINA_TUBARAO]
    );
    const colunas = COLUNAS_DA_AUTOMACAO.map((esperado) => {
      const exato = quadros.find((q) => q.name === esperado);
      const parecido = exato ? null : quadros.find((q) => normCompacto(q.name) === normCompacto(esperado));
      return { esperado, situacao: exato ? 'ok' : parecido ? 'nome diferente' : 'falta', nomeNoTubarao: exato?.name ?? parecido?.name ?? null };
    });

    // 2) cards
    const todos = await query<CardLinha>(
      `SELECT r.id, COALESCE(r.nome, '') AS nome, COALESCE(r.empresa, '') AS empresa, COALESCE(r.telefone, '') AS telefone,
              COALESCE(r.tipo, '') AS tipo, COALESCE(r.sdr, '') AS sdr, COALESCE(r.status, '') AS status,
              COALESCE(r.agendamento, '') AS agendamento, r.created_at, r.deleted_at, COALESCE(r.notes_count, 0) AS notes_count,
              r.espelho_origem_id, r.copia_ia_origem_id, r.venda_origem_id,
              lb.name AS coluna, lp.id AS pagina_id, lp.name AS pagina, lb.is_vendas
       FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id JOIN lead_pages lp ON lp.id = lb.page
       WHERE lp.section = 'comercial'`
    );
    const notasPorCard = new Map((await query<{ lead_row_id: string; n: string }>(
      'SELECT lead_row_id, count(*) AS n FROM lead_notes GROUP BY lead_row_id'
    )).map((x) => [x.lead_row_id, Number(x.n)]));

    const leads = LEADS.map((l) => {
      const porTelefone = todos.filter((c) => l.telefones.some((t) => mesmoTelefone(c.telefone, t)));
      const porNome = todos.filter((c) => ehDeTubarao(c) && l.nomes.some((n) => casaNome(c.nome, n) || casaNome(c.empresa, n)));
      // Todo card que divide o telefone com um dos achados (a mesma pessoa em outro quadro, com outro nome).
      const chaves = new Set([...porTelefone, ...porNome].map((c) => chaveTelefone(c.telefone)?.ultimos8).filter(Boolean) as string[]);
      const achados = todos.filter((c) => porTelefone.includes(c) || porNome.includes(c)
        || (chaves.has(chaveTelefone(c.telefone)?.ultimos8 ?? '-') && [...porTelefone, ...porNome].some((a) => mesmoTelefone(a.telefone, c.telefone))));
      const cards = achados
        .sort((a, b) => (a.telefone.localeCompare(b.telefone)) || (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()))
        .map((c) => ({
          id: c.id, nome: c.nome, empresa: c.empresa, telefone: c.telefone, tipo: c.tipo, sdr: c.sdr, status: c.status,
          quadro: c.pagina, quadroId: c.pagina_id, coluna: c.coluna, agendamento: c.agendamento, criadoEm: c.created_at,
          excluido: !!c.deleted_at, atualizacoes: notasPorCard.get(c.id) ?? 0,
          tipoDeCard: c.venda_origem_id ? 'linha da aba Vendas' : c.espelho_origem_id ? 'cópia do closer (espelho)'
            : c.copia_ia_origem_id ? 'cópia da IA Luiza' : c.is_vendas ? 'aba Vendas' : 'original',
          deTubarao: ehDeTubarao(c),
        }));
      return { rotulo: l.rotulo, cards };
    });

    // 3) "e outros": todo lead de Tubarão (Tipo "tubarao…" ou DDD 48) que ainda está fora do CRM TUBARAO — só os
    // cards originais (não as cópias do closer/IA nem a aba Vendas) no CRM ARTHUR e no CRM IA LUIZA.
    const foraDoTubarao = todos
      .filter((c) => !c.deleted_at && !c.is_vendas && !c.espelho_origem_id && !c.copia_ia_origem_id && !c.venda_origem_id
        && (c.pagina_id === 'crm-arthur' || c.pagina_id === 'crm-ia-luiza') && ehDeTubarao(c))
      .sort((a, b) => a.pagina.localeCompare(b.pagina) || a.coluna.localeCompare(b.coluna) || a.nome.localeCompare(b.nome))
      .map((c) => ({
        id: c.id, nome: c.nome, empresa: c.empresa, telefone: c.telefone, tipo: c.tipo, sdr: c.sdr, quadro: c.pagina,
        coluna: c.coluna, agendamento: c.agendamento, criadoEm: c.created_at, atualizacoes: notasPorCard.get(c.id) ?? 0,
        motivo: norm(c.tipo).startsWith('tubarao') ? 'Tipo Tubarão' : 'DDD 48',
      }));

    return { quadroTubarao: PAGINA_TUBARAO, colunas, colunasDoTubarao: quadros.map((q) => q.name), leads, foraDoTubarao };
  });
}
