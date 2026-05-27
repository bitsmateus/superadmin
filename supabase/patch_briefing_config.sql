-- =====================================================================
-- PATCH — Configuração do briefing e campos complementares
--
-- Adiciona:
--   briefing_config   — configuração interna do briefing (multi-select)
--   accesses          — acessos do cliente (redes sociais, painéis, etc.)
--   platform_app/web/chat — plataformas que o cliente usa
--   contract_file / contract_file_name — arquivo do contrato (base64)
--
-- IDEMPOTENTE — pode rodar várias vezes.
-- =====================================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS briefing_config JSONB;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS accesses JSONB;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS platform_app BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS platform_web BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS platform_chat BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS contract_file TEXT;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS contract_file_name TEXT;
