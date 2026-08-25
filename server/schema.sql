-- =====================================================================
-- SuperAdmin — Schema standalone PostgreSQL (sem Supabase)
-- Execute este arquivo no seu banco db-superadmin no EasyPanel
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------- Enums ----------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'supervisor', 'suporte');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pipeline_stage') THEN
    CREATE TYPE pipeline_stage AS ENUM ('lead','welcome','contract','briefing','setup_start','setup','setup_done','delivery','delivered','active','churned');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'briefing_status') THEN
    CREATE TYPE briefing_status AS ENUM ('not_sent','sent','filled','approved','revision');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE payment_status AS ENUM ('pending','paid','overdue');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_status') THEN
    CREATE TYPE ticket_status AS ENUM ('new','open','pending_customer','resolved','closed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_priority') THEN
    CREATE TYPE ticket_priority AS ENUM ('low','normal','high','urgent');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_author_type') THEN
    CREATE TYPE ticket_author_type AS ENUM ('customer','agent','system');
  END IF;
END $$;

-- ---------- profiles ----------
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role user_role NOT NULL DEFAULT 'suporte',
  -- Área no funil: 'comercial' | 'entrega' | 'ambos'. Nulo = ambos.
  area TEXT,
  -- Trava opcional de acesso (só relevante pro papel 'suporte'/"Usuário"): restringe à área e,
  -- dentro dela, a abas específicas do Comercial (ver user_page_access). Default = sem restrição.
  restrict_access BOOLEAN NOT NULL DEFAULT false,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- settings (singleton) ----------
CREATE TABLE IF NOT EXISTS settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  asaas_api_key TEXT,
  asaas_environment TEXT CHECK (asaas_environment IN ('sandbox','production')) DEFAULT 'sandbox',
  asaas_sync_interval_min INT DEFAULT 15,
  default_tenant_password TEXT,
  default_access_password TEXT,
  support_phone TEXT,
  followups_enabled BOOLEAN DEFAULT TRUE,
  followup_templates JSONB,
  nps_delay_days INT DEFAULT 7,
  nps_enabled BOOLEAN DEFAULT TRUE,
  notify_edge_function_url TEXT,
  notify_enabled BOOLEAN DEFAULT FALSE,
  goal_new_clients_monthly INT,
  goal_mrr_monthly NUMERIC(12,2),
  goal_nps_monthly INT,
  goals_enabled BOOLEAN DEFAULT FALSE,
  last_backup_at TIMESTAMPTZ,
  backup_remind_days INT DEFAULT 7,
  servers JSONB,
  support_group JSONB,
  evolution JSONB,
  uazapi JSONB,
  sla_by_stage JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT settings_singleton CHECK (id = TRUE)
);
-- add column if running against existing DB
ALTER TABLE settings ADD COLUMN IF NOT EXISTS servers JSONB;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS support_group JSONB;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS evolution JSONB;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS uazapi JSONB;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sla_by_stage JSONB;

-- ---------- channel_alerts (config de aviso por canal) ----------
CREATE TABLE IF NOT EXISTS channel_alerts (
  channel_key TEXT PRIMARY KEY,
  alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  alert_number TEXT,
  last_status TEXT,
  last_alert_at TIMESTAMPTZ,
  status_since TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE channel_alerts ADD COLUMN IF NOT EXISTS status_since TIMESTAMPTZ;

-- ---------- channel_events (histórico de quedas/retornos p/ relatórios) ----------
CREATE TABLE IF NOT EXISTS channel_events (
  id BIGSERIAL PRIMARY KEY,
  channel_key TEXT NOT NULL,
  channel_name TEXT,
  channel_number TEXT,
  client_id UUID,
  client_name TEXT,
  status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS channel_events_changed_idx ON channel_events (changed_at DESC);
CREATE INDEX IF NOT EXISTS channel_events_key_idx ON channel_events (channel_key);

-- ---------- channel_assignments (vínculo de instância avulsa a cliente) ----------
CREATE TABLE IF NOT EXISTS channel_assignments (
  provider TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  client_id UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, instance_key)
);

-- ---------- archived_orphans (avulsos arquivados, sem excluir no provedor) ----------
CREATE TABLE IF NOT EXISTS archived_orphans (
  provider TEXT NOT NULL,
  instance_key TEXT NOT NULL,
  name TEXT,
  number TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, instance_key)
);
ALTER TABLE archived_orphans ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE archived_orphans ADD COLUMN IF NOT EXISTS number TEXT;

-- ---------- clients ----------
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  company TEXT NOT NULL,
  responsavel TEXT,
  responsavel_comercial TEXT,
  responsavel_entrega TEXT,
  channel_notify_enabled BOOLEAN DEFAULT FALSE,
  channel_notify_number TEXT,
  stage pipeline_stage NOT NULL DEFAULT 'welcome',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stage_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  tenant_id TEXT,
  tenant_server_id TEXT,
  tenant_api_id TEXT,
  tenant_api_token TEXT,
  tenant_name TEXT,
  ficha_cadastro JSONB,
  briefing_number TEXT,
  support_email TEXT,
  support_password TEXT,

  contract_url TEXT,
  contract_sent_at TIMESTAMPTZ,
  contract_signed_at TIMESTAMPTZ,
  asaas_customer_id TEXT,
  asaas_payment_id TEXT,
  asaas_subscription_id TEXT,
  implementation_value NUMERIC,
  monthly_value NUMERIC,
  due_day INT CHECK (due_day IS NULL OR (due_day BETWEEN 1 AND 31)),
  payment_status payment_status,
  last_payment_check TIMESTAMPTZ,
  payments JSONB NOT NULL DEFAULT '[]',
  extra_links JSONB NOT NULL DEFAULT '[]',
  finance_notes TEXT,

  briefing_token TEXT UNIQUE,
  briefing_status briefing_status,
  briefing_sent_at TIMESTAMPTZ,
  briefing_data JSONB,
  briefing_approved_at TIMESTAMPTZ,
  briefing_revision_note TEXT,

  delivery_checklist JSONB NOT NULL DEFAULT '[]',
  delivery_handoff_checklist JSONB DEFAULT '[]',
  delivery_date TEXT,
  delivery_notes TEXT,
  delivery_completed_at TIMESTAMPTZ,

  followup_active BOOLEAN NOT NULL DEFAULT FALSE,
  followups JSONB NOT NULL DEFAULT '[]',
  notes JSONB NOT NULL DEFAULT '[]',
  logs JSONB NOT NULL DEFAULT '[]',

  has_api_oficial BOOLEAN NOT NULL DEFAULT FALSE,
  has_ia BOOLEAN NOT NULL DEFAULT FALSE,
  has_automacao_externa BOOLEAN NOT NULL DEFAULT FALSE,

  briefing_config JSONB,
  accesses JSONB,
  -- Progresso da config de API Oficial e de IA (checklist com estado).
  config_progress JSONB,
  -- Fluxo do chatbot: roteiro (spec) revisável, JSON final importável, avisos.
  chatbot_flow_spec JSONB,
  chatbot_flow_json JSONB,
  chatbot_flow_warnings JSONB,
  chatbot_flow_generated_at TIMESTAMPTZ,
  chatbot_flow_published_at TIMESTAMPTZ,
  platform_app BOOLEAN NOT NULL DEFAULT FALSE,
  platform_web BOOLEAN NOT NULL DEFAULT FALSE,
  platform_chat BOOLEAN NOT NULL DEFAULT FALSE,
  contract_file TEXT,
  contract_file_name TEXT,

  -- Arquivamento (soft-delete): card sai do pipeline mas pode ser restaurado.
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS clients_stage_idx ON clients(stage);
CREATE INDEX IF NOT EXISTS clients_created_at_idx ON clients(created_at DESC);
CREATE INDEX IF NOT EXISTS clients_briefing_token_idx ON clients(briefing_token);
CREATE INDEX IF NOT EXISTS clients_email_lower_idx ON clients(lower(email));
CREATE INDEX IF NOT EXISTS clients_archived_at_idx ON clients(archived_at);

-- Auto-touch updated_at
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS clients_touch_updated_at ON clients;
CREATE TRIGGER clients_touch_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- stage_updated_at when stage changes
CREATE OR REPLACE FUNCTION touch_stage_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN NEW.stage_updated_at := NOW(); END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS clients_stage_touch ON clients;
CREATE TRIGGER clients_stage_touch BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION touch_stage_updated_at();

-- ---------- ticket_categories ----------
CREATE TABLE IF NOT EXISTS ticket_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT 'HelpCircle',
  color TEXT DEFAULT 'info',
  position INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  default_sla_hours INT NOT NULL DEFAULT 24,
  default_priority ticket_priority NOT NULL DEFAULT 'normal',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- ticket_triage_steps ----------
CREATE TABLE IF NOT EXISTS ticket_triage_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES ticket_categories(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES ticket_triage_steps(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]',
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS triage_category_idx ON ticket_triage_steps(category_id);

-- ---------- lead_boards / lead_rows (Comercial: Novos Leads, CRM NX Luis, CRM NX Arthur) ----------
-- Abas do Comercial, gerenciáveis por admin (criar/duplicar/arquivar) — não é mais um enum fixo.
CREATE TABLE IF NOT EXISTS lead_pages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO lead_pages (id, name, position) VALUES
  ('novos_leads', 'Novos Leads', 0),
  ('crm_luis', 'CRM NX Luis', 1),
  ('crm_arthur', 'CRM NX Arthur', 2)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS lead_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#4F8EF7',
  -- Aba/tela onde o quadro aparece. Mover um lead pra outra aba é so trocar o
  -- board_id do lead pra um quadro que fique numa "page" diferente.
  page TEXT NOT NULL DEFAULT 'novos_leads' REFERENCES lead_pages(id),
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- true no quadro que recebe as oportunidades de venda (so um no sistema).
  is_vendas BOOLEAN NOT NULL DEFAULT false,
  -- Quadro marcado com is_contrato renderiza a ContratoView (geração de contrato a partir do
  -- CNPJ) em vez do quadro Monday-style genérico. Sem exclusividade tipo is_vendas.
  is_contrato BOOLEAN NOT NULL DEFAULT false
);

-- Legado: allowlist por QUADRO — substituída por user_page_access (allowlist por ABA inteira,
-- ver abaixo). Mantida só porque já existe em bancos antigos; nada no app lê/escreve mais aqui.
CREATE TABLE IF NOT EXISTS user_board_access (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES lead_boards(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, board_id)
);

-- Allowlist de ABAS do Comercial (lead_pages) pra usuários com profiles.restrict_access = true.
-- Sem linhas pra um user_id = sem restrição de aba (vê todas as abas ativas). Todos os quadros
-- de uma aba liberada ficam visíveis — a granularidade é por aba inteira, não por quadro.
CREATE TABLE IF NOT EXISTS user_page_access (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES lead_pages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, page_id)
);

-- Allowlist de itens de menu pra usuários com profiles.restrict_access = true. Sem linhas pra um
-- user_id = ainda não configurado (não corta por página — só por quadro, se houver).
CREATE TABLE IF NOT EXISTS user_menu_access (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  menu_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, menu_key)
);

CREATE TABLE IF NOT EXISTS lead_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES lead_boards(id) ON DELETE CASCADE,
  nome TEXT NOT NULL DEFAULT '',
  tipo TEXT NOT NULL DEFAULT '',
  empresa TEXT NOT NULL DEFAULT '',
  telefone TEXT NOT NULL DEFAULT '',
  dia_contato TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  agendamento TEXT NOT NULL DEFAULT '',
  retornar TEXT NOT NULL DEFAULT '',
  retornado BOOLEAN NOT NULL DEFAULT false,
  responsavel TEXT NOT NULL DEFAULT '',
  sdr TEXT NOT NULL DEFAULT '',
  -- Faltava aqui: db.ts cria lead_rows com `ligacao` e uma migracao faz UPDATE nela, entao um
  -- banco montado so pelo schema.sql quebrava ao subir o servidor ("column ligacao does not exist").
  ligacao TEXT NOT NULL DEFAULT '',
  numero TEXT NOT NULL DEFAULT '',
  dor_cliente TEXT NOT NULL DEFAULT '',
  numero_atendentes TEXT NOT NULL DEFAULT '',
  valor_mrr TEXT NOT NULL DEFAULT '',
  valor_implementacao TEXT NOT NULL DEFAULT '',
  -- Registro de venda: data de fechamento, lead que originou a oportunidade (NULL = venda
  -- lancada a mao) e marca de venda desfeita. Ver comentario em db.ts.
  fechamento TEXT NOT NULL DEFAULT '',
  venda_origem_id UUID,
  venda_revertida BOOLEAN NOT NULL DEFAULT false,
  notes_count INT NOT NULL DEFAULT 0,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Exclusão é sempre "soft delete" (marca a data, não apaga a linha) — dá pra restaurar
  -- pela Lixeira na tela de Lista. NULL = ativo, preenchido = na lixeira.
  deleted_at TIMESTAMPTZ,
  -- Motivo informado ao excluir uma venda (aba Vendas) — só usado ali; pra lead comum fica vazio.
  delete_reason TEXT,
  -- Marca manual (só a pessoa liga/desliga) de pagamento pendente — usada só na aba Vendas.
  -- Default true: toda venda nasce "pendente" até alguém confirmar o pagamento.
  mrr_pendente BOOLEAN NOT NULL DEFAULT true,
  impl_pendente BOOLEAN NOT NULL DEFAULT true,
  -- Comentário livre pro controle manual na aba Vendas (ex.: "paga metade metade", condição
  -- especial negociada). Só aparece/edita lá, não é uma coluna do quadro Monday-style.
  observacoes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS lead_rows_board_idx ON lead_rows(board_id);
CREATE INDEX IF NOT EXISTS lead_rows_deleted_at_idx ON lead_rows(deleted_at) WHERE deleted_at IS NOT NULL;

DROP TRIGGER IF EXISTS lead_rows_touch_updated_at ON lead_rows;
CREATE TRIGGER lead_rows_touch_updated_at BEFORE UPDATE ON lead_rows
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- lead_notes (bloco de anotações/atualizações por lead) ----------
CREATE TABLE IF NOT EXISTS lead_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_row_id UUID NOT NULL REFERENCES lead_rows(id) ON DELETE CASCADE,
  author_id UUID,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_notes_lead_row_idx ON lead_notes(lead_row_id);

-- ---------- lead_events (linha do tempo automática por lead) ----------
-- Chegada, mudança de status/dia de contato/SDR/quadro, marcado como retornado — gravado pelo
-- backend a cada PATCH relevante em lead_rows. Log imutável: só INSERT, sem UPDATE/DELETE.
CREATE TABLE IF NOT EXISTS lead_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_row_id UUID NOT NULL REFERENCES lead_rows(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  actor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_events_lead_row_idx ON lead_events(lead_row_id);

-- Mantém lead_rows.notes_count em sincronia sem precisar contar em toda leitura.
CREATE OR REPLACE FUNCTION increment_lead_notes_count() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE lead_rows SET notes_count = notes_count + 1 WHERE id = NEW.lead_row_id;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS lead_notes_count_trigger ON lead_notes;
CREATE TRIGGER lead_notes_count_trigger AFTER INSERT ON lead_notes
  FOR EACH ROW EXECUTE FUNCTION increment_lead_notes_count();

CREATE OR REPLACE FUNCTION decrement_lead_notes_count() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE lead_rows SET notes_count = GREATEST(notes_count - 1, 0) WHERE id = OLD.lead_row_id;
  RETURN OLD;
END; $$;

DROP TRIGGER IF EXISTS lead_notes_decrement_trigger ON lead_notes;
CREATE TRIGGER lead_notes_decrement_trigger AFTER DELETE ON lead_notes
  FOR EACH ROW EXECUTE FUNCTION decrement_lead_notes_count();

-- ---------- lead_labels (etiquetas coloridas de "Tipo", "Dia de contato", "Status", "SDR" e "Ligação") ----------
-- page_id: escopo por aba (cada CRM tem seu próprio conjunto) — NULL só pra "sdr", que continua
-- global (é a lista de SDRs de verdade, usada pra travar/rotear leads entre abas).
CREATE TABLE IF NOT EXISTS lead_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field TEXT NOT NULL CHECK (field IN ('tipo', 'dia_contato', 'status', 'sdr', 'ligacao')),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#9CA3AF',
  position INT NOT NULL DEFAULT 0,
  page_id TEXT REFERENCES lead_pages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_labels_field_idx ON lead_labels(field);
CREATE INDEX IF NOT EXISTS lead_labels_page_field_idx ON lead_labels(page_id, field);

-- ---------- kb_articles ----------
CREATE TABLE IF NOT EXISTS kb_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  body_markdown TEXT,
  video_url TEXT,
  category_id UUID REFERENCES ticket_categories(id) ON DELETE SET NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  views_count INT NOT NULL DEFAULT 0,
  helpful_count INT NOT NULL DEFAULT 0,
  not_helpful_count INT NOT NULL DEFAULT 0,
  published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- tickets ----------
CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number SERIAL UNIQUE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  category_id UUID REFERENCES ticket_categories(id) ON DELETE SET NULL,
  customer_name TEXT,
  customer_email TEXT NOT NULL,
  customer_cnpj TEXT,
  customer_phone TEXT,
  customer_company TEXT,
  subject TEXT NOT NULL,
  description TEXT,
  triage_path JSONB NOT NULL DEFAULT '[]',
  status ticket_status NOT NULL DEFAULT 'new',
  priority ticket_priority NOT NULL DEFAULT 'normal',
  assignee_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  sla_hours INT NOT NULL DEFAULT 24,
  sla_due_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_response_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  public_token TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::TEXT,
  needs_linking BOOLEAN NOT NULL DEFAULT FALSE,
  customer_resolved_via_kb BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status);
CREATE INDEX IF NOT EXISTS tickets_client_idx ON tickets(client_id);
CREATE INDEX IF NOT EXISTS tickets_public_token_idx ON tickets(public_token);

-- SLA trigger
CREATE OR REPLACE FUNCTION set_ticket_sla_due() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sla_due_at IS NULL AND NEW.sla_hours IS NOT NULL THEN
    NEW.sla_due_at := NEW.opened_at + (NEW.sla_hours || ' hours')::INTERVAL;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS tickets_set_sla ON tickets;
CREATE TRIGGER tickets_set_sla BEFORE INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION set_ticket_sla_due();

-- ---------- ticket_messages ----------
CREATE TABLE IF NOT EXISTS ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_type ticket_author_type NOT NULL,
  author_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  author_name TEXT,
  content TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  attachments JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_ticket_idx ON ticket_messages(ticket_id, created_at);

-- Touch ticket after message
CREATE OR REPLACE FUNCTION touch_ticket_after_message() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE ticket_row tickets%ROWTYPE;
BEGIN
  SELECT * INTO ticket_row FROM tickets WHERE id = NEW.ticket_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  UPDATE tickets SET last_message_at = NEW.created_at WHERE id = NEW.ticket_id;
  IF NEW.author_type = 'agent' AND NEW.is_internal = FALSE AND ticket_row.first_response_at IS NULL THEN
    UPDATE tickets SET first_response_at = NEW.created_at,
      status = CASE WHEN ticket_row.status = 'new' THEN 'open'::ticket_status ELSE ticket_row.status END
    WHERE id = NEW.ticket_id;
  END IF;
  IF NEW.author_type = 'customer' AND ticket_row.status = 'pending_customer' THEN
    UPDATE tickets SET status = 'open' WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS ticket_messages_touch ON ticket_messages;
CREATE TRIGGER ticket_messages_touch AFTER INSERT ON ticket_messages
  FOR EACH ROW EXECUTE FUNCTION touch_ticket_after_message();

-- ---------- message_templates ----------
CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all',
  category TEXT,
  shortcut TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- reminders ----------
CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind TEXT,
  status TEXT,
  priority TEXT
);

-- Itens fixos do menu Suporte — admin pode arquivar (some do menu, fica salvo pra restaurar).
-- As URLs continuam fixas (/pipeline, /tickets…), só a visibilidade no menu é gerenciável.
-- source_key = id pro item original; numa cópia ("Duplicar"), aponta pro id do item de origem —
-- é o que faz uma cópia abrir a MESMA tela/rota do original (ver comentário nas rotas).
CREATE TABLE IF NOT EXISTS support_pages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_key TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  -- Visao salva da copia (filtros/modo de exibicao escolhidos ao duplicar). NULL = padrao da tela.
  view_config JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO support_pages (id, name, source_key, position) VALUES
  ('tarefas',       'Suporte (Tarefas)',   'tarefas',       1),
  ('pipeline',      'Pipeline',             'pipeline',      2),
  ('clientes',      'Clientes',             'clientes',      3),
  ('canais',        'Canais',               'canais',        4),
  ('tenants',       'Tenants',              'tenants',       5),
  ('configuracoes', 'Configurações',        'configuracoes', 6),
  ('arquivados',    'Clientes arquivados',  'arquivados',    7),
  ('tickets',       'Tickets',              'tickets',       8),
  ('templates',     'Templates',            'templates',     9)
ON CONFLICT (id) DO NOTHING;

-- ---------- support_page_stages / support_page_clients ----------
-- Etapas proprias de uma COPIA do menu Suporte. O item de origem usa as etapas fixas do codigo
-- (PIPELINE_STAGES), que alimentam funil/Dashboard -- por isso so a copia tem etapas no banco.
CREATE TABLE IF NOT EXISTS support_page_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id TEXT NOT NULL REFERENCES support_pages(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#9CA3AF',
  position INT NOT NULL DEFAULT 0,
  is_done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (page_id, key)
);
CREATE INDEX IF NOT EXISTS support_page_stages_page_idx ON support_page_stages(page_id, position);

-- Quais clientes aparecem numa copia, e em que etapa dela. Associacao, nao duplicata: o cliente
-- continua unico em `clients`, e stage_key e separado de clients.stage (verdade dos relatorios).
CREATE TABLE IF NOT EXISTS support_page_clients (
  page_id TEXT NOT NULL REFERENCES support_pages(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (page_id, client_id)
);
CREATE INDEX IF NOT EXISTS support_page_clients_page_idx ON support_page_clients(page_id, stage_key, position);

-- ---------- stage_history ----------
CREATE TABLE IF NOT EXISTS stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  from_stage pipeline_stage,
  to_stage pipeline_stage NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS stage_history_client_idx ON stage_history(client_id);
CREATE INDEX IF NOT EXISTS stage_history_at_idx ON stage_history(at DESC);

-- Stage change trigger
CREATE OR REPLACE FUNCTION record_stage_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO stage_history (client_id, from_stage, to_stage, at) VALUES (NEW.id, NULL, NEW.stage, COALESCE(NEW.created_at, NOW()));
    RETURN NEW;
  END IF;
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO stage_history (client_id, from_stage, to_stage, at) VALUES (NEW.id, OLD.stage, NEW.stage, NOW());
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS clients_record_stage_history ON clients;
CREATE TRIGGER clients_record_stage_history AFTER INSERT OR UPDATE OF stage ON clients
  FOR EACH ROW EXECUTE FUNCTION record_stage_change();

-- ---------- audit_log ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  actor_email TEXT,
  actor_name TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  summary TEXT,
  changes JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log(at DESC);

-- ---------- nps_responses ----------
CREATE TABLE IF NOT EXISTS nps_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  public_token TEXT UNIQUE NOT NULL DEFAULT gen_random_uuid()::TEXT,
  score INT CHECK (score IS NULL OR (score BETWEEN 0 AND 10)),
  comment TEXT,
  classification TEXT CHECK (classification IN ('detractor','neutral','promoter')),
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------- LISTEN/NOTIFY triggers for realtime ----------
CREATE OR REPLACE FUNCTION notify_db_change() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  payload TEXT;
  record_data JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    record_data := to_jsonb(OLD);
  ELSE
    record_data := to_jsonb(NEW);
  END IF;
  payload := json_build_object('table', TG_TABLE_NAME, 'type', TG_OP, 'data', record_data)::TEXT;
  -- Truncate payload if too large for NOTIFY (8000 byte limit)
  IF length(payload) > 7500 THEN
    payload := json_build_object('table', TG_TABLE_NAME, 'type', TG_OP, 'data', json_build_object('id', record_data->>'id'))::TEXT;
  END IF;
  PERFORM pg_notify('db_changes', payload);
  RETURN NEW;
END; $$;

-- Apply NOTIFY trigger to all watched tables
DROP TRIGGER IF EXISTS notify_clients ON clients;
CREATE TRIGGER notify_clients AFTER INSERT OR UPDATE OR DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION notify_db_change();

DROP TRIGGER IF EXISTS notify_settings ON settings;
CREATE TRIGGER notify_settings AFTER INSERT OR UPDATE ON settings
  FOR EACH ROW EXECUTE FUNCTION notify_db_change();

DROP TRIGGER IF EXISTS notify_profiles ON profiles;
CREATE TRIGGER notify_profiles AFTER INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION notify_db_change();

DROP TRIGGER IF EXISTS notify_user_page_access ON user_page_access;
CREATE TRIGGER notify_user_page_access AFTER INSERT OR UPDATE OR DELETE ON user_page_access
  FOR EACH ROW EXECUTE FUNCTION notify_db_change();

DROP TRIGGER IF EXISTS notify_user_menu_access ON user_menu_access;
CREATE TRIGGER notify_user_menu_access AFTER INSERT OR UPDATE OR DELETE ON user_menu_access
  FOR EACH ROW EXECUTE FUNCTION notify_db_change();

DROP TRIGGER IF EXISTS notify_tickets ON tickets;
CREATE TRIGGER notify_tickets AFTER INSERT OR UPDATE OR DELETE ON tickets
  FOR EACH ROW EXECUTE FUNCTION notify_db_change();

DROP TRIGGER IF EXISTS notify_ticket_messages ON ticket_messages;
CREATE TRIGGER notify_ticket_messages AFTER INSERT ON ticket_messages
  FOR EACH ROW EXECUTE FUNCTION notify_db_change();

DROP TRIGGER IF EXISTS notify_nps ON nps_responses;
CREATE TRIGGER notify_nps AFTER INSERT OR UPDATE OR DELETE ON nps_responses
  FOR EACH ROW EXECUTE FUNCTION notify_db_change();

DROP TRIGGER IF EXISTS notify_stage_history ON stage_history;
CREATE TRIGGER notify_stage_history AFTER INSERT ON stage_history
  FOR EACH ROW EXECUTE FUNCTION notify_db_change();

DROP TRIGGER IF EXISTS notify_audit_log ON audit_log;
CREATE TRIGGER notify_audit_log AFTER INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION notify_db_change();

DROP TRIGGER IF EXISTS notify_lead_pages ON lead_pages;
CREATE TRIGGER notify_lead_pages AFTER INSERT OR UPDATE OR DELETE ON lead_pages
  FOR EACH ROW EXECUTE FUNCTION notify_db_change();

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

DROP TRIGGER IF EXISTS notify_lead_labels ON lead_labels;
CREATE TRIGGER notify_lead_labels AFTER INSERT OR UPDATE OR DELETE ON lead_labels
  FOR EACH ROW EXECUTE FUNCTION notify_db_change();

-- ---------- Seed de categorias ----------
INSERT INTO ticket_categories (name, description, icon, color, position, default_sla_hours, default_priority)
SELECT * FROM (VALUES
  ('WhatsApp não conecta',   'Problemas pra conectar/manter o número online',  'MessageCircle', 'warning', 1, 4,  'high'::ticket_priority),
  ('Mensagens não chegam',   'Cliente ou operador não recebe mensagens',       'AlertTriangle', 'danger',  2, 4,  'urgent'::ticket_priority),
  ('Configuração de bot/IA', 'Ajustes no fluxo, instruções, tom de voz',       'Bot',           'info',    3, 24, 'normal'::ticket_priority),
  ('Usuários e acesso',      'Criar usuários, resetar senha, permissões',      'Users',         'info',    4, 12, 'normal'::ticket_priority),
  ('Financeiro',             'Dúvidas sobre cobrança, vencimento, recibo',     'CreditCard',    'success', 5, 24, 'normal'::ticket_priority),
  ('Outro',                  'Não encontrei minha categoria',                  'HelpCircle',    'neutral', 99, 24, 'low'::ticket_priority)
) AS v(name, description, icon, color, position, default_sla_hours, default_priority)
WHERE NOT EXISTS (SELECT 1 FROM ticket_categories);

-- ---------- Seed do quadro padrão de leads ----------
INSERT INTO lead_boards (name, color, position)
SELECT 'Leads Novos', '#4F8EF7', 0
WHERE NOT EXISTS (SELECT 1 FROM lead_boards);

-- ---------- Seed dos quadros do funil comercial ----------
WITH next_pos AS (
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
WHERE NOT EXISTS (SELECT 1 FROM lead_boards lb WHERE lb.name = s.name);

-- ---------- Seed das etiquetas de SDR ----------
-- Só "sdr" é semeado aqui — é a lista global de SDRs de verdade (roteamento entre abas). As
-- demais (tipo/dia_contato/ligacao/status) agora são por aba: cada CRM começa vazio e ganha as
-- suas via "Editar etiquetas" (ver migração de backfill em db.ts pra quem já tinha as globais).
INSERT INTO lead_labels (field, name, color, position)
SELECT * FROM (VALUES
  ('sdr', 'Luis',                       '#4F8EF7', 1),
  ('sdr', 'Arthur',                     '#8B5CF6', 2)
) AS v(field, name, color, position)
WHERE NOT EXISTS (SELECT 1 FROM lead_labels ll WHERE ll.field = v.field AND ll.name = v.name);

-- ---------- contract_templates / contracts ----------
-- Aba Contrato (Dashboard Comercial) -- modelo(s) padrao de contrato em HTML com placeholders
-- "<<...>>" (guardados como entidades HTML) e os contratos gerados por cliente.
CREATE TABLE IF NOT EXISTS contract_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  conteudo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES lead_boards(id) ON DELETE CASCADE,
  template_id UUID REFERENCES contract_templates(id) ON DELETE SET NULL,
  campos JSONB NOT NULL DEFAULT '{}',
  conteudo TEXT NOT NULL DEFAULT '',
  -- Marcacao manual (a pessoa marca quando o cliente devolve assinado).
  status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'assinado')),
  -- Liga o contrato a linha de origem no quadro de Vendas (quando criado a partir da fila
  -- "Pendente de contrato") -- permite calcular quais vendas ainda nao tem contrato nenhum.
  venda_lead_id UUID REFERENCES lead_rows(id) ON DELETE SET NULL,
  -- "Pendente de contrato" e alimentada pela ficha de cadastro publica (clients.ficha_cadastro),
  -- nao mais por vendas manuais -- client_id liga o contrato ao cliente que preencheu a ficha.
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  -- Data em que foi marcado como assinado (null = nunca assinado ou desmarcado depois) -- usada
  -- pro filtro por mes da aba "Contratos assinados".
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contracts_board_id_idx ON contracts(board_id);
CREATE INDEX IF NOT EXISTS contracts_venda_lead_id_idx ON contracts(venda_lead_id);
CREATE INDEX IF NOT EXISTS contracts_client_id_idx ON contracts(client_id);

-- ---------- commercial_months ----------
-- Painel do Mês (Dashboard Comercial) — um registro por mês (id = 'YYYY-MM') só com os campos
-- manuais (investimento em tráfego, leads gerados, permanência média). O resto do painel é
-- calculado ao vivo em cima de lead_rows/lead_boards.
CREATE TABLE IF NOT EXISTS commercial_months (
  id TEXT PRIMARY KEY,
  investimento_trafego TEXT NOT NULL DEFAULT '0,00',
  leads_gerados INT NOT NULL DEFAULT 0,
  permanencia_media NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- APÓS RODAR ESTE SCHEMA:
-- Crie o primeiro usuário admin com:
--   INSERT INTO profiles (email, name, role, password_hash)
--   VALUES ('seu@email.com', 'Seu Nome', 'admin', crypt('sua_senha', gen_salt('bf')));
-- OU use a API: POST /api/users com um script de seed.
-- =====================================================================
