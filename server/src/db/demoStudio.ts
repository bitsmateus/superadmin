import type { Pool } from 'pg';

/**
 * Tabelas do módulo "Demo Studio" (demos interativas compartilhadas por link — ver docs/demo-studio/).
 *
 * É o modelo de dados da §11 da especificação, traduzido de Prisma para SQL no padrão do projeto:
 * CREATE ... IF NOT EXISTS, roda a cada boot sem fazer diferença quando já existe. A ordem importa
 * (chaves estrangeiras). Prefixo `ds_` em tudo pra deixar o módulo visível em qualquer consulta.
 *
 * Usuários são os `profiles` do superadmin — o Demo Studio não tem cadastro de usuário próprio.
 * Ids de visitante/sessão são TEXT porque nascem no navegador (uuid gerado pelo player).
 */

/** O workspace único por enquanto. Fixo pra todo o código conseguir achá-lo sem consulta. */
export const DS_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

const TIPOS = [
  ['ds_demo_status', `'DRAFT','PUBLISHED','ARCHIVED'`],
  ['ds_frame_kind', `'IMAGE','HTML'`],
  ['ds_step_kind', `'HOTSPOT','MODAL','LEAD_FORM','CTA'`],
  ['ds_link_kind', `'CHANNEL','PERSONAL'`],
  ['ds_lead_status', `'NOVO','EM_CONTATO','QUALIFICADO','GANHO','PERDIDO'`],
  ['ds_delivery_status', `'PENDING','SUCCESS','FAILED'`],
] as const;

const TABELAS = [
  `CREATE TABLE IF NOT EXISTS ds_workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    -- ctaDefault {phone,message}, anonymizeAuto {...}, privacyUrl
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // Token pessoal da extensão de captura. Só o hash fica salvo; o token aparece uma vez ao gerar.
  `CREATE TABLE IF NOT EXISTS ds_api_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS ds_demos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES ds_workspaces(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    status ds_demo_status NOT NULL DEFAULT 'DRAFT',
    is_template BOOLEAN NOT NULL DEFAULT FALSE,
    segment TEXT,
    -- {accent, brandName, logoText, logoAssetPath}
    theme JSONB NOT NULL DEFAULT '{}',
    -- {showProgress, showRestart, leadGateStep, ctaPhone, ctaMessage}
    settings JSONB NOT NULL DEFAULT '{}',
    cover_frame_id UUID,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    published_version_id UUID UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS ds_demos_workspace_status_idx ON ds_demos (workspace_id, status)`,

  // Snapshot imutável do "Publicar": o link público sempre lê daqui.
  `CREATE TABLE IF NOT EXISTS ds_demo_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demo_id UUID NOT NULL REFERENCES ds_demos(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    snapshot JSONB NOT NULL,
    published_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (demo_id, number)
  )`,

  `CREATE TABLE IF NOT EXISTS ds_css_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sha256 TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL,
    bytes INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS ds_frames (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demo_id UUID NOT NULL REFERENCES ds_demos(id) ON DELETE CASCADE,
    kind ds_frame_kind NOT NULL DEFAULT 'IMAGE',
    name TEXT,
    image_path TEXT NOT NULL,
    thumb_path TEXT NOT NULL,
    -- px CSS
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    pixel_ratio REAL NOT NULL DEFAULT 1,
    display_url TEXT,
    -- URL real capturada (só interno, nunca vai pro player)
    source_url TEXT,
    html_path TEXT,
    css_asset_id UUID REFERENCES ds_css_assets(id),
    -- [{x,y,w,h,type:'blur'|'cover',text?}] em px CSS do frame
    masks JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS ds_frames_demo_idx ON ds_frames (demo_id)`,

  `CREATE TABLE IF NOT EXISTS ds_chapters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demo_id UUID NOT NULL REFERENCES ds_demos(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    "order" INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS ds_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demo_id UUID NOT NULL REFERENCES ds_demos(id) ON DELETE CASCADE,
    frame_id UUID NOT NULL REFERENCES ds_frames(id),
    chapter_id UUID REFERENCES ds_chapters(id) ON DELETE SET NULL,
    "order" INTEGER NOT NULL,
    kind ds_step_kind NOT NULL DEFAULT 'HOTSPOT',
    -- {x,y,w,h} px CSS do frame
    hotspot JSONB,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    placement TEXT NOT NULL DEFAULT 'auto',
    button_label TEXT,
    -- {type:'next'|'goto'|'url', stepId?, url?}
    action JSONB,
    -- LEAD_FORM: {fields:[{key,label,required}], consentText}
    form JSONB,
    -- CTA: {type:'WHATSAPP'|'URL', phone?, message?, url?, buttonLabel}
    cta JSONB
  )`,
  `CREATE INDEX IF NOT EXISTS ds_steps_demo_order_idx ON ds_steps (demo_id, "order")`,

  `CREATE TABLE IF NOT EXISTS ds_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES ds_workspaces(id),
    name TEXT,
    company TEXT,
    phone_e164 TEXT,
    email TEXT,
    role TEXT,
    cnpj TEXT,
    enrichment JSONB,
    status ds_lead_status NOT NULL DEFAULT 'NOVO',
    owner_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    -- {demoId, linkId, channel}
    source JSONB NOT NULL DEFAULT '{}',
    score INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS ds_leads_workspace_status_idx ON ds_leads (workspace_id, status)`,
  `CREATE INDEX IF NOT EXISTS ds_leads_phone_idx ON ds_leads (phone_e164)`,
  `CREATE INDEX IF NOT EXISTS ds_leads_email_idx ON ds_leads (email)`,

  `CREATE TABLE IF NOT EXISTS ds_share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demo_id UUID NOT NULL REFERENCES ds_demos(id) ON DELETE CASCADE,
    -- 7 chars base62
    code TEXT NOT NULL UNIQUE,
    kind ds_link_kind NOT NULL DEFAULT 'CHANNEL',
    label TEXT NOT NULL,
    created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES ds_leads(id) ON DELETE SET NULL,
    -- {empresa, nome, vendedor}
    variables JSONB NOT NULL DEFAULT '{}',
    utm JSONB NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS ds_share_links_demo_idx ON ds_share_links (demo_id)`,

  `CREATE TABLE IF NOT EXISTS ds_visitors (
    id TEXT PRIMARY KEY,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lead_id UUID REFERENCES ds_leads(id) ON DELETE SET NULL
  )`,

  `CREATE TABLE IF NOT EXISTS ds_view_sessions (
    id TEXT PRIMARY KEY,
    demo_id UUID NOT NULL REFERENCES ds_demos(id) ON DELETE CASCADE,
    version_id UUID,
    link_id UUID REFERENCES ds_share_links(id) ON DELETE SET NULL,
    visitor_id TEXT NOT NULL REFERENCES ds_visitors(id),
    lead_id UUID REFERENCES ds_leads(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    active_ms INTEGER NOT NULL DEFAULT 0,
    max_step_order INTEGER NOT NULL DEFAULT 0,
    steps_viewed INTEGER NOT NULL DEFAULT 0,
    total_steps INTEGER NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    cta_clicked BOOLEAN NOT NULL DEFAULT FALSE,
    internal BOOLEAN NOT NULL DEFAULT FALSE,
    -- mobile|tablet|desktop
    device TEXT,
    browser TEXT,
    os TEXT,
    referrer TEXT,
    utm JSONB NOT NULL DEFAULT '{}',
    -- sha256(ip + IP_SALT); o IP em claro nunca é salvo
    ip_hash TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS ds_view_sessions_demo_started_idx ON ds_view_sessions (demo_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS ds_view_sessions_link_started_idx ON ds_view_sessions (link_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS ds_view_sessions_lead_idx ON ds_view_sessions (lead_id)`,

  `CREATE TABLE IF NOT EXISTS ds_events (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES ds_view_sessions(id) ON DELETE CASCADE,
    -- session_start|step_view|hotspot_click|chapter_open|lead_submit|cta_click|complete|heartbeat
    type TEXT NOT NULL,
    step_id UUID,
    step_order INTEGER,
    data JSONB,
    ts TIMESTAMPTZ NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS ds_events_session_ts_idx ON ds_events (session_id, ts)`,
  `CREATE INDEX IF NOT EXISTS ds_events_type_ts_idx ON ds_events (type, ts)`,

  `CREATE TABLE IF NOT EXISTS ds_anonymize_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES ds_workspaces(id),
    find TEXT NOT NULL,
    replace TEXT NOT NULL,
    is_regex BOOLEAN NOT NULL DEFAULT FALSE,
    "order" INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS ds_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES ds_workspaces(id),
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{}',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS ds_webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id UUID NOT NULL REFERENCES ds_webhooks(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    payload JSONB NOT NULL,
    status ds_delivery_status NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    response_code INTEGER,
    response_body TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS ds_webhook_deliveries_pending_idx ON ds_webhook_deliveries (status, next_attempt_at)`,
];

export async function criarEstruturaDemoStudio(pool: Pool): Promise<void> {
  for (const [nome, valores] of TIPOS) {
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${nome}') THEN
        CREATE TYPE ${nome} AS ENUM (${valores});
      END IF;
    END $$;`);
  }
  for (const sql of TABELAS) await pool.query(sql);

  // Papel dentro do módulo (ADMIN vem de profiles.role = 'admin'). NULL = EDITOR.
  await pool.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ds_role TEXT`);

  // Seed básico: o workspace "NX Digital", com o CTA padrão da NX.
  await pool.query(
    `INSERT INTO ds_workspaces (id, name, settings) VALUES ($1, 'NX Digital', $2)
     ON CONFLICT (id) DO NOTHING`,
    [
      DS_WORKSPACE_ID,
      JSON.stringify({
        ctaDefault: {
          phone: process.env.DEFAULT_WHATSAPP || '5548936181649',
          message: 'Oi! Vi o tour do NX Systems e quero saber mais.',
        },
      }),
    ]
  );
}
