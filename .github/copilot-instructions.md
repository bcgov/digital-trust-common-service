# Copilot instructions — digital-trust-common-service

Multi-tenant BC Gov digital trust service. NestJS 11 monorepo: one application
(`apps/digital-trust-common-service`) plus six libraries under `libs/`, backed by PostgreSQL 18 +
TypeORM, pg-boss for background jobs, and an in-app `oidc-provider` OIDC server.

Detailed rules load automatically per file type from `.github/instructions/`. Deeper background lives
in `docs/ARCHITECTURE.md` and `docs/DEVELOPER.md`.

## Commands

npm only (`package-lock.json`, `npm ci`). Node `>=22.12.0`.

| Task | Command |
| --- | --- |
| Build | `npm run build` |
| Lint (CI gate) | `npm run lint:ci` — `npm run lint` to autofix |
| Format | `npm run format` |
| Unit tests | `npm test` / `npm run test:cov` |
| Integration tests | `npm run test:integration` (needs the test DB, see below) |
| E2E tests | `npm run test:e2e` (needs `npm run build && npm run migrate:up`) |
| New migration | `npm run migration:create` |
| Apply migrations | `npm run build && npm run migrate:up` |
| Seed | `npm run seed` |
| Test DB | `docker compose --profile test up -d db-test migrate-test seed-test` |

`migrate:up` runs from `dist/` — build first or it applies stale migrations.

## Layout and imports

- `apps/digital-trust-common-service/src/<feature>/` — one flat folder per feature.
- `libs/{auth,common,credential-ports,database,oidc,pg-boss}` — shared libraries, each registered in
  `nest-cli.json` with its own `tsconfig.lib.json`.
- Import libraries through their barrel alias (`@app/auth`, `@app/database`, …), never by relative
  path into `libs/`. Aliases are declared in `tsconfig.json`.
- A new library needs its alias in `tsconfig.json`, a project entry in `nest-cli.json`, and a
  `moduleNameMapper` entry in all three jest configs.

## Non-negotiables

- **Tenant isolation.** Never remove, weaken, or skip a `tenantId` predicate. Isolation is enforced
  in application code only — there is no Postgres row-level security, so a missing filter is a
  cross-tenant data leak.
- **Migrations are immutable.** Never edit a migration already listed in
  `libs/database/src/data-source.ts`; add a new one. Never set `synchronize: true`.
- **Crypto is load-bearing.** Never weaken argon2 secret hashing, the AES-256-GCM stored envelope,
  the required-PKCE policy, or JWKS validation. See `.github/instructions/auth-security.instructions.md`.
- **No secrets in the repo.** No keys, tokens, passwords, or client secrets in code, values files,
  fixtures, tests, or logs.
- **Do not bypass CI gates.** No `--no-verify`, no blanket lint-rule disables, no skipped tests to go
  green.

## Style

Enforced by ESLint (type-aware, flat config) with Prettier as an error-level rule, so
`npm run lint:ci` is the source of truth.

- Explicit accessibility on every class member (`public constructor(...)`, `private readonly …`).
- No `any`; no floating promises.
- No `console` — use `private readonly logger = new Logger(MyClass.name)`.
- Imports alphabetised with a blank line between groups (`import/order`).
- Single quotes, trailing commas, semicolons, 80 columns, 2-space indent, LF.

## Architecture rules

- Controller → service → repository. Controllers stay thin, services hold business rules and throw
  Nest HTTP exceptions, repositories wrap `@InjectRepository`.
- Controllers must pass `version: API_VERSION` from `common/constants/api-version.constants.ts`.
  There is no `defaultVersion`, so omitting it silently serves the route unversioned.
- Global pipes, interceptors, filters, and prefixes belong in `app.config.ts`, not `main.ts` — tests
  call `configureApp()` so they exercise identical routing.
- DTO validation is class-validator + class-transformer under a strict global `ValidationPipe`
  (`whitelist`, `forbidNonWhitelisted`, `transform`): undeclared properties are rejected with a 400.

## Config propagation

Config is read with `ConfigService.get`/`getOrThrow` and there is **no env schema validation**, so a
missed deployment surface fails at runtime rather than at build time.

Adding, renaming, or removing an env var means updating all of these in the same change:

1. `.env.example` — with a comment and a sensible default.
2. `docker-compose.yml` — `app`, `migrate`, and `seed` read `.env`, but the `*-test` profile services
   use explicit `environment:` blocks that must be updated by hand.
3. `charts/digital-trust-common-service/values.yaml` — plus `values-dev.yaml`, `values-test.yaml`,
   `values-prod.yaml`, `values-pr.yaml`, and `ci/ci-values.yaml` wherever the value differs.
4. `templates/configmap.yaml` for plain values, `templates/secret.yaml` for sensitive ones.
5. **Both** `templates/deployment.yaml` and `templates/worker-deployment.yaml` — the worker is the one
   people forget. Check `templates/migration-job.yaml` too if migrations need the value.
6. `charts/digital-trust-common-service/tests/` — helm unittest assertions, when the key is asserted.
7. Regenerate the chart README with helm-docs and add a chart CHANGELOG entry.
8. `docs/DEVELOPER.md`, and `apps/digital-trust-common-service/test/jest-integration-setup.ts` if
   tests need a default.

Adding or changing a mounted path (`CONNECTOR_ENCRYPTION_KEYS_PATH`, `OIDC_KEYS_PATH`,
`UPSTREAM_IDENTITY_FEDERATION_CONFIG_PATH`, `NODE_EXTRA_CA_CERTS`) additionally means:

- `docker-compose.yml` `volumes:` for every service that reads it, plus the `config/` fixture.
- `Dockerfile`, if the path must exist in the image.
- `volumes`/`volumeMounts` in both deployment templates, plus the backing Secret or ConfigMap —
  follow `oidc-signing-secret.yaml` and `connector-encryption-secret.yaml`.
- The CI `--set-file` wiring where secrets are injected (for example `oidcSigning.keys`).

Sensitive values go through a Secret template with `--set-file` or external injection. Never commit
one into a `values-*.yaml`.

## Git and commits

Hard rules: never commit secrets; never rewrite history on `main` or a published release tag (no
amend, rebase, `push --force`, or `reset --hard`); never use `--no-verify`.

On your own feature or PR branch, amend, interactive rebase, and squash are encouraged to keep the
history reviewable. Prefer `git push --force-with-lease` over `--force`, and ask first if the branch
is shared.

Conventional Commits 1.0.0 — `<type>(<scope>): <subject>`:

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`, `perf`, `style`, `revert`.
- Scopes follow the repo: `auth`, `oidc`, `database`, `credential`, `tenant`, `audit`, `connector`,
  `oauth-client`, `role-scope`, `jobs`, `swagger`, `helm`, `ci`, `docs`, `deps`.
- Subject in the imperative, lowercase, no trailing period, 72 characters or fewer.
- Body explains why, not what. Footer carries `BREAKING CHANGE:` for API, schema, or chart breaks,
  the work-item code (`AU-01`, `AG-01`, …), and `Refs #<issue>`.
- Sign off with `git commit --signoff` (recommended, not enforced). It appends a
  `Signed-off-by:` trailer certifying the Developer Certificate of Origin, which is standard practice
  across BC Gov repositories.

Keep changesets self-contained:

- One logical change per commit, and each commit should build, lint, and test green on its own.
- Don't mix refactors with behaviour changes, or formatting churn with logic.
- Keep the migration, entity, repository, and specs for one schema change together; split unrelated
  schema changes apart.
- A chart change carries its helm-docs README regeneration and CHANGELOG entry in the same commit.
- Stage explicitly with `git add <paths>` — never `git add -A` or `git add .` — and never sweep up
  unrelated pre-existing working-tree changes. Surface those instead.

## Definition of done

1. `npm run lint:ci`, `npm run build`, and `npm test` all pass.
2. Specs added or extended for the changed behaviour.
3. Swagger decorators updated for any API surface change.
4. Config propagation checklist above satisfied.
5. `docs/` updated when behaviour, architecture, or developer workflow changes.

## Known gotchas

- Adding an ESM-only dependency requires updating `transformIgnorePatterns` in all three jest configs.
- Chart edits fail CI unless the chart README is regenerated with helm-docs.
- Node version signals disagree: `engines` says `>=22.12.0`, `.mise.toml` pins 24, CI uses 22.
- `TenantGuard` is still a stub, so tenant checks must stay explicit in services and repositories.
