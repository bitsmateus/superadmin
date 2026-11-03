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

## M2 — Rastreamento e analytics (03/11/2026)
- Coletor no player (`src/lib/demoStudio/coletor.ts`): visitante em localStorage + cookie, sessão de 30 min por demo e por visitante, lote a cada 5s e no pagehide via sendBeacon `text/plain` (sem preflight entre o domínio da demo e o da API), heartbeat só com a aba visível. Quem tem login do painel no navegador conta como interno.
- `POST /api/t` (`server/src/lib/demoStudio/coleta.ts`): zod, 60 req/min por IP (primeiro X-Forwarded-For, porque atrás do proxy do Easypanel o `req.ip` é o do proxy), robôs e preview do WhatsApp ignorados, IP só como sha256 com `IP_SALT`, agregados na sessão. Job diário apaga heartbeat > 180 dias.
- Métricas puras em `server/src/lib/demoStudio/metrics.ts` (§8.3) com testes sintéticos; telas de visão geral, analytics da demo (funil com a maior queda em vermelho), lista de sessões e linha do tempo. Gráficos sem biblioteca, no padrão do superadmin.
- Aceite conferido no navegador com banco local: 3 visitantes (1 até o fim, 1 via `utm_source=instagram`, 1 no celular) → 3 views, 3 únicos, 33% e funil 3→2→1. Os testes pegaram 3 casos que foram corrigidos: sessão reaproveitada com visitante trocado, aba esquecida abrindo sessão só com heartbeat e visita logada somando etapas na sessão de um visitante.
- Pendente para o deploy: definir `IP_SALT` no serviço da API. Leads e o selo "quente" chegam no M3.

## M3 — Leads, links personalizados e webhooks (03/11/2026)
- Links por canal e personalizados (`/l/:code`): o personalizado já cadastra o lead com o vendedor como responsável, preenche `{{nome}}`/`{{empresa}}`/`{{vendedor}}` no tour e pula o gate. Mensagem pronta para WhatsApp e QR code gerado no navegador.
- Leads (`server/src/lib/demoStudio/leads.ts`): WhatsApp em E.164, dedupe por telefone e e-mail, pontuação da §8.3 e selo "quente" (≥ 70). Formulário público com consentimento obrigatório; nome/empresa do cartão final também identificam o lead. Telas de lista (filtros, exportar CSV) e detalhe (status, responsável, notas, WhatsApp, apagar por LGPD).
- Webhooks (`server/src/lib/demoStudio/webhooks.ts`): `lead.created/updated`, `session.started/completed`, `cta.clicked`, corpo da §9.1, `X-NXDemo-Signature: sha256=HMAC`, fila com worker de 10s e retentativas 1/5/30 min. Configurações: usuários do módulo (acesso + editor/vendedor), CTA padrão, consentimento e política de privacidade.
- Rotas públicas respondem `Access-Control-Allow-Origin: *` e o lead vai como text/plain: o player funciona do domínio da demo mesmo que `CORS_ORIGIN` só libere o painel.
- Aceite conferido com banco local e um receptor que faz o papel do n8n: vendedor criou o link "Ana / Pedal Bikes" pela tela, a visita no celular foi até o fim, o lead apareceu com 15/15 e chegaram `lead.created`, `session.started` e `session.completed`, todos com assinatura válida. Pendente: cadastrar o webhook real do n8n em produção.
