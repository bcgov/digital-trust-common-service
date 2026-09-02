# Digital Trust Common Service — UI

React admin/management interface for the Common Service (issue [#82]).
Standalone npm package inside the monorepo — it has its own `package.json`,
lockfile and toolchain, and is **not** part of the root NestJS build.

## Stack

React 19 · Vite 8 (+ React Compiler) · TypeScript 6 · React Router 8 (data mode,
route-level code splitting) · Tailwind CSS 4 · shadcn/ui · TanStack Query ·
axios · zod · Vitest + Testing Library + MSW.

Styling follows the BC Design System (#180): `@bcgov/design-tokens` mapped
onto shadcn's token layer in `src/index.css`, BC Sans as the app font
(self-hosted `@font-face` from `@bcgov/bc-sans`), and the official
`@bcgov/design-system-react-components` header behind the app boundary in
`src/components/bc-gov-header.tsx`. **BCDS-first is the standing direction**:
where the BCDS package provides a component, prefer it; the vendored shadcn
primitives fill the gaps it doesn't cover.

## Development

```bash
cd apps/ui
npm install
npm run dev          # http://localhost:5173
```

The dev server proxies `/api`, `/oidc` and `/health` to the API
(`VITE_PROXY_TARGET`, default `http://localhost:3000` — run the backend via
`docker compose up` or `npm run start:dev` at the repo root). This mirrors the
production Caddy reverse proxy: the SPA only ever talks to its own origin, so
every URL in the app is relative and one build works in every environment.
The one baked-in value is `VITE_AUTH_MODE`, a build variant rather than
configuration (it decides which auth client ships); hosted images are built
with `oidc`. Everything that differs between deployments is
[runtime configuration](#runtime-configuration).

### Same-origin HTTPS via Caddy (#181)

For flows that need the SPA, `/oidc` and cookies on one HTTPS origin (the
interactive PKCE flow), the Docker dev stack fronts everything at
`https://app.localhost`: Caddy sends `/api/*`, `/oidc/*` and `/health/*` to
the API on `:3000` and everything else to the Vite dev server on `:5173`.

```bash
# repo root: infra (db + caddy + keycloak). A bare `up` would also start the
# containerized API on :3000 — name the services you want when running the
# API on the host.
docker compose up -d db caddy keycloak

# dev server on the host (default) …
cd apps/ui && npm run dev

# … or containerized instead
docker compose --profile ui up ui
```

The containerized option is a convenience for running the stack without Node
on the host — first start runs `npm ci` (slow on bind mounts), and hot reload isn't guaranteed there (file events don't cross Windows bind mounts). For actual live-watching UI development, run the dev server on the host.

Then open `https://app.localhost` (see `docs/DEVELOPER.md` for trusting the
Caddy local CA). Plain `http://localhost:5173` still works for UI-only work.

## Runtime configuration

Settings that differ between deployments are read at startup from
`/config.json`, not from `VITE_*` variables — Vite inlines those into the
bundle, which is exactly what one-image-everywhere forbids.
`src/lib/config.ts` fetches and validates the file before anything renders; a
missing or invalid file is a full-page error rather than a silent fallback, so
a broken deployment says so instead of failing later on the provider's page.

| Key | Default | Purpose |
|---|---|---|
| `oidcClientId` | `dtsc-ui` | client_id the SPA presents to `/oidc`. Each environment registers a public client under this id on the provider side (the dev seed does it locally). |
| `oidcScopes` | `openid profile email tenant offline_access` | Scopes requested at sign-in — see the caveat under [Auth](#auth). |

Locally the file is `public/config.json`: the dev server serves it and the
build copies it into `dist/`, so the image ships the same defaults. The Helm
chart renders `frontend.config.*` into a ConfigMap and mounts it over that
copy (`/srv/config.json`), served with `Cache-Control: no-cache` so a change
reaches the next page load. To add a per-environment value: extend the schema
in `src/lib/config.ts`, add the default to `public/config.json` and to the
chart's `frontend.config`, then read it through `getAppConfig()`.

## Auth

Two implementations sit behind one `AuthClient` seam in `src/lib/auth/`,
selected by `VITE_AUTH_MODE`:

- **`mock` (default)** — the Sign in button creates a fake session in
  `sessionStorage`. No backend auth required, and `oidc-client-ts` never
  reaches the entry chunk (`oidc-auth` is imported on demand).
- **`oidc`** — real Authorization Code + PKCE against this origin's `/oidc`
  provider, which federates to Keycloak internally. The SPA never talks to
  Keycloak and never holds a client secret: it is registered as a public
  client (`dtsc-ui`).

In `oidc` mode the app **must** be reached at `https://app.localhost`, not
`http://localhost:5173` — the issuer in the discovery document points at the
Caddy origin, so the raw Vite origin would put authorize/token cross-origin
and drop the provider's session cookie.

One setting is load-bearing rather than optional (`docs/DEVELOPER.md` carries
the full reasoning): `oidcScopes` in the runtime config must stay within the
set every role holds. The provider rejects, rather than trims, a request for
scopes the user's role lacks, and `readonly` carries no API scopes at all.

The SPA sends no RFC 8707 `resource` parameter. It is the provider's
`useGrantedResource` that makes the access token an API-audience JWT rather
than a userinfo-only opaque token; a browser client cannot influence that from
its side, because oidc-client-ts puts `resource` on the authorize URL only and
the decision is made at the token endpoint.

Flow: `/login` → `/oidc/auth` → Keycloak → `/auth/callback` (a public route,
deliberately outside the guard — the redirect arrives before a session
exists) → the deep link the user was interrupted on, or `/tenants` otherwise.
Access tokens last 5 minutes; refresh is driven by the API client's 401
single-flight handler rather than a background timer.

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
  lib/auth/      AuthClient seam: mock (default) and oidc (PKCE, real provider)
  lib/config.ts  runtime config: fetches and validates /config.json before mount
  components/ui/ shadcn-managed primitives (add via `npx shadcn add <name>`)
  test/          Vitest setup + MSW handlers
public/
  config.json    runtime config defaults (served by Vite in dev, copied into dist/)
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
- Theming is a token bridge: `src/index.css` maps shadcn's theme variables
  (`--primary`, `--border`, …) onto `@bcgov/design-tokens` by `var()`
  reference. Style new work with the shadcn-side tokens (`bg-primary`,
  `text-muted-foreground`, …), not raw BCDS variables or hex values, and it
  inherits the BC look automatically. There is no dark mode — BCDS v5 is
  light-only (`dark:` utilities in vendored components are inert).
- Focus styling is global: a base `:focus-visible` rule in `index.css` applies
  the BC Gov outline (solid 2px active-blue, 2px offset). Don't add per-element
  focus rings.
- Updating vendored components: `npx shadcn add <name> --diff` to compare
  against upstream, then merge by hand — never `--overwrite` on customized
  files (stock files reintroduce soft focus rings and dark-mode styling;
  `src/test/design-system.test.ts` fails if a per-element focus ring slips
  back in, and also fails if a BCDS token referenced in `index.css` disappears
  from `@bcgov/design-tokens` after an upgrade).
- `@bcgov/*` packages are exact-pinned and upgraded together: the
  react-components bundle style-injects its own copy of the design tokens
  (plus all component CSS) at runtime, which wins the cascade over the
  `index.css` import — the same test fails if the pinned versions drift.
  That injection lands after our stylesheet in production builds but before
  it in dev, so any override of a `.bcds-*` class must out-specify the
  package rule, never rely on source order.

[#82]: https://github.com/bcgov/digital-trust-common-service/issues/82
