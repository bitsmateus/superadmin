# NX Demo Studio — Especificação completa

> Plataforma interna da NX Digital para criar **demos interativas** dos nossos sistemas (começando pelo NX Systems), compartilhar por link com leads, e medir quem viu, até onde foi e quem virou contato.
> Inspiração de mercado: Getdemo, Arcade, Navattic, Storylane. Referência funcional já validada: `reference/player/player-v1.html` (Fase 1).

Sumário
1. Objetivo e escopo
2. Usuários e permissões
3. Conceitos do domínio
4. Funcionalidades (requisitos)
5. Telas do painel
6. Extensão de captura (Chrome)
7. Player público (link da demo)
8. Analytics: eventos, métricas e leads
9. Integrações (n8n, WhatsApp, enriquecimento)
10. Arquitetura e stack
11. Modelo de dados (Prisma)
12. API
13. Segurança e LGPD
14. Deploy no Easypanel
15. Seed: demo "NX Systems — Tour completo"
16. Critérios de aceite gerais

---

## 1. Objetivo e escopo

**Problema.** O comercial da NX gasta reunião mostrando a plataforma para lead que ainda não tem intenção clara. Queremos mandar um link no WhatsApp, o lead navega sozinho pelas telas reais, e o SDR sabe exatamente quem viu, quanto tempo ficou e em que parte parou.

**O que o sistema faz**
- Captura telas de qualquer sistema web (extensão Chrome), já anonimizando dados reais.
- Monta **vários fluxos (demos)**: cada demo é uma sequência de telas com pontos clicáveis (hotspots), balões explicativos, cartão de abertura, formulário de lead e chamada final (WhatsApp).
- Mantém uma **biblioteca de exemplos (templates)** por segmento (clínica, autopeças, provedor, imobiliária, varejo, advocacia…), que podem ser duplicados e ajustados.
- Gera **links compartilháveis**, inclusive **links personalizados por lead** (nome/empresa aparecem na demo, e todo acesso fica atribuído àquele lead).
- Registra **views, sessões, etapas vistas, tempo, conclusão, cliques no CTA** e **dados dos leads**; mostra tudo num dashboard e envia eventos para o n8n.

**Fora de escopo (por enquanto)**
- Cobrança/planos/assinatura (é ferramenta interna; o modelo já nasce multi-workspace para virar SaaS depois).
- Onboarding guiado dentro do produto (in-app tours) e "SaaS Copilot".
- Gravação de vídeo.

**Idioma:** toda a interface em português do Brasil. Datas `dd/MM/yyyy HH:mm`, fuso `America/Sao_Paulo`, moeda R$.

---

## 2. Usuários e permissões

| Papel | Pode |
|---|---|
| **Admin** | Tudo: usuários, configurações do workspace, webhooks, regras de anonimização, apagar demos/leads. |
| **Editor** | Criar/editar/publicar demos, capturar telas, criar links, ver analytics e leads. |
| **Vendedor (SDR)** | Ver demos publicadas, criar **links personalizados** para os próprios leads, ver analytics e leads **dos seus links**, mudar status dos seus leads. |

- Login por e-mail + senha (bcrypt). Sessão por cookie httpOnly.
- Primeiro admin criado via variável de ambiente no seed (`ADMIN_EMAIL`, `ADMIN_PASSWORD`).
- **Token pessoal de API** (Configurações → Extensão) para a extensão de captura autenticar.

---

## 3. Conceitos do domínio

| Conceito | Descrição |
|---|---|
| **Workspace** | A organização (NX Digital). Tudo pertence a um workspace. Começa com um só. |
| **Demo (fluxo)** | Um tour navegável. Tem nome, slug, tema, capítulos, etapas, status (rascunho/publicada) e versões publicadas. |
| **Frame (tela)** | Uma captura de tela. Tipo `IMAGE` (screenshot WebP, padrão) ou `HTML` (snapshot DOM+CSS, opcional). Tem largura/altura em px CSS (ex.: 1536×695), pixel ratio (2), URL exibida na barra falsa do navegador. |
| **Etapa (step)** | Um passo da demo, apontando para um frame. Tipos: `HOTSPOT` (ponto clicável + balão), `MODAL` (cartão centralizado — abertura ou explicação), `LEAD_FORM` (pede dados), `CTA` (chamada final). |
| **Hotspot** | Retângulo `{x,y,w,h}` em px CSS do frame. Clicar nele avança. |
| **Capítulo (storyline)** | Agrupa etapas ("Atendimento", "IA", "Campanhas"). O visitante pode pular para um capítulo pelo menu. |
| **Template** | Uma demo marcada como exemplo (`isTemplate`), com segmento. Serve de ponto de partida ("Usar este exemplo" = duplicar). |
| **Versão publicada** | Snapshot JSON imutável da demo no momento do "Publicar". O link público sempre lê a versão publicada; editar não quebra o que está no ar. |
| **Link de compartilhamento** | URL curta para uma demo. Pode ser genérico ("Site", "Instagram bio") ou **personalizado** para um lead (nome, empresa, telefone, vendedor). Variáveis do link preenchem `{{empresa}}`, `{{nome}}`, `{{vendedor}}` nos textos. |
| **Visitante** | Navegador identificado por um id anônimo (localStorage + cookie first-party). |
| **Sessão** | Uma visualização da demo por um visitante (expira após 30 min sem atividade). |
| **Evento** | Algo que aconteceu na sessão: abriu, viu etapa X, clicou no hotspot, abriu capítulo, enviou lead, clicou no CTA, concluiu, heartbeat. |
| **Lead** | Pessoa identificada: preencheu o formulário, clicou no CTA com nome/empresa, ou veio de um link personalizado. Tem status de funil comercial. |

---

## 4. Funcionalidades (requisitos)

Prioridade: **P0** = MVP obrigatório; **P1** = logo depois; **P2** = futuro.

### 4.1 Demos
- P0 Listar demos (cards com miniatura da 1ª tela, nome, status, nº de etapas, views 30 dias, leads 30 dias, atualizado em).
- P0 Criar demo em branco, a partir de template, ou a partir de uma captura da extensão.
- P0 Duplicar demo (frames são reaproveitados por referência; etapas copiadas).
- P0 Publicar / despublicar. Publicar gera nova versão (snapshot). Histórico de versões com "restaurar".
- P0 Tema por demo: cor de destaque, nome da marca, logo (texto ou imagem), texto e número do CTA de WhatsApp.
- P0 Configurações por demo: mostrar barra de progresso, mostrar "Recomeçar", exigir formulário de lead na etapa N (gate), idioma (pt-BR fixo por ora).
- P1 Capítulos com menu de navegação no player.
- P1 Marcar como template + segmento + descrição curta; galeria "Exemplos".
- P2 Ramificação (etapa com 2+ botões que levam a etapas diferentes, ex.: "Sou clínica" / "Sou loja").

### 4.2 Frames
- P0 Upload manual de imagem (PNG/JPG/WebP) como frame — converte para WebP, gera miniatura 480px.
- P0 Receber frames da extensão (imagem + metadados + snapshot HTML opcional).
- P0 Biblioteca de frames da demo; trocar o frame de uma etapa.
- P1 Máscaras sobre imagem: desenhar retângulos de **desfoque** ou **cobertura com texto** (para esconder dado que escapou da anonimização). Aplicadas na renderização (não destrutivo) e "assadas" numa nova WebP ao publicar.
- P2 Frame HTML editável: clicar num texto e trocar, ocultar elemento; render server-side com Playwright para regenerar a imagem.

### 4.3 Editor de etapas
- P0 Lista de etapas à esquerda (arrastar para reordenar), canvas no centro com o frame, painel de propriedades à direita.
- P0 Hotspot: desenhar arrastando no canvas; mover e redimensionar (alças); valores x/y/w/h editáveis.
- P0 Balão: título, texto (até ~280 caracteres, suporta **negrito** e quebra de linha), posição (auto, direita, esquerda, cima, baixo), rótulo do botão (padrão "Próximo").
- P0 Tipos `MODAL`, `LEAD_FORM` (campos configuráveis: nome, empresa, WhatsApp, e-mail, cargo, CNPJ; obrigatórios configuráveis; texto de consentimento LGPD), `CTA` (WhatsApp com mensagem modelo com variáveis, ou URL externa).
- P0 Variáveis nos textos: `{{empresa}}`, `{{nome}}`, `{{vendedor}}` com valor padrão quando vazio (ex.: `{{empresa|sua empresa}}`).
- P0 Pré-visualizar (abre o player com a versão de rascunho) em desktop e simulação de celular (390×844).
- P1 Ação do hotspot/botão: próxima etapa (padrão), ir para etapa X, abrir URL.
- P1 Duplicar etapa; etapa sem hotspot (só balão central).
- P2 Gerar textos com IA (descrição do negócio + o que mostrar → títulos e textos sugeridos para cada etapa); narração TTS por etapa.

### 4.4 Links e compartilhamento
- P0 Link padrão da demo: `https://{DOMINIO}/d/{slugDaDemo}`.
- P0 Links nomeados (canal): "Site", "Bio Instagram", "Campanha Black" → `https://{DOMINIO}/l/{codigo}` (código curto de 7 caracteres). Cada um com UTM opcional.
- P0 **Link personalizado por lead**: formulário rápido (nome do lead, empresa, WhatsApp, vendedor responsável = usuário logado). Gera `/l/{codigo}`. Ao abrir, a demo mostra "Preparamos este tour para a {{empresa}}" e os textos com variáveis; o lead já nasce cadastrado e toda sessão desse link é atribuída a ele.
- P0 Botão "Copiar mensagem para WhatsApp": texto pronto com o link ("Oi {{nome}}, preparei um tour rápido do NX Systems para a {{empresa}}: {link}").
- P0 Ativar/desativar link; expiração opcional.
- P1 Código de incorporação (iframe responsivo) para o site/LP.
- P1 QR Code do link (gerado no front, sem serviço externo).

### 4.5 Analytics
- P0 Rastreamento no player (seção 8).
- P0 Dashboard geral e por demo, filtros de período (hoje, 7, 30, 90 dias, personalizado) e por link/vendedor.
- P0 Funil por etapa (quantas sessões chegaram em cada etapa → onde abandonam).
- P0 Lista de sessões com: quando, quem (lead ou "Anônimo"), link/canal, dispositivo, duração, etapas vistas X/N, concluiu, clicou CTA.
- P0 Linha do tempo de uma sessão (eventos em ordem com horário).
- P1 "Leads quentes": ranking por pontuação de engajamento.
- P1 Exportar CSV (sessões e leads).

### 4.6 Leads
- P0 Lista de leads (nome, empresa, WhatsApp, origem: demo/link/vendedor, primeira e última visita, nº de sessões, maior % concluído, status).
- P0 Detalhe do lead: dados, sessões, linha do tempo, notas, status (`NOVO`, `EM_CONTATO`, `QUALIFICADO`, `GANHO`, `PERDIDO`), responsável.
- P0 Botão "Chamar no WhatsApp" (wa.me com mensagem).
- P1 Enriquecimento por CNPJ (BrasilAPI) quando o lead informar CNPJ: razão social, CNAE, porte, cidade/UF, capital social.
- P1 Deduplicação por telefone normalizado (E.164) e e-mail.

### 4.7 Configurações
- P0 Usuários (convidar, papel, desativar).
- P0 Token da extensão (gerar/revogar).
- P0 Regras de anonimização do workspace (lista "procurar → substituir", regex opcional, chaves automáticas: telefone, e-mail, CPF, CNPJ, fotos de perfil).
- P0 Webhooks (URL, eventos assinados, segredo HMAC, botão "Enviar teste", log das últimas 50 entregas).
- P0 Dados padrão do CTA (WhatsApp da NX `5548936181649`, mensagem padrão).

---

## 5. Telas do painel

Rotas sob `/app` (autenticadas). Layout: barra lateral fixa (Demos, Exemplos, Leads, Analytics, Links, Configurações), cabeçalho com busca e usuário. Usar shadcn/ui + Tailwind, visual limpo, cor de destaque `#2c6bc8` (azul NX).

| Rota | Conteúdo |
|---|---|
| `/app` | Visão geral: KPIs do período (views, visitantes únicos, taxa de conclusão, tempo médio, leads, cliques no CTA), gráfico de views por dia, top demos, top links, leads recentes, sessões ao vivo (últimos 5 min). |
| `/app/demos` | Grid de demos + botão "Nova demo" (Em branco / A partir de exemplo / Importar captura). |
| `/app/demos/[id]/editor` | Editor (seção 4.3). Topo: nome editável, status, "Pré-visualizar", "Publicar", "Compartilhar". |
| `/app/demos/[id]/analytics` | KPIs da demo, funil por etapa (barras horizontais com % e queda), views por dia, dispositivos, canais/links, sessões. |
| `/app/demos/[id]/links` | Links da demo + criar link nomeado / personalizado. |
| `/app/demos/[id]/versions` | Histórico de versões. |
| `/app/exemplos` | Galeria de templates por segmento, com "Ver" (abre player) e "Usar este exemplo". |
| `/app/leads` | Tabela filtrável (status, vendedor, demo, período) + exportar. |
| `/app/leads/[id]` | Detalhe do lead. |
| `/app/sessoes/[id]` | Linha do tempo da sessão. |
| `/app/links` | Todos os links (meus / todos), com views e leads por link. |
| `/app/configuracoes/*` | Usuários, Extensão, Anonimização, Webhooks, CTA padrão. |

Estados vazios sempre explicam o próximo passo ("Nenhuma sessão ainda. Compartilhe o link da demo para começar a medir.").

---

## 6. Extensão de captura (Chrome, Manifest V3)

Pasta `apps/extension`. Distribuição: build gera `.zip`; instalar em modo desenvolvedor (chrome://extensions → "Carregar sem compactação"). Sem Chrome Web Store por enquanto.

### 6.1 Configuração
- Popup → aba "Conta": URL do servidor (padrão `https://{DOMINIO}`) + token pessoal. Validar com `GET /api/ext/me`.

### 6.2 Fluxo de captura
1. Usuário abre o sistema a ser capturado (ex.: `app.nxsystems.com.br`) já logado.
2. Popup: escolher **demo de destino** (lista via API) ou "Nova demo"; ligar/desligar **Anonimizar**; modo **Imagem** (padrão) ou **Imagem + HTML**.
3. "Iniciar captura": o content script ativa a anonimização ao vivo (regras do workspace + automáticas, com `MutationObserver` para manter a página anonimizada enquanto o SPA renderiza) e mostra um selo discreto "Gravando · N telas" no canto.
4. **A cada clique do usuário** (listener em `pointerdown`, fase de captura):
   - registra o retângulo do elemento clicado (`getBoundingClientRect`, em px CSS), um seletor CSS estável e o texto do elemento;
   - pede ao service worker `chrome.tabs.captureVisibleTab({format:'png'})` **antes** da página mudar;
   - (modo HTML) gera o snapshot do DOM (ver `reference/capture/capture-reference.js`).
   - O frame salvo é a tela **onde** o clique aconteceu; o retângulo vira o hotspot da etapa.
5. Atalho **Alt+Shift+S** captura a tela atual sem clique (etapa sem hotspot ou para montar depois).
6. "Finalizar": captura a tela final e abre a revisão no popup (miniaturas, excluir as indesejadas) → "Enviar para a demo".
7. Upload: `POST /api/ext/captures` (multipart) com cada imagem + metadados. O servidor cria os frames e **uma etapa HOTSPOT por clique** com título vazio (o editor sinaliza "sem texto").
8. Ao finalizar, a extensão recarrega a aba para desfazer a anonimização ao vivo.

### 6.3 Detalhes técnicos
- Viewport e `devicePixelRatio` enviados junto; o servidor guarda `width/height` em px CSS e converte a imagem para WebP qualidade 78 mantendo a resolução (2x em telas retina).
- O CSS da página (modo HTML) é coletado uma vez por sessão e deduplicado por hash SHA-256 (`CssAsset`).
- Limites: 40 telas por captura, 4 MB por imagem antes da conversão.
- Permissões: `activeTab`, `scripting`, `storage`, `tabs`; `host_permissions` apenas para o domínio do servidor (upload). Nada de `<all_urls>` permanente: injetar o content script via `chrome.scripting` na aba ativa quando o usuário iniciar a captura.
- Nunca enviar cookies/tokens da página capturada; o snapshot HTML remove `script`, `iframe`, atributos `on*` e `href`.

---

## 7. Player público (link da demo)

Rotas públicas: `/d/[slug]` (link padrão), `/l/[codigo]` (link nomeado/personalizado → renderiza a mesma demo com o contexto do link), `/e/[slug]` (versão para iframe, sem cabeçalho). Server Component carrega a **versão publicada** e entrega JSON para um componente cliente leve (sem dependências pesadas; meta: < 60 KB JS gzip além do React).

### 7.1 Comportamento (portar de `reference/player/player-v1.html`, que já funciona em desktop e celular)
- Moldura de navegador (bolinhas + barra de URL com o `displayUrl` do frame).
- Frame renderizado como `<img>` (WebP 2x) dentro de um "canvas" de tamanho lógico `width×height`, posicionado com `transform: scale(z) translate(-ox, -oy)`.
- Spotlight: retângulo do hotspot com `box-shadow: 0 0 0 9999px rgba(9,20,38,.42)` e anel pulsante na cor de destaque. Clicar no hotspot avança; clicar fora faz o anel "balançar" (dica).
- **Desktop (> 760px):** tela inteira visível (`z = larguraDisponível / width`). Balão flutua ao lado do hotspot (direita → esquerda → abaixo → acima, o primeiro que couber) com setinha.
- **Celular (≤ 760px):** altura do palco `clamp(280px, 95vw, 52vh)`. O palco **dá zoom e centraliza no hotspot**: `z = min(vw/(w+56), vh/(h+56), 0.95)`, nunca menor que `vw/width`; `ox/oy` centralizam o hotspot e são limitados às bordas do frame. Transição de 450 ms entre etapas. Balão **ancorado abaixo do palco** (não flutua). Botão "Tela inteira / Aproximar" na barra de URL. Selo "Toque no destaque". Arrastar para o lado (> 60px) avança/volta.
- Cartões (`MODAL`, `LEAD_FORM`, `CTA`) centralizados sobre a tela com fundo escurecido e desfocado.
- Barra de progresso clicável abaixo; contador "Etapa 3 de 13"; teclado ← →.
- Pré-carregar todas as imagens da demo ao abrir (`new Image()` + `decode()`), troca de tela com crossfade de 180 ms entre duas `<img>`.
- Variáveis `{{empresa}}`, `{{nome}}`, `{{vendedor}}` vêm do link (ou do querystring `?empresa=`) e são aplicadas nos textos.
- CTA WhatsApp: `https://wa.me/{numero}?text={mensagem com variáveis}`; inputs do cartão atualizam o link ao digitar; sempre mostrar o número em texto ao lado.
- Acessibilidade: hotspot é `role=button` com foco por teclado; balão `aria-live=polite`; respeitar `prefers-reduced-motion`.
- Fontes de 16px nos inputs (evita zoom do iOS), `touch-action: manipulation`.
- Meta tags Open Graph por demo (título, descrição, imagem = 1º frame) para o link ficar bonito no WhatsApp.

### 7.2 Gate de lead
Se a demo tiver `leadGateStep = N`, ao chegar na etapa N o cartão `LEAD_FORM` aparece e só libera o restante após envio. Se o link é personalizado, o gate é pulado (lead já conhecido).

### 7.3 Incorporação
`<iframe src="https://{DOMINIO}/e/{slug}" style="width:100%;aspect-ratio:16/9;border:0" allow="fullscreen"></iframe>` + opção de script que ajusta altura automaticamente via `postMessage`.

---

## 8. Analytics: eventos, métricas e leads

### 8.1 Coleta no player
- Identificadores: `visitorId` (uuid em localStorage `nxd_vid` + cookie first-party de 1 ano), `sessionId` (uuid novo se não houver atividade há 30 min).
- Envio em lote a cada 5 s e no `visibilitychange/pagehide` via `navigator.sendBeacon('/api/t', blob)`; fallback `fetch(..., {keepalive:true})`.
- Payload:
```json
{
  "v": 1,
  "demoId": "...", "versionId": "...", "linkCode": "abc1234",
  "visitorId": "...", "sessionId": "...",
  "ctx": { "url": "...", "referrer": "...", "utm": {"source":"","medium":"","campaign":""},
           "screen": {"w":390,"h":844,"dpr":3}, "lang": "pt-BR", "tz": "America/Sao_Paulo" },
  "events": [
    {"t":"session_start","ts":1730650000000},
    {"t":"step_view","ts":...,"stepId":"...","order":3},
    {"t":"hotspot_click","ts":...,"stepId":"..."},
    {"t":"chapter_open","ts":...,"chapter":"IA"},
    {"t":"lead_submit","ts":...,"fields":{"nome":"...","empresa":"...","whatsapp":"..."}},
    {"t":"cta_click","ts":...,"cta":"whatsapp"},
    {"t":"complete","ts":...},
    {"t":"heartbeat","ts":...,"activeMs":15000}
  ]
}
```
- Heartbeat a cada 15 s só com a aba visível (para calcular tempo ativo real).
- Não rastrear quando o visitante é um usuário logado do painel (cookie de sessão presente) → marcar `internal=true` e excluir dos números por padrão.
- Ignorar bots pelo user-agent (lista básica: bot, crawler, spider, WhatsApp link preview `WhatsApp/`, `facebookexternalhit`).

### 8.2 Processamento no servidor (`POST /api/t`)
- Validar com zod; rate limit por IP (60 req/min).
- Upsert de `Visitor`, `Session` (cria no `session_start` ou no primeiro evento), insere `Event`s.
- Atualiza campos agregados da sessão: `lastSeenAt`, `maxStepOrder`, `stepsViewed` (distintos), `activeMs`, `completed`, `ctaClicked`, `leadId`.
- Dispositivo/navegador/SO com `ua-parser-js`. IP **não** é salvo; salvar `ipHash = sha256(ip + IP_SALT)` para contar únicos.
- `lead_submit` → cria/atualiza `Lead` (dedupe por WhatsApp E.164 ou e-mail), liga à sessão e ao visitante (sessões anteriores e futuras do mesmo visitante passam a mostrar o lead).
- Link personalizado → `Session.leadId` já vem do `ShareLink.leadId`.
- Dispara webhooks assíncronos (seção 9).

### 8.3 Métricas (definições exatas)
| Métrica | Definição |
|---|---|
| Views | nº de sessões (excluindo internas e bots) |
| Visitantes únicos | nº de `visitorId` distintos |
| Taxa de conclusão | sessões com `complete` ÷ sessões |
| Tempo médio | média de `activeMs` das sessões |
| Engajamento médio | média de `stepsViewed / totalHotspotSteps` |
| Leads | leads criados no período (primeira identificação) |
| Cliques no CTA | sessões com `cta_click` |
| Conversão em lead | sessões com lead ÷ sessões |
| Funil por etapa | para cada `order`: sessões cuja `maxStepOrder >= order` |
| Pontuação do lead (P1) | `40×conclusão + 20×min(tempo/120s,1) + 15×min(sessões-1,2)/2 + 25×ctaClicked` (0–100); ≥ 70 = quente |

Consultas agregadas direto no Postgres com índices (seção 11). Volume esperado (milhares de sessões/mês) não exige banco analítico separado.

---

## 9. Integrações

### 9.1 Webhooks (n8n)
- Eventos assináveis: `lead.created`, `lead.updated`, `session.started` (só links personalizados ou leads conhecidos), `session.completed`, `cta.clicked`.
- Corpo:
```json
{ "event": "session.completed", "sentAt": "2026-11-03T18:20:00Z",
  "demo": {"id":"...","name":"NX Systems - Tour completo","url":"https://.../d/nx-systems-tour"},
  "link": {"code":"abc1234","label":"Lead - Pedal Bikes","seller":{"name":"Luis","email":"..."}},
  "lead": {"id":"...","nome":"Ana Souza","empresa":"Pedal Bikes","whatsapp":"+5548999990000","score":82},
  "session": {"id":"...","startedAt":"...","activeSeconds":184,"stepsViewed":13,"totalSteps":13,"completed":true,"device":"mobile"},
  "panelUrl": "https://.../app/leads/..." }
```
- Assinatura: header `X-NXDemo-Signature: sha256=HMAC(secret, body)`.
- Entrega assíncrona via tabela `WebhookDelivery` + worker no mesmo processo (intervalo de 10 s), 3 tentativas com backoff (1 min, 5 min, 30 min). Log visível em Configurações.
- Caso de uso principal no n8n: `session.completed` ou `cta.clicked` de link personalizado → mandar mensagem no WhatsApp do vendedor: "🔥 Ana (Pedal Bikes) terminou a demo agora, 3 min de tour. Chama!".

### 9.2 WhatsApp
- Apenas links `wa.me` (CTA do player e botões do painel). Nenhum envio automático pelo sistema; envios ficam no n8n/NX Systems.

### 9.3 Enriquecimento (P1)
- `GET https://brasilapi.com.br/api/cnpj/v1/{cnpj}` quando houver CNPJ; salvar JSON em `Lead.enrichment` e campos principais. Timeout 5 s; falha não bloqueia nada.

### 9.4 IA (P2, opcional)
- Variável `OPENAI_API_KEY` (ou Anthropic). Usos: sugerir textos das etapas a partir do texto visível de cada frame + descrição do negócio; sugerir regras de anonimização. Desligado se a chave não existir.

---

## 10. Arquitetura e stack

```
                ┌────────────────────────── Easypanel (VPS) ───────────────────────────┐
 Extensão  ───► │  app (Next.js 15, Node 20)                                            │
 Chrome         │   ├─ /app/*        painel (React Server Components + shadcn/ui)      │
                │   ├─ /d /l /e      player público                                    │
 Lead (link) ─► │   ├─ /api/t        coleta de eventos (beacon)                        │
                │   ├─ /api/*        API do painel e da extensão                       │
                │   └─ worker        entregas de webhook (setInterval no boot)         │
                │        │                         │                                    │
                │   Postgres 16 (serviço)     Volume /data (imagens WebP, html, css)   │
                └──────────────────────────────────────────────────────────────────────┘
                                         │ webhooks
                                         ▼
                                      n8n (já existe na VPS)
```

**Stack**
- Monorepo **pnpm workspaces**: `apps/web` (Next.js 15 App Router, TypeScript strict), `apps/extension` (MV3, Vite + TypeScript), `packages/shared` (tipos, schemas zod, cálculo de variáveis, renderização do texto do balão).
- **Banco:** PostgreSQL 16 + **Prisma**.
- **Auth:** Auth.js (NextAuth v5) com Credentials + bcryptjs; middleware protege `/app` e `/api` (exceto públicas).
- **UI:** Tailwind CSS + shadcn/ui + lucide-react; gráficos **Recharts**; tabelas TanStack Table; arrastar/redimensionar hotspot com **react-rnd**; reordenar etapas com **dnd-kit**.
- **Imagens:** `sharp` (conversão WebP, miniaturas).
- **Validação:** zod em toda entrada.
- **Armazenamento:** interface `Storage` com implementação `LocalDiskStorage` (raiz `STORAGE_DIR=/data`) e espaço para `S3Storage` futura. Arquivos servidos por rota `/files/[...path]` com `Cache-Control: public, max-age=31536000, immutable` (nomes com hash).
- **Testes:** Vitest (unit: variáveis, métricas, anonimização, layout do player) + Playwright (e2e: criar demo, publicar, abrir no celular 390×844, clicar hotspot, enviar lead).
- **Qualidade:** ESLint + Prettier; `pnpm typecheck` e `pnpm test` no CI (GitHub Actions).

**Estrutura de pastas**
```
nx-demo-studio/
├─ apps/
│  ├─ web/
│  │  ├─ app/
│  │  │  ├─ (auth)/login/
│  │  │  ├─ app/            # painel (/app/...)
│  │  │  ├─ d/[slug]/       # player
│  │  │  ├─ l/[code]/
│  │  │  ├─ e/[slug]/
│  │  │  ├─ files/[...path]/route.ts
│  │  │  └─ api/            # rotas (seção 12)
│  │  ├─ components/        # ui (shadcn), editor/, player/, analytics/
│  │  ├─ lib/               # db.ts, auth.ts, storage.ts, metrics.ts, webhooks.ts, ua.ts
│  │  ├─ prisma/            # schema.prisma, migrations/, seed.ts
│  │  └─ Dockerfile
│  └─ extension/
│     ├─ src/ (popup/, content/, background/)
│     └─ manifest.json
├─ packages/shared/
├─ reference/               # material da Fase 1 (não é código de produção)
├─ docs/
├─ docker-compose.yml       # dev local: postgres
└─ CLAUDE.md
```

---

## 11. Modelo de dados (Prisma)

```prisma
generator client {
  provider = "prisma-client-js"
}
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  EDITOR
  SELLER
}
enum DemoStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}
enum FrameKind {
  IMAGE
  HTML
}
enum StepKind {
  HOTSPOT
  MODAL
  LEAD_FORM
  CTA
}
enum LinkKind {
  CHANNEL
  PERSONAL
}
enum LeadStatus {
  NOVO
  EM_CONTATO
  QUALIFICADO
  GANHO
  PERDIDO
}
enum DeliveryStatus {
  PENDING
  SUCCESS
  FAILED
}

model Workspace {
  id         String   @id @default(cuid())
  name       String
  settings   Json     @default("{}")   // ctaDefault {phone,message}, anonymizeAuto {...}
  createdAt  DateTime @default(now())
  users      User[]
  demos      Demo[]
  leads      Lead[]
  webhooks   Webhook[]
  anonymizeRules AnonymizeRule[]
}

model User {
  id           String   @id @default(cuid())
  workspaceId  String
  workspace    Workspace @relation(fields: [workspaceId], references: [id])
  name         String
  email        String   @unique
  passwordHash String
  role         Role     @default(EDITOR)
  phone        String?            // para notificações via n8n
  active       Boolean  @default(true)
  apiTokens    ApiToken[]
  links        ShareLink[]
  leads        Lead[]   @relation("LeadOwner")
  createdAt    DateTime @default(now())
}

model ApiToken {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  name      String
  tokenHash String   @unique         // sha256 do token; o token só aparece uma vez
  lastUsedAt DateTime?
  revokedAt DateTime?
  createdAt DateTime @default(now())
}

model Demo {
  id          String     @id @default(cuid())
  workspaceId String
  workspace   Workspace  @relation(fields: [workspaceId], references: [id])
  name        String
  slug        String     @unique
  description String?
  status      DemoStatus @default(DRAFT)
  isTemplate  Boolean    @default(false)
  segment     String?              // Clínica, Autopeças, Provedor...
  theme       Json       @default("{}") // {accent, brandName, logoText, logoAssetPath}
  settings    Json       @default("{}") // {showProgress, showRestart, leadGateStep, ctaPhone, ctaMessage}
  coverFrameId String?
  createdById String
  frames      Frame[]
  steps       Step[]
  chapters    Chapter[]
  versions    DemoVersion[]
  links       ShareLink[]
  sessions    ViewSession[]
  publishedVersionId String? @unique
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
  @@index([workspaceId, status])
}

model DemoVersion {
  id         String   @id @default(cuid())
  demoId     String
  demo       Demo     @relation(fields: [demoId], references: [id], onDelete: Cascade)
  number     Int
  snapshot   Json      // demo + chapters + steps + frames (paths) congelados
  publishedById String
  createdAt  DateTime @default(now())
  @@unique([demoId, number])
}

model Frame {
  id          String    @id @default(cuid())
  demoId      String
  demo        Demo      @relation(fields: [demoId], references: [id], onDelete: Cascade)
  kind        FrameKind @default(IMAGE)
  name        String?
  imagePath   String              // WebP no storage
  thumbPath   String
  width       Int                 // px CSS
  height      Int
  pixelRatio  Float     @default(1)
  displayUrl  String?             // aparece na barra falsa
  sourceUrl   String?             // URL real capturada (só interno)
  htmlPath    String?             // snapshot body (json) quando kind=HTML ou captura com HTML
  cssAssetId  String?
  cssAsset    CssAsset? @relation(fields: [cssAssetId], references: [id])
  masks       Json      @default("[]") // [{x,y,w,h,type:'blur'|'cover',text?}]
  createdAt   DateTime  @default(now())
  steps       Step[]
}

model CssAsset {
  id        String  @id @default(cuid())
  sha256    String  @unique
  path      String
  bytes     Int
  frames    Frame[]
}

model Chapter {
  id      String @id @default(cuid())
  demoId  String
  demo    Demo   @relation(fields: [demoId], references: [id], onDelete: Cascade)
  name    String
  order   Int
  steps   Step[]
}

model Step {
  id          String   @id @default(cuid())
  demoId      String
  demo        Demo     @relation(fields: [demoId], references: [id], onDelete: Cascade)
  frameId     String
  frame       Frame    @relation(fields: [frameId], references: [id])
  chapterId   String?
  chapter     Chapter? @relation(fields: [chapterId], references: [id])
  order       Int
  kind        StepKind @default(HOTSPOT)
  hotspot     Json?            // {x,y,w,h} px CSS do frame
  title       String   @default("")
  body        String   @default("")
  placement   String   @default("auto")  // auto|right|left|top|bottom
  buttonLabel String?
  action      Json?            // {type:'next'|'goto'|'url', stepId?, url?}
  form        Json?            // LEAD_FORM: {fields:[{key,label,required}], consentText}
  cta         Json?            // CTA: {type:'WHATSAPP'|'URL', phone?, message?, url?, buttonLabel}
  @@index([demoId, order])
}

model ShareLink {
  id         String   @id @default(cuid())
  demoId     String
  demo       Demo     @relation(fields: [demoId], references: [id], onDelete: Cascade)
  code       String   @unique          // 7 chars base62
  kind       LinkKind @default(CHANNEL)
  label      String
  createdById String
  createdBy  User     @relation(fields: [createdById], references: [id])
  leadId     String?                    // PERSONAL
  lead       Lead?    @relation(fields: [leadId], references: [id])
  variables  Json     @default("{}")    // {empresa, nome, vendedor}
  utm        Json     @default("{}")
  active     Boolean  @default(true)
  expiresAt  DateTime?
  createdAt  DateTime @default(now())
  sessions   ViewSession[]
}

model Visitor {
  id          String   @id            // uuid gerado no navegador
  firstSeenAt DateTime @default(now())
  lastSeenAt  DateTime @default(now())
  leadId      String?
  lead        Lead?    @relation(fields: [leadId], references: [id])
  sessions    ViewSession[]
}

model ViewSession {   // "Session" evitado para não colidir com tabelas de auth
  id           String   @id           // uuid do navegador
  demoId       String
  demo         Demo     @relation(fields: [demoId], references: [id], onDelete: Cascade)
  versionId    String?
  linkId       String?
  link         ShareLink? @relation(fields: [linkId], references: [id])
  visitorId    String
  visitor      Visitor  @relation(fields: [visitorId], references: [id])
  leadId       String?
  lead         Lead?    @relation(fields: [leadId], references: [id])
  startedAt    DateTime @default(now())
  lastSeenAt   DateTime @default(now())
  activeMs     Int      @default(0)
  maxStepOrder Int      @default(0)
  stepsViewed  Int      @default(0)
  totalSteps   Int      @default(0)
  completed    Boolean  @default(false)
  ctaClicked   Boolean  @default(false)
  internal     Boolean  @default(false)
  device       String?               // mobile|tablet|desktop
  browser      String?
  os           String?
  referrer     String?
  utm          Json     @default("{}")
  ipHash       String?
  events       Event[]
  @@index([demoId, startedAt])
  @@index([linkId, startedAt])
  @@index([leadId])
}

model Event {
  id        BigInt   @id @default(autoincrement())
  sessionId String
  session   ViewSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  type      String               // session_start|step_view|hotspot_click|chapter_open|lead_submit|cta_click|complete|heartbeat
  stepId    String?
  stepOrder Int?
  data      Json?
  ts        DateTime
  @@index([sessionId, ts])
  @@index([type, ts])
}

model Lead {
  id          String     @id @default(cuid())
  workspaceId String
  workspace   Workspace  @relation(fields: [workspaceId], references: [id])
  name        String?
  company     String?
  phoneE164   String?
  email       String?
  role        String?
  cnpj        String?
  enrichment  Json?
  status      LeadStatus @default(NOVO)
  ownerId     String?
  owner       User?      @relation("LeadOwner", fields: [ownerId], references: [id])
  source      Json       @default("{}") // {demoId, linkId, channel}
  score       Int        @default(0)
  notes       String?
  firstSeenAt DateTime   @default(now())
  lastSeenAt  DateTime   @default(now())
  sessions    ViewSession[]
  visitors    Visitor[]
  links       ShareLink[]
  @@index([workspaceId, status])
  @@index([phoneE164])
  @@index([email])
}

model AnonymizeRule {
  id          String  @id @default(cuid())
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  find        String
  replace     String
  isRegex     Boolean @default(false)
  order       Int     @default(0)
}

model Webhook {
  id          String   @id @default(cuid())
  workspaceId String
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  url         String
  secret      String
  events      String[]
  active      Boolean  @default(true)
  deliveries  WebhookDelivery[]
  createdAt   DateTime @default(now())
}

model WebhookDelivery {
  id          String         @id @default(cuid())
  webhookId   String
  webhook     Webhook        @relation(fields: [webhookId], references: [id], onDelete: Cascade)
  event       String
  payload     Json
  status      DeliveryStatus @default(PENDING)
  attempts    Int            @default(0)
  nextAttemptAt DateTime     @default(now())
  responseCode Int?
  responseBody String?
  createdAt   DateTime       @default(now())
  @@index([status, nextAttemptAt])
}
```

Notas
- Coordenadas de hotspot e máscaras **sempre em px CSS do frame**, nunca em px da tela do editor.
- Ao publicar, o snapshot da versão guarda os caminhos das imagens; frames referenciados por versões publicadas **não podem ser apagados** (soft-delete / limpeza só de órfãos).
- Job diário: apagar `Event` do tipo `heartbeat` com mais de 180 dias (os agregados ficam na `Session`); limpar arquivos órfãos do storage.

---

## 12. API

Todas as rotas do painel exigem sessão; as da extensão exigem `Authorization: Bearer {token}`. Respostas JSON; erros `{error:{code,message}}` com mensagens em português.

**Públicas**
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/public/demos/{slug}` | versão publicada (usado pelo player cliente se precisar) |
| GET | `/api/public/links/{code}` | resolve link → demo publicada + variáveis (não expõe dados do lead além de nome/empresa) |
| POST | `/api/t` | coleta de eventos (seção 8) |
| POST | `/api/public/leads` | envio do formulário de lead (também chega como evento; endpoint dedicado para validação síncrona) |
| GET | `/files/{path}` | imagens e assets |

**Painel**
| Método | Rota |
|---|---|
| GET/POST | `/api/demos` (lista com métricas resumidas / criar `{name, fromTemplateId?}`) |
| GET/PATCH/DELETE | `/api/demos/{id}` |
| POST | `/api/demos/{id}/duplicate` |
| POST | `/api/demos/{id}/publish` · `/unpublish` |
| GET | `/api/demos/{id}/versions` · POST `/api/demos/{id}/versions/{n}/restore` |
| GET/POST | `/api/demos/{id}/frames` (upload multipart) · PATCH/DELETE `/api/frames/{id}` |
| GET/POST | `/api/demos/{id}/steps` · PATCH/DELETE `/api/steps/{id}` · POST `/api/demos/{id}/steps/reorder` `{ids:[]}` |
| GET/POST | `/api/demos/{id}/chapters` · PATCH/DELETE `/api/chapters/{id}` |
| GET/POST | `/api/demos/{id}/links` · PATCH `/api/links/{id}` |
| GET | `/api/analytics/overview?from&to&demoId&linkId&sellerId` |
| GET | `/api/analytics/funnel?demoId&from&to` |
| GET | `/api/analytics/timeseries?metric=views&demoId&from&to&interval=day` |
| GET | `/api/sessions?…` · `/api/sessions/{id}` (com eventos) |
| GET/PATCH | `/api/leads` · `/api/leads/{id}` · GET `/api/leads/export.csv` |
| CRUD | `/api/users`, `/api/tokens`, `/api/anonymize-rules`, `/api/webhooks` (+ POST `/api/webhooks/{id}/test`) |

**Extensão**
| Método | Rota |
|---|---|
| GET | `/api/ext/me` |
| GET | `/api/ext/demos` (id, nome) · POST `/api/ext/demos` (criar) |
| GET | `/api/ext/anonymize-rules` |
| POST | `/api/ext/captures` multipart: `demoId`, `meta` (JSON com lista de telas: `{index, width, height, dpr, url, title, click:{x,y,w,h,selector,text}|null}`), `image_{i}` (PNG), `html_{i}` (JSON gz opcional), `css` (texto gz opcional) → cria frames + steps; responde `{demoId, editorUrl}` |

---

## 13. Segurança e LGPD

- Senhas bcrypt (custo 12); tokens de API guardados só como hash.
- Rate limit: login (10/15 min por IP), `/api/t` (60/min por IP), `/api/public/leads` (10/min por IP).
- Sanitizar todo HTML de snapshot no servidor (DOMPurify/jsdom: sem `script`, `iframe`, `on*`, `javascript:`); frames HTML só são exibidos dentro de `<iframe sandbox>` sem `allow-scripts`.
- CSP no player e no painel; `X-Frame-Options` liberado apenas para `/e/*` (embed).
- **Anonimização é obrigatória por padrão** na extensão (pode ser desligada por Admin). Editor mostra aviso se detectar padrão de telefone/e-mail no texto visível do snapshot HTML.
- Formulário de lead com texto de consentimento ("Ao enviar, você concorda em ser contatado pela NX Digital…") e link para política de privacidade (URL configurável).
- IP nunca salvo em claro (só hash com salt). Opção de apagar lead e todas as sessões dele (direito de exclusão).
- Logs sem dados pessoais.

---

## 14. Deploy no Easypanel

### 14.1 Dockerfile (`apps/web/Dockerfile`, build a partir da raiz do monorepo)
```dockerfile
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY . .
RUN pnpm --filter shared build && pnpm --filter web exec prisma generate && pnpm --filter web build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN apk add --no-cache libc6-compat
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
COPY --from=build /repo/apps/web/prisma ./apps/web/prisma
COPY --from=build /repo/node_modules/.pnpm/node_modules/prisma ./node_modules/prisma
EXPOSE 3000
CMD ["sh","-c","node node_modules/prisma/build/index.js migrate deploy --schema apps/web/prisma/schema.prisma && node apps/web/server.js"]
```
(`next.config` com `output: 'standalone'`. `sharp` precisa estar nas dependências de produção.)

### 14.2 Variáveis de ambiente
| Variável | Exemplo |
|---|---|
| `DATABASE_URL` | `postgresql://nxdemo:SENHA@nxdemo-db:5432/nxdemo` (host interno do serviço no Easypanel) |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `AUTH_URL` / `PUBLIC_BASE_URL` | `https://demo.gruponxdigital.com` |
| `STORAGE_DIR` | `/data` |
| `IP_SALT` | string aleatória |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | usados só no seed |
| `DEFAULT_WHATSAPP` | `5548936181649` |
| `OPENAI_API_KEY` | opcional (P2) |

### 14.3 Passo a passo no painel do Easypanel
1. **Criar projeto** `nx-demo`.
2. **+ Service → Postgres** (nome `nxdemo-db`, versão 16). Anotar a connection string interna.
3. **+ Service → App** (nome `nxdemo-app`): Source = GitHub (repositório do projeto, branch `main`), Build = Dockerfile, caminho `apps/web/Dockerfile`, contexto `/` (raiz).
4. **Environment:** colar as variáveis da 14.2.
5. **Mounts:** Volume `nxdemo-data` → `/data`.
6. **Domains:** `demo.gruponxdigital.com` → porta 3000, HTTPS ligado (Let's Encrypt). No DNS do domínio: registro **A** `demo` → IP da VPS (ou CNAME para o host do Easypanel).
7. **Deploy.** Na primeira vez, abrir o console do serviço e rodar `node node_modules/prisma/build/index.js db seed` (ou expor um script `pnpm seed`), que cria o workspace, o admin e importa o template "NX Systems — Tour completo" de `reference/seed/`.
8. Ligar **auto-deploy** no push para `main`.

### 14.4 Operação
- **Disco:** a VPS já teve aperto de armazenamento. Imagens em WebP q78 (~100 KB por tela 2x); limitar upload; job de limpeza de órfãos; acompanhar uso do volume.
- **Backup:** backup diário do Postgres pelo Easypanel + cópia semanal do volume `/data` (rsync/rclone para Google Drive ou S3).
- **Healthcheck:** `GET /api/health` → `{ok:true, db:true}`.
- **Logs:** stdout em JSON (pino).

---

## 15. Seed: demo "NX Systems — Tour completo"

`reference/seed/` contém a demo da Fase 1 pronta para importar:
- `demo.json` — nome, slug `nx-systems-tour`, tema, capítulos, 9 frames e 15 etapas (1 abertura, 13 hotspots, 1 CTA), com textos e coordenadas de hotspot em px CSS (frames 1536×695).
- `frames/*.webp` — screenshots 2x (3072×1390), já anonimizados (loja fictícia "Pedal Bikes").
- `html/*.json` + `html/nxsystems.css` — snapshots HTML/CSS das mesmas telas (para o modo HTML futuro; o CSS tem as fontes Inter embutidas).

O script de seed deve: criar workspace "NX Digital", usuário admin, regras de anonimização padrão, copiar as imagens para o storage (gerando miniaturas), criar a demo como **template** e **publicada**, e criar um link CHANNEL "Site". Resultado esperado: abrir `/d/nx-systems-tour` e ver o mesmo tour da Fase 1, no desktop e no celular.

**Templates de exemplo a criar depois (manualmente, pela extensão):** Clínica (agendamento + IA), Autopeças (orçamento + catálogo), Provedor de internet (2ª via + suporte técnico), Imobiliária (captação de leads), Varejo/loja (campanhas + kanban). Cada um reaproveita telas do NX Systems com dados fictícios do segmento.

---

## 16. Critérios de aceite gerais

- Criar uma demo do zero com 5 telas enviadas manualmente, desenhar hotspots, escrever textos, publicar e abrir o link — em menos de 10 minutos.
- O player funciona em: Chrome/Edge/Firefox desktop, Safari iOS 16+, Chrome Android, e dentro do navegador do WhatsApp. No celular, cada etapa mostra o destaque com zoom legível e o balão abaixo.
- Um link personalizado aberto no celular gera: sessão atribuída ao lead, funil correto e webhook `session.completed` ao terminar.
- Dashboard bate com os eventos (teste automatizado com dados sintéticos).
- Lighthouse do player (mobile): Performance ≥ 85, Acessibilidade ≥ 90.
- Nenhum dado real de cliente aparece nas demos de seed nem nos logs.
