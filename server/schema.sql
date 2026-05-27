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
    CREATE TYPE pipeline_stage AS ENUM ('lead','welcome','contract','briefing','setup','delivery','active','churned');
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT settings_singleton CHECK (id = TRUE)
);

-- ---------- clients ----------
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  company TEXT NOT NULL,
  responsavel TEXT,
  stage pipeline_stage NOT NULL DEFAULT 'welcome',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stage_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  tenant_id TEXT,
  tenant_server_id TEXT,
  tenant_api_id TEXT,
  tenant_name TEXT,
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
  has_automacao_externa BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS clients_stage_idx ON clients(stage);
CREATE INDEX IF NOT EXISTS clients_created_at_idx ON clients(created_at DESC);
CREATE INDEX IF NOT EXISTS clients_briefing_token_idx ON clients(briefing_token);
CREATE INDEX IF NOT EXISTS clients_email_lower_idx ON clients(lower(email));

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
  due_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

-- =====================================================================
-- APÓS RODAR ESTE SCHEMA:
-- Crie o primeiro usuário admin com:
--   INSERT INTO profiles (email, name, role, password_hash)
--   VALUES ('seu@email.com', 'Seu Nome', 'admin', crypt('sua_senha', gen_salt('bf')));
-- OU use a API: POST /api/users com um script de seed.
-- =====================================================================
