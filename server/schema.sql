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
  -- dentro dela, a quadros específicos de lead_boards (ver user_board_access). Default = sem restrição.
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
CREATE TABLE IF NOT EXISTS lead_boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#4F8EF7',
  -- Aba/tela onde o quadro aparece. Mover um lead pra outra aba é so trocar o
  -- board_id do lead pra um quadro que fique numa "page" diferente.
  page TEXT NOT NULL DEFAULT 'novos_leads' CHECK (page IN ('novos_leads', 'crm_luis', 'crm_arthur')),
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Allowlist de quadros pra usuários com profiles.restrict_access = true. Sem linhas pra um
-- user_id = sem restrição de quadro (vê todos os quadros da área liberada).
CREATE TABLE IF NOT EXISTS user_board_access (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES lead_boards(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, board_id)
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
  numero TEXT NOT NULL DEFAULT '',
  dor_cliente TEXT NOT NULL DEFAULT '',
  numero_atendentes TEXT NOT NULL DEFAULT '',
  valor_mrr TEXT NOT NULL DEFAULT '',
  valor_implementacao TEXT NOT NULL DEFAULT '',
  notes_count INT NOT NULL DEFAULT 0,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Exclusão é sempre "soft delete" (marca a data, não apaga a linha) — dá pra restaurar
  -- pela Lixeira na tela de Lista. NULL = ativo, preenchido = na lixeira.
  deleted_at TIMESTAMPTZ
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
CREATE TABLE IF NOT EXISTS lead_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field TEXT NOT NULL CHECK (field IN ('tipo', 'dia_contato', 'status', 'sdr', 'ligacao')),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#9CA3AF',
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_labels_field_idx ON lead_labels(field);

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

-- ---------- Seed das etiquetas de Tipo, Dia de contato, Status e SDR ----------
INSERT INTO lead_labels (field, name, color, position)
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
WHERE NOT EXISTS (SELECT 1 FROM lead_labels ll WHERE ll.field = v.field AND ll.name = v.name);

-- =====================================================================
-- APÓS RODAR ESTE SCHEMA:
-- Crie o primeiro usuário admin com:
--   INSERT INTO profiles (email, name, role, password_hash)
--   VALUES ('seu@email.com', 'Seu Nome', 'admin', crypt('sua_senha', gen_salt('bf')));
-- OU use a API: POST /api/users com um script de seed.
-- =====================================================================
