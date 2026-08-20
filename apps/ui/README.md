# Digital Trust Common Service — UI

React admin/management interface for the Common Service (issue [#82]).
Standalone npm package inside the monorepo — it has its own `package.json`,
lockfile and toolchain, and is **not** part of the root NestJS build.

## Stack

React 19 · Vite 8 (+ React Compiler) · TypeScript 6 · React Router 8 (data mode,
route-level code splitting) · Tailwind CSS 4 · shadcn/ui · TanStack Query ·
axios · zod · Vitest + Testing Library + MSW.

The current theme is the stock shadcn neutral preset (interim). BC Design
System alignment is planned — see `docs/ui-bc-design-system-planning.md`.

## Development

```bash
cd apps/ui
npm install
npm run dev          # http://localhost:5173
```

The dev server proxies `/api`, `/oidc` and `/health` to the API
(`VITE_PROXY_TARGET`, default `http://localhost:3000` — run the backend via
`docker compose up` or `npm run start:dev` at the repo root). This mirrors the
production Caddy reverse proxy (#160): the SPA only ever talks to its own
origin, so every URL in the app is relative. The one exception to
"one build works in every environment" is `VITE_AUTH_MODE`, which is baked
in at build time — a production build must set it explicitly (or it moves to
runtime config when #83 lands).

Auth defaults to **mock mode** (`VITE_AUTH_MODE=mock`) until the interactive
OIDC flow exists (backend AU-02, frontend #83): the Sign in button creates a
fake session; the real `oidc-client-ts` implementation sits behind the same
`AuthClient` seam in `src/lib/auth/`.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `build` / `preview` | Vite |
| `npm test` / `test:watch` / `test:cov` | Vitest (jsdom + Testing Library + MSW) |
| `npm run lint` / `lint:fix` | ESLint (own flat config — the root config ignores this app) |
| `npm run format` / `format:check` | Prettier (shares the repo root `.prettierrc`) |
| `npm run types:spec` | Regenerate `src/lib/api/types.gen.ts` from `docs/openapi.yaml` |
| `npm run types:live` | Regenerate from a running API's `/api/docs/json` |

The `types:*` scripts run `openapi-typescript` via pinned `npx` rather than a
devDependency because it peer-requires TypeScript ^5 while this app is on 6.

## Structure

```
src/
  routes/        route tree (createBrowserRouter data mode) + auth guard
  layouts/       RootLayout (providers) · AppShell (sidebar/header) · TenantLayout (tabs)
  pages/         one file per route; placeholders reference their tracking issue
  lib/api/       axios client (Bearer + 401 single-flight refresh), generated
                 types, per-resource modules, TanStack Query hooks
  lib/auth/      AuthClient seam: mock (default) and oidc (completed by #83)
  components/ui/ shadcn-managed primitives (add via `npx shadcn add <name>`)
  test/          Vitest setup + MSW handlers
```

Conventions worth knowing:

- Test files are `*.test.ts(x)` (never `*.spec.ts` — the root Jest config would
  pick those up).
- The API rejects unknown body fields (`forbidNonWhitelisted`); never send
  extra properties.
- List responses are normalized by `lib/api/pagination.ts` to tolerate both the
  spec's `{ data, pagination }` envelope and today's bare arrays.
- Endpoint paths live only in `lib/api/resources/*` — the implemented API is
  flat while the spec nests under `/tenants/{id}/…`; convergence should touch
  only those modules.

[#82]: https://github.com/bcgov/digital-trust-common-service/issues/82
