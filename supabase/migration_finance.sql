-- =====================================================================
-- TenantHub — Migração: Painel financeiro
--
-- Adiciona em clients:
--   - payments      jsonb (histórico de pagamentos manual + Asaas)
--   - extra_links   jsonb (links adicionais por cliente)
--   - finance_notes text  (anotações financeiras livres)
--
-- E inclui as novas colunas no guard que impede suporte de mexer em
-- dados financeiros.
--
-- COMO RODAR
-- 1) Supabase → SQL Editor → New query
-- 2) Cole este arquivo inteiro e clique Run
-- =====================================================================

-- 1. Colunas novas (idempotente)
alter table public.clients
  add column if not exists payments jsonb not null default '[]'::jsonb;

alter table public.clients
  add column if not exists extra_links jsonb not null default '[]'::jsonb;

alter table public.clients
  add column if not exists finance_notes text;

-- Intervalo do auto-sync de pagamentos Asaas (minutos; 0 desliga)
alter table public.settings
  add column if not exists asaas_sync_interval_min int default 15;

-- 2. Atualiza o trigger de bloqueio para incluir as novas colunas
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

-- =====================================================================
-- FIM — agora o painel /financeiro consegue ler/escrever payments,
-- extra_links e finance_notes em clients.
-- =====================================================================
