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

  // ── Comercial > Novos Leads (quadros estilo Monday) ──────────────────────
  await pool.query(`CREATE TABLE IF NOT EXISTS lead_boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#4F8EF7',
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
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
  // "Tipo" também virou etiqueta colorida — amplia o CHECK pra bancos já existentes.
  await pool.query(`ALTER TABLE lead_labels DROP CONSTRAINT IF EXISTS lead_labels_field_check`);
  await pool.query(`ALTER TABLE lead_labels ADD CONSTRAINT lead_labels_field_check CHECK (field IN ('tipo', 'dia_contato', 'status'))`);
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
