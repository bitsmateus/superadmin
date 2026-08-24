import { Pool, PoolClient } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle pg client', err);
});

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// LISTEN/NOTIFY listener for SSE realtime
let listenerClient: PoolClient | null = null;
type NotifyHandler = (table: string, type: string, data: Record<string, unknown>) => void;
const handlers: NotifyHandler[] = [];

export function onDbChange(handler: NotifyHandler) {
  handlers.push(handler);
}

/**
 * Libera um slug "bonito" (ex.: 'vendas', 'crm-luis') travado por uma aba sobra de teste — quando
 * uma aba nova nasce com o mesmo nome de outra que já existia, `uniquePageId` evita a colisão
 * acrescentando "-2". Se a original ficar vazia (sem quadro nenhum, então nunca teve uso real),
 * apaga ela e renomeia a "-2" pro slug limpo. Não mexe em nada se a original tiver quadro — nesse
 * caso não dá pra saber se é sobra de teste ou uma aba de verdade, então não arrisca apagar.
 * Efetivamente roda uma vez só por par: depois que renomeia, `staleId` não existe mais.
 */
async function freeUpSlug(cleanId: string, staleWithSuffixId: string) {
  // DO $$ ... $$ não aceita parâmetro de query ($1/$2) — os dois ids aqui são sempre literais
  // fixos escritos no próprio código-fonte (nunca vêm de request), então interpolar é seguro.
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM lead_pages WHERE id = '${cleanId}')
       AND EXISTS (SELECT 1 FROM lead_pages WHERE id = '${staleWithSuffixId}')
       AND NOT EXISTS (SELECT 1 FROM lead_boards WHERE page = '${cleanId}') THEN
      DELETE FROM lead_pages WHERE id = '${cleanId}';
    END IF;
  END $$`);
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM lead_pages WHERE id = '${staleWithSuffixId}')
       AND NOT EXISTS (SELECT 1 FROM lead_pages WHERE id = '${cleanId}') THEN
      ALTER TABLE lead_boards DROP CONSTRAINT IF EXISTS lead_boards_page_fkey;
      ALTER TABLE user_page_access DROP CONSTRAINT IF EXISTS user_page_access_page_id_fkey;
      UPDATE lead_pages SET id = '${cleanId}' WHERE id = '${staleWithSuffixId}';
      UPDATE lead_boards SET page = '${cleanId}' WHERE page = '${staleWithSuffixId}';
      UPDATE user_page_access SET page_id = '${cleanId}' WHERE page_id = '${staleWithSuffixId}';
      ALTER TABLE lead_boards ADD CONSTRAINT lead_boards_page_fkey FOREIGN KEY (page) REFERENCES lead_pages(id);
      ALTER TABLE user_page_access ADD CONSTRAINT user_page_access_page_id_fkey FOREIGN KEY (page_id) REFERENCES lead_pages(id) ON DELETE CASCADE;
    END IF;
  END $$`);
}

/** Idempotent schema migrations — safe to run on every startup. */
export async function runMigrations() {
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS servers JSONB`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS tenant_api_token TEXT`);
  // Espaço de Suporte: tarefas/pendências/reuniões/anotações.
  await pool.query(`ALTER TABLE reminders ADD COLUMN IF NOT EXISTS kind TEXT`);
  await pool.query(`ALTER TABLE reminders ADD COLUMN IF NOT EXISTS status TEXT`);
  await pool.query(`ALTER TABLE reminders ADD COLUMN IF NOT EXISTS priority TEXT`);
  // due_at passa a ser opcional (backlog / anotação sem data).
  await pool.query(`ALTER TABLE reminders ALTER COLUMN due_at DROP NOT NULL`);
  // Grupo do WhatsApp para alertas do suporte (apiId/token/groupId/baseUrl).
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS support_group JSONB`);
  // Ficha de cadastro (formulário público) + número pessoal do cliente.
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS ficha_cadastro JSONB`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS briefing_number TEXT`);
  // Progresso da config de API Oficial e de IA (checklist com estado).
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS config_progress JSONB`);
  // Fluxo do chatbot gerado a partir do briefing (spec revisável + JSON final).
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS chatbot_flow_spec JSONB`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS chatbot_flow_json JSONB`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS chatbot_flow_warnings JSONB`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS chatbot_flow_generated_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS chatbot_flow_published_at TIMESTAMPTZ`);
  // Arquivamento (soft-delete): card sai do pipeline mas pode ser restaurado
  // ou excluído permanentemente na tela de Arquivados.
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
  // Responsáveis separados: comercial e de entrega (selecionados da equipe).
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS responsavel_comercial TEXT`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS responsavel_entrega TEXT`);
  // Notificação de canais POR TENANT: liga/desliga + número que recebe o aviso
  // (default = telefone do cliente da Visão Geral).
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS channel_notify_enabled BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS channel_notify_number TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS clients_archived_at_idx ON clients(archived_at)`);
  // Nova etapa "Entregas Recentes" (delivered) entre delivery e active.
  // ALTER TYPE ... ADD VALUE não roda dentro de transação — pool.query roda solto.
  await pool.query(
    `ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'delivered' AFTER 'delivery'`
  );
  // Etapas "Iniciar Configuração" (setup_start) e "Pronto para Entrega"
  // (setup_done), em volta de "setup".
  await pool.query(
    `ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'setup_start' BEFORE 'setup'`
  );
  await pool.query(
    `ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'setup_done' AFTER 'setup'`
  );
  // Credenciais da Evolution API (baseUrl + apiKey) para criar instâncias.
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS evolution JSONB`);
  // Servidores UAZAPI ([{url, token}]) para reconciliar status real dos canais.
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS uazapi JSONB`);
  // SLA (dias) por etapa do pipeline — configurável nas Configurações.
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS sla_by_stage JSONB`);
  // Fila de configuração: prioridade manual (menor = passa na frente) e o
  // momento em que a config começou de fato ("fazendo agora" x "aguardando vez").
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS queue_priority INT`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS setup_started_at TIMESTAMPTZ`);
  // Área de atuação do usuário no funil: comercial, entrega ou ambos.
  // Filtra quem aparece como responsável comercial x de entrega.
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS area TEXT`);
  // Trava opcional de acesso (só relevante pro papel 'suporte'/"Usuário"): restringe à área e,
  // dentro dela, a abas específicas do Comercial (ver user_page_access). Default = sem restrição
  // — preserva o comportamento de quem já está cadastrado.
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS restrict_access BOOLEAN NOT NULL DEFAULT false`);
  // Roteiro da sessão de ativação (checklist do que é feito com o cliente).
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS session_checklist JSONB`);
  // Quantas configurações simultâneas cada responsável de entrega pode ter.
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS setup_wip_limit INT`);
  // Config de aviso por canal (liga/desliga + número que recebe). O aviso NUNCA
  // vai pro cliente — só pro alert_number configurado. last_status/last_alert_at
  // controlam o "1x por queda".
  await pool.query(`CREATE TABLE IF NOT EXISTS channel_alerts (
    channel_key TEXT PRIMARY KEY,
    alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    alert_number TEXT,
    last_status TEXT,
    last_alert_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // Desde quando o canal está no last_status atual (para "há quanto tempo
  // desconectado"). Atualizado pelo job a cada transição.
  await pool.query(`ALTER TABLE channel_alerts ADD COLUMN IF NOT EXISTS status_since TIMESTAMPTZ`);
  // Histórico de transições de status dos canais (quedas/retornos), para os
  // relatórios. Registrado pelo job a cada 3 min ao detectar mudança.
  await pool.query(`CREATE TABLE IF NOT EXISTS channel_events (
    id BIGSERIAL PRIMARY KEY,
    channel_key TEXT NOT NULL,
    channel_name TEXT,
    channel_number TEXT,
    client_id UUID,
    client_name TEXT,
    status TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS channel_events_changed_idx ON channel_events (changed_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS channel_events_key_idx ON channel_events (channel_key)`);
  // Vínculo manual de instância avulsa (UAZAPI/Evolution sem tenant na NX) a um
  // cliente. Só vínculo local — não mexe em NX/provedor.
  await pool.query(`CREATE TABLE IF NOT EXISTS channel_assignments (
    provider TEXT NOT NULL,
    instance_key TEXT NOT NULL,
    client_id UUID NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, instance_key)
  )`);
  // Avulsos arquivados (escondidos da lista principal, sem excluir no provedor).
  // Útil para canais quebrados que não dá pra apagar na UAZAPI/Evolution.
  await pool.query(`CREATE TABLE IF NOT EXISTS archived_orphans (
    provider TEXT NOT NULL,
    instance_key TEXT NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (provider, instance_key)
  )`);
  // Identidade estável p/ manter arquivado mesmo se o token da UAZAPI girar
  // (instâncias quebradas regeneram token a cada /instance/all).
  await pool.query(`ALTER TABLE archived_orphans ADD COLUMN IF NOT EXISTS name TEXT`);
  await pool.query(`ALTER TABLE archived_orphans ADD COLUMN IF NOT EXISTS number TEXT`);
  // Índice email -> tenant + nível, alimentado pelo job de sincronização
  // (varre listUsers de cada tenant). Usado pelo agente de suporte para
  // identificar de qual cliente é um funcionário a partir do e-mail, mesmo que
  // o número de WhatsApp dele não esteja cadastrado.
  await pool.query(`CREATE TABLE IF NOT EXISTS tenant_users (
    client_id UUID NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    role TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (client_id, email)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS tenant_users_email_idx ON tenant_users (email)`);

  // ── Histórico de etapas (stage_history) ──────────────────────────────────
  // Já existe no schema.sql, mas garantimos aqui de forma idempotente para
  // ambientes que não rodaram o schema completo. A GRAVAÇÃO é feita por trigger
  // no banco (record_stage_change) — o app NÃO insere (evita duplicar).
  await pool.query(`CREATE TABLE IF NOT EXISTS stage_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    from_stage pipeline_stage,
    to_stage pipeline_stage NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS stage_history_client_idx ON stage_history(client_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS stage_history_at_idx ON stage_history(at DESC)`);
  // Trigger que registra a transição em toda mudança de stage (e na criação).
  await pool.query(`CREATE OR REPLACE FUNCTION record_stage_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO stage_history (client_id, from_stage, to_stage, at) VALUES (NEW.id, NULL, NEW.stage, COALESCE(NEW.created_at, NOW()));
    RETURN NEW;
  END IF;
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO stage_history (client_id, from_stage, to_stage, at) VALUES (NEW.id, OLD.stage, NEW.stage, NOW());
  END IF;
  RETURN NEW;
END; $$`);
  await pool.query(`DROP TRIGGER IF EXISTS clients_record_stage_history ON clients`);
  await pool.query(`CREATE TRIGGER clients_record_stage_history AFTER INSERT OR UPDATE OF stage ON clients
    FOR EACH ROW EXECUTE FUNCTION record_stage_change()`);
  // Trigger de realtime (LISTEN/NOTIFY) — só cria se a função já existir.
  await pool.query(`DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_db_change') THEN
    DROP TRIGGER IF EXISTS notify_stage_history ON stage_history;
    CREATE TRIGGER notify_stage_history AFTER INSERT ON stage_history
      FOR EACH ROW EXECUTE FUNCTION notify_db_change();
  END IF;
END $$`);
  // Backfill conservador: para clientes SEM nenhum histórico (criados antes do
  // trigger existir), cria a linha de entrada a partir de created_at. Não
  // fabrica transições intermediárias — só garante que o cliente apareça.
  await pool.query(`INSERT INTO stage_history (client_id, from_stage, to_stage, at)
    SELECT c.id, NULL, c.stage, c.created_at
    FROM clients c
    WHERE NOT EXISTS (SELECT 1 FROM stage_history sh WHERE sh.client_id = c.id)`);

  // ── Comercial > Novos Leads / CRM NX Luis / CRM NX Arthur (quadros estilo Monday) ──
  await pool.query(`CREATE TABLE IF NOT EXISTS lead_boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4F8EF7',
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // Aba onde o quadro aparece — permite "mover" um lead pra outra tela (CRM de
  // um SDR especifico) so trocando o board_id pra um quadro daquela page.
  await pool.query(`ALTER TABLE lead_boards ADD COLUMN IF NOT EXISTS page TEXT NOT NULL DEFAULT 'novos_leads'`);
  // Abas do Comercial viram gerenciáveis (admin cria/duplica/arquiva) — "page" deixa de ser um
  // enum fixo de 3 valores e passa a referenciar lead_pages. As 3 abas de sempre viram linhas
  // normais nessa tabela, com o mesmo id que já usavam como valor de "page" (zero backfill).
  await pool.query(`CREATE TABLE IF NOT EXISTS lead_pages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`INSERT INTO lead_pages (id, name, position) VALUES
    ('novos_leads', 'Novos Leads', 0),
    ('crm_luis', 'CRM NX Luis', 1),
    ('crm_arthur', 'CRM NX Arthur', 2)
    ON CONFLICT (id) DO NOTHING`);
  await pool.query(`ALTER TABLE lead_boards DROP CONSTRAINT IF EXISTS lead_boards_page_check`);
  await pool.query(`ALTER TABLE lead_boards DROP CONSTRAINT IF EXISTS lead_boards_page_fkey`);
  await pool.query(`ALTER TABLE lead_boards ADD CONSTRAINT lead_boards_page_fkey FOREIGN KEY (page) REFERENCES lead_pages(id)`);
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_db_change') THEN
      DROP TRIGGER IF EXISTS notify_lead_pages ON lead_pages;
      CREATE TRIGGER notify_lead_pages AFTER INSERT OR UPDATE OR DELETE ON lead_pages
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
    END IF;
  END $$`);
  // Legado: allowlist por QUADRO — substituída por user_page_access (allowlist por ABA inteira,
  // logo abaixo). Mantida só porque já existe em bancos antigos; nada no app lê/escreve mais aqui.
  await pool.query(`CREATE TABLE IF NOT EXISTS user_board_access (
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    board_id UUID NOT NULL REFERENCES lead_boards(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, board_id)
  )`);
  // Allowlist de ABAS do Comercial (lead_pages) pra usuários com profiles.restrict_access = true.
  // Sem linhas pra um user_id = sem restrição de aba (vê todas as abas ativas). Todos os quadros
  // de uma aba liberada ficam visíveis — a granularidade é por aba inteira, não por quadro.
  await pool.query(`CREATE TABLE IF NOT EXISTS user_page_access (
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL REFERENCES lead_pages(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, page_id)
  )`);
  // Allowlist de itens de menu pra usuários com profiles.restrict_access = true. Sem linhas pra
  // um user_id = ainda não configurado (não corta por página — só por quadro, se houver).
  await pool.query(`CREATE TABLE IF NOT EXISTS user_menu_access (
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    menu_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, menu_key)
  )`);
  // Quem já tinha permissão granular por sub-aba do Comercial (comercial_novos_leads etc.)
  // ganha a chave única "comercial" — a granularidade agora é só por quadro (user_board_access),
  // não mais por página, senão essas pessoas perderiam acesso do nada nessa migração.
  await pool.query(`INSERT INTO user_menu_access (user_id, menu_key)
    SELECT DISTINCT user_id, 'comercial' FROM user_menu_access
    WHERE menu_key IN ('comercial_novos_leads', 'comercial_crm_luis', 'comercial_crm_arthur')
    ON CONFLICT (user_id, menu_key) DO NOTHING`);
  await pool.query(`CREATE TABLE IF NOT EXISTS lead_rows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES lead_boards(id) ON DELETE CASCADE,
    nome TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT '',
    empresa TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    dia_contato TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    retornar TEXT NOT NULL DEFAULT '',
    ligacao TEXT NOT NULL DEFAULT '',
    responsavel TEXT NOT NULL DEFAULT '',
    numero TEXT NOT NULL DEFAULT '',
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS lead_rows_board_idx ON lead_rows(board_id)`);
  // Colunas extras adicionadas depois: dor do cliente, atendentes, valores.
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS dor_cliente TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS numero_atendentes TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS notes_count INT NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS sdr TEXT NOT NULL DEFAULT ''`);
  // Marca se o retorno agendado já foi feito — usado pra colorir a coluna Retornar (amarelo = pendente, vermelho = atrasado).
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS retornado BOOLEAN NOT NULL DEFAULT false`);
  // Dia em que o SDR agendou a reunião com o lead — coluna livre, sem lógica de atraso/cor.
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS agendamento TEXT NOT NULL DEFAULT ''`);
  // "Valor Previsto"/"Valor Fechado" viraram "Valor MRR"/"Valor de Implementação"
  // — rename preserva os dados ja digitados (nao e um drop+recreate). So renomeia
  // se o destino ainda nao existir (evita colisao em boots repetidos).
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_rows' AND column_name = 'valor_previsto')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_rows' AND column_name = 'valor_mrr') THEN
      ALTER TABLE lead_rows RENAME COLUMN valor_previsto TO valor_mrr;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_rows' AND column_name = 'valor_fechado')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_rows' AND column_name = 'valor_implementacao') THEN
      ALTER TABLE lead_rows RENAME COLUMN valor_fechado TO valor_implementacao;
    END IF;
  END $$`);
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS valor_mrr TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS valor_implementacao TEXT NOT NULL DEFAULT ''`);
  // Exclusão de lead é sempre "soft delete" — marca deleted_at em vez de apagar a linha,
  // pra dar pra restaurar depois pela Lixeira na tela de Lista.
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await pool.query(`CREATE INDEX IF NOT EXISTS lead_rows_deleted_at_idx ON lead_rows(deleted_at) WHERE deleted_at IS NOT NULL`);
  // Motivo informado ao excluir uma venda (aba Vendas) — só usado ali; pra lead comum fica vazio.
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS delete_reason TEXT`);
  // Marca manual (só a pessoa liga/desliga, nada calcula isso) de pagamento pendente — usada só
  // na aba Vendas. Default true: toda venda nasce "pendente" até alguém confirmar o pagamento.
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS mrr_pendente BOOLEAN NOT NULL DEFAULT true`);
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS impl_pendente BOOLEAN NOT NULL DEFAULT true`);
  // Limpa colunas "valor_previsto"/"valor_fechado" que sobraram vazias/duplicadas
  // de boots anteriores (enquanto o bug acima existia) — só remove se a coluna
  // nova ja existir, entao os dados reais ja estao em valor_mrr/valor_implementacao.
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_rows' AND column_name = 'valor_mrr')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_rows' AND column_name = 'valor_previsto') THEN
      ALTER TABLE lead_rows DROP COLUMN valor_previsto;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_rows' AND column_name = 'valor_implementacao')
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lead_rows' AND column_name = 'valor_fechado') THEN
      ALTER TABLE lead_rows DROP COLUMN valor_fechado;
    END IF;
  END $$`);
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'touch_updated_at') THEN
      DROP TRIGGER IF EXISTS lead_rows_touch_updated_at ON lead_rows;
      CREATE TRIGGER lead_rows_touch_updated_at BEFORE UPDATE ON lead_rows
        FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
    END IF;
  END $$`);
  // Bloco de anotações/atualizações por lead (painel lateral, estilo Monday).
  await pool.query(`CREATE TABLE IF NOT EXISTS lead_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_row_id UUID NOT NULL REFERENCES lead_rows(id) ON DELETE CASCADE,
    author_id UUID,
    author_name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`ALTER TABLE lead_notes ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'`);
  await pool.query(`CREATE INDEX IF NOT EXISTS lead_notes_lead_row_idx ON lead_notes(lead_row_id)`);
  await pool.query(`CREATE OR REPLACE FUNCTION increment_lead_notes_count() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE lead_rows SET notes_count = notes_count + 1 WHERE id = NEW.lead_row_id;
      RETURN NEW;
    END; $$`);
  await pool.query(`DROP TRIGGER IF EXISTS lead_notes_count_trigger ON lead_notes`);
  await pool.query(`CREATE TRIGGER lead_notes_count_trigger AFTER INSERT ON lead_notes
    FOR EACH ROW EXECUTE FUNCTION increment_lead_notes_count()`);
  await pool.query(`CREATE OR REPLACE FUNCTION decrement_lead_notes_count() RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE lead_rows SET notes_count = GREATEST(notes_count - 1, 0) WHERE id = OLD.lead_row_id;
      RETURN OLD;
    END; $$`);
  await pool.query(`DROP TRIGGER IF EXISTS lead_notes_decrement_trigger ON lead_notes`);
  await pool.query(`CREATE TRIGGER lead_notes_decrement_trigger AFTER DELETE ON lead_notes
    FOR EACH ROW EXECUTE FUNCTION decrement_lead_notes_count()`);
  // Linha do tempo automática de um lead (chegada, mudança de status/dia de contato/SDR/quadro,
  // marcado como retornado) — gravada pelo backend a cada PATCH relevante em lead_rows, ver
  // leadBoardRoutes.ts. Só INSERT (sem UPDATE/DELETE) porque é um log imutável.
  await pool.query(`CREATE TABLE IF NOT EXISTS lead_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_row_id UUID NOT NULL REFERENCES lead_rows(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    from_value TEXT,
    to_value TEXT,
    actor_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS lead_events_lead_row_idx ON lead_events(lead_row_id)`);
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_db_change') THEN
      DROP TRIGGER IF EXISTS notify_lead_boards ON lead_boards;
      CREATE TRIGGER notify_lead_boards AFTER INSERT OR UPDATE OR DELETE ON lead_boards
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
      DROP TRIGGER IF EXISTS notify_lead_rows ON lead_rows;
      CREATE TRIGGER notify_lead_rows AFTER INSERT OR UPDATE OR DELETE ON lead_rows
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
      DROP TRIGGER IF EXISTS notify_lead_notes ON lead_notes;
      CREATE TRIGGER notify_lead_notes AFTER INSERT OR UPDATE OR DELETE ON lead_notes
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
      DROP TRIGGER IF EXISTS notify_lead_events ON lead_events;
      CREATE TRIGGER notify_lead_events AFTER INSERT ON lead_events
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
    END IF;
  END $$`);
  await pool.query(`INSERT INTO lead_boards (name, color, position)
    SELECT 'Leads Novos', '#4F8EF7', 0
    WHERE NOT EXISTS (SELECT 1 FROM lead_boards)`);
  // Quadros do funil comercial (SDR) — cada um com nome/cor próprios, mesmas
  // colunas de lead_rows. Idempotente: só cria os que ainda não existem (por nome).
  await pool.query(`WITH next_pos AS (
      SELECT COALESCE(MAX(position), -1) AS base FROM lead_boards
    ),
    seed(name, color, ord) AS (
      VALUES
        ('Primeiro contato',              '#4F8EF7', 1),
        ('Reunião agendada',              '#8B5CF6', 2),
        ('Reunião não comparecida',       '#F97316', 3),
        ('Proposta enviada',              '#FBBF24', 4),
        ('Followup Propostas',            '#06B6D4', 5),
        ('Vendido',                       '#34D399', 6),
        ('Disparo em massa após 7 dias',  '#EC4899', 7),
        ('Desqualificados',               '#9CA3AF', 8),
        ('Perdidos',                      '#F87171', 9)
    )
    INSERT INTO lead_boards (name, color, position)
    SELECT s.name, s.color, next_pos.base + s.ord
    FROM seed s, next_pos
    WHERE NOT EXISTS (SELECT 1 FROM lead_boards lb WHERE lb.name = s.name)`);

  // Etiquetas coloridas (estilo Monday) para as colunas "Dia de contato" e
  // "Status" — editáveis pelo usuário via "Editar etiquetas".
  await pool.query(`CREATE TABLE IF NOT EXISTS lead_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field TEXT NOT NULL CHECK (field IN ('dia_contato', 'status')),
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#9CA3AF',
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS lead_labels_field_idx ON lead_labels(field)`);
  // "Tipo", "SDR" e "Ligação" também viraram etiqueta colorida — amplia o CHECK pra bancos já existentes.
  await pool.query(`ALTER TABLE lead_labels DROP CONSTRAINT IF EXISTS lead_labels_field_check`);
  await pool.query(`ALTER TABLE lead_labels ADD CONSTRAINT lead_labels_field_check CHECK (field IN ('tipo', 'dia_contato', 'status', 'sdr', 'ligacao'))`);
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_db_change') THEN
      DROP TRIGGER IF EXISTS notify_lead_labels ON lead_labels;
      CREATE TRIGGER notify_lead_labels AFTER INSERT OR UPDATE OR DELETE ON lead_labels
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
    END IF;
  END $$`);
  await pool.query(`INSERT INTO lead_labels (field, name, color, position)
    SELECT * FROM (VALUES
      ('tipo', 'IA',                        '#10B981', 1),
      ('tipo', 'CHATBOT',                   '#F97316', 2),
      ('tipo', '01 - FRIO - LEADS 1-3-5 / ADVOCACIA',                                          '#3B82F6', 3),
      ('tipo', '01 - FRIO - LEADS 1-3-5 / API OFICIAL',                                        '#8B5CF6', 4),
      ('tipo', '01 - FRIO - LEADS 1-3-5 / GERAL',                                              '#06B6D4', 5),
      ('tipo', '01 - FRIO - LEADS 1-3-5 / CRIATIVOS VALIDADOS',                                '#EC4899', 6),
      ('tipo', 'rmkt - quente / QUENTE GERAL',                                                 '#EF4444', 7),
      ('tipo', 'LEADS 02 - CHATBOT GERAL / CHATBOT - VALIDADO',                                '#F59E0B', 8),
      ('tipo', 'CAMPANHA 01 - VALIDADO — Cópia / ADVTANGE ON + 3 assuntos',                     '#84CC16', 9),
      ('tipo', 'CAMPANHA 01 - VALIDADO — Cópia / ADVTANGE ON + 3 assuntos — Cópia',              '#14B8A6', 10),
      ('tipo', 'CAMPANHA 01 - VALIDADO — Cópia / VALIDADO + IMAGENS',                           '#6366F1', 11),
      ('sdr', 'Luis',                       '#4F8EF7', 1),
      ('sdr', 'Arthur',                     '#8B5CF6', 2),
      ('ligacao', '0',                      '#E5E5E5', 0),
      ('ligacao', '1',                      '#C4C4C4', 1),
      ('ligacao', '2',                      '#1BC47D', 2),
      ('ligacao', '3',                      '#8DC63F', 3),
      ('ligacao', '4',                      '#0E8A5B', 4),
      ('ligacao', '5',                      '#FFC400', 5),
      ('ligacao', '6',                      '#C9B458', 6),
      ('ligacao', '7',                      '#FDA64B', 7),
      ('ligacao', '8',                      '#FB6340', 8),
      ('ligacao', '9',                      '#D6304A', 9),
      ('ligacao', '10',                     '#F0047F', 10),
      ('dia_contato', '1º Dia - ChatBot',   '#9CA3AF', 1),
      ('dia_contato', '2º Dia - ChatBot',   '#60A5FA', 2),
      ('dia_contato', '3º Dia - ChatBot',   '#3B82F6', 3),
      ('dia_contato', '4º Dia - ChatBot',   '#1E3A8A', 4),
      ('dia_contato', '5º Dia - ChatBot',   '#2563EB', 5),
      ('dia_contato', '6º Dia - ChatBot',   '#4338CA', 6),
      ('dia_contato', '7º Dia - ChatBot',   '#F97316', 7),
      ('dia_contato', 'Sem contato',        '#DC2626', 8),
      ('dia_contato', 'NoShow 1º Dia',      '#EAB308', 9),
      ('dia_contato', 'NoShow 2º Dia',      '#FB923C', 10),
      ('dia_contato', 'NoShow 3º Dia',      '#E11D48', 11),
      ('dia_contato', 'NEUTRO',             '#92400E', 12),
      ('status', 'Primeiro Contato',        '#5B9BD5', 1),
      ('status', 'Reunião agendada',        '#D97706', 2),
      ('status', 'Reunião não comparecida', '#DC2626', 3),
      ('status', 'Proposta Enviada',        '#84CC16', 4),
      ('status', 'Follow-up Propostas',     '#8B5CF6', 5),
      ('status', 'Vendido',                 '#10B981', 6),
      ('status', 'Follow-up Mensal',        '#F97316', 7),
      ('status', 'Disparo em massa',        '#9F1239', 8),
      ('status', 'Perdidos',                '#EC4899', 9),
      ('status', 'Leads 3C',                '#78350F', 10),
      ('status', 'Leads/Março',             '#047857', 11),
      ('status', 'Leads Outbount',          '#7C3AED', 12),
      ('status', 'Desqualificado',          '#374151', 13)
    ) AS v(field, name, color, position)
    WHERE NOT EXISTS (SELECT 1 FROM lead_labels ll WHERE ll.field = v.field AND ll.name = v.name)`);

  // Lead novo já nasce com Lig. = '0' (ver leadBoardsService.createRow) — isso só vale a partir
  // de agora, então preenche com '0' quem ficou pra trás com o campo em branco. Efetivamente
  // roda uma vez só: depois disso não sobra nenhuma linha com ligacao = '' pra essa query pegar.
  await pool.query(`UPDATE lead_rows SET ligacao = '0' WHERE ligacao = ''`);

  // ── Colunas do quadro do Suporte ───────────────────────────────────────────
  // As etapas do Kanban deixam de ser fixas no código: o time cria, renomeia,
  // reordena e apaga colunas pela própria tela. `key` é o valor gravado em
  // reminders.status, por isso é imutável depois de criada (renomear muda só
  // o `name`) — assim nenhuma tarefa existente fica órfã.
  await pool.query(`CREATE TABLE IF NOT EXISTS support_columns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#9CA3AF',
    position INT NOT NULL DEFAULT 0,
    is_done BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_db_change') THEN
      DROP TRIGGER IF EXISTS notify_support_columns ON support_columns;
      CREATE TRIGGER notify_support_columns AFTER INSERT OR UPDATE OR DELETE ON support_columns
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
    END IF;
  END $$`);
  // Semeia as 4 etapas que já existiam hard-coded, com as mesmas keys que as
  // tarefas antigas gravaram em reminders.status.
  await pool.query(`INSERT INTO support_columns (key, name, color, position, is_done)
    SELECT * FROM (VALUES
      ('todo',    'A Fazer',            '#9CA3AF', 1, FALSE),
      ('doing',   'Fazendo',            '#4F8EF7', 2, FALSE),
      ('waiting', 'Aguardando técnico', '#F59E0B', 3, FALSE),
      ('done',    'Feito',              '#10B981', 4, TRUE)
    ) AS v(key, name, color, position, is_done)
    WHERE NOT EXISTS (SELECT 1 FROM support_columns sc WHERE sc.key = v.key)`);

  // ── Registro de vendas (aba Vendas do Comercial) ──────────────────────────
  // Quando um lead vira "Vendido" num CRM, ele CONTINUA no CRM do SDR e uma oportunidade é criada
  // no quadro de vendas. A oportunidade é uma FOTO do momento (copia nome/empresa/SDR/valores):
  // corrigir o lead depois não mexe no que já foi fechado, senão relatório de mês passado mudaria
  // sozinho. `venda_origem_id` liga a oportunidade ao lead que a gerou — é o que evita criar duas
  // quando o status vai e volta. `venda_revertida` marca a venda desfeita sem apagar o histórico.
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS fechamento TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS venda_origem_id UUID`);
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS venda_revertida BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS lead_rows_venda_origem_uniq
    ON lead_rows(venda_origem_id) WHERE venda_origem_id IS NOT NULL`);

  // Qual quadro recebe as vendas. Fica no quadro (e não numa config solta) pra sobreviver a
  // renomear a aba, e porque é o quadro que de fato guarda as linhas.
  await pool.query(`ALTER TABLE lead_boards ADD COLUMN IF NOT EXISTS is_vendas BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS lead_boards_is_vendas_uniq
    ON lead_boards((is_vendas)) WHERE is_vendas`);

  // Itens fixos do menu Suporte — admin pode arquivar (some do menu, fica salvo pra
  // restaurar) e renomear. As URLs continuam fixas, só a visibilidade é gerenciável.
  await pool.query(`CREATE TABLE IF NOT EXISTS support_pages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // "Duplicar" cria uma segunda entrada no menu com nome próprio, mas apontando pra MESMA
  // tela/rota do original (ex.: "Pipeline" e "Pipeline (cópia)" os dois abrem /pipeline) — as
  // telas do Suporte não são um container genérico como o Comercial, então duplicar não cria
  // dados independentes, só um atalho nomeado. source_key = id pro item original; numa cópia,
  // aponta pro id do item de origem (mesmo se a origem já for uma cópia).
  await pool.query(`ALTER TABLE support_pages ADD COLUMN IF NOT EXISTS source_key TEXT`);
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_db_change') THEN
      DROP TRIGGER IF EXISTS notify_support_pages ON support_pages;
      CREATE TRIGGER notify_support_pages AFTER INSERT OR UPDATE OR DELETE ON support_pages
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
    END IF;
  END $$`);
  await pool.query(`INSERT INTO support_pages (id, name, position)
    SELECT * FROM (VALUES
      ('tarefas',       'Suporte (Tarefas)',   1),
      ('pipeline',      'Pipeline',             2),
      ('clientes',      'Clientes',             3),
      ('canais',        'Canais',               4),
      ('tenants',       'Tenants',              5),
      ('configuracoes', 'Configurações',        6),
      ('arquivados',    'Clientes arquivados',  7),
      ('tickets',       'Tickets',              8),
      ('templates',     'Templates',            9)
    ) AS v(id, name, position)
    WHERE NOT EXISTS (SELECT 1 FROM support_pages sp WHERE sp.id = v.id)`);
  await pool.query(`UPDATE support_pages SET source_key = id WHERE source_key IS NULL`);
  await pool.query(`ALTER TABLE support_pages ALTER COLUMN source_key SET NOT NULL`);
  // Uma cópia abre a mesma TELA do original, mas com a própria visão salva (filtros/modo de
  // exibição escolhidos na hora de duplicar) — é o que a diferencia de um atalho repetido.
  // NULL/{} = abre a tela com os filtros padrão dela, igual ao item de origem.
  await pool.query(`ALTER TABLE support_pages ADD COLUMN IF NOT EXISTS view_config JSONB`);

  // ── Cópia do Suporte como subpágina de verdade ────────────────────────────
  // Etapas ("quadros") de uma CÓPIA. O item de origem continua usando as etapas fixas do código
  // (PIPELINE_STAGES): elas alimentam funil, tempo por etapa, clientes travados e o Dashboard,
  // e torná-las variáveis quebraria esses relatórios. Só a cópia tem etapas próprias.
  await pool.query(`CREATE TABLE IF NOT EXISTS support_page_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id TEXT NOT NULL REFERENCES support_pages(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#9CA3AF',
    position INT NOT NULL DEFAULT 0,
    is_done BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (page_id, key)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS support_page_stages_page_idx ON support_page_stages(page_id, position)`);

  // Quais clientes aparecem numa cópia, e em que etapa DELA. O cliente continua existindo uma vez
  // só em `clients` — isto aqui é associação, não duplicata: editar o cliente pela cópia edita o
  // mesmo registro, e tirar da cópia não apaga ninguém. `stage_key` é a etapa dentro da cópia,
  // separada de clients.stage (que segue sendo a verdade do Pipeline original e dos relatórios).
  await pool.query(`CREATE TABLE IF NOT EXISTS support_page_clients (
    page_id TEXT NOT NULL REFERENCES support_pages(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    stage_key TEXT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (page_id, client_id)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS support_page_clients_page_idx ON support_page_clients(page_id, stage_key, position)`);

  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_db_change') THEN
      DROP TRIGGER IF EXISTS notify_support_page_stages ON support_page_stages;
      CREATE TRIGGER notify_support_page_stages AFTER INSERT OR UPDATE OR DELETE ON support_page_stages
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
      DROP TRIGGER IF EXISTS notify_support_page_clients ON support_page_clients;
      CREATE TRIGGER notify_support_page_clients AFTER INSERT OR UPDATE OR DELETE ON support_page_clients
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
    END IF;
  END $$`);

  // Abas que nasceram com "-2" no link porque já existia uma sobra de teste vazia no slug limpo
  // (ver freeUpSlug) — libera o nome bonito assim que a sobra some.
  await freeUpSlug('vendas', 'vendas-2');
  await freeUpSlug('crm-luis', 'crm-luis-2');

  // "Registrar venda" (tela de Vendas) gravava o valor digitado cru, sem passar pelo mesmo
  // formatador do resto do app (CurrencyField) — "249" ficava salvo como "249" em vez de
  // "R$ 249,00", e como parseBRLCents só sabe ler centavos a partir de uma vírgula, isso exibia
  // R$ 2,49 na tela. Corrige o campo já formatado (não mexe mais nele daqui pra frente); reformata
  // só o que ainda está cru (só dígitos, sem vírgula) — o que já está certo não bate no WHERE.
  await pool.query(`UPDATE lead_rows SET valor_mrr = valor_mrr || ',00' WHERE valor_mrr ~ '^[0-9]+$'`);
  await pool.query(`UPDATE lead_rows SET valor_implementacao = valor_implementacao || ',00' WHERE valor_implementacao ~ '^[0-9]+$'`);

  // Lead criado direto numa aba travada num SDR (CRM Luis/Arthur) sem o campo sdr preenchido —
  // acontecia porque a coluna SDR nem aparece lá pra escolher manualmente (antes desse boot, o
  // front também não preenchia sozinho na criação). Casa pelo NOME da aba, igual sdrLockForPageName
  // no front, pra funcionar mesmo se a aba for renomeada. Roda em todo boot de propósito — também
  // corrige lead importado via CSV sem SDR, não é só um backfill de uma vez.
  await pool.query(`UPDATE lead_rows lr SET sdr = 'Luis'
    FROM lead_boards lb JOIN lead_pages lp ON lp.id = lb.page
    WHERE lr.board_id = lb.id AND lower(lp.name) LIKE '%luis%'
      AND (lr.sdr IS NULL OR lr.sdr = '') AND lr.deleted_at IS NULL`);
  await pool.query(`UPDATE lead_rows lr SET sdr = 'Arthur'
    FROM lead_boards lb JOIN lead_pages lp ON lp.id = lb.page
    WHERE lr.board_id = lb.id AND lower(lp.name) LIKE '%arthur%'
      AND (lr.sdr IS NULL OR lr.sdr = '') AND lr.deleted_at IS NULL`);

  // Aba "Vendas" sobe pro topo da lista do Comercial (logo abaixo de "Dashboard Comercial", que é
  // um item fixo fora dessa tabela) — posição bem negativa garante que fica antes de qualquer
  // outra aba, mesmo se a ordem delas mudar no futuro.
  await pool.query(`UPDATE lead_pages SET position = -1 WHERE lower(name) LIKE '%venda%' AND position <> -1`);

  // Painel do Mês (Dashboard Comercial > Painel do Mês) — um registro por mês (id = 'YYYY-MM')
  // só com os poucos campos manuais (investimento em tráfego, leads gerados, permanência média).
  // Todo o resto do painel (funil, MRR, ROI) é calculado ao vivo em cima de lead_rows/lead_boards,
  // sem precisar de snapshot.
  await pool.query(`CREATE TABLE IF NOT EXISTS commercial_months (
    id TEXT PRIMARY KEY,
    investimento_trafego TEXT NOT NULL DEFAULT '0,00',
    leads_gerados INT NOT NULL DEFAULT 0,
    permanencia_media NUMERIC(10,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_db_change') THEN
      DROP TRIGGER IF EXISTS notify_commercial_months ON commercial_months;
      CREATE TRIGGER notify_commercial_months AFTER INSERT OR UPDATE OR DELETE ON commercial_months
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
    END IF;
  END $$`);

  console.log('[db] migrations applied');
}

export async function startRealtimeListener() {
  listenerClient = await pool.connect();
  listenerClient.on('notification', (msg) => {
    if (!msg.payload) return;
    try {
      const payload = JSON.parse(msg.payload) as {
        table: string;
        type: string;
        data: Record<string, unknown>;
      };
      handlers.forEach((h) => h(payload.table, payload.type, payload.data));
    } catch {
      // ignore malformed payloads
    }
  });
  await listenerClient.query('LISTEN db_changes');
  console.log('PostgreSQL LISTEN started on channel db_changes');
}
