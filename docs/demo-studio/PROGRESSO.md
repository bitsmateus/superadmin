# Progresso — Demo Studio

## M0 — Fundação (03/11/2026)
- Decisão: o Demo Studio é um módulo do superadmin, não um projeto Next.js separado. A tradução de stack (rotas `/demo-studio/*`, API em `/api/ds/*`, tabelas `ds_*`, login e permissões do superadmin) está em `ADAPTACAO.md`.
- Schema completo da §11 em `server/src/db/demoStudio.ts` (idempotente, roda no boot) + workspace "NX Digital" e `profiles.ds_role`. Storage em disco (`STORAGE_DIR`, volume `/data`) com `/files/*` imutável e `GET /api/health`.
- Menu "DEMO STUDIO" no Sidebar com 6 sub-abas em estado vazio; acesso de não-admin pela marca `demo_studio` em Equipe → Permissões.
- Pendências: o SQL ainda não rodou contra um Postgres real (Docker Desktop estava desligado) — conferir no primeiro boot, nos logs de `runMigrations`. No Easypanel: montar volume em `/data` no serviço da API antes do M1 (upload de frames).

## M1 — Demos, frames, editor e player (03/11/2026)
- API `/api/ds/*` (demos, telas, etapas, publicar, versões, restaurar, duplicar) com zod e papéis ADMIN/EDITOR/SELLER; público em `/api/public/ds/demos/:slug`. Imagens com sharp (WebP q78 + miniatura 480px, px CSS pelo pixel ratio).
- Player React (`src/components/demoStudio/player/`) portado da Fase 1 em `/d/:slug` e `/e/:slug`, chunk de ~6,5 KB gzip. Editor em `/demo-studio/demos/:id` com destaque arrastável, salvamento automático e pré-visualização desktop/celular.
- Seed do tour NX Systems roda sozinho no primeiro boot (marca `seedTourNx` no workspace) e publica com link "Site".
- Decisão: a estrutura `ds_*` saiu do `runMigrations` e roda à parte no boot — num banco novo uma migração antiga de outro módulo (`gc_briefing`) falhou e levava o Demo Studio junto.
- Verificado num Postgres real (PGlite): seed, fluxo completo da API (criar, enviar tela 2x, publicar v1/v2, restaurar, duplicar, exemplo, despublicar) e o player no navegador em 1440×900 e 375×812. Pendente: e2e Playwright automatizado.
