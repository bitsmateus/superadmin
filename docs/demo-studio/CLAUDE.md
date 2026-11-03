# NX Demo Studio — instruções (módulo do superadmin)

Plataforma interna da NX Digital para criar demos interativas dos nossos sistemas, compartilhar por link com leads e medir views, engajamento e leads.

**Decisão de base:** o Demo Studio NÃO é um monorepo Next.js novo. Ele é um **módulo do superadmin**, usando a mesma base (Fastify + Postgres + React/Vite + login e equipe que já existem). Tudo o mais — produto, regras, telas, player, analytics, webhooks, extensão — segue a especificação original. A tradução de stack está em `ADAPTACAO.md` e vale por cima das seções 10, 11, 12 (formato) e 14 da especificação.

## Leia antes de qualquer código
1. `docs/demo-studio/ESPECIFICACAO.md` — produto, modelo de dados, API, player, analytics, deploy. Fonte da verdade do **que** fazer.
2. `docs/demo-studio/ADAPTACAO.md` — **como** isso fica na base do superadmin (rotas, tabelas `ds_*`, auth, storage, deploy).
3. `docs/demo-studio/ROADMAP.md` — marcos M0 → M6. Um marco por vez, na ordem; marque os itens concluídos.
4. `docs/demo-studio/reference/` — material validado na Fase 1 (player, seed, captura).

## Convenções (as do superadmin + as do Demo Studio)
- Interface, mensagens de erro e textos em **português do Brasil**. Datas `dd/MM/yyyy HH:mm`, fuso `America/Sao_Paulo`.
- Coordenadas de hotspot/máscara sempre em **px CSS do frame**.
- Nada de dado real de cliente em seed, testes, fixtures ou logs.
- Rotas públicas (`/d`, `/l`, `/e`, `/api/t`, `/api/public/ds/*`, `/files`) não dependem de sessão.
- Tabelas com prefixo `ds_`, criadas de forma idempotente em `server/src/db/demoStudio.ts` (roda a cada boot, como o resto).
- Antes de concluir: `npm run lint` e `npm run build` na raiz, `npm test` e `npm run build` em `server/`.
- Ao fim de cada marco, atualizar `docs/demo-studio/PROGRESSO.md`.

## Contexto do negócio
- A NX Digital vende o "NX Systems" (`app.nxsystems.com.br`): atendimento no WhatsApp (API Oficial), agentes de IA, chatbots, CRM/kanban e campanhas.
- WhatsApp comercial da NX: `5548936181649` (padrão do CTA).
- Eventos de lead e de demo concluída vão para o **n8n** via webhook; o n8n avisa o vendedor no WhatsApp.
