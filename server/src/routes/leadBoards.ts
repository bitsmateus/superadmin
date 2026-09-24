import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../db.js';
import { findMatchingClientId } from '../lib/leadMatch.js';

/**
 * Toda venda nova (funil ou avulsa) já cria sozinha a linha correspondente em Gestão Interna >
 * Comissão SDR — só com Nome e Pessoa (o SDR) preenchidos. Tipo, Valor, Referência e Contrato
 * ficam em branco/manual de propósito (a pessoa que registra a comissão escolhe isso à mão,
 * inclusive porque uma venda vira comissão de "Venda sistema" ou "Venda tráfego" dependendo de
 * um critério que não dá pra inferir sozinho aqui). Nunca lança: efeito colateral de criar a
 * venda, não pode derrubar isso se der erro.
 */
async function createCommissionStub(nome: string, sdr: string, month: string, vendaLeadId: string | null = null) {
  try {
    if (!sdr?.trim()) return;
    await query(
      `INSERT INTO commission_entries
        (nome, person, role, type_id, type_label, reference, base_value_cents, amount_cents, month, status, contrato_assinado, venda_lead_id)
       VALUES ($1,$2,'sdr',NULL,'(a definir)','',NULL,0,$3,'pendente',false,$4)`,
      [nome, sdr, month, vendaLeadId]
    );
  } catch (err) {
    console.error('[commissions] falha ao criar comissão em branco pra venda', nome, err);
  }
}

/**
 * Resolve a allowlist de quadros de um usuário restrito. A permissão de menu é só "comercial"
 * (tudo ou nada — as abas viraram gerenciáveis, não dá mais pra restringir por aba individual
 * nessa camada); a granularidade fina é por ABA inteira (user_page_access) — ex.: um SDR só
 * enxerga "Novos Leads" e "CRM Luis", nunca "CRM Arthur", com todos os quadros dessas 2 abas.
 * null = sem restrição (vê tudo) · [] = não vê nenhum quadro (inclui "nenhuma aba marcada ainda" —
 * quem gerencia Equipe precisa marcar manualmente cada aba liberada) · string[] = allowlist de
 * board ids. Só faz consulta extra pro papel 'suporte' ("Usuário") — admin/supervisor saem com null.
 */
export async function restrictedBoardFilter(userId: string, role: string): Promise<string[] | null> {
  if (role !== 'suporte') return null;
  const profile = await queryOne<{ restrict_access: boolean }>(
    'SELECT restrict_access FROM profiles WHERE id = $1',
    [userId]
  );
  if (!profile?.restrict_access) return null;

  const menuRows = await query<{ menu_key: string }>(
    'SELECT menu_key FROM user_menu_access WHERE user_id = $1',
    [userId]
  );
  // Sem nenhuma permissão de menu salva ainda = restrição não configurada por área, só por aba.
  const hasComercial = menuRows.length === 0 || menuRows.some((r) => r.menu_key === 'comercial');
  if (!hasComercial) return [];

  const pageAccess = await query<{ page_id: string }>(
    'SELECT page_id FROM user_page_access WHERE user_id = $1',
    [userId]
  );
  if (!pageAccess.length) return []; // nenhuma aba marcada ainda = não vê nenhum quadro

  const boards = await query<{ id: string }>(
    'SELECT id FROM lead_boards WHERE page = ANY($1)',
    [pageAccess.map((r) => r.page_id)]
  );
  return boards.map((r) => r.id);
}

async function getActorName(userId: string | null | undefined): Promise<string> {
  if (!userId) return 'Sistema';
  const profile = await queryOne<{ name: string | null; email: string }>(
    'SELECT name, email FROM profiles WHERE id = $1',
    [userId]
  );
  return profile?.name || profile?.email || 'Alguém';
}

/** Grava um evento na linha do tempo automática do lead (ver aba "Linha do tempo" no modal). */
async function logLeadEvent(
  leadRowId: string,
  type: string,
  fromValue: string | null,
  toValue: string | null,
  actorName: string
): Promise<void> {
  await query(
    `INSERT INTO lead_events (lead_row_id, type, from_value, to_value, actor_name)
     VALUES ($1,$2,$3,$4,$5)`,
    [leadRowId, type, fromValue, toValue, actorName]
  );
}

/** Campos rastreados na linha do tempo — chave da coluna ↔ tipo de evento gravado. */
const TRACKED_FIELDS: Record<string, string> = {
  status: 'status',
  dia_contato: 'dia_contato',
  sdr: 'sdr',
  retornado: 'retornado',
};

/**
 * Etiquetas de Status que contam como "marco" pro dashboard de SDR. A classificação de cada
 * lead usa sempre a ocorrência MAIS RECENTE de uma dessas três na linha do tempo (não o status
 * literal atual) — assim, se o lead voltou de "no-show" pra "Reunião agendada", conta como
 * agendada; se saiu de "no-show" pra um status fora dessa lista (ex.: disparo em massa), continua
 * contando como no-show.
 */
const MILESTONE_AGENDADA = 'Reunião agendada';
const MILESTONE_VENDIDO = 'Vendido';
const MILESTONE_STATUSES = [MILESTONE_AGENDADA, 'Reunião não comparecida', MILESTONE_VENDIDO];

/** O CAMINHO VÁLIDO depois de agendar uma reunião: continua agendada, virou no-show, seguiu pra
 * proposta/follow-up, ou fechou venda. Usado como o único critério de "ever_agendada" (denominador
 * do funil) — o status ATUAL do lead precisa estar aqui, não importa o que ele já foi no passado
 * (evita contar erro de SDR: marcar Reunião agendada e depois corrigir pra um status fora desse
 * caminho, tipo "Disparo em massa", não deve contar como agendamento de verdade). Não muda o
 * "milestone" (marco mais recente, usado separadamente pra no-show/vendas). */
const POST_AGENDAMENTO_STATUSES = [
  MILESTONE_AGENDADA,
  'Reunião não comparecida',
  'Proposta Enviada',
  'Follow-up Propostas',
  MILESTONE_VENDIDO,
];

/**
 * Sincroniza o registro de venda quando o status de um lead muda.
 *
 * Virou "Vendido"  → cria a oportunidade no quadro marcado com is_vendas, copiando nome, empresa,
 *                    SDR e os valores COMO ESTÃO AGORA (foto do momento — corrigir o lead depois
 *                    não altera o que já foi fechado). O lead continua no CRM do SDR, marcado
 *                    como vendido; a oportunidade é um registro novo, não uma mudança de lugar.
 * Saiu de "Vendido" → marca a oportunidade como revertida em vez de apagar, pra não perder o
 *                     histórico se alguém trocou o status por engano.
 * Voltou a "Vendido" → reaproveita a oportunidade que já existe (venda_origem_id é único), só
 *                      tira a marca de revertida. Assim ir e voltar não gera duplicata.
 *
 * Nunca lança: é chamado em background depois do UPDATE, e falhar aqui não pode derrubar a
 * edição do lead que o usuário acabou de fazer.
 */
async function syncVendaFromStatus(leadRowId: string, fromStatus: string, toStatus: string) {
  try {
    if (fromStatus === toStatus) return;

    // Cópia do espelho nunca registra venda: o closer pode ser quem marca "Vendido", mas a venda
    // (e a comissão) sai UMA vez só, sempre pela lead original do Arthur — quem chama por ela
    // nesse caso é o propagarEspelho.
    const espelho = await queryOne<{ espelho_origem_id: string | null }>(
      'SELECT espelho_origem_id FROM lead_rows WHERE id = $1',
      [leadRowId]
    );
    if (espelho?.espelho_origem_id) return;

    if (toStatus !== MILESTONE_VENDIDO) {
      if (fromStatus !== MILESTONE_VENDIDO) return;
      await query(
        'UPDATE lead_rows SET venda_revertida = true WHERE venda_origem_id = $1',
        [leadRowId]
      );
      return;
    }

    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM lead_rows WHERE venda_origem_id = $1',
      [leadRowId]
    );
    if (existing) {
      await query('UPDATE lead_rows SET venda_revertida = false WHERE id = $1', [existing.id]);
      return;
    }

    const target = await queryOne<{ id: string }>('SELECT id FROM lead_boards WHERE is_vendas LIMIT 1');
    // Sem quadro de vendas configurado não há onde registrar — o lead vira Vendido normalmente e
    // o painel avisa que falta escolher o quadro. Silenciar aqui é de propósito.
    if (!target) return;

    const lead = await queryOne<{
      nome: string; empresa: string; telefone: string; sdr: string;
      valor_mrr: string; valor_implementacao: string;
    }>(
      `SELECT nome, empresa, telefone, sdr, valor_mrr, valor_implementacao
       FROM lead_rows WHERE id = $1`,
      [leadRowId]
    );
    if (!lead) return;

    const [{ max }] = await query<{ max: number | null }>(
      'SELECT MAX(position) as max FROM lead_rows WHERE board_id = $1',
      [target.id]
    );

    const [vendaRow] = await query<{ id: string }>(
      `INSERT INTO lead_rows (
        board_id, nome, empresa, telefone, sdr, status,
        valor_mrr, valor_implementacao, fechamento, venda_origem_id, position, veio_do_funil
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) RETURNING id`,
      [
        target.id, lead.nome, lead.empresa, lead.telefone, lead.sdr, MILESTONE_VENDIDO,
        lead.valor_mrr, lead.valor_implementacao,
        new Date().toISOString().slice(0, 10),
        leadRowId,
        (max ?? -1) + 1,
      ]
    );
    // venda_lead_id liga o lançamento de comissão à linha da venda — é o que faz renomear a venda
    // (ou marcar o contrato como assinado) chegar sozinho na Comissão SDR.
    void createCommissionStub(lead.nome, lead.sdr, new Date().toISOString().slice(0, 7), vendaRow?.id ?? null);
  } catch (err) {
    console.error('[vendas] falha ao sincronizar venda do lead', leadRowId, err);
  }
}

/**
 * Espelho CRM ARTHUR -> CRM LUIS CLOSER.
 *
 * Quando uma lead do CRM do Arthur chega em "Reunião agendada" (pelo Status ou arrastada pro
 * quadro), o closer precisa dela no CRM dele com o mesmo conteúdo. O app cria UMA cópia lá, ligada
 * à original por espelho_origem_id, e daí em diante o conteúdo anda junto nos dois sentidos: quem
 * editar de um lado, edita dos dois. Fora do espelho, de propósito:
 *  - status/quadro: cada CRM toca o funil dele. Status compartilhado criaria venda e comissão em
 *    DOBRO (uma por CRM), já que virar "Vendido" dispara o registro de venda;
 *  - o sentido contrário: lead que nasce no CRM do Luis não vira nada no do Arthur;
 *  - saída: tirar de "Reunião agendada" ou excluir no Arthur não mexe na cópia — o closer continua
 *    com a lead que já estava trabalhando.
 * As Atualizações são compartilhadas (ver idCanonicoDasNotas): os dois escrevem no mesmo histórico.
 */
const ESPELHO_PAGE_ORIGEM = 'crm-arthur';
const ESPELHO_PAGE_DESTINO = 'crm-luis-closer';

/** Campos de CONTEÚDO que andam juntos. Fora daqui: status e board_id (funil é de cada um),
 * position, notes_count e o pacote de venda (esse só existe na aba Vendas). */
const ESPELHO_CAMPOS = [
  'nome', 'tipo', 'empresa', 'telefone', 'dia_contato', 'ligacao', 'agendamento', 'retornar',
  'retornado', 'responsavel', 'sdr', 'numero', 'dor_cliente', 'numero_atendentes',
  'valor_mrr', 'valor_implementacao', 'observacoes',
];

/** "Reunião agendada"/"REUNIÃO AGENDADA" — nome do quadro varia de CRM pra CRM. "Reunião não
 * comparecida" não cai aqui porque não tem "agendada" no nome. */
function ehQuadroReuniaoAgendada(name: string): boolean {
  return name.toLowerCase().includes('agendada');
}

/** Etiquetas do funil que andam juntas nos dois CRMs. Status fora dessa lista (Primeiro Contato,
 * Disparo em massa, Perdidos, Desqualificado...) fica só no CRM onde foi mexido — cada um
 * organiza a base dele sem bagunçar a do outro. */
const ESPELHO_STATUS = [
  'Reunião agendada',
  'Reunião não comparecida',
  'Proposta Enviada',
  'Follow-up Propostas',
  'Vendido',
];

/** Sem acento, sem pontuação, minúsculo — pra comparar nome de quadro com nome de status mesmo
 * escritos diferente em cada CRM ("Follow-up Propostas" acha "FOLLOW UP PROPOSTAS (APÓS 3
 * TENTATIVAS)"). */
function normalizaNome(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Quadro equivalente ao status dentro da página do parceiro — senão a etiqueta muda mas a lead
 * fica parada no grupo errado. Sem equivalente (o CRM do closer não tem "Vendido" nem "Reunião
 * não comparecida"), devolve null: muda só a etiqueta e a lead fica onde está. */
async function quadroDoStatus(page: string, status: string): Promise<string | null> {
  const alvo = normalizaNome(status);
  const boards = await query<{ id: string; name: string }>(
    'SELECT id, name FROM lead_boards WHERE page = $1 ORDER BY position',
    [page]
  );
  const match =
    boards.find((b) => normalizaNome(b.name) === alvo) ??
    boards.find((b) => normalizaNome(b.name).startsWith(alvo));
  return match?.id ?? null;
}

/** Cria a cópia no CRM do closer, se ainda não existir. Nunca lança: roda em background depois da
 * edição, e falhar aqui não pode derrubar o que o usuário acabou de fazer. */
async function syncEspelhoReuniaoAgendada(leadRowId: string) {
  try {
    const lead = await queryOne<{
      status: string; espelho_origem_id: string | null; page: string; board_name: string;
      nome: string; tipo: string; empresa: string; telefone: string; dia_contato: string;
      ligacao: string; agendamento: string; retornar: string; retornado: boolean;
      responsavel: string; sdr: string; numero: string; dor_cliente: string;
      numero_atendentes: string; valor_mrr: string; valor_implementacao: string; observacoes: string;
    }>(
      `SELECT r.*, lb.page, lb.name AS board_name
       FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id
       WHERE r.id = $1 AND r.deleted_at IS NULL`,
      [leadRowId]
    );
    if (!lead) return;
    // Só nasce do CRM do Arthur, e só quando está de fato em "Reunião agendada".
    if (lead.page !== ESPELHO_PAGE_ORIGEM) return;
    // A própria linha já é uma cópia — nunca espelha o espelho.
    if (lead.espelho_origem_id) return;
    if (lead.status !== MILESTONE_AGENDADA && !ehQuadroReuniaoAgendada(lead.board_name)) return;

    const jaEspelhada = await queryOne<{ id: string }>(
      'SELECT id FROM lead_rows WHERE espelho_origem_id = $1',
      [leadRowId]
    );
    if (jaEspelhada) return;

    const destino =
      (await queryOne<{ id: string }>(
        `SELECT id FROM lead_boards WHERE page = $1 AND lower(name) LIKE '%agendada%'
         ORDER BY position LIMIT 1`,
        [ESPELHO_PAGE_DESTINO]
      )) ??
      (await queryOne<{ id: string }>(
        'SELECT id FROM lead_boards WHERE page = $1 ORDER BY position LIMIT 1',
        [ESPELHO_PAGE_DESTINO]
      ));
    // Sem CRM de destino configurado não há pra onde espelhar — silencioso de propósito: a lead do
    // Arthur segue normal.
    if (!destino) return;

    const [{ max }] = await query<{ max: number | null }>(
      'SELECT MAX(position) as max FROM lead_rows WHERE board_id = $1',
      [destino.id]
    );

    await query(
      `INSERT INTO lead_rows (
        board_id, nome, tipo, empresa, telefone, dia_contato, ligacao, status, agendamento,
        retornar, retornado, responsavel, sdr, numero, dor_cliente, numero_atendentes,
        valor_mrr, valor_implementacao, observacoes, espelho_origem_id, position
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      ON CONFLICT DO NOTHING`,
      [
        destino.id, lead.nome, lead.tipo, lead.empresa, lead.telefone, lead.dia_contato,
        lead.ligacao, MILESTONE_AGENDADA, lead.agendamento, lead.retornar, lead.retornado,
        lead.responsavel, lead.sdr, lead.numero, lead.dor_cliente, lead.numero_atendentes,
        lead.valor_mrr, lead.valor_implementacao, lead.observacoes, leadRowId, (max ?? -1) + 1,
      ]
    );
  } catch (err) {
    console.error('[espelho] falha ao espelhar lead pro CRM do closer', leadRowId, err);
  }
}

/** Edição de conteúdo vai pro outro lado do espelho (original <-> cópia). É um pulo só: o UPDATE
 * daqui não passa pelo PATCH de novo, então não entra em loop. */
async function propagarEspelho(
  leadRowId: string,
  espelhoOrigemId: string | null,
  patch: Record<string, unknown>,
  actorId: string
) {
  try {
    const campos = Object.keys(patch).filter((k) => ESPELHO_CAMPOS.includes(k));
    const novoStatus =
      typeof patch.status === 'string' && ESPELHO_STATUS.includes(patch.status) ? patch.status : null;
    if (!campos.length && !novoStatus) return;

    // espelhoOrigemId preenchido = quem foi editado é a CÓPIA, então o parceiro é a original.
    const parceiro = await queryOne<{ id: string; status: string; board_id: string; page: string }>(
      `SELECT r.id, r.status, r.board_id, lb.page
       FROM lead_rows r JOIN lead_boards lb ON lb.id = r.board_id
       WHERE ${espelhoOrigemId ? 'r.id = $1' : 'r.espelho_origem_id = $1'}`,
      [espelhoOrigemId ?? leadRowId]
    );
    if (!parceiro) return;

    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of campos) {
      sets.push(`${k} = $${params.length + 1}`);
      params.push(patch[k]);
    }

    const statusMudou = !!novoStatus && novoStatus !== parceiro.status;
    if (statusMudou) {
      sets.push(`status = $${params.length + 1}`);
      params.push(novoStatus);
      const quadro = await quadroDoStatus(parceiro.page, novoStatus!);
      if (quadro && quadro !== parceiro.board_id) {
        sets.push(`board_id = $${params.length + 1}`);
        params.push(quadro);
      }
    }
    if (!sets.length) return;

    params.push(parceiro.id);
    await query(`UPDATE lead_rows SET ${sets.join(', ')} WHERE id = $${params.length}`, params);

    // Quem recebeu foi a lead ORIGINAL (ou seja, quem editou foi o closer): a correção segue pra
    // aba Vendas também, senão o nome novo só aparecia nos dois CRMs e não na lista de vendas.
    if (espelhoOrigemId) void propagarVenda(parceiro.id, patch);

    if (statusMudou) {
      const actorName = await getActorName(actorId);
      await logLeadEvent(parceiro.id, 'status', parceiro.status, novoStatus, actorName);
      // Quem mexeu foi a cópia (closer): a venda nasce aqui, pela original, uma vez só.
      if (espelhoOrigemId) {
        await syncVendaFromStatus(parceiro.id, parceiro.status, novoStatus!);
      }
    }
  } catch (err) {
    console.error('[espelho] falha ao propagar edição do lead', leadRowId, err);
  }
}

/** Campos de IDENTIDADE que a aba Vendas reflete do lead de origem — renomear/corrigir o lead no
 * CRM tem que aparecer na lista de Vendas também (a linha de lá é uma cópia tirada no momento da
 * venda, e antes ela nunca era atualizada depois disso). De fora ficam:
 *  - valor_mrr/valor_implementacao: andam no sentido CONTRÁRIO (Vendas -> CRM), porque o valor que
 *    vale é o fechado na venda — ver o PATCH mais abaixo;
 *  - status/quadro/fechamento/observações e as marcas de pagamento: são da vida da VENDA, não do
 *    lead (a venda segue "Vendido" mesmo que o lead mude de etapa depois no CRM). */
const VENDA_CAMPOS = ['nome', 'empresa', 'telefone', 'sdr'];

/** Do registro da venda pro lançamento na Comissão SDR (ligados por venda_lead_id): o nome
 * corrigido e o "Contrato assinado" marcado na aba Vendas chegam sozinhos na comissão — antes era
 * o mesmo trabalho feito duas vezes, um em cada tela. Só esses dois campos: valor, tipo e
 * referência da comissão continuam 100% manuais, como a tela foi pedida. */
async function propagarComissao(vendaLeadId: string, patch: Record<string, unknown>) {
  try {
    const sets: string[] = [];
    const params: unknown[] = [];
    if ('nome' in patch) { sets.push(`nome = $${params.length + 1}`); params.push(patch.nome); }
    if ('contrato_assinado' in patch) {
      sets.push(`contrato_assinado = $${params.length + 1}`);
      params.push(patch.contrato_assinado);
    }
    if (!sets.length) return;
    params.push(vendaLeadId);
    await query(
      `UPDATE commission_entries SET ${sets.join(', ')}, updated_at = NOW() WHERE venda_lead_id = $${params.length}`,
      params
    );
  } catch (err) {
    console.error('[commissions] falha ao propagar pro lançamento de comissão', vendaLeadId, err);
  }
}

/** Leva pro registro da aba Vendas as correções de identidade feitas no lead de origem. */
async function propagarVenda(origemId: string, patch: Record<string, unknown>) {
  try {
    const campos = Object.keys(patch).filter((k) => VENDA_CAMPOS.includes(k));
    if (!campos.length) return;
    const venda = await queryOne<{ id: string }>(
      'SELECT id FROM lead_rows WHERE venda_origem_id = $1',
      [origemId]
    );
    if (!venda) return;
    const params = campos.map((k) => patch[k]);
    const sets = campos.map((k, idx) => `${k} = $${idx + 1}`);
    params.push(venda.id);
    await query(`UPDATE lead_rows SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
    // O nome novo segue da venda pro lançamento de comissão daquela venda.
    void propagarComissao(venda.id, patch);
  } catch (err) {
    console.error('[vendas] falha ao propagar correção pro registro de venda', origemId, err);
  }
}

/** As Atualizações são compartilhadas: a cópia não tem histórico próprio, lê e escreve no da lead
 * original. É o que faz Arthur e Luis conversarem no mesmo lugar. */
async function idCanonicoDasNotas(leadRowId: string): Promise<string> {
  const row = await queryOne<{ espelho_origem_id: string | null }>(
    'SELECT espelho_origem_id FROM lead_rows WHERE id = $1',
    [leadRowId]
  );
  return row?.espelho_origem_id ?? leadRowId;
}

/** O gatilho do banco conta as notas só na linha dona do histórico — aqui o número é refletido na
 * cópia também, pra o contador não aparecer zerado pro closer. */
async function sincronizarContagemNotas(canonicalId: string) {
  try {
    await query(
      `UPDATE lead_rows SET notes_count = (SELECT count(*) FROM lead_notes WHERE lead_row_id = $1)
       WHERE id = $1 OR espelho_origem_id = $1`,
      [canonicalId]
    );
  } catch (err) {
    console.error('[espelho] falha ao sincronizar contagem de notas', canonicalId, err);
  }
}

export async function leadBoardRoutes(app: FastifyInstance) {
  // GET /api/lead-rows/:id/ficha-status — essa lead já tem ficha de cadastro? (botão "Ficha de
  // cadastro" no cabeçalho da lead). Não existe vínculo direto lead <-> cliente (ver leadMatch.ts),
  // então procura primeiro o vínculo CONFIRMADO à mão (contracts.venda_lead_id), olhando também as
  // cópias da mesma lead (a da aba Vendas e a do espelho do closer), e só depois o casamento
  // automático por telefone/nome. "preenchida" = cliente achado e com ficha; "pendente" = cliente
  // achado mas sem ficha (cadastrado por outro caminho); "nao_atrelada" = nenhum cliente.
  app.get<{ Params: { id: string } }>(
    '/api/lead-rows/:id/ficha-status',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const lead = await queryOne<{
        id: string; telefone: string; nome: string; empresa: string;
        venda_origem_id: string | null; espelho_origem_id: string | null;
      }>(
        'SELECT id, telefone, nome, empresa, venda_origem_id, espelho_origem_id FROM lead_rows WHERE id = $1',
        [req.params.id]
      );
      if (!lead) return reply.status(404).send({ message: 'Lead não encontrada' });

      const base = [lead.id, lead.venda_origem_id, lead.espelho_origem_id].filter((v): v is string => !!v);
      const related = await query<{ id: string }>(
        `SELECT id FROM lead_rows
         WHERE id = ANY($1) OR venda_origem_id = ANY($1) OR espelho_origem_id = ANY($1)`,
        [base]
      );

      let client = await queryOne<{ id: string; ficha_cadastro: unknown }>(
        `SELECT c.id, c.ficha_cadastro FROM contracts ct JOIN clients c ON c.id = ct.client_id
         WHERE ct.venda_lead_id = ANY($1) ORDER BY ct.created_at DESC LIMIT 1`,
        [related.map((r) => r.id)]
      );
      if (!client) {
        const matchId = await findMatchingClientId(lead.telefone, lead.nome, lead.empresa);
        if (matchId) {
          client = await queryOne<{ id: string; ficha_cadastro: unknown }>(
            'SELECT id, ficha_cadastro FROM clients WHERE id = $1',
            [matchId]
          );
        }
      }
      if (!client) return { status: 'nao_atrelada', clientId: null };
      return { status: client.ficha_cadastro ? 'preenchida' : 'pendente', clientId: client.id };
    }
  );

  // GET /api/lead-rows/:id/support-view — card de leitura de UMA lead específica (dados + as
  // Atualizações), SEM checar restrictedBoardFilter de propósito: é o que deixa o Suporte ver o
  // histórico do SDR com o cliente (aba Pipeline > "Lead do CRM", ver LeadLinkPanel) mesmo sem
  // nenhum acesso ao Comercial como um todo. Não é uma brecha de busca livre — só devolve dado de
  // um ID que a pessoa já tem em mãos por um vínculo que o próprio app já validou
  // (contracts.venda_lead_id ou a sugestão automática por telefone/nome), nunca uma listagem.
  app.get<{ Params: { id: string } }>(
    '/api/lead-rows/:id/support-view',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const lead = await queryOne(
        `SELECT id, nome, empresa, telefone, tipo, dia_contato, status, sdr, dor_cliente,
                numero_atendentes, valor_mrr, valor_implementacao, created_at
         FROM lead_rows WHERE id = $1`,
        [req.params.id]
      );
      if (!lead) return reply.status(404).send({ message: 'Lead não encontrada' });
      const notes = await query(
        'SELECT id, author_name, content, attachments, created_at FROM lead_notes WHERE lead_row_id = $1 ORDER BY created_at DESC',
        [req.params.id]
      );
      return { lead, notes };
    }
  );

  // GET /api/lead-boards
  app.get('/api/lead-boards', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    const allowed = await restrictedBoardFilter(sub, role);
    if (allowed !== null) {
      if (!allowed.length) return [];
      return query('SELECT * FROM lead_boards WHERE id = ANY($1) ORDER BY position, created_at', [allowed]);
    }
    return query('SELECT * FROM lead_boards ORDER BY position, created_at');
  });

  // POST /api/lead-boards
  app.post<{ Body: Record<string, unknown> }>(
    '/api/lead-boards',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) return reply.status(403).send({ message: 'Acesso negado' });

      const b = req.body;
      const id = (b.id as string) || uuidv4();
      const page = (b.page as string) || 'novos_leads';
      let position = b.position as number | undefined;
      if (position === undefined) {
        const [row] = await query<{ max: number | null }>(
          'SELECT MAX(position) as max FROM lead_boards WHERE page = $1',
          [page]
        );
        position = (row?.max ?? -1) + 1;
      }
      const [board] = await query(
        `INSERT INTO lead_boards (id, name, color, page, position) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [id, b.name, b.color ?? '#4F8EF7', page, position]
      );
      return reply.status(201).send(board);
    }
  );

  // PATCH /api/lead-boards/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/lead-boards/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null && !allowed.includes(req.params.id)) {
        return reply.status(403).send({ message: 'Acesso negado' });
      }

      const patch = req.body;
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(patch)) {
        sets.push(`${key} = $${i++}`);
        params.push(val);
      }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });
      params.push(req.params.id);
      const [board] = await query(
        `UPDATE lead_boards SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!board) return reply.status(404).send({ message: 'Quadro não encontrado' });
      return board;
    }
  );

  // POST /api/lead-boards/:id/set-vendas — admin only. Elege o quadro que recebe as oportunidades
  // quando um lead vira "Vendido". Só um no sistema inteiro (índice único), então tira a marca dos
  // outros antes — sem isso o UPDATE quebraria no índice em vez de trocar o quadro escolhido.
  app.post<{ Params: { id: string } }>(
    '/api/lead-boards/:id/set-vendas',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { role } = req.user as { role: string };
      if (role !== 'admin') return reply.status(403).send({ message: 'Acesso negado' });
      await query('UPDATE lead_boards SET is_vendas = false WHERE is_vendas');
      const [board] = await query(
        'UPDATE lead_boards SET is_vendas = true WHERE id = $1 RETURNING *',
        [req.params.id]
      );
      if (!board) return reply.status(404).send({ message: 'Quadro não encontrado' });
      return board;
    }
  );

  // DELETE /api/lead-boards/:id
  app.delete<{ Params: { id: string } }>(
    '/api/lead-boards/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null && !allowed.includes(req.params.id)) {
        return reply.status(403).send({ message: 'Acesso negado' });
      }
      await query('DELETE FROM lead_boards WHERE id = $1', [req.params.id]);
      return reply.status(204).send();
    }
  );

  // GET /api/lead-rows — ?trash=1 lista os excluídos (pra Lixeira), em vez dos ativos.
  app.get<{ Querystring: { trash?: string } }>('/api/lead-rows', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    const allowed = await restrictedBoardFilter(sub, role);
    const trash = req.query.trash === '1';
    const deletedCond = trash ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL';
    const orderBy = trash ? 'deleted_at DESC' : 'position, created_at';
    if (allowed !== null) {
      if (!allowed.length) return [];
      return query(
        `SELECT * FROM lead_rows WHERE board_id = ANY($1) AND ${deletedCond} ORDER BY ${orderBy}`,
        [allowed]
      );
    }
    return query(`SELECT * FROM lead_rows WHERE ${deletedCond} ORDER BY ${orderBy}`);
  });

  // POST /api/lead-rows
  app.post<{ Body: Record<string, unknown> }>(
    '/api/lead-rows',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const b = req.body;
      if (!b.board_id) return reply.status(400).send({ message: 'board_id é obrigatório' });

      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null && !allowed.includes(b.board_id as string)) {
        return reply.status(403).send({ message: 'Acesso negado' });
      }

      // Mesma trava do PATCH: nunca cria lead direto num quadro de página arquivada (ex.: um front
      // com a lista de quadros em cache desatualizado, de antes da página ter sido arquivada).
      const targetBoard = await queryOne<{ page_archived: string | null; is_vendas: boolean }>(
        `SELECT lp.archived_at as page_archived, lb.is_vendas FROM lead_boards lb
         JOIN lead_pages lp ON lp.id = lb.page WHERE lb.id = $1`,
        [b.board_id]
      );
      if (targetBoard?.page_archived) {
        return reply.status(400).send({ message: 'Não é possível criar o lead num quadro de uma página arquivada.' });
      }

      const id = (b.id as string) || uuidv4();
      let position = b.position as number | undefined;
      if (position === undefined) {
        const [row] = await query<{ max: number | null }>(
          'SELECT MAX(position) as max FROM lead_rows WHERE board_id = $1',
          [b.board_id]
        );
        position = (row?.max ?? -1) + 1;
      }
      const [leadRow] = await query(
        `INSERT INTO lead_rows (
          id, board_id, nome, tipo, empresa, telefone, dia_contato, ligacao, status,
          agendamento, retornar, responsavel, sdr, numero,
          dor_cliente, numero_atendentes, valor_mrr, valor_implementacao, position, created_at,
          fechamento, venda_origem_id, mrr_pendente, impl_pendente, observacoes, veio_do_funil
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, COALESCE($20::timestamptz, NOW()),
          $21,$22,$23,$24,$25,$26
        ) RETURNING *`,
        [
          id, b.board_id, b.nome ?? '', b.tipo ?? '', b.empresa ?? '', b.telefone ?? '',
          b.dia_contato ?? '', b.ligacao ?? '', b.status ?? '',
          b.agendamento ?? '', b.retornar ?? '', b.responsavel ?? '', b.sdr ?? '', b.numero ?? '',
          b.dor_cliente ?? '', b.numero_atendentes ?? '', b.valor_mrr ?? '', b.valor_implementacao ?? '',
          position, b.created_at ?? null,
          b.fechamento ?? '', b.venda_origem_id ?? null, b.mrr_pendente ?? true, b.impl_pendente ?? true,
          b.observacoes ?? '', b.veio_do_funil ?? false,
        ]
      );
      void getActorName(sub).then((actorName) => logLeadEvent(id, 'created', null, null, actorName));
      // Venda avulsa registrada direto na aba Vendas (botão "Registrar venda") — mesma comissão em
      // branco que uma venda vinda do funil já ganha sozinha.
      if (targetBoard?.is_vendas) {
        const row = leadRow as { nome: string; sdr: string; fechamento: string; created_at: string };
        const month = (row.fechamento || row.created_at || '').slice(0, 7) || new Date().toISOString().slice(0, 7);
        void createCommissionStub(row.nome, row.sdr, month, id);
      }
      // Lead criada já dentro de "Reunião agendada" no CRM do Arthur também espelha pro closer.
      void syncEspelhoReuniaoAgendada(id);
      return reply.status(201).send(leadRow);
    }
  );

  // PATCH /api/lead-rows/:id
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/lead-rows/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const current = await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [req.params.id]
        );
        const targetBoardId = (req.body.board_id as string | undefined) ?? current?.board_id;
        if (!current || !allowed.includes(current.board_id) || (targetBoardId && !allowed.includes(targetBoardId))) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }

      const patch = req.body;

      // Nunca deixa um lead ir pra um quadro de página ARQUIVADA — travado aqui no servidor (não só
      // escondendo a opção no front) porque uma página arquivada some da navegação normal e o lead
      // vira invisível pro SDR, mesmo com o dado intacto no banco. Vale pra qualquer caminho que
      // troque board_id (drag-and-drop, menu "Mover", mudança de status que arrasta o quadro junto).
      if (typeof patch.board_id === 'string') {
        const targetBoard = await queryOne<{ page_archived: string | null }>(
          `SELECT lp.archived_at as page_archived FROM lead_boards lb
           JOIN lead_pages lp ON lp.id = lb.page WHERE lb.id = $1`,
          [patch.board_id]
        );
        if (targetBoard?.page_archived) {
          return reply.status(400).send({ message: 'Não é possível mover o lead para um quadro de uma página arquivada.' });
        }
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(patch)) {
        sets.push(`${key} = $${i++}`);
        params.push(val);
      }
      if (!sets.length) return reply.status(400).send({ message: 'Nada para atualizar' });

      // Snapshot "antes" só dos campos rastreados na linha do tempo — pra saber o que
      // realmente mudou depois do UPDATE (nada disso roda se não tiver campo rastreado no patch).
      const trackedKeys = Object.keys(patch).filter((k) => k in TRACKED_FIELDS || k === 'board_id');
      const before = trackedKeys.length
        ? await queryOne<{ status: string; dia_contato: string; sdr: string; retornado: boolean; board_id: string }>(
            'SELECT status, dia_contato, sdr, retornado, board_id FROM lead_rows WHERE id = $1',
            [req.params.id]
          )
        : null;

      params.push(req.params.id);
      const [leadRow] = await query(
        `UPDATE lead_rows SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
        params
      );
      if (!leadRow) return reply.status(404).send({ message: 'Linha não encontrada' });

      // Corrigir o MRR/Implementação numa venda sincronizada (ex.: desconto fechado depois)
      // atualiza o valor "oficial" no lead de origem também — só nesse sentido (Vendas -> CRM),
      // nunca o contrário, senão editar o lead depois apagaria a correção feita na venda.
      const vendaOrigemId = (leadRow as { venda_origem_id?: string | null }).venda_origem_id;
      if (vendaOrigemId && ('valor_mrr' in patch || 'valor_implementacao' in patch)) {
        const valores: Record<string, unknown> = {};
        if ('valor_mrr' in patch) valores.valor_mrr = patch.valor_mrr;
        if ('valor_implementacao' in patch) valores.valor_implementacao = patch.valor_implementacao;
        const campos = Object.keys(valores);
        const originSets = campos.map((k, idx) => `${k} = $${idx + 1}`);
        const originParams = [...campos.map((k) => valores[k]), vendaOrigemId];
        void query(`UPDATE lead_rows SET ${originSets.join(', ')} WHERE id = $${originParams.length}`, originParams)
          .catch((err) => console.error('[vendas] falha ao propagar valor pro lead de origem', vendaOrigemId, err));
        // O CRM do closer (cópia do espelho) acompanha o mesmo valor corrigido.
        void propagarEspelho(vendaOrigemId, null, valores, sub);
      }

      // Espelho CRM ARTHUR <-> CRM LUIS CLOSER: conteúdo e etiqueta de funil editados de um lado
      // refletem no outro...
      void propagarEspelho(
        req.params.id,
        (leadRow as { espelho_origem_id?: string | null }).espelho_origem_id ?? null,
        patch,
        sub
      );
      // ...e chegar em "Reunião agendada" (pelo Status ou arrastando de quadro) cria a cópia.
      if ('status' in patch || 'board_id' in patch) {
        void syncEspelhoReuniaoAgendada(req.params.id);
      }
      // Corrigir nome/empresa/telefone/SDR do lead atualiza a linha dele na aba Vendas também...
      void propagarVenda(req.params.id, patch);
      // ...e editar direto na aba Vendas (nome ou "Contrato assinado") atualiza a Comissão SDR.
      void propagarComissao(req.params.id, patch);

      if (before) {
        void (async () => {
          const actorName = await getActorName(sub);
          for (const key of trackedKeys) {
            if (key === 'board_id') {
              const fromId = before.board_id;
              const toId = patch.board_id as string;
              if (fromId === toId) continue;
              const [fromBoard, toBoard] = await Promise.all([
                queryOne<{ name: string }>('SELECT name FROM lead_boards WHERE id = $1', [fromId]),
                queryOne<{ name: string }>('SELECT name FROM lead_boards WHERE id = $1', [toId]),
              ]);
              await logLeadEvent(req.params.id, 'board', fromBoard?.name ?? null, toBoard?.name ?? null, actorName);
              continue;
            }
            const type = TRACKED_FIELDS[key];
            const fromVal = before[key as 'status' | 'dia_contato' | 'sdr' | 'retornado'];
            const toVal = patch[key];
            if (String(fromVal ?? '') === String(toVal ?? '')) continue;
            // Marcar/desmarcar "Vendido" reflete na aba Vendas — mesmo lugar onde a linha do
            // tempo já detecta a troca de status, pra não varrer o status em dois pontos.
            // Numa cópia do espelho isso não roda (syncVendaFromStatus ignora cópia): a venda sai
            // pela lead original, chamada de dentro do propagarEspelho.
            if (key === 'status') {
              await syncVendaFromStatus(req.params.id, String(fromVal ?? ''), String(toVal ?? ''));
            }
            await logLeadEvent(
              req.params.id,
              type,
              fromVal === null || fromVal === undefined ? null : String(fromVal),
              toVal === null || toVal === undefined ? null : String(toVal),
              actorName
            );
          }
        })();
      }

      return leadRow;
    }
  );

  // DELETE /api/lead-rows/:id — soft delete (marca deleted_at, não apaga de verdade) pra dar
  // pra restaurar depois pela Lixeira. `reason` é opcional (só a aba Vendas pede motivo hoje).
  app.delete<{ Params: { id: string }; Body: { reason?: string } | undefined }>(
    '/api/lead-rows/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const current = await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [req.params.id]
        );
        if (!current || !allowed.includes(current.board_id)) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }
      const reason = req.body?.reason?.trim() || null;
      await query('UPDATE lead_rows SET deleted_at = NOW(), delete_reason = $2 WHERE id = $1', [req.params.id, reason]);
      return reply.status(204).send();
    }
  );

  // POST /api/lead-rows/:id/restore — tira da Lixeira, volta a aparecer normal no quadro.
  app.post<{ Params: { id: string } }>(
    '/api/lead-rows/:id/restore',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const current = await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [req.params.id]
        );
        if (!current || !allowed.includes(current.board_id)) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }
      const [row] = await query('UPDATE lead_rows SET deleted_at = NULL WHERE id = $1 RETURNING *', [req.params.id]);
      if (!row) return reply.status(404).send({ message: 'Linha não encontrada' });
      return row;
    }
  );

  // GET /api/lead-events?page=xxx&from=iso&to=iso — log de tudo que aconteceu numa aba (todos os
  // SDRs/leads dela), pro botão "Log" ao lado de Filtro. from/to são timestamps ISO já calculados
  // no fuso do navegador (evita ambiguidade de "hoje"/"ontem" por fuso do servidor). Mesmas 500
  // mais recentes DENTRO do período, sem paginação — o filtro de data entra na query, não só no
  // front, senão um dia muito movimentado empurra dias mais antigos pra fora do LIMIT antes mesmo
  // de filtrar.
  app.get<{ Querystring: { lead_row_id?: string; page?: string; from?: string; to?: string } }>(
    '/api/lead-events',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);

      if (req.query.page) {
        const boardRows = await query<{ id: string }>('SELECT id FROM lead_boards WHERE page = $1', [req.query.page]);
        let boardIds = boardRows.map((r) => r.id);
        if (allowed !== null) boardIds = boardIds.filter((id) => allowed.includes(id));
        if (!boardIds.length) return [];
        const dateFilter = req.query.from && req.query.to ? 'AND le.created_at >= $2 AND le.created_at < $3' : '';
        const params: unknown[] = [boardIds];
        if (req.query.from && req.query.to) params.push(req.query.from, req.query.to);
        return query(
          `SELECT le.*, lr.nome AS lead_nome, lr.sdr AS lead_sdr
           FROM lead_events le
           JOIN lead_rows lr ON lr.id = le.lead_row_id
           WHERE lr.board_id = ANY($1) ${dateFilter}
           ORDER BY le.created_at DESC
           LIMIT 500`,
          params
        );
      }

      if (!req.query.lead_row_id) return reply.status(400).send({ message: 'lead_row_id ou page é obrigatório' });
      if (allowed !== null) {
        const row = await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [req.query.lead_row_id]
        );
        if (!row || !allowed.includes(row.board_id)) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }
      return query(
        'SELECT * FROM lead_events WHERE lead_row_id = $1 ORDER BY created_at DESC',
        [req.query.lead_row_id]
      );
    }
  );

  // GET /api/lead-activity — quando cada lead teve o "Dia de contato" alterado pela última vez
  // (ou a data de criação, se nunca mudou) — usado pra sinalizar quem está parado há mais de
  // 24h sem o SDR mexer (painel do dia, cartão "Status não atualizado").
  app.get('/api/lead-activity', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    const allowed = await restrictedBoardFilter(sub, role);
    if (allowed !== null && !allowed.length) return [];

    const boardFilter = allowed !== null ? 'WHERE lr.board_id = ANY($1)' : '';
    const params: unknown[] = allowed !== null ? [allowed] : [];

    return query(
      `SELECT lr.id, lr.board_id,
        COALESCE(
          (SELECT le.created_at FROM lead_events le
           WHERE le.lead_row_id = lr.id AND le.type = 'dia_contato'
           ORDER BY le.created_at DESC LIMIT 1),
          lr.created_at
        ) AS dia_contato_updated_at
       FROM lead_rows lr
       ${boardFilter}`,
      params
    );
  });

  // GET /api/lead-milestones — status "que conta" de cada lead (Reunião agendada / Reunião
  // não comparecida / Vendido), pro Dashboard de SDR. "milestone" é sempre o STATUS ATUAL do
  // lead (só isso — se não for um dos três, não tem milestone) — NÃO o "último evento desse tipo
  // na história". Um lead marcado Vendido e depois mudado pra outro status (ex.: "Disparo em
  // massa") tem que SAIR da contagem de vendas: contar pelo último evento do tipo, ignorando
  // mudanças posteriores pra status não-milestone, inflava vendas/no-show com gente que já foi
  // corrigido/mudado de status depois.
  // "ever_agendada" (denominador do funil) exige um CAMINHO VÁLIDO: o status ATUAL tem que ser
  // Reunião agendada, Reunião não comparecida, Proposta Enviada, Follow-up Propostas ou Vendido —
  // ou seja, ou está agendado agora, ou seguiu o funil esperado dali em diante. NÃO basta ter tido
  // um evento de "virou Reunião agendada" em algum momento da história: se o SDR errou (marcou
  // Reunião agendada por engano e corrigiu pra outro status fora desse caminho, tipo "Disparo em
  // massa" ou de volta pra "Primeiro Contato"), isso não é um agendamento de verdade e não deve
  // contar — só o histórico de evento, sem olhar o status atual, deixava esse erro contando pra
  // sempre.
  // "milestone_at" é a data do evento de status mais recente do lead (se o status atual bate com
  // o milestone, foi essa mudança que colocou ele lá). "first_agendada_at" é a data do PRIMEIRO
  // "Reunião agendada" da história — fica fixa mesmo com reagendamento depois de um no-show.
  // EXCLUI quadros marcados is_vendas: quando um lead vira "Vendido", o app cria uma cópia dele
  // (oportunidade) no quadro de Vendas (ver comentário em POST/PATCH lead-rows) — sem excluir
  // esses quadros aqui, a mesma venda contava duas vezes (o lead original marcado Vendido E a
  // cópia da oportunidade), inflando "Vendas fechadas" nas métricas de SDR/Painel do Mês.
  app.get('/api/lead-milestones', { onRequest: [app.authenticate] }, async (req) => {
    const { sub, role } = req.user as { sub: string; role: string };
    const allowed = await restrictedBoardFilter(sub, role);
    if (allowed !== null && !allowed.length) return [];

    const boardFilter = allowed !== null ? 'AND lr.board_id = ANY($4)' : '';
    const params: unknown[] = [MILESTONE_STATUSES, POST_AGENDAMENTO_STATUSES, MILESTONE_AGENDADA];
    if (allowed !== null) params.push(allowed);

    // "ever_agendada" exige as DUAS coisas: o status atual estar no caminho válido pós-agendamento
    // (evita contar quem teve "Reunião agendada" corrigida por engano depois pra fora do caminho,
    // ver comentário acima) E o lead ter passado de verdade por "Reunião agendada" em algum
    // momento — current status = $3 (setado direto, sem evento — ex.: importado assim) OU um
    // evento real de status -> "Reunião agendada" no histórico. Sem essa segunda checagem, um lead
    // que pulou direto de "Primeiro contato" pra "Proposta Enviada" (nunca passou por Agendada)
    // contava como agendado só por o status atual estar no caminho — inflava a métrica de
    // agendamentos com lead que nunca foi agendado de verdade.
    const everAgendadaSql = `(
      lr.status = ANY($2) AND (
        lr.status = $3
        OR EXISTS (
          SELECT 1 FROM lead_events le
          WHERE le.lead_row_id = lr.id AND le.type = 'status' AND le.to_value = $3
        )
      )
    )`;

    return query(
      `SELECT lr.id, lr.board_id, lr.sdr,
        CASE WHEN lr.status = ANY($1) THEN lr.status END AS milestone,
        CASE WHEN lr.status = ANY($1) THEN
          COALESCE(
            (SELECT le.created_at FROM lead_events le
             WHERE le.lead_row_id = lr.id AND le.type = 'status'
             ORDER BY le.created_at DESC LIMIT 1),
            lr.created_at
          )
        END AS milestone_at,
        ${everAgendadaSql} AS ever_agendada,
        CASE WHEN ${everAgendadaSql} THEN
          COALESCE(
            (SELECT MIN(le.created_at) FROM lead_events le
             WHERE le.lead_row_id = lr.id AND le.type = 'status' AND le.to_value = $3),
            lr.created_at
          )
        END AS first_agendada_at
       FROM lead_rows lr
       JOIN lead_boards lb ON lb.id = lr.board_id
       WHERE lb.is_vendas = false
       AND lr.espelho_origem_id IS NULL
       ${boardFilter}`,
      params
    );
  });

  // GET /api/lead-notes?lead_row_id=xxx — bloco de anotações/atualizações do lead
  app.get<{ Querystring: { lead_row_id?: string } }>(
    '/api/lead-notes',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      if (!req.query.lead_row_id) return reply.status(400).send({ message: 'lead_row_id é obrigatório' });
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const row = await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [req.query.lead_row_id]
        );
        if (!row || !allowed.includes(row.board_id)) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }
      // Lead espelhada lê o histórico da original — os dois CRMs veem as mesmas Atualizações.
      const canonicalId = await idCanonicoDasNotas(req.query.lead_row_id as string);
      return query(
        'SELECT * FROM lead_notes WHERE lead_row_id = $1 ORDER BY created_at DESC',
        [canonicalId]
      );
    }
  );

  // POST /api/lead-notes
  app.post<{ Body: Record<string, unknown> }>(
    '/api/lead-notes',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const b = req.body;
      const hasAttachments = Array.isArray(b.attachments) && b.attachments.length > 0;
      // Conteúdo é opcional quando tem anexo — mandar só um print/arquivo sem texto é válido.
      if (!b.lead_row_id || (!b.content && !hasAttachments)) {
        return reply.status(400).send({ message: 'lead_row_id é obrigatório, e content ou attachments também' });
      }
      const { sub: authorId, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(authorId, role);
      if (allowed !== null) {
        const row = await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [b.lead_row_id]
        );
        if (!row || !allowed.includes(row.board_id)) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }
      // Atualização escrita na cópia entra no histórico da lead original — um só pros dois CRMs.
      const canonicalId = await idCanonicoDasNotas(b.lead_row_id as string);
      const [note] = await query(
        `INSERT INTO lead_notes (lead_row_id, author_id, author_name, content, attachments, created_at)
         VALUES ($1,$2,$3,$4,$5, COALESCE($6::timestamptz, NOW())) RETURNING *`,
        [
          canonicalId, authorId ?? null, b.author_name ?? 'Alguém', b.content ?? '',
          JSON.stringify(b.attachments ?? []), b.created_at ?? null,
        ]
      );
      void sincronizarContagemNotas(canonicalId);
      return reply.status(201).send(note);
    }
  );

  // PATCH /api/lead-notes/:id — edita o texto de uma atualização
  app.patch<{ Params: { id: string }; Body: { content?: string } }>(
    '/api/lead-notes/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const note = await queryOne<{ lead_row_id: string }>(
          'SELECT lead_row_id FROM lead_notes WHERE id = $1',
          [req.params.id]
        );
        const row = note && await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [note.lead_row_id]
        );
        if (!row || !allowed.includes(row.board_id)) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }

      const content = req.body.content?.trim();
      if (!content) return reply.status(400).send({ message: 'content é obrigatório' });
      const [note] = await query(
        `UPDATE lead_notes SET content = $1 WHERE id = $2 RETURNING *`,
        [content, req.params.id]
      );
      if (!note) return reply.status(404).send({ message: 'Anotação não encontrada' });
      return note;
    }
  );

  // DELETE /api/lead-notes/:id
  app.delete<{ Params: { id: string } }>(
    '/api/lead-notes/:id',
    { onRequest: [app.authenticate] },
    async (req, reply) => {
      const { sub, role } = req.user as { sub: string; role: string };
      const allowed = await restrictedBoardFilter(sub, role);
      if (allowed !== null) {
        const note = await queryOne<{ lead_row_id: string }>(
          'SELECT lead_row_id FROM lead_notes WHERE id = $1',
          [req.params.id]
        );
        const row = note && await queryOne<{ board_id: string }>(
          'SELECT board_id FROM lead_rows WHERE id = $1',
          [note.lead_row_id]
        );
        if (!row || !allowed.includes(row.board_id)) {
          return reply.status(403).send({ message: 'Acesso negado' });
        }
      }
      const noteRow = await queryOne<{ lead_row_id: string }>(
        'SELECT lead_row_id FROM lead_notes WHERE id = $1',
        [req.params.id]
      );
      await query('DELETE FROM lead_notes WHERE id = $1', [req.params.id]);
      if (noteRow) void sincronizarContagemNotas(noteRow.lead_row_id);
      return reply.status(204).send();
    }
  );
}
