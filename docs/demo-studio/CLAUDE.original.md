# NX Demo Studio — instruções para o Claude Code

Plataforma interna da NX Digital (Tubarão/SC) para criar demos interativas dos nossos sistemas, compartilhar por link com leads e medir views, engajamento e leads. Vai rodar no Easypanel da nossa VPS, no domínio `demo.gruponxdigital.com`.

## Leia antes de qualquer código
1. `docs/ESPECIFICACAO.md` — produto, modelo de dados, API, player, analytics, deploy. É a fonte da verdade.
2. `docs/ROADMAP.md` — marcos M0 → M6. Trabalhe **um marco por vez**, na ordem, e marque os itens concluídos.
3. `reference/` — material validado na Fase 1:
   - `reference/player/player-v1.html`: player que já funciona em desktop e celular. O player novo deve se comportar igual (especialmente o zoom no hotspot no celular).
   - `reference/seed/`: demo "NX Systems — Tour completo" (demo.json + telas WebP + snapshots HTML) para o seed.
   - `reference/capture/capture-reference.js`: lógica de snapshot e anonimização para portar para a extensão.

## Stack (não troque sem perguntar)
pnpm workspaces · Next.js 15 App Router + TypeScript strict · PostgreSQL 16 + Prisma · Auth.js (Credentials) · Tailwind + shadcn/ui · Recharts · dnd-kit · react-rnd · sharp · zod · Vitest + Playwright · Docker (standalone) no Easypanel.

## Convenções
- Interface, mensagens de erro, e-mails e textos: **português do Brasil**. Datas `dd/MM/yyyy HH:mm`, fuso `America/Sao_Paulo`.
- Código, nomes de variáveis, tabelas e commits em inglês; comentários podem ser em português.
- Toda entrada validada com zod (schemas em `packages/shared`).
- Coordenadas de hotspot/máscara sempre em **px CSS do frame**.
- Nada de dado real de cliente em seed, testes, fixtures ou logs.
- Server Components por padrão; Client Components só onde há interação (editor, player, gráficos).
- Rotas públicas (`/d`, `/l`, `/e`, `/api/t`, `/api/public/*`, `/files`) não podem depender de sessão.
- Antes de concluir uma tarefa: `pnpm typecheck && pnpm lint && pnpm test`.
- Ao fim de cada marco, atualizar `docs/PROGRESSO.md` (crie se não existir).

## Comandos esperados (crie no M0)
- `pnpm dev` — web em http://localhost:3000 (Postgres via `docker compose up -d`)
- `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:studio`
- `pnpm test` (Vitest) · `pnpm e2e` (Playwright)
- `pnpm build:ext` — gera `apps/extension/dist` e `nx-demo-capture.zip`

## Contexto do negócio
- A NX Digital vende uma plataforma de atendimento no WhatsApp (API Oficial da Meta), agentes de IA, chatbots, CRM/kanban e campanhas — o "NX Systems" (`app.nxsystems.com.br`).
- WhatsApp comercial da NX: `5548936181649` (padrão do CTA).
- Os eventos de lead e de demo concluída vão para o **n8n** (já existe na VPS) via webhook; o n8n avisa o vendedor no WhatsApp.
- Usuários: admin (Mateus), editores e vendedores/SDRs.
