-- =====================================================================
-- TenantHub — NPS + Notificações por e-mail
--
-- Cria:
--   - nps_responses (pesquisa de satisfação após entrega)
--   - Trigger automático: cria NPS pendente N dias após delivery_completed_at
--   - RPCs públicas pro cliente responder NPS via token
--   - Trigger HTTP pra Edge Function quando ticket criado/atribuído
--   - Coluna nps_delay_days em settings (default 7)
--
-- IDEMPOTENTE — pode rodar várias vezes.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists pg_net;  -- pra HTTP requests do banco

-- ---------- nps_responses ----------
create table if not exists public.nps_responses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- Token público (cliente acessa /nps/:token sem login)
  public_token text unique not null default gen_random_uuid()::text,
  -- 0-10. Null enquanto não respondido.
  score int check (score is null or (score between 0 and 10)),
  comment text,
  -- Classificação derivada (calculada na resposta).
  classification text check (classification in ('detractor', 'neutral', 'promoter')),
  -- Timeline
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists nps_client_idx on public.nps_responses(client_id);
create index if not exists nps_responded_idx on public.nps_responses(responded_at)
  where responded_at is not null;
create index if not exists nps_token_idx on public.nps_responses(public_token);

-- ---------- Settings: campos do NPS + notificações ----------
alter table public.settings
  add column if not exists nps_delay_days int default 7;
alter table public.settings
  add column if not exists nps_enabled boolean default true;
alter table public.settings
  add column if not exists notify_edge_function_url text;
alter table public.settings
  add column if not exists notify_enabled boolean default false;

-- ---------- Trigger: cria NPS pendente quando delivery_completed_at é setado ----------
create or replace function public.create_nps_on_delivery_completed()
returns trigger
language plpgsql
as $$
declare
  delay_days int := 7;
  is_enabled boolean := true;
begin
  -- Só dispara quando passa de null pra valor (nova conclusão)
  if old.delivery_completed_at is not null then
    return new;
  end if;
  if new.delivery_completed_at is null then
    return new;
  end if;

  -- Lê configurações
  select coalesce(nps_delay_days, 7), coalesce(nps_enabled, true)
    into delay_days, is_enabled
  from public.settings where id = true;

  if not is_enabled then
    return new;
  end if;

  -- Não cria se já existe NPS pendente recente pra esse cliente
  if exists (
    select 1 from public.nps_responses
    where client_id = new.id and responded_at is null
      and created_at > now() - interval '30 days'
  ) then
    return new;
  end if;

  insert into public.nps_responses (client_id, scheduled_for)
  values (new.id, new.delivery_completed_at + (delay_days || ' days')::interval);

  return new;
end;
$$;

drop trigger if exists clients_create_nps on public.clients;
create trigger clients_create_nps
  after update on public.clients
  for each row
  when (old.delivery_completed_at is distinct from new.delivery_completed_at)
  execute function public.create_nps_on_delivery_completed();

-- ---------- RLS pra nps_responses ----------
alter table public.nps_responses enable row level security;

drop policy if exists "nps_read_auth" on public.nps_responses;
create policy "nps_read_auth"
  on public.nps_responses for select
  to authenticated using (true);

drop policy if exists "nps_write_auth" on public.nps_responses;
create policy "nps_write_auth"
  on public.nps_responses for all
  to authenticated
  using (true)
  with check (true);

-- ---------- RPCs públicas (cliente responde sem login) ----------

-- 1) Lê NPS pendente por token
create or replace function public.get_nps_by_token(token_in text)
returns table (
  id uuid,
  client_company text,
  client_name text,
  responded boolean
)
language sql
security definer
set search_path = public
as $$
  select
    n.id,
    c.company as client_company,
    c.name as client_name,
    (n.responded_at is not null) as responded
  from public.nps_responses n
  join public.clients c on c.id = n.client_id
  where n.public_token = token_in
  limit 1
$$;

grant execute on function public.get_nps_by_token(text) to anon, authenticated;

-- 2) Cliente submete resposta NPS
create or replace function public.submit_nps(
  token_in text,
  score_in int,
  comment_in text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  resp_id uuid;
  is_responded boolean;
  c_id uuid;
  classif text;
begin
  if score_in < 0 or score_in > 10 then
    raise exception 'Score deve estar entre 0 e 10.';
  end if;
  if length(coalesce(comment_in, '')) > 2000 then
    raise exception 'Comentário muito longo.';
  end if;

  select id, (responded_at is not null), client_id
    into resp_id, is_responded, c_id
  from public.nps_responses where public_token = token_in;

  if not found then
    raise exception 'Token inválido.';
  end if;
  if is_responded then
    raise exception 'NPS já respondido.';
  end if;

  classif := case
    when score_in >= 9 then 'promoter'
    when score_in >= 7 then 'neutral'
    else 'detractor'
  end;

  update public.nps_responses
    set score = score_in,
        comment = nullif(trim(comment_in), ''),
        classification = classif,
        responded_at = now()
    where id = resp_id;

  -- Adiciona log no cliente
  update public.clients
    set logs = logs || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid()::text,
      'action', 'NPS respondido',
      'detail', 'Nota ' || score_in || ' (' || classif || ')',
      'createdAt', now()
    ))
    where id = c_id;
end;
$$;

grant execute on function public.submit_nps(text, int, text) to anon, authenticated;

-- =====================================================================
-- Notificação por e-mail (Edge Function via pg_net)
-- =====================================================================
-- A Edge Function `notify-ticket` (deploy separado) é chamada quando:
--   - Ticket é criado
--   - Ticket é atribuído (assignee_id muda de null pra uuid)
-- A URL fica em settings.notify_edge_function_url. Se vazia ou
-- notify_enabled = false, não dispara.
-- Headers: Authorization: Bearer <ANON_KEY> (pra Edge Function aceitar).
-- =====================================================================
create or replace function public.notify_ticket_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  url text;
  is_enabled boolean := false;
  payload jsonb;
  event_kind text;
begin
  select notify_edge_function_url, coalesce(notify_enabled, false)
    into url, is_enabled
  from public.settings where id = true;

  if not is_enabled or url is null or url = '' then
    return new;
  end if;

  -- Decide o tipo de evento
  if tg_op = 'INSERT' then
    event_kind := 'ticket.created';
  elsif tg_op = 'UPDATE' then
    if new.assignee_id is not null
       and (old.assignee_id is null or old.assignee_id is distinct from new.assignee_id) then
      event_kind := 'ticket.assigned';
    else
      return new;
    end if;
  else
    return new;
  end if;

  payload := jsonb_build_object(
    'event', event_kind,
    'ticket', jsonb_build_object(
      'id', new.id,
      'number', new.number,
      'subject', new.subject,
      'priority', new.priority,
      'status', new.status,
      'customer_name', new.customer_name,
      'customer_email', new.customer_email,
      'customer_company', new.customer_company,
      'assignee_id', new.assignee_id,
      'public_token', new.public_token,
      'opened_at', new.opened_at
    )
  );

  -- Dispara HTTP POST em background (não bloqueia o insert/update)
  perform net.http_post(
    url := url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := payload
  );

  return new;
exception when others then
  -- Falha não bloqueia a operação principal.
  raise notice 'notify_ticket_event falhou: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists tickets_notify_insert on public.tickets;
create trigger tickets_notify_insert
  after insert on public.tickets
  for each row execute function public.notify_ticket_event();

drop trigger if exists tickets_notify_assignee on public.tickets;
create trigger tickets_notify_assignee
  after update of assignee_id on public.tickets
  for each row execute function public.notify_ticket_event();

-- =====================================================================
-- Realtime pra NPS
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'nps_responses'
  ) then
    alter publication supabase_realtime add table public.nps_responses;
  end if;
end $$;

-- =====================================================================
-- FIM
-- =====================================================================
