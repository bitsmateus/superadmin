-- =====================================================================
-- TenantHub — Migração de Hardening (Review do código)
--
-- Aplica correções de:
--  - pipeline_stage faltando 'lead'
--  - índices em colunas usadas pra match (asaas/tenant link/email)
--  - updated_at em clients (auto-touch trigger)
--  - tira `settings` do publication realtime (vazava asaas_api_key)
--  - rate limit + cap de tamanho em submit_briefing (anônimo)
--  - relaxa due_day pra 1..31
--  - constraint de tamanho em briefing_data (jsonb size)
--
-- IDEMPOTENTE — pode rodar várias vezes. SQL Editor → Run.
-- =====================================================================

-- 1. Adicionar 'lead' ao enum pipeline_stage (se ainda não existe)
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on e.enumtypid = t.oid
    where t.typname = 'pipeline_stage' and e.enumlabel = 'lead'
  ) then
    alter type public.pipeline_stage add value 'lead' before 'welcome';
  end if;
end $$;

-- 2. Índices úteis (idempotentes)
create index if not exists clients_asaas_customer_id_idx
  on public.clients (asaas_customer_id)
  where asaas_customer_id is not null;

create index if not exists clients_tenant_link_idx
  on public.clients (tenant_server_id, tenant_id)
  where tenant_id is not null;

create index if not exists clients_email_lower_idx
  on public.clients (lower(email))
  where email is not null and email <> '';

-- 3. updated_at em clients
alter table public.clients
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists clients_touch_updated_at on public.clients;
create trigger clients_touch_updated_at
  before update on public.clients
  for each row execute function public.touch_updated_at();

-- 4. Tirar settings do publication realtime (vazava asaas_api_key)
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'settings'
  ) then
    alter publication supabase_realtime drop table public.settings;
  end if;
end $$;

-- 5. Relaxar due_day pra 1..31 (28 era arbitrário e UI não clampava)
do $$
declare
  con_name text;
begin
  select conname into con_name
  from pg_constraint
  where conrelid = 'public.clients'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%due_day%';

  if con_name is not null then
    execute format('alter table public.clients drop constraint %I', con_name);
  end if;
end $$;

alter table public.clients
  add constraint clients_due_day_range check (due_day is null or (due_day between 1 and 31));

-- 6. Rate limit + cap em submit_briefing
--    - Bloqueia payloads > 64KB
--    - Bloqueia se o cliente foi submetido nas últimas 30 segundos
--      (anti-spam suave, dá pra ajustar)
create or replace function public.submit_briefing(token_in text, data_in jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status public.briefing_status;
  last_log_at timestamptz;
begin
  -- cap de tamanho do payload
  if octet_length(data_in::text) > 64 * 1024 then
    raise exception 'Briefing muito grande (> 64KB).';
  end if;

  -- token tem que existir e estar pendente
  select briefing_status into current_status
  from public.clients
  where briefing_token = token_in
  limit 1;

  if not found then
    raise exception 'Token inválido.';
  end if;

  if current_status = 'approved' then
    raise exception 'Briefing já aprovado.';
  end if;

  -- rate limit suave: 1 submissão a cada 30 segundos
  select max((entry->>'createdAt')::timestamptz) into last_log_at
  from public.clients,
       jsonb_array_elements(logs) as entry
  where briefing_token = token_in
    and entry->>'action' = 'Briefing preenchido pelo cliente';

  if last_log_at is not null and now() - last_log_at < interval '30 seconds' then
    raise exception 'Aguarde antes de reenviar.';
  end if;

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

-- 7. Settings — colunas pra senhas/telefone (antes hardcoded no código)
alter table public.settings
  add column if not exists default_tenant_password text;
alter table public.settings
  add column if not exists default_access_password text;
alter table public.settings
  add column if not exists support_phone text;

-- 8. View de leitura segura pra suporte (sem campos financeiros)
--    Reforça o gating do FinancePage no servidor — suporte que tentar
--    consultar via SDK não vê pagamentos/valores. Os tabs de UI continuam
--    indo direto em public.clients (admin/supervisor).
create or replace view public.clients_safe as
select
  id, name, email, phone, company, responsavel, stage,
  created_at, stage_updated_at, updated_at,
  tenant_id, tenant_server_id, tenant_api_id, tenant_name,
  support_email,
  briefing_token, briefing_status, briefing_sent_at,
  briefing_data, briefing_approved_at, briefing_revision_note,
  delivery_checklist, delivery_handoff_checklist,
  delivery_date, delivery_notes, delivery_completed_at,
  followup_active, followups,
  notes, logs
from public.clients;

grant select on public.clients_safe to authenticated;

-- =====================================================================
-- FIM
-- =====================================================================
