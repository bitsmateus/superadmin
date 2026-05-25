-- =====================================================================
-- PATCH — Correções da revisão (auditoria + KB feedback público)
--
-- 1) _audit_actor passa a usar auth.uid() — mais confiável que ler
--    current_setting('request.jwt.claim.sub') manualmente. Triggers do
--    audit_log voltam a registrar o usuário corretamente.
--
-- 2) RPCs públicas pra feedback de KB (thumbs up / down). Antes o portal
--    fazia UPDATE direto na tabela, que era bloqueado pela RLS anon.
--
-- IDEMPOTENTE — pode rodar várias vezes.
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
-- KB: incrementadores públicos (helpful / not_helpful)
-- =====================================================================
create or replace function public.kb_mark_helpful(article_id_in uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kb_articles
     set helpful_count = helpful_count + 1
   where id = article_id_in and published = true;
end;
$$;

create or replace function public.kb_mark_not_helpful(article_id_in uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.kb_articles
     set not_helpful_count = not_helpful_count + 1
   where id = article_id_in and published = true;
end;
$$;

grant execute on function public.kb_mark_helpful(uuid) to anon, authenticated;
grant execute on function public.kb_mark_not_helpful(uuid) to anon, authenticated;
