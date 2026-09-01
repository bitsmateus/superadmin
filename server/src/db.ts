import { Pool, PoolClient } from 'pg';
import { DEFAULT_CONTRACT_HTML } from './data/contractTemplateSeed.js';

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
  // Preferência de tema (claro/escuro) da PESSOA, não do navegador — fica salva na conta e volta
  // igual em qualquer dispositivo que ela logar. NULL = nunca escolheu ainda (usa o padrão local).
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS theme TEXT`);
  await pool.query(`ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_theme_check`);
  await pool.query(`ALTER TABLE profiles ADD CONSTRAINT profiles_theme_check CHECK (theme IS NULL OR theme IN ('light', 'dark'))`);
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
  // Notifica em tempo real quem teve a própria allowlist alterada (ver watchOwnAccessChanges no
  // front) — sem isso, a pessoa restrita continua vendo aba/quadro que acabou de perder acesso
  // até recarregar a aba por conta própria, já que essas duas tabelas não tocam em lead_pages/
  // lead_boards (que já tem SSE próprio).
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_db_change') THEN
      DROP TRIGGER IF EXISTS notify_user_page_access ON user_page_access;
      CREATE TRIGGER notify_user_page_access AFTER INSERT OR UPDATE OR DELETE ON user_page_access
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
      DROP TRIGGER IF EXISTS notify_user_menu_access ON user_menu_access;
      CREATE TRIGGER notify_user_menu_access AFTER INSERT OR UPDATE OR DELETE ON user_menu_access
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
    END IF;
  END $$`);
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
  // "sdr" continua global de propósito (não é etiqueta "de aba" — é a lista de SDRs de verdade,
  // usada pra travar/rotear leads entre as abas de cada um — ver sdrLockForPageName). As demais
  // (tipo/dia_contato/ligacao/status) viraram por aba logo abaixo — não semeia mais aqui.
  await pool.query(`INSERT INTO lead_labels (field, name, color, position)
    SELECT * FROM (VALUES
      ('sdr', 'Luis',                       '#4F8EF7', 1),
      ('sdr', 'Arthur',                     '#8B5CF6', 2)
    ) AS v(field, name, color, position)
    WHERE NOT EXISTS (SELECT 1 FROM lead_labels ll WHERE ll.field = v.field AND ll.name = v.name)`);

  // Etiquetas por aba — cada CRM (Novos Leads, CRM Luis, CRM Arthur, e qualquer aba criada
  // depois) tem seu PRÓPRIO conjunto de tipo/dia de contato/ligação/status: uma etiqueta criada
  // numa aba não aparece nas outras. "sdr" fica de fora (page_id sempre NULL, ver acima).
  await pool.query(`ALTER TABLE lead_labels ADD COLUMN IF NOT EXISTS page_id TEXT REFERENCES lead_pages(id) ON DELETE CASCADE`);
  await pool.query(`CREATE INDEX IF NOT EXISTS lead_labels_page_field_idx ON lead_labels(page_id, field)`);
  // Backfill de uma vez só: até aqui todo mundo usava as MESMAS etiquetas em toda aba — copia o
  // conjunto que já existia (page_id NULL) pra cada aba ativa, aí some o global, pra não sumir
  // nada de quem já estava usando. Roda de graça depois da primeira vez: sem linha NULL sobrando
  // pra copiar/apagar, o INSERT/DELETE não bate em nada.
  await pool.query(`INSERT INTO lead_labels (field, name, color, position, page_id)
    SELECT ll.field, ll.name, ll.color, ll.position, lp.id
    FROM lead_labels ll
    CROSS JOIN lead_pages lp
    WHERE ll.page_id IS NULL AND ll.field <> 'sdr'`);
  await pool.query(`DELETE FROM lead_labels
    WHERE page_id IS NULL AND field <> 'sdr' AND EXISTS (SELECT 1 FROM lead_pages)`);

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

  // Observações da venda (aba Vendas) — comentário livre pro controle manual (ex.: "paga metade
  // metade", condição especial negociada). Só aparece/edita na tela de Vendas, não é uma coluna
  // do quadro Monday-style.
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS observacoes TEXT NOT NULL DEFAULT ''`);

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

  // Aba Contrato (Dashboard Comercial) — quadro marcado com is_contrato renderiza a ContratoView
  // (geração de contrato a partir do CNPJ) em vez do quadro Monday-style genérico. Sem
  // exclusividade tipo is_vendas: pode ter mais de um quadro de contrato no sistema.
  await pool.query(`ALTER TABLE lead_boards ADD COLUMN IF NOT EXISTS is_contrato BOOLEAN NOT NULL DEFAULT false`);

  // Modelo(s) padrão de contrato — texto em HTML com placeholders "<<...>>" (guardados como
  // entidades HTML, &lt;&lt;...&gt;&gt;, pra ficar válido dentro do próprio HTML). O formulário da
  // aba Contrato detecta cada placeholder no texto do modelo e vira um campo pra preencher.
  await pool.query(`CREATE TABLE IF NOT EXISTS contract_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    conteudo TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(
    `INSERT INTO contract_templates (name, conteudo)
     SELECT 'Contrato Padrão NX', $1
     WHERE NOT EXISTS (SELECT 1 FROM contract_templates)`,
    [DEFAULT_CONTRACT_HTML]
  );
  // Quem já tinha o modelo padrão semeado antes (tabela de serviços fixa, vigência/reajuste/multa
  // como números soltos no texto) ganha os placeholders novos — só troca se o texto original
  // exato ainda estiver lá (strpos, não LIKE, pra não tropeçar no "%" literal de "30%"); se a
  // pessoa já editou esse trecho pelo "Editar modelo padrão", fica como está.
  const OLD_SERVICES_TABLE = `<table style="width:100%;border-collapse:collapse;margin:0 0 14pt;">
  <thead><tr><th style="border:1px solid #999;padding:6pt;background:#f1f1f1;">Serviços</th><th style="border:1px solid #999;padding:6pt;background:#f1f1f1;">Pacote</th></tr></thead>
  <tbody>
    <tr><td style="border:1px solid #999;padding:6pt;text-align:center;">01</td><td style="border:1px solid #999;padding:6pt;">PLATAFORMA NX</td></tr>
    <tr><td style="border:1px solid #999;padding:6pt;text-align:center;">02</td><td style="border:1px solid #999;padding:6pt;">API</td></tr>
    <tr><td style="border:1px solid #999;padding:6pt;text-align:center;">03</td><td style="border:1px solid #999;padding:6pt;">SUPORTE DEDICADO</td></tr>
  </tbody>
</table>`;
  const CONTRACT_TEXT_MIGRATIONS: [string, string][] = [
    [OLD_SERVICES_TABLE, '&lt;&lt;Tabela de Serviços&gt;&gt;'],
    [
      'sendo o prazo de 12 meses a partir da data de início',
      'sendo o prazo de &lt;&lt;Reajuste (meses)&gt;&gt; meses a partir da data de início',
    ],
    [
      'multa equivalente à 30% de uma mensalidade',
      'multa equivalente à &lt;&lt;Multa Rescisória (%)&gt;&gt;% de uma mensalidade',
    ],
    [
      'multa equivalente 30% da remuneração',
      'multa equivalente &lt;&lt;Multa Rescisória (%)&gt;&gt;% da remuneração',
    ],
    [
      'vigência pelo prazo de 12 meses, com renovação',
      'vigência pelo prazo de &lt;&lt;Vigência (meses)&gt;&gt; meses, com renovação',
    ],
    [
      'o primeiro vencimento em <strong>&lt;&lt;DATA&gt;&gt;</strong> de 2026',
      'o primeiro vencimento em <strong>&lt;&lt;Data do Primeiro Vencimento&gt;&gt;</strong> de 2026',
    ],
  ];
  // Isolado do resto do boot: se alguma dessas trocas falhar por qualquer motivo, não pode
  // impedir as migrações seguintes (criação da tabela contracts etc.) de rodar.
  try {
    for (const [oldText, newText] of CONTRACT_TEXT_MIGRATIONS) {
      await pool.query(
        `UPDATE contract_templates SET conteudo = replace(conteudo, $1, $2) WHERE strpos(conteudo, $1) > 0`,
        [oldText, newText]
      );
    }
  } catch (err) {
    console.error('Migração de texto do contrato padrão falhou (não bloqueia o resto):', err);
  }

  // Um contrato gerado = um cliente. "campos" guarda o valor que a pessoa preencheu pra cada
  // placeholder do modelo (inclui campos.CNPJ, usado pra disparar a busca automática); "conteudo"
  // é o texto final já com os placeholders substituídos — independente do modelo dali pra frente,
  // editar o modelo depois não muda contratos já gerados.
  await pool.query(`CREATE TABLE IF NOT EXISTS contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES lead_boards(id) ON DELETE CASCADE,
    template_id UUID REFERENCES contract_templates(id) ON DELETE SET NULL,
    campos JSONB NOT NULL DEFAULT '{}',
    conteudo TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS contracts_board_id_idx ON contracts(board_id)`);

  // Status manual (ninguém calcula sozinho — a pessoa marca quando o cliente devolve assinado,
  // mesmo espírito do mrr_pendente/impl_pendente em Vendas). "venda_lead_id" liga o contrato à
  // linha de origem no quadro de Vendas (quando criado a partir da fila "Pendente de contrato") —
  // é o que permite calcular quais vendas ainda não têm contrato nenhum.
  await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pendente'`);
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_status_check') THEN
      ALTER TABLE contracts ADD CONSTRAINT contracts_status_check CHECK (status IN ('pendente', 'assinado'));
    END IF;
  END $$`);
  await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS venda_lead_id UUID REFERENCES lead_rows(id) ON DELETE SET NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS contracts_venda_lead_id_idx ON contracts(venda_lead_id)`);

  // "Pendente de contrato" passou a ser alimentada pela ficha de cadastro pública (app/ficha →
  // tabela clients, clients.ficha_cadastro) em vez de vendas registradas manualmente no CRM —
  // client_id liga o contrato ao cliente que preencheu a ficha. signed_at é a data em que o
  // contrato foi marcado como assinado (null = nunca assinado ou desmarcado depois), usada pro
  // filtro por mês da aba "Contratos assinados".
  await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS contracts_client_id_idx ON contracts(client_id)`);
  await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ`);

  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_db_change') THEN
      DROP TRIGGER IF EXISTS notify_contract_templates ON contract_templates;
      CREATE TRIGGER notify_contract_templates AFTER INSERT OR UPDATE OR DELETE ON contract_templates
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
      DROP TRIGGER IF EXISTS notify_contracts ON contracts;
      CREATE TRIGGER notify_contracts AFTER INSERT OR UPDATE OR DELETE ON contracts
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
    END IF;
  END $$`);

  // Marca se uma linha da aba Vendas veio do funil (SDR agendou/trabalhou o lead) ou foi avulsa de
  // verdade (indicação, cliente antigo voltando, etc). O vínculo automático venda_origem_id não dá
  // conta disso sozinho: na prática quase toda venda é registrada à mão pelo botão "Registrar
  // venda" mesmo quando veio do funil, então o vínculo fica vazio mesmo sendo uma venda do funil —
  // esse campo é a fonte da verdade, marcada manualmente por quem registra/revisa a venda.
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS veio_do_funil BOOLEAN NOT NULL DEFAULT false`);

  // Marca manual (toggle) se o contrato da venda já foi assinado — só usada na aba Vendas, mesmo
  // padrão de veio_do_funil (sem checklist, sem data associada, só liga/desliga).
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS contrato_assinado BOOLEAN NOT NULL DEFAULT false`);

  // Integração com Autentique: o contrato é gerado aqui mas enviado pra assinatura lá fora (a
  // pessoa sobe o PDF manualmente no Autentique, não tem criação via API). Esse campo guarda o ID
  // do documento no Autentique, colado à mão depois de subir — é o que liga o webhook de "documento
  // assinado" de volta a este contrato específico (ver server/src/routes/webhooks.ts).
  await pool.query(`ALTER TABLE contracts ADD COLUMN IF NOT EXISTS autentique_document_id TEXT`);
  await pool.query(`CREATE INDEX IF NOT EXISTS contracts_autentique_document_id_idx ON contracts(autentique_document_id) WHERE autentique_document_id IS NOT NULL`);

  // "Deslogar" alguém de Equipe: como o JWT é stateless (sem sessão guardada), não dá pra apagar
  // um token específico — em vez disso, guarda A PARTIR DE QUANDO todo token dessa pessoa vira
  // inválido. app.authenticate compara com o "iat" (data de emissão) do token a cada requisição;
  // token emitido ANTES dessa marca é recusado, mesmo dentro do prazo normal de expiração (7 dias).
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS session_invalidated_at TIMESTAMPTZ`);

  // Aba marcada is_notas vira um bloco de notas simples (sem quadros/kanban/métricas/SDR/filtro) —
  // uma nota por dia, com formatação básica (negrito etc.), pra alguém anotar o que precisa fazer.
  await pool.query(`ALTER TABLE lead_pages ADD COLUMN IF NOT EXISTS is_notas BOOLEAN NOT NULL DEFAULT false`);
  await pool.query(`CREATE TABLE IF NOT EXISTS page_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id TEXT NOT NULL REFERENCES lead_pages(id) ON DELETE CASCADE,
    note_date DATE NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (page_id, note_date)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS page_notes_page_id_idx ON page_notes(page_id)`);
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_db_change') THEN
      DROP TRIGGER IF EXISTS notify_page_notes ON page_notes;
      CREATE TRIGGER notify_page_notes AFTER INSERT OR UPDATE OR DELETE ON page_notes
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
    END IF;
  END $$`);

  // Webhook de leads do Meta Ads (via n8n) — ver server/src/routes/webhooks.ts. meta_lead_id é o
  // id do lead lá no Meta, usado só pra deduplicar reenvios do n8n (índice único parcial: várias
  // linhas com NULL continuam permitidas, só não pode repetir um id do Meta já processado).
  // origem_campanha/qualificacao guardam campos já tratados do formulário pra aparecerem na UI;
  // lead_raw guarda o payload bruto inteiro (histórico/auditoria caso precise investigar depois).
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS meta_lead_id TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS lead_rows_meta_lead_id_uniq
    ON lead_rows(meta_lead_id) WHERE meta_lead_id IS NOT NULL`);
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS origem_campanha TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS qualificacao JSONB NOT NULL DEFAULT '{}'`);
  await pool.query(`ALTER TABLE lead_rows ADD COLUMN IF NOT EXISTS lead_raw JSONB`);

  // Assinaturas de Web Push (PWA) — um dispositivo assina automaticamente ao logar (ver
  // usePushSubscription no front), sem botão de opt-in. Quem de fato recebe cada notificação é
  // decidido na hora do envio (ex.: só quem tem acesso ao quadro do lead), não aqui — por isso
  // guarda a assinatura de QUALQUER usuário logado, mesmo sem acesso ao Comercial ainda.
  // endpoint é único por navegador/dispositivo: reassinar do mesmo aparelho faz UPSERT (troca de
  // usuário no mesmo device, ex. computador compartilhado, atualiza o dono da assinatura).
  await pool.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id)`);

  // Atualizações/anexos e linha do tempo pras tarefas do Suporte (mesmo padrão de lead_notes/
  // lead_events do Comercial) — antes disso a tarefa só tinha um campo "notes" de texto único, sem
  // autor nem data por entrada.
  await pool.query(`CREATE TABLE IF NOT EXISTS reminder_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reminder_id UUID NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
    author_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    author_name TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    attachments JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS reminder_notes_reminder_id_idx ON reminder_notes(reminder_id)`);

  await pool.query(`CREATE TABLE IF NOT EXISTS reminder_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reminder_id UUID NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    from_value TEXT,
    to_value TEXT,
    actor_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS reminder_events_reminder_id_idx ON reminder_events(reminder_id)`);

  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_db_change') THEN
      DROP TRIGGER IF EXISTS notify_reminder_notes ON reminder_notes;
      CREATE TRIGGER notify_reminder_notes AFTER INSERT OR UPDATE OR DELETE ON reminder_notes
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
      DROP TRIGGER IF EXISTS notify_reminder_events ON reminder_events;
      CREATE TRIGGER notify_reminder_events AFTER INSERT ON reminder_events
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
    END IF;
  END $$`);

  // Modelo editável do Briefing público: overrides de rótulo pros campos já existentes
  // + perguntas de texto livre novas adicionadas pelo admin — ambos renderizados
  // dinamicamente em BriefingPublicPage (editor em BriefingTemplateModal).
  await pool.query(`CREATE TABLE IF NOT EXISTS briefing_field_overrides (
    field_key TEXT PRIMARY KEY,
    label TEXT,
    placeholder TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await pool.query(`CREATE TABLE IF NOT EXISTS briefing_custom_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    field_key TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    placeholder TEXT,
    type TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'textarea')),
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_db_change') THEN
      DROP TRIGGER IF EXISTS notify_briefing_field_overrides ON briefing_field_overrides;
      CREATE TRIGGER notify_briefing_field_overrides AFTER INSERT OR UPDATE OR DELETE ON briefing_field_overrides
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
      DROP TRIGGER IF EXISTS notify_briefing_custom_questions ON briefing_custom_questions;
      CREATE TRIGGER notify_briefing_custom_questions AFTER INSERT OR UPDATE OR DELETE ON briefing_custom_questions
        FOR EACH ROW EXECUTE FUNCTION notify_db_change();
    END IF;
  END $$`);

  // SMTP próprio (Configurações > E-mail) — usado pro envio automático do e-mail de acessos ao
  // clicar em "Baixar acessos" (ver server/src/lib/mailer.ts). Senha mascarada no GET/merge no PUT,
  // mesmo padrão do bloco `evolution` acima.
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS smtp JSONB`);

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
