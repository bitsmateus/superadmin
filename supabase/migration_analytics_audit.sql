-- =====================================================================
-- TenantHub — Analytics + Auditoria + Metas + Backup
--
-- Cria:
--   - stage_history (track de transições pra calcular tempo médio em stage
--     e funil de conversão real)
--   - audit_log (registro de ações sensíveis: delete, role change, settings)
--   - Triggers que populam stage_history automaticamente
--   - Triggers que registram audit_log (delete cliente, mudança role, edit
--     settings)
--   - Colunas em settings pra metas + backup
--   - RPCs: list_audit_log (admin only), audit_event_app (registrar evento
--     do app)
--
-- IDEMPOTENTE — pode rodar várias vezes.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- stage_history ----------
-- Insere uma linha sempre que clients.stage muda (inclusive na criação).
-- Permite calcular:
--   - tempo médio em cada stage (diff entre transições)
--   - funil de conversão (quantos clientes passaram por cada stage)
--   - clientes que avançaram em janela de tempo
create table if not exists public.stage_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  from_stage public.pipeline_stage,
  to_stage public.pipeline_stage not null,
  at timestamptz not null default now()
);

create index if not exists stage_history_client_idx on public.stage_history(client_id);
create index if not exists stage_history_at_idx on public.stage_history(at desc);
create index if not exists stage_history_to_stage_idx on public.stage_history(to_stage);

-- ---------- audit_log ----------
-- Log de ações sensíveis pra compliance/descoberta de incidentes.
-- entity_type: 'client' | 'profile' | 'settings' | 'backup' | 'goals' | etc.
-- action: 'delete' | 'role_change' | 'update' | 'export' | 'restore' | etc.
-- changes: jsonb com {before, after} ou {key: value} relevante (truncado se
-- muito grande)
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  actor_name text,
  entity_type text not null,
  entity_id text,
  action text not null,
  summary text,
  changes jsonb,
  at timestamptz not null default now()
);

create index if not exists audit_log_at_idx on public.audit_log(at desc);
create index if not exists audit_log_actor_idx on public.audit_log(actor_id);
create index if not exists audit_log_entity_idx on public.audit_log(entity_type, entity_id);

-- ---------- Settings: metas + backup ----------
alter table public.settings
  add column if not exists goal_new_clients_monthly int;
alter table public.settings
  add column if not exists goal_mrr_monthly numeric(12, 2);
alter table public.settings
  add column if not exists goal_nps_monthly int;
alter table public.settings
  add column if not exists goals_enabled boolean default false;
alter table public.settings
  add column if not exists last_backup_at timestamptz;
alter table public.settings
  add column if not exists backup_remind_days int default 7;

-- =====================================================================
-- Trigger: popula stage_history em INSERT/UPDATE de clients
-- =====================================================================
create or replace function public.record_stage_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.stage_history (client_id, from_stage, to_stage, at)
    values (new.id, null, new.stage, coalesce(new.created_at, now()));
    return new;
  end if;
  -- UPDATE
  if new.stage is distinct from old.stage then
    insert into public.stage_history (client_id, from_stage, to_stage, at)
    values (new.id, old.stage, new.stage, now());
  end if;
  return new;
end;
$$;

drop trigger if exists clients_record_stage_history on public.clients;
create trigger clients_record_stage_history
  after insert or update of stage on public.clients
  for each row execute function public.record_stage_change();

-- Backfill: pra clientes existentes que ainda não têm linha em stage_history,
-- cria a linha "inicial" usando stage atual e created_at.
insert into public.stage_history (client_id, from_stage, to_stage, at)
select c.id, null, c.stage, c.created_at
from public.clients c
where not exists (
  select 1 from public.stage_history h where h.client_id = c.id
);

-- =====================================================================
-- Helpers pra audit_log — captura ator do JWT (jwt.claims.sub) quando
-- disponível. Em conexões service_role/triggers sem JWT, fica null.
-- =====================================================================
create or replace function public._audit_actor()
returns table (id uuid, email text, name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid;
begin
  uid := auth.uid();
  if uid is null then
    return query select null::uuid, null::text, null::text;
    return;
  end if;
  return query
    select p.id, p.email, p.name
    from public.profiles p
    where p.id = uid;
end;
$$;

-- =====================================================================
-- Trigger: delete de cliente registra audit_log
-- =====================================================================
create or replace function public.audit_client_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
begin
  select * into a from public._audit_actor();
  insert into public.audit_log (
    actor_id, actor_email, actor_name,
    entity_type, entity_id, action, summary, changes
  ) values (
    a.id, a.email, a.name,
    'client', old.id::text, 'delete',
    'Cliente "' || coalesce(old.company, old.name, old.email) || '" removido',
    jsonb_build_object(
      'name', old.name,
      'email', old.email,
      'company', old.company,
      'stage', old.stage
    )
  );
  return old;
end;
$$;

drop trigger if exists clients_audit_delete on public.clients;
create trigger clients_audit_delete
  before delete on public.clients
  for each row execute function public.audit_client_delete();

-- =====================================================================
-- Trigger: mudança de role em profiles registra audit_log
-- =====================================================================
create or replace function public.audit_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
begin
  if new.role is not distinct from old.role then
    return new;
  end if;
  select * into a from public._audit_actor();
  insert into public.audit_log (
    actor_id, actor_email, actor_name,
    entity_type, entity_id, action, summary, changes
  ) values (
    a.id, a.email, a.name,
    'profile', new.id::text, 'role_change',
    'Role de "' || coalesce(new.name, new.email) || '" alterado de '
      || old.role::text || ' para ' || new.role::text,
    jsonb_build_object('before', old.role, 'after', new.role)
  );
  return new;
end;
$$;

drop trigger if exists profiles_audit_role_change on public.profiles;
create trigger profiles_audit_role_change
  after update of role on public.profiles
  for each row execute function public.audit_profile_role_change();

-- =====================================================================
-- Trigger: update em settings registra audit_log (sem expor valores
-- sensíveis como asaas_api_key — só sinaliza que mudou).
-- =====================================================================
create or replace function public.audit_settings_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  diff jsonb := '{}'::jsonb;
  changed_keys text[] := '{}';
begin
  select * into a from public._audit_actor();

  -- Compara cada coluna; pra colunas sensíveis registra só "changed".
  if new.asaas_api_key is distinct from old.asaas_api_key then
    changed_keys := changed_keys || 'asaas_api_key';
    diff := diff || jsonb_build_object('asaas_api_key', 'changed');
  end if;
  if new.asaas_environment is distinct from old.asaas_environment then
    changed_keys := changed_keys || 'asaas_environment';
    diff := diff || jsonb_build_object('asaas_environment',
      jsonb_build_object('before', old.asaas_environment, 'after', new.asaas_environment));
  end if;
  if new.default_tenant_password is distinct from old.default_tenant_password then
    changed_keys := changed_keys || 'default_tenant_password';
    diff := diff || jsonb_build_object('default_tenant_password', 'changed');
  end if;
  if new.default_access_password is distinct from old.default_access_password then
    changed_keys := changed_keys || 'default_access_password';
    diff := diff || jsonb_build_object('default_access_password', 'changed');
  end if;
  if new.support_phone is distinct from old.support_phone then
    changed_keys := changed_keys || 'support_phone';
    diff := diff || jsonb_build_object('support_phone',
      jsonb_build_object('before', old.support_phone, 'after', new.support_phone));
  end if;
  if new.goal_new_clients_monthly is distinct from old.goal_new_clients_monthly then
    changed_keys := changed_keys || 'goal_new_clients_monthly';
    diff := diff || jsonb_build_object('goal_new_clients_monthly',
      jsonb_build_object('before', old.goal_new_clients_monthly, 'after', new.goal_new_clients_monthly));
  end if;
  if new.goal_mrr_monthly is distinct from old.goal_mrr_monthly then
    changed_keys := changed_keys || 'goal_mrr_monthly';
    diff := diff || jsonb_build_object('goal_mrr_monthly',
      jsonb_build_object('before', old.goal_mrr_monthly, 'after', new.goal_mrr_monthly));
  end if;
  if new.goals_enabled is distinct from old.goals_enabled then
    changed_keys := changed_keys || 'goals_enabled';
    diff := diff || jsonb_build_object('goals_enabled',
      jsonb_build_object('before', old.goals_enabled, 'after', new.goals_enabled));
  end if;

  if array_length(changed_keys, 1) is null then
    return new;
  end if;

  insert into public.audit_log (
    actor_id, actor_email, actor_name,
    entity_type, entity_id, action, summary, changes
  ) values (
    a.id, a.email, a.name,
    'settings', 'singleton', 'update',
    'Configurações alteradas: ' || array_to_string(changed_keys, ', '),
    diff
  );
  return new;
end;
$$;

drop trigger if exists settings_audit_update on public.settings;
create trigger settings_audit_update
  after update on public.settings
  for each row execute function public.audit_settings_update();

-- =====================================================================
-- RPC: registrar evento do app (export backup, restore, etc.)
-- Pode ser chamado por qualquer usuário autenticado — o ator vem do JWT.
-- =====================================================================
create or replace function public.audit_event_app(
  entity_type_in text,
  entity_id_in text,
  action_in text,
  summary_in text,
  changes_in jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
begin
  select * into a from public._audit_actor();
  insert into public.audit_log (
    actor_id, actor_email, actor_name,
    entity_type, entity_id, action, summary, changes
  ) values (
    a.id, a.email, a.name,
    entity_type_in, entity_id_in, action_in, summary_in, changes_in
  );
end;
$$;

grant execute on function public.audit_event_app(text, text, text, text, jsonb) to authenticated;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.stage_history enable row level security;
alter table public.audit_log enable row level security;

-- stage_history: qualquer auth lê (analytics). Inserts vem só do trigger.
drop policy if exists "stage_history_read_auth" on public.stage_history;
create policy "stage_history_read_auth"
  on public.stage_history for select
  to authenticated using (true);

-- audit_log: só admin lê. Insert vem dos triggers/RPC (SECURITY DEFINER),
-- não precisa de policy de insert pra usuários comuns.
drop policy if exists "audit_log_read_admin" on public.audit_log;
create policy "audit_log_read_admin"
  on public.audit_log for select
  to authenticated using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- =====================================================================
-- Realtime
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'audit_log'
  ) then
    alter publication supabase_realtime add table public.audit_log;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'stage_history'
  ) then
    alter publication supabase_realtime add table public.stage_history;
  end if;
end $$;

-- =====================================================================
-- FIM
-- =====================================================================
