---
applyTo: 'apps/ui/**'
description: React/Vite UI development conventions, testing, API integration, and generated types.
---

# UI Instructions

The UI is a standalone npm package under `apps/ui`; it is not part of the root NestJS build.
Run UI commands from `apps/ui` with its own `package.json` and lockfile. Use the existing React 19,
Vite, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, axios, zod, Vitest, Testing Library, and
MSW toolchain rather than introducing parallel patterns.

## Validation

- Run `npm test` and `npm run lint` from `apps/ui` for UI changes.
- Run `npm run format:check` and `npm run build` when the change affects formatting or production
  bundling.
- UI tests use `*.test.ts` and `*.test.tsx`; do not use `*.spec.ts`, which the root Jest config picks
  up.

## API and Auth

- Keep API calls in `src/lib/api/resources/*`; do not scatter endpoint paths through components.
- Use relative URLs so the app works behind the same-origin Caddy/Vite proxy. Configure
  `VITE_PROXY_TARGET` only for the local development proxy.
- The API rejects unknown body fields; send only properties declared by the API contract.
- `VITE_AUTH_MODE` is build-time configuration. Preserve the existing `AuthClient` seam when changing
  authentication behavior and keep mock mode working until the real OIDC flow is complete.
- Settings that differ between deployments (the OIDC client id and scopes) are runtime configuration,
  not `VITE_*` variables: `public/config.json` locally, the chart's `frontend.config.*` when
  deployed, loaded by `src/lib/config.ts` before the app mounts. Add new per-environment values there.

## Generated Types

Regenerate API types with `npm run types:spec` or `npm run types:live` as appropriate. Do not hand-edit
`src/lib/api/types.gen.ts`.

## Copy and Translation

- Put user-facing text in `src/locales/en.json` and render it with `t()` from `useTranslation`, or
  `i18n.t` outside React. Use one catalog and do not wrap `t` in helpers.
- Keys are typed against the catalog; a missing key fails `tsc`. ESLint's `i18next/no-literal-string`
  rejects raw JSX text and user-facing attributes, but not strings passed to `notify()`, router state
  or announcements, so check those by hand.
- Format dates with `Intl.DateTimeFormat(i18n.language, …)`, not `toLocale*String()`.
- Zod messages use `error: () => i18n.t(…)` so they follow the current language.
- API errors are translated by code under `errors` in the catalog, falling back to the server's
  message. Only add codes whose server text is generic or technical.
- Tests run in `en` (`src/test/setup.ts`) and assert the English copy.
- Add every new key to both `en.json` and `fr.json`; `src/locales/locales.test.ts` fails if their keys
  differ. English is bundled and other catalogs load on first use from `src/locales/`.

## Components and Routes

Follow the existing shadcn/ui component conventions and route structure. Keep providers in
`src/layouts/RootLayout`, shared application chrome in `src/layouts/AppShell`, and tenant-scoped
navigation in `src/layouts/TenantLayout`. Add route-level pages under `src/pages` and register them
through the existing React Router data-mode route tree.

For same-origin HTTPS flows, preserve the local hostname contract documented in `apps/ui/README.md`
and `docs/DEVELOPER.md`: `https://app.localhost` fronts `/api`, `/oidc`, and `/health` through Caddy.
