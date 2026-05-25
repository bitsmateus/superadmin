-- =====================================================================
-- TenantHub — Sistema de Tickets, KB, Templates, Lembretes
--
-- Cria:
--   - ticket_categories (categorias com SLA padrão + ícone)
--   - ticket_triage_steps (perguntas em árvore por categoria)
--   - kb_articles (base de conhecimento + vídeos externos)
--   - tickets + ticket_messages (thread)
--   - message_templates (respostas prontas)
--   - reminders (lembretes pessoais)
--
-- IDEMPOTENTE — pode rodar várias vezes.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- Enums ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type public.ticket_status as enum (
      'new', 'open', 'pending_customer', 'resolved', 'closed'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'ticket_priority') then
    create type public.ticket_priority as enum (
      'low', 'normal', 'high', 'urgent'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'ticket_author_type') then
    create type public.ticket_author_type as enum (
      'customer', 'agent', 'system'
    );
  end if;
end $$;

-- ---------- Categorias ----------
create table if not exists public.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  icon text default 'HelpCircle',
  color text default 'info',
  position int not null default 0,
  active boolean not null default true,
  default_sla_hours int not null default 24,
  default_priority public.ticket_priority not null default 'normal',
  created_at timestamptz not null default now()
);

-- ---------- Triagem em árvore ----------
-- Cada step tem uma pergunta e opções. Cada opção pode levar a outro step
-- (sub-pergunta) ou a um kb_article (resolução sugerida). O caminho do
-- cliente é registrado em tickets.triage_path.
create table if not exists public.ticket_triage_steps (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.ticket_categories(id) on delete cascade,
  parent_id uuid references public.ticket_triage_steps(id) on delete cascade,
  -- Pergunta apresentada ao cliente nesse passo.
  question text not null,
  -- options: [{ "label": "Sim", "next_step_id": "uuid|null", "kb_article_id": "uuid|null" }]
  options jsonb not null default '[]'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists triage_category_idx on public.ticket_triage_steps(category_id);
create index if not exists triage_parent_idx on public.ticket_triage_steps(parent_id);

-- ---------- Knowledge Base ----------
create table if not exists public.kb_articles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  summary text,
  body_markdown text,
  -- Pra vídeos externos (YouTube/Loom). Embed gerado no client.
  video_url text,
  category_id uuid references public.ticket_categories(id) on delete set null,
  tags text[] not null default '{}',
  views_count int not null default 0,
  helpful_count int not null default 0,
  not_helpful_count int not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kb_category_idx on public.kb_articles(category_id);
create index if not exists kb_published_idx on public.kb_articles(published) where published = true;

-- ---------- Tickets ----------
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  -- Número curto exibido ao cliente (#1, #2 ...). Sequence auto.
  number serial unique,

  -- Vínculo com Client (CRM). Null quando ainda não foi feito o match.
  client_id uuid references public.clients(id) on delete set null,
  category_id uuid references public.ticket_categories(id) on delete set null,

  -- Snapshot do cliente que abriu (preservado mesmo após vínculo).
  customer_name text,
  customer_email text not null,
  customer_cnpj text,
  customer_phone text,
  customer_company text,

  -- Conteúdo
  subject text not null,
  description text,
  -- Caminho da triagem: array de { question, answer, kb_article_id? }
  triage_path jsonb not null default '[]'::jsonb,

  status public.ticket_status not null default 'new',
  priority public.ticket_priority not null default 'normal',

  -- Responsável (profile do painel). Null = não atribuído.
  assignee_id uuid references public.profiles(id) on delete set null,

  -- SLA
  sla_hours int not null default 24,
  sla_due_at timestamptz,

  -- Timeline
  opened_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  last_message_at timestamptz not null default now(),

  -- Acesso público (cliente acompanha sem login).
  public_token text unique not null default gen_random_uuid()::text,

  -- Flags
  needs_linking boolean not null default false,
  customer_resolved_via_kb boolean not null default false,

  created_at timestamptz not null default now()
);

create index if not exists tickets_status_idx on public.tickets(status);
create index if not exists tickets_assignee_idx on public.tickets(assignee_id);
create index if not exists tickets_client_idx on public.tickets(client_id);
create index if not exists tickets_email_idx on public.tickets(lower(customer_email));
create index if not exists tickets_sla_idx on public.tickets(sla_due_at) where status in ('new', 'open');
create index if not exists tickets_public_token_idx on public.tickets(public_token);
create index if not exists tickets_needs_linking_idx on public.tickets(needs_linking) where needs_linking = true;

-- Trigger: define sla_due_at na criação
create or replace function public.set_ticket_sla_due()
returns trigger
language plpgsql
as $$
begin
  if new.sla_due_at is null and new.sla_hours is not null then
    new.sla_due_at := new.opened_at + (new.sla_hours || ' hours')::interval;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_set_sla on public.tickets;
create trigger tickets_set_sla
  before insert on public.tickets
  for each row execute function public.set_ticket_sla_due();

-- ---------- Mensagens do ticket (thread) ----------
create table if not exists public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_type public.ticket_author_type not null,
  author_id uuid references public.profiles(id) on delete set null,
  -- Snapshot do nome (preserva mesmo se profile for removido).
  author_name text,
  content text not null,
  -- Notas internas não são exibidas no portal do cliente.
  is_internal boolean not null default false,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messages_ticket_idx
  on public.ticket_messages(ticket_id, created_at);

-- Trigger: atualiza last_message_at + first_response_at no ticket
create or replace function public.touch_ticket_after_message()
returns trigger
language plpgsql
as $$
declare
  ticket_row public.tickets%rowtype;
begin
  select * into ticket_row from public.tickets where id = new.ticket_id;
  if not found then
    return new;
  end if;

  -- Atualiza last_message_at
  update public.tickets set last_message_at = new.created_at where id = new.ticket_id;

  -- Primeira resposta de agente (não interna) marca first_response_at
  if new.author_type = 'agent' and new.is_internal = false
     and ticket_row.first_response_at is null then
    update public.tickets
       set first_response_at = new.created_at,
           status = case when ticket_row.status = 'new' then 'open'::public.ticket_status else ticket_row.status end
     where id = new.ticket_id;
  end if;

  -- Cliente respondendo num ticket pending_customer reabre
  if new.author_type = 'customer' and ticket_row.status = 'pending_customer' then
    update public.tickets set status = 'open' where id = new.ticket_id;
  end if;

  return new;
end;
$$;

drop trigger if exists ticket_messages_touch on public.ticket_messages;
create trigger ticket_messages_touch
  after insert on public.ticket_messages
  for each row execute function public.touch_ticket_after_message();

-- ---------- Templates de mensagem ----------
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  content text not null,
  scope text not null default 'all',  -- 'ticket', 'email', 'whatsapp', 'all'
  category text,
  shortcut text,  -- Ex.: "/saudacao"
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- Lembretes pessoais ----------
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  title text not null,
  notes text,
  due_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists reminders_user_due_idx
  on public.reminders(user_id, due_at)
  where completed_at is null;

-- =====================================================================
-- RLS
-- =====================================================================

alter table public.ticket_categories enable row level security;
alter table public.ticket_triage_steps enable row level security;
alter table public.kb_articles enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.message_templates enable row level security;
alter table public.reminders enable row level security;

-- Categorias / triagem / KB: leitura anônima (portal público precisa)
drop policy if exists "categories_read_all" on public.ticket_categories;
create policy "categories_read_all"
  on public.ticket_categories for select
  to anon, authenticated using (active = true);

drop policy if exists "categories_write_admin" on public.ticket_categories;
create policy "categories_write_admin"
  on public.ticket_categories for all
  to authenticated
  using (public.current_role() in ('admin', 'supervisor'))
  with check (public.current_role() in ('admin', 'supervisor'));

drop policy if exists "triage_read_all" on public.ticket_triage_steps;
create policy "triage_read_all"
  on public.ticket_triage_steps for select
  to anon, authenticated using (true);

drop policy if exists "triage_write_admin" on public.ticket_triage_steps;
create policy "triage_write_admin"
  on public.ticket_triage_steps for all
  to authenticated
  using (public.current_role() in ('admin', 'supervisor'))
  with check (public.current_role() in ('admin', 'supervisor'));

drop policy if exists "kb_read_all" on public.kb_articles;
create policy "kb_read_all"
  on public.kb_articles for select
  to anon, authenticated using (published = true);

drop policy if exists "kb_write_admin" on public.kb_articles;
create policy "kb_write_admin"
  on public.kb_articles for all
  to authenticated
  using (public.current_role() in ('admin', 'supervisor'))
  with check (public.current_role() in ('admin', 'supervisor'));

-- Tickets: leitura interna pra autenticados; cliente acessa via RPC
drop policy if exists "tickets_read_auth" on public.tickets;
create policy "tickets_read_auth"
  on public.tickets for select
  to authenticated using (true);

drop policy if exists "tickets_write_auth" on public.tickets;
create policy "tickets_write_auth"
  on public.tickets for all
  to authenticated
  using (true)
  with check (true);

-- Mensagens: idem; cliente público posta via RPC
drop policy if exists "messages_read_auth" on public.ticket_messages;
create policy "messages_read_auth"
  on public.ticket_messages for select
  to authenticated using (true);

drop policy if exists "messages_write_auth" on public.ticket_messages;
create policy "messages_write_auth"
  on public.ticket_messages for all
  to authenticated
  using (true)
  with check (true);

-- Templates: leitura todos auth, escrita admin/supervisor
drop policy if exists "templates_read_auth" on public.message_templates;
create policy "templates_read_auth"
  on public.message_templates for select
  to authenticated using (true);

drop policy if exists "templates_write_auth" on public.message_templates;
create policy "templates_write_auth"
  on public.message_templates for all
  to authenticated
  using (true)
  with check (true);

-- Lembretes: cada um vê os seus; admin vê todos
drop policy if exists "reminders_select_own" on public.reminders;
create policy "reminders_select_own"
  on public.reminders for select
  to authenticated
  using (user_id = auth.uid() or public.current_role() = 'admin');

drop policy if exists "reminders_write_own" on public.reminders;
create policy "reminders_write_own"
  on public.reminders for all
  to authenticated
  using (user_id = auth.uid() or public.current_role() = 'admin')
  with check (user_id = auth.uid() or public.current_role() = 'admin');

-- =====================================================================
-- RPCs públicas (portal do cliente)
-- =====================================================================

-- 1) Identifica cliente por email — retorna o Client + lista de tickets dele.
create or replace function public.support_lookup_by_email(email_in text)
returns table (
  client_id uuid,
  client_name text,
  client_company text,
  open_tickets int
)
language sql
security definer
set search_path = public
as $$
  select
    c.id as client_id,
    c.name as client_name,
    c.company as client_company,
    (
      select count(*)::int from public.tickets t
      where t.client_id = c.id and t.status not in ('resolved', 'closed')
    ) as open_tickets
  from public.clients c
  where lower(c.email) = lower(trim(email_in))
  limit 1
$$;

grant execute on function public.support_lookup_by_email(text) to anon, authenticated;

-- 2) Cria ticket via portal público. Aceita anônimo (sem auth).
create or replace function public.create_public_ticket(
  customer_email_in text,
  customer_name_in text,
  customer_cnpj_in text,
  customer_phone_in text,
  customer_company_in text,
  category_id_in uuid,
  subject_in text,
  description_in text,
  triage_path_in jsonb
)
returns table (
  ticket_id uuid,
  ticket_number int,
  public_token text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_client_id uuid;
  matched_company text;
  new_ticket_id uuid;
  new_ticket_number int;
  new_public_token text;
  cat_default_sla int := 24;
  cat_default_priority public.ticket_priority := 'normal';
begin
  -- cap de tamanho
  if length(subject_in) > 200 then
    raise exception 'Assunto muito longo.';
  end if;
  if length(coalesce(description_in, '')) > 5000 then
    raise exception 'Descrição muito longa.';
  end if;
  if octet_length(triage_path_in::text) > 16 * 1024 then
    raise exception 'Triagem muito longa.';
  end if;

  -- Tenta match por email (case-insensitive)
  select c.id, c.company into matched_client_id, matched_company
  from public.clients c
  where lower(c.email) = lower(trim(customer_email_in))
  limit 1;

  -- Lê SLA padrão da categoria se houver
  if category_id_in is not null then
    select tc.default_sla_hours, tc.default_priority
      into cat_default_sla, cat_default_priority
    from public.ticket_categories tc where tc.id = category_id_in;
  end if;

  insert into public.tickets as t (
    client_id, category_id,
    customer_name, customer_email, customer_cnpj, customer_phone, customer_company,
    subject, description, triage_path,
    needs_linking, sla_hours, priority
  ) values (
    matched_client_id, category_id_in,
    customer_name_in,
    trim(customer_email_in),
    customer_cnpj_in,
    customer_phone_in,
    coalesce(customer_company_in, matched_company),
    subject_in, description_in, coalesce(triage_path_in, '[]'::jsonb),
    matched_client_id is null,
    coalesce(cat_default_sla, 24),
    coalesce(cat_default_priority, 'normal'::public.ticket_priority)
  )
  returning t.id, t.number, t.public_token
    into new_ticket_id, new_ticket_number, new_public_token;

  -- Mensagem inicial do cliente
  insert into public.ticket_messages (ticket_id, author_type, author_name, content)
  values (new_ticket_id, 'customer', customer_name_in, coalesce(description_in, '(sem descrição)'));

  return query select new_ticket_id, new_ticket_number, new_public_token;
end;
$$;

grant execute on function public.create_public_ticket(text, text, text, text, text, uuid, text, text, jsonb) to anon, authenticated;

-- 3) Busca ticket público por token (cliente acompanha)
create or replace function public.get_public_ticket(token_in text)
returns table (
  id uuid,
  number int,
  subject text,
  status public.ticket_status,
  priority public.ticket_priority,
  customer_name text,
  customer_email text,
  customer_company text,
  opened_at timestamptz,
  last_message_at timestamptz,
  category_id uuid,
  messages jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    t.id, t.number, t.subject, t.status, t.priority,
    t.customer_name, t.customer_email, t.customer_company,
    t.opened_at, t.last_message_at, t.category_id,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'author_type', m.author_type,
        'author_name', m.author_name,
        'content', m.content,
        'created_at', m.created_at
      ) order by m.created_at)
      from public.ticket_messages m
      where m.ticket_id = t.id and m.is_internal = false
    ), '[]'::jsonb) as messages
  from public.tickets t
  where t.public_token = token_in
  limit 1
$$;

grant execute on function public.get_public_ticket(text) to anon, authenticated;

-- 4) Cliente posta nova mensagem no ticket dele (via token)
create or replace function public.post_public_ticket_message(
  token_in text,
  author_name_in text,
  content_in text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t_id uuid;
  t_status public.ticket_status;
begin
  if length(content_in) > 5000 then
    raise exception 'Mensagem muito longa.';
  end if;

  select id, status into t_id, t_status
  from public.tickets where public_token = token_in;
  if not found then
    raise exception 'Token inválido.';
  end if;
  if t_status in ('resolved', 'closed') then
    raise exception 'Ticket já encerrado.';
  end if;

  insert into public.ticket_messages (ticket_id, author_type, author_name, content)
  values (t_id, 'customer', author_name_in, content_in);
end;
$$;

grant execute on function public.post_public_ticket_message(text, text, text) to anon, authenticated;

-- =====================================================================
-- Realtime
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'tickets'
  ) then
    alter publication supabase_realtime add table public.tickets;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'ticket_messages'
  ) then
    alter publication supabase_realtime add table public.ticket_messages;
  end if;
end $$;

-- =====================================================================
-- Seed mínimo de categorias (idempotente — só insere se vazio)
-- =====================================================================
insert into public.ticket_categories (name, description, icon, color, position, default_sla_hours, default_priority)
select * from (values
  ('WhatsApp não conecta',   'Problemas pra conectar/manter o número online',  'MessageCircle', 'warning', 1, 4,  'high'::public.ticket_priority),
  ('Mensagens não chegam',   'Cliente ou operador não recebe mensagens',       'AlertTriangle', 'danger',  2, 4,  'urgent'::public.ticket_priority),
  ('Configuração de bot/IA', 'Ajustes no fluxo, instruções, tom de voz',       'Bot',           'info',    3, 24, 'normal'::public.ticket_priority),
  ('Usuários e acesso',      'Criar usuários, resetar senha, permissões',      'Users',         'info',    4, 12, 'normal'::public.ticket_priority),
  ('Financeiro',             'Dúvidas sobre cobrança, vencimento, recibo',     'CreditCard',    'success', 5, 24, 'normal'::public.ticket_priority),
  ('Outro',                  'Não encontrei minha categoria',                  'HelpCircle',    'neutral', 99, 24, 'low'::public.ticket_priority)
) as v(name, description, icon, color, position, default_sla_hours, default_priority)
where not exists (select 1 from public.ticket_categories);

-- =====================================================================
-- FIM
-- =====================================================================
