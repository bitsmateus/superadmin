-- =====================================================================
-- TenantHub — Schema inicial (Supabase / PostgreSQL)
--
-- COMO RODAR
-- 1) Abra o projeto no Supabase
-- 2) Vá em "SQL Editor" → "New query"
-- 3) Cole este arquivo inteiro e clique em "Run"
-- 4) Vá em Authentication → Users → "Add user" e crie sua conta com o
--    e-mail: mateus.bitencourt.sousa@gmail.com (escolha uma senha)
--    O trigger handle_new_user cria o profile com role 'suporte'.
-- 5) Volte aqui no SQL Editor e rode APENAS este UPDATE para virar admin:
--      update public.profiles set role = 'admin'
--      where email = 'mateus.bitencourt.sousa@gmail.com';
--
-- A partir daí, novos usuários criados pelo admin via UI (/users) entram
-- com o role escolhido. Self-signup pelo painel de login fica desativado
-- (só admin convida).
-- =====================================================================

-- ---------- 0. Extensões e tipos ----------
create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type public.user_role as enum ('admin', 'supervisor', 'suporte');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pipeline_stage') then
    create type public.pipeline_stage as enum (
      'welcome','contract','briefing','setup','delivery','active','churned'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'contract_status') then
    create type public.contract_status as enum ('not_sent','sent','signed');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'briefing_status') then
    create type public.briefing_status as enum (
      'not_sent','sent','filled','approved','revision'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum ('pending','paid','overdue');
  end if;
end $$;

-- ---------- 1. profiles (espelha auth.users + role) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  role public.user_role not null default 'suporte',
  created_at timestamptz not null default now()
);

-- Trigger que cria automaticamente o profile quando alguém é criado em auth.users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', null))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: lê o role do usuário autenticado (usado em policies).
create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------- 2. settings (singleton por org — uma linha só) ----------
create table if not exists public.settings (
  id boolean primary key default true,
  asaas_api_key text,
  asaas_environment text check (asaas_environment in ('sandbox','production')) default 'sandbox',
  followups_enabled boolean default true,
  followup_templates jsonb,
  updated_at timestamptz not null default now(),
  constraint settings_singleton check (id = true)
);

-- ---------- 3. clients (núcleo do CRM) ----------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text not null,
  company text not null,
  responsavel text,
  stage public.pipeline_stage not null default 'welcome',
  created_at timestamptz not null default now(),
  stage_updated_at timestamptz not null default now(),

  -- Tenant vinculado (criado em um dos 3 servidores)
  tenant_id text,
  tenant_server_id text,
  tenant_api_id text,
  tenant_name text,
  support_email text,
  support_password text,

  -- Contrato
  contract_url text,
  contract_sent_at timestamptz,
  contract_signed_at timestamptz,
  asaas_customer_id text,
  asaas_payment_id text,
  asaas_subscription_id text,
  implementation_value numeric,
  monthly_value numeric,
  due_day int check (due_day between 1 and 28),
  payment_status public.payment_status,
  last_payment_check timestamptz,

  -- Financeiro (manual + Asaas)
  payments jsonb not null default '[]'::jsonb,
  extra_links jsonb not null default '[]'::jsonb,
  finance_notes text,

  -- Briefing
  briefing_token text unique,
  briefing_status public.briefing_status,
  briefing_sent_at timestamptz,
  briefing_data jsonb,
  briefing_approved_at timestamptz,
  briefing_revision_note text,

  -- Entrega
  delivery_checklist jsonb not null default '[]'::jsonb,
  delivery_handoff_checklist jsonb default '[]'::jsonb,
  delivery_date text,
  delivery_notes text,
  delivery_completed_at timestamptz,

  -- Follow-up
  followup_active boolean not null default false,
  followups jsonb not null default '[]'::jsonb,

  -- Auditoria local
  notes jsonb not null default '[]'::jsonb,
  logs jsonb not null default '[]'::jsonb
);

create index if not exists clients_stage_idx on public.clients (stage);
create index if not exists clients_created_at_idx on public.clients (created_at desc);
create index if not exists clients_briefing_token_idx on public.clients (briefing_token);

-- Mantém stage_updated_at sincronizado quando stage muda
create or replace function public.touch_stage_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists clients_stage_touch on public.clients;
create trigger clients_stage_touch
  before update on public.clients
  for each row execute function public.touch_stage_updated_at();

-- ---------- 4. RLS ----------
alter table public.profiles enable row level security;
alter table public.clients  enable row level security;
alter table public.settings enable row level security;

-- profiles --
drop policy if exists "profiles read all" on public.profiles;
create policy "profiles read all"
  on public.profiles for select
  to authenticated using (true);

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles admin manage" on public.profiles;
create policy "profiles admin manage"
  on public.profiles for all
  to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- clients --
-- Leitura: todos autenticados leem todos os clientes
drop policy if exists "clients read all" on public.clients;
create policy "clients read all"
  on public.clients for select
  to authenticated using (true);

-- Inserir: admin e supervisor e suporte podem criar
drop policy if exists "clients insert" on public.clients;
create policy "clients insert"
  on public.clients for insert
  to authenticated
  with check (public.current_role() in ('admin','supervisor','suporte'));

-- Update: admin/supervisor podem tudo. Suporte só pode mexer em campos
-- não-financeiros — checamos NO APP, mas reforçamos no banco com uma
-- policy que bloqueia mudança em colunas sensíveis via trigger BEFORE UPDATE.
drop policy if exists "clients update" on public.clients;
create policy "clients update"
  on public.clients for update
  to authenticated
  using (public.current_role() in ('admin','supervisor','suporte'))
  with check (public.current_role() in ('admin','supervisor','suporte'));

-- Trigger que bloqueia suporte de tocar em campos de contrato/financeiro
create or replace function public.guard_support_writes()
returns trigger
language plpgsql
as $$
declare
  r public.user_role := public.current_role();
begin
  if r = 'suporte' then
    if new.contract_url is distinct from old.contract_url
       or new.contract_sent_at is distinct from old.contract_sent_at
       or new.contract_signed_at is distinct from old.contract_signed_at
       or new.asaas_customer_id is distinct from old.asaas_customer_id
       or new.asaas_payment_id is distinct from old.asaas_payment_id
       or new.asaas_subscription_id is distinct from old.asaas_subscription_id
       or new.implementation_value is distinct from old.implementation_value
       or new.monthly_value is distinct from old.monthly_value
       or new.due_day is distinct from old.due_day
       or new.payment_status is distinct from old.payment_status
       or new.last_payment_check is distinct from old.last_payment_check
       or new.payments is distinct from old.payments
       or new.extra_links is distinct from old.extra_links
       or new.finance_notes is distinct from old.finance_notes
    then
      raise exception 'Role "suporte" não pode alterar dados de contrato/financeiro';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_guard_support on public.clients;
create trigger clients_guard_support
  before update on public.clients
  for each row execute function public.guard_support_writes();

-- Delete: APENAS admin
drop policy if exists "clients delete admin only" on public.clients;
create policy "clients delete admin only"
  on public.clients for delete
  to authenticated
  using (public.current_role() = 'admin');

-- settings --
-- Leitura: todos autenticados (a chave Asaas é necessária pro fluxo do contrato)
drop policy if exists "settings read auth" on public.settings;
create policy "settings read auth"
  on public.settings for select
  to authenticated using (true);

-- Update/insert: só admin
drop policy if exists "settings write admin" on public.settings;
create policy "settings write admin"
  on public.settings for all
  to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

-- ---------- 5. Briefing público (acesso anônimo via token) ----------
-- A página pública /briefing/:token precisa ler o cliente sem login.
-- Em vez de abrir a tabela pra anon, criamos uma RPC SECURITY DEFINER
-- que devolve o cliente correspondente ao token (e nada mais).
create or replace function public.get_client_by_briefing_token(token_in text)
returns table (
  id uuid,
  name text,
  company text,
  briefing_status public.briefing_status,
  briefing_data jsonb,
  briefing_revision_note text
)
language sql
security definer
set search_path = public
as $$
  select id, name, company, briefing_status, briefing_data, briefing_revision_note
  from public.clients
  where briefing_token = token_in
  limit 1
$$;

grant execute on function public.get_client_by_briefing_token(text) to anon, authenticated;

-- RPC pra cliente submeter o briefing preenchido (anônimo, validado pelo token)
create or replace function public.submit_briefing(token_in text, data_in jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.clients
    set briefing_data = data_in,
        briefing_status = 'filled',
        logs = logs || jsonb_build_array(jsonb_build_object(
          'id', gen_random_uuid()::text,
          'action', 'Briefing preenchido pelo cliente',
          'createdAt', now()
        ))
    where briefing_token = token_in;
end;
$$;

grant execute on function public.submit_briefing(text, jsonb) to anon, authenticated;

-- ---------- 6. Realtime ----------
-- Sinaliza ao Supabase que essas tabelas devem emitir eventos via Realtime.
alter publication supabase_realtime add table public.clients;
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.settings;

-- =====================================================================
-- FIM — depois de rodar, crie sua conta em Auth → Users e rode:
--   update public.profiles set role = 'admin'
--   where email = 'mateus.bitencourt.sousa@gmail.com';
-- =====================================================================
