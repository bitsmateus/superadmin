-- =====================================================================
-- PATCH — Flags de tipo de implementação em clients
--
-- 3 colunas booleanas marcadas pelo time interno na aba "Visão geral" do
-- cliente. Quando true, o cliente aparece nos painéis correspondentes
-- do Dashboard (API Oficial, IA, Automação externa).
--
-- IDEMPOTENTE — pode rodar várias vezes.
-- =====================================================================

alter table public.clients
  add column if not exists has_api_oficial boolean not null default false;
alter table public.clients
  add column if not exists has_ia boolean not null default false;
alter table public.clients
  add column if not exists has_automacao_externa boolean not null default false;

-- Índices parciais — clientes flagueados são poucos, índice ajuda o
-- Dashboard a filtrar rápido.
create index if not exists clients_has_api_oficial_idx
  on public.clients(has_api_oficial) where has_api_oficial = true;
create index if not exists clients_has_ia_idx
  on public.clients(has_ia) where has_ia = true;
create index if not exists clients_has_automacao_externa_idx
  on public.clients(has_automacao_externa) where has_automacao_externa = true;
