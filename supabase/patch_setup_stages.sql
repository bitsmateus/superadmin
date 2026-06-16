-- =====================================================================
-- PATCH — Novas sub-etapas de configuração no pipeline
--
-- Adiciona dois novos valores ao ENUM pipeline_stage:
--   setup_start  — "Iniciar Configuração"
--                  Auto-movido quando o cliente preenche o briefing.
--   setup_done   — "Pronto para Entrega"
--                  Auto-movido quando todas as configurações são concluídas.
--
-- Ordem no pipeline:
--   briefing → setup_start → setup → setup_done → delivery
--
-- IDEMPOTENTE — pode rodar várias vezes (IF NOT EXISTS).
-- Nota: ALTER TYPE ADD VALUE não pode rodar dentro de uma transação
-- em PostgreSQL < 12. No Supabase/PG 14+ é seguro.
-- =====================================================================

ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'setup_start' AFTER 'briefing';
ALTER TYPE pipeline_stage ADD VALUE IF NOT EXISTS 'setup_done' AFTER 'setup';
