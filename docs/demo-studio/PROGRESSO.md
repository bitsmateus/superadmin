# Progresso — Demo Studio

## M0 — Fundação (03/11/2026)
- Decisão: o Demo Studio é um módulo do superadmin, não um projeto Next.js separado. A tradução de stack (rotas `/demo-studio/*`, API em `/api/ds/*`, tabelas `ds_*`, login e permissões do superadmin) está em `ADAPTACAO.md`.
- Schema completo da §11 em `server/src/db/demoStudio.ts` (idempotente, roda no boot) + workspace "NX Digital" e `profiles.ds_role`. Storage em disco (`STORAGE_DIR`, volume `/data`) com `/files/*` imutável e `GET /api/health`.
- Menu "DEMO STUDIO" no Sidebar com 6 sub-abas em estado vazio; acesso de não-admin pela marca `demo_studio` em Equipe → Permissões.
- Pendências: o SQL ainda não rodou contra um Postgres real (Docker Desktop estava desligado) — conferir no primeiro boot, nos logs de `runMigrations`. No Easypanel: montar volume em `/data` no serviço da API antes do M1 (upload de frames).
