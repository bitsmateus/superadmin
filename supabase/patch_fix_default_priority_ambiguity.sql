-- =====================================================================
-- PATCH — Corrige ambiguidade em create_public_ticket
--
-- Bugs:
--  1) variável local default_priority colidia com coluna de ticket_categories
--     no SELECT INTO.
--  2) RETURNS TABLE(... public_token text) cria OUT param com mesmo nome
--     da coluna em tickets — RETURNING public_token ficava ambíguo.
--
-- Fix:
--  - Renomear variáveis locais pra cat_default_sla / cat_default_priority
--    e qualificar colunas com alias tc.
--  - Qualificar RETURNING com alias t da tabela tickets.
--
-- IDEMPOTENTE — pode rodar várias vezes.
-- =====================================================================

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
  if length(subject_in) > 200 then
    raise exception 'Assunto muito longo.';
  end if;
  if length(coalesce(description_in, '')) > 5000 then
    raise exception 'Descrição muito longa.';
  end if;
  if octet_length(triage_path_in::text) > 16 * 1024 then
    raise exception 'Triagem muito longa.';
  end if;

  select c.id, c.company into matched_client_id, matched_company
  from public.clients c
  where lower(c.email) = lower(trim(customer_email_in))
  limit 1;

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

  insert into public.ticket_messages (ticket_id, author_type, author_name, content)
  values (new_ticket_id, 'customer', customer_name_in, coalesce(description_in, '(sem descrição)'));

  return query select new_ticket_id, new_ticket_number, new_public_token;
end;
$$;

grant execute on function public.create_public_ticket(text, text, text, text, text, uuid, text, text, jsonb) to anon, authenticated;
