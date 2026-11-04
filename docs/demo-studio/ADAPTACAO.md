# Demo Studio na base do superadmin

A especificação foi escrita para um projeto novo (Next.js 15 + Prisma + Auth.js num monorepo pnpm). A decisão é construir **dentro do superadmin**. Só a base muda; as funcionalidades, regras, métricas e critérios de aceite ficam como estão. Este arquivo diz como cada peça da especificação vira algo na base do superadmin.

## Stack

| Especificação | No superadmin |
|---|---|
| Monorepo pnpm (`apps/web`, `packages/shared`) | Repositório atual: front em `src/` (React 18 + Vite), API em `server/` (Fastify 4). Código compartilhado puro (variáveis, zoom do player, métricas) em `src/lib/demoStudio/` e `server/src/lib/demoStudio/` com testes no servidor. |
| `apps/extension` | Pasta `extension/` na raiz (MV3, Vite + TS), no M4. |
| Next.js App Router / Server Components | Páginas React no SPA (lazy), dados via `api` (`src/services/api.ts`). |
| Prisma + migrations | SQL idempotente em `server/src/db/demoStudio.ts`, chamado no boot logo depois do `runMigrations()` (à parte, para uma falha de outro módulo não deixar o Demo Studio sem tabela). Tabelas `ds_*` (snake_case), ids `UUID` com `gen_random_uuid()`. |
| `prisma db seed` | `server/src/lib/demoStudio/seed.ts` roda sozinho no primeiro boot (lê `server/seed/demo-studio/`); a marca `seedTourNx` no workspace impede de rodar de novo. |
| Upload multipart | No painel, JSON com a imagem em data URL base64 (como o resto do superadmin; `bodyLimit` de 20 MB). Multipart entra com a extensão (M4). |
| Auth.js Credentials + tabela `User` | Login e JWT que já existem (`/api/auth/login`, `profiles`). Não há usuário separado do Demo Studio. |
| Papéis ADMIN / EDITOR / SELLER | `profiles.role = 'admin'` → ADMIN. Os demais precisam da marca `demo_studio` em Equipe → Permissões; o papel dentro do módulo vem de `profiles.ds_role` (`EDITOR` padrão, `SELLER` restrito aos próprios links/leads — aplicado no M3). |
| `Workspace` | Tabela `ds_workspaces` com uma linha "NX Digital" criada na migração. Todas as tabelas carregam `workspace_id` para não fechar a porta do multi-workspace. |
| shadcn/ui | Componentes de `src/components/ui` e o tema do superadmin. Destaque do Demo Studio (player) `#2c6bc8`, configurável por demo. |
| Recharts / dnd-kit / react-rnd / sharp / zod | `@dnd-kit`, `react-rnd`, `zod` e `sharp` como na especificação. **Sem Recharts:** os gráficos seguem o padrão do superadmin (div + Tailwind, ver `components/analytics/ConversionFunnel.tsx`) para não pesar o bundle. `ua-parser-js` fica na v1 (MIT; a v2 é AGPL). |
| Vitest + Playwright | `node --test` com `tsx` (padrão do servidor) para as regras puras. E2E com Playwright fica para quando o player existir (M1). |
| `Dockerfile` standalone | Os dois Dockerfiles que já existem (front nginx + `server/Dockerfile`). O servidor ganha um volume em `/data`. |
| GitHub Actions | Não existe CI hoje no superadmin; o que vale é rodar lint/build/testes antes do commit. |

## Rotas

Painel (autenticado, dentro do layout do superadmin): `/app/*` da especificação vira **`/demo-studio/*`**.

| Especificação | No superadmin |
|---|---|
| `/app` (visão geral) | `/demo-studio` |
| `/app/demos`, `/app/demos/[id]/editor|analytics|links|versions` | `/demo-studio/demos`, `/demo-studio/demos/:id/...` |
| `/app/exemplos`, `/app/leads`, `/app/links`, `/app/sessoes/[id]`, `/app/configuracoes/*` | `/demo-studio/exemplos`, `/demo-studio/leads`, `/demo-studio/links`, `/demo-studio/sessoes/:id`, `/demo-studio/configuracoes` |

Público (SPA, sem login): `/d/:slug`, `/l/:code`, `/e/:slug`, como na especificação.

API (Fastify): as rotas da §12 ganham o prefixo `/api/ds/` para não colidir com as rotas do superadmin (`/api/leads`, `/api/webhooks`, `/api/users` já existem). Exemplos: `/api/ds/demos`, `/api/ds/leads`, `/api/ds/webhooks`. As públicas ficam em `/api/public/ds/*` e a coleta em `/api/t`. Extensão: `/api/ext/*`. Arquivos: `/files/*`. Saúde: `/api/health` (`/health` antigo continua).

Erros seguem o padrão do superadmin: `{ message }` com status HTTP.

## Domínio e deploy

- O front (nginx) atende o painel e o player. `demo.gruponxdigital.com` entra como **domínio extra do serviço do front** no Easypanel; o link público fica `https://demo.gruponxdigital.com/d/<slug>`.
- O servidor guarda as imagens em `STORAGE_DIR` (padrão `/data` em produção, `./data` em dev) e as serve em `/files/*` pelo domínio da API. Precisa de **volume montado em `/data`** no serviço da API.
- Variáveis novas no servidor: `STORAGE_DIR`, `IP_SALT`, `PUBLIC_BASE_URL` (ex.: `https://demo.gruponxdigital.com`), `DEFAULT_WHATSAPP` (padrão `5548936181649`).
- Open Graph do link no WhatsApp (§7.1): como o player é SPA, o `nginx.conf` do front desvia só os robôs de preview (WhatsApp, Facebook, LinkedIn…) de `/d`, `/l` e `/e` para `/api/public/ds/og/*` na API. O endereço da API entra no build pelo `VITE_API_URL`; sem ele, o bloco é removido e o nginx fica como antes. O `nginx -t` no Dockerfile barra o build se a config quebrar.
