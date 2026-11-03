# Roadmap de implementação — NX Demo Studio

Execute **um marco por vez**, na ordem. Ao terminar cada marco: rode `pnpm typecheck && pnpm test`, faça commit, marque os itens com `[x]` aqui e escreva 3–5 linhas em `docs/PROGRESSO.md` (o que foi feito, decisões, pendências). Não comece o próximo marco com testes quebrados.

Referências: `docs/ESPECIFICACAO.md` (seções citadas entre parênteses) e `reference/`.

---

> **Base:** o Demo Studio é um módulo do superadmin (ver `ADAPTACAO.md`). Onde este roadmap fala em pnpm, Next.js, Prisma, Auth.js ou Vitest, vale a tradução de lá. O M0 original foi reescrito abaixo porque a fundação (monorepo, login, Docker) já existe no superadmin.

## M0 — Fundação (na base do superadmin)
- [x] Kit trazido para `docs/demo-studio/` (especificação, roadmap, referência) + `ADAPTACAO.md` com a tradução de stack.
- [x] Schema completo (§11) em SQL idempotente: `server/src/db/demoStudio.ts` com as tabelas `ds_*`, rodando no `runMigrations()`; workspace "NX Digital" criado na migração; `profiles.ds_role`.
- [x] Login: o do superadmin; acesso pela marca `demo_studio` em Equipe → Permissões (admin vê sempre).
- [x] `server/src/lib/demoStudio/storage.ts` (LocalDiskStorage em `STORAGE_DIR`) + rota `/files/*` com cache imutável e proteção contra `..`.
- [x] `GET /api/health` → `{ ok, db }`.
- [x] Menu "Demo Studio" no Sidebar com as sub-abas (Visão geral, Demos, Exemplos, Leads, Links, Configurações) e telas com estado vazio.
- [x] Volume `/data` e variáveis novas documentadas para o Easypanel; testes do storage no `npm test` do servidor.

**Aceite:** `npm run dev` (front) + `npm run dev` (server) → login com o admin → `/demo-studio` vazio com a barra lateral do módulo.

## M1 — Demos, frames, editor e player (núcleo)
- [x] CRUD de demos (§4.1) e grid em `/demo-studio/demos` (inclui duplicar e "a partir de exemplo").
- [x] Upload de frames por imagem (§4.2): sharp → WebP q78 + miniatura 480px; width/height em px CSS (pixel ratio no upload, padrão 2 quando ≥ 2560px). Upload em JSON base64 (padrão do superadmin); multipart entra com a extensão no M4.
- [x] Editor (§4.3, §5): lista de etapas com dnd-kit, canvas com react-rnd para hotspot, painel de propriedades, tipos HOTSPOT/MODAL/CTA (+ LEAD_FORM só visual), variáveis `{{empresa|padrão}}`.
- [x] Player público `/d/[slug]` (§7) portado de `reference/player/player-v1.html`; geometria em `src/lib/demoStudio/layout.ts`, idêntica à Fase 1. `/e/[slug]` já renderiza sem cabeçalho.
- [x] Publicar/despublicar com `ds_demo_versions` (snapshot) e histórico com restaurar.
- [x] Pré-visualização do rascunho (`/demo-studio/demos/:id/preview`) com alternância desktop/celular (iframe 390×844).
- [x] Seed do template "NX Systems — Tour completo" a partir de `server/seed/demo-studio/` (§15), automático no primeiro boot.
- [x] Testes unit do cálculo de zoom/posição do balão e das variáveis (`src/lib/demoStudio/*.test.ts`, rodam no `npm test` do servidor).
- [ ] e2e Playwright em 1440×900 e 390×844 até o CTA — **pendente** (o superadmin não tem Playwright; o fluxo foi conferido à mão no navegador).

**Aceite:** o tour da Fase 1 roda em `/d/nx-systems-tour` igual à referência, no desktop e no celular; consigo criar uma segunda demo do zero e publicar.

## M2 — Rastreamento e analytics
- [x] Coletor no player (§8.1, `src/lib/demoStudio/coletor.ts`): visitorId/sessionId, fila de eventos, sendBeacon (text/plain), heartbeat só com aba visível, exclusão de usuários internos e bots.
- [x] `POST /api/t` (§8.2) com zod, rate limit, ua-parser-js (v1, MIT), ipHash, agregados na `ds_view_sessions`. Lote só de heartbeat não abre sessão; sessão continuada por alguém logado vira interna.
- [x] `server/src/lib/demoStudio/metrics.ts` com as definições da §8.3 (testadas com dados sintéticos, incluindo o cenário do aceite).
- [x] `/demo-studio` visão geral, `/demo-studio/demos/:id/analytics` (KPIs, funil, série diária, dispositivos, canais), lista de sessões e `/demo-studio/sessoes/:id` (linha do tempo). Gráficos com div + Tailwind, padrão do superadmin (sem Recharts).
- [x] Filtros de período e por demo/link/vendedor (vendedor SELLER fica preso aos próprios links no servidor).

**Aceite:** abrir a demo em 3 navegadores diferentes (um até o fim) → dashboard mostra 3 views, 3 únicos, 33% de conclusão e funil coerente.

## M3 — Leads, links personalizados e webhooks
- [x] Etapa LEAD_FORM com campos configuráveis, consentimento obrigatório e gate (§4.3, §7.2); `POST /api/public/ds/leads` (text/plain, 10/min por IP).
- [x] CTA WhatsApp com variáveis e mensagem modelo; nome/empresa digitados no cartão final também viram lead.
- [x] Links CHANNEL e PERSONAL (§4.4) em `/demo-studio/demos/:id/links` e `/demo-studio/links`; rota `/l/:code`; "Copiar mensagem para WhatsApp"; QR code gerado no navegador (`qrcode`, MIT).
- [x] Leads (§4.6): lista, detalhe, status, responsável, notas, dedupe por telefone E.164/e-mail, exportar CSV (no navegador, com o `downloadCsv` do superadmin), apagar lead + sessões (LGPD).
- [x] Pontuação de engajamento e selo "quente" (§8.3), recalculada a cada lote de eventos.
- [x] Webhooks (§9.1): CRUD, HMAC, `ds_webhook_deliveries` + worker (10s) com retentativas 1/5/30 min, botão de teste e log das últimas 50.
- [x] Permissões do papel SELLER (vê só demos publicadas e os próprios links/leads; não cria link de canal nem edita demo). Papel e acesso definidos em Configurações → Usuários.

**Aceite:** como vendedor, crio link para "Ana / Pedal Bikes", abro no celular, termino a demo → lead aparece com sessão 100%, e o n8n recebe `session.completed` com assinatura válida.

## M4 — Extensão de captura
- [ ] `apps/extension` MV3 (Vite + TS): popup (conta, destino, anonimizar, modo), service worker, content script injetado sob demanda (§6).
- [ ] Anonimização ao vivo com regras do workspace + automáticas + MutationObserver (base: `reference/capture/capture-reference.js`).
- [ ] Captura por clique (pointerdown) + atalho Alt+Shift+S + revisão antes de enviar.
- [ ] Modo Imagem + HTML (snapshot e CSS deduplicado por hash).
- [ ] `POST /api/ext/captures` criando frames e etapas HOTSPOT com o retângulo do clique.
- [ ] Tela Configurações → Extensão (gerar token, link para baixar o zip, instruções de instalação).
- [ ] Configurações → Anonimização (CRUD de regras + pré-visualização de texto).

**Aceite:** capturo 6 telas do NX Systems com 5 cliques, os dados aparecem trocados nas imagens, e a demo abre no editor com 6 etapas e hotspots no lugar dos cliques.

## M5 — Exemplos, capítulos e incorporação
- [ ] Capítulos (§4.1) no editor e menu de capítulos no player (evento `chapter_open`).
- [ ] Templates: marcar demo como exemplo + segmento; galeria `/app/exemplos`; "Usar este exemplo" (duplica com frames por referência).
- [ ] Embed `/e/[slug]` + gerador do código iframe + ajuste de altura via postMessage.
- [ ] Open Graph por demo (imagem = frame de capa).
- [ ] Máscaras de desfoque/cobertura sobre imagens (§4.2) com "assar" ao publicar.

**Aceite:** a galeria mostra pelo menos o template NX; duplico, troco textos para "clínica", publico e incorporo numa página HTML de teste.

## M6 — Extras (quando M0–M5 estiverem estáveis)
- [ ] Enriquecimento por CNPJ via BrasilAPI (§9.3).
- [ ] Sugestão de textos e regras de anonimização com IA (§9.4).
- [ ] Narração TTS por etapa com player de áudio e velocidade 1x/2x.
- [ ] Frames HTML editáveis + render com Playwright num serviço separado.
- [ ] Ramificação de etapas (botões que levam a etapas diferentes).
