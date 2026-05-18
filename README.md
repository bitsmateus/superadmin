# TenantHub

Painel interno de gestão de tenants para um micro-serviço SaaS. Automatiza onboarding (criar tenant, configurar API e criar usuário de suporte) em uma única interface.

## Stack

- React 18 + Vite + TypeScript
- TailwindCSS v3
- TanStack Query v5
- React Router v6
- React Hook Form + Zod
- Axios (com interceptor de Bearer token)
- Zustand (estado da sessão)
- Sonner (toasts) + Lucide Icons

## Instalação

```bash
npm install
cp .env.example .env   # ajuste a URL da API
npm run dev
```

A aplicação abre em `http://localhost:5173`.

## Variáveis de ambiente

| Variável | Descrição |
| --- | --- |
| `VITE_API_BASE_URL` | URL base da API (sem barra no final). Ex.: `https://api.exemplo.com` |

## Autenticação

O painel tem dois níveis distintos:

1. **Login do admin** em `/login` — usuário e senha do painel. Default: `admin` / `admin`. Persistido no `localStorage` via zustand.
2. **API Token** — usado para falar com o backend (`Authorization: Bearer …`). Pré-configurado com a URL e o token de produção; pode ser ajustado a qualquer momento em **Configurações** (`/settings`), incluindo um botão para "Testar conexão".

Em qualquer resposta `401` da API, um toast avisa para conferir as Configurações. Se o admin não estiver logado, redireciona para `/login`.

## Endpoints consumidos

Tenants:
- `GET  /tenantApiListTenants` (ListTenants)
- `POST /tenantApiShowTenant` (ShowTenant)
- `POST /tenantApiStoreTenant` (StoreTenant)
- `POST /tenantApiUpdateTenant` (UpdateTenant)
- `POST /tenantCreateApi` (CreateApi)
- `POST /tenantDeleteApi` (DeleteApi)
- `POST /tenantApiCreateSession` (CreateSessionTenant)

Usuários:
- `POST /CreateUser`
- `POST /UpdateUser`
- `GET  /ListUsers`
- `GET  /GetUserStatus`

## Estrutura

```
src/
├── api/            # axios client + módulos de tenant/usuário
├── components/     # ui primitives, layout e features
├── hooks/          # queries/mutations com React Query
├── lib/            # utilitários
├── pages/          # rotas (Login, Dashboard, Tenants, Detalhe, Usuários)
├── routes/         # ProtectedRoute
├── store/          # zustand store da sessão
└── types/          # tipagens compartilhadas
```

## Scripts

```bash
npm run dev       # vite dev server
npm run build     # tsc + vite build
npm run preview   # serve a build
npm run lint      # tsc --noEmit (type-check)
```
