# Developer Guide - Digital Credential Common Service

This guide covers local development setup, running the application, and managing database migrations.

## Prerequisites

- **Node.js**: v22.12.0 or higher
- **npm**: Latest stable version
- **Docker** and **Docker Compose**: For database and containerized development
- **PostgreSQL**: v18.4 (or use Docker)

## Environment Setup

### 1. Clone and Install Dependencies

```bash
# Install project dependencies
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and update values as needed:

```bash
cp .env.example .env
```

**Key environment variables:**

```env
PORT=3000                          # Application port
NODE_ENV=development               # Environment (development/production)

# Database Configuration
DB_HOST=localhost                  # Database host (localhost or db for Docker)
DB_PORT=5432                       # PostgreSQL default port
DB_USERNAME=postgres               # Database user
DB_PASSWORD=postgres               # Database password
DB_NAME=dc_common_service          # Database name
DB_LOGGING=false                   # Enable/disable SQL query logging

# Database SSL (optional)
DB_SSL=false                       # Enable SSL connection
# DB_SSL_REJECT_UNAUTHORIZED=true
# DB_SSL_CA=/etc/postgres/certs/ca.crt

# Encryption Configuration
CONNECTOR_ENCRYPTION_KEYS_PATH='./config/encryption-keys.json'  # Path to encryption keys
```

### 3. Encryption Keys Configuration

The application uses AES-256-GCM encryption to protect sensitive data. Encryption keys are managed via the `CONNECTOR_ENCRYPTION_KEYS_PATH` environment variable, which points to a JSON configuration file.

**Encryption keys file format** (`config/encryption-keys.json`):

```json
{
  "currentVersion": 1,
  "keys": {
    "1": "1111111111111111111111111111111111111111111111111111111111111111"
  }
}
```

- **currentVersion**: The active key version used for new encryptions
- **keys**: A map of version numbers to hex-encoded 256-bit (64-character) keys

**Key rotation workflow:**

1. Generate a new encryption key (64 hex characters = 32 bytes)
2. Add it to the `keys` map with a new version number
3. Update `currentVersion` to the new version number
4. The application will automatically use the new key for new encryptions
5. Existing data encrypted with old keys can still be decrypted for key rotation purposes

**Development vs. Production:**

- **Development**: Use the provided `config/encryption-keys.json` with default test keys
- **Production**: Generate strong random keys and store securely (e.g., in a secrets manager)

### 4. Upstream OIDC Federation Configuration

The application supports upstream OIDC federation with Keycloak using the `openid-client` library. This library **strictly enforces HTTPS** connections for all OIDC discovery and token endpoints.

For local development, this repo uses **Caddy** with locally trusted TLS as a
same-origin front door that mirrors the production topology (SPA + `/oidc` +
`/api` on one origin):

- `https://app.localhost` -> the whole app: `/api/*`, `/oidc/*` and `/health/*`
  go to the local API on port `3000`; everything else goes to the Vite dev
  server on port `5173` (see [Serving the UI through Caddy](#serving-the-ui-through-caddy))
- `https://keycloak.localhost` -> Keycloak in Docker on port `8080`

> **Migrating from `oidc.localhost`** (renamed in #181): the checked-in realm
> only imports on first Keycloak start, so existing local stacks keep the old
> redirect URIs. Either reset just the Keycloak services and volume:
>
> ```bash
> docker compose --profile dev rm -sf keycloak keycloak-db
> docker volume rm $(docker volume ls -q --filter name=keycloak-db-data)
> ```
>
> (avoid `docker compose down -v` here — it removes *every* project volume,
> including your Postgres data and the Caddy CA) — or update the
> `dtsc-oidc-provider` client's redirect URIs/web origins in the admin
> console. Also set `OIDC_ISSUER=https://app.localhost/oidc` in your `.env`,
> and on macOS/Windows replace the `oidc.localhost` hosts entry with
> `app.localhost`.

#### Start the local HTTPS stack

Bring up the infrastructure services (the `app` service has no profile, so a
bare `docker compose --profile dev up` starts the containerized API too and
binds port `3000` — use the targeted list below when running the API on the
host):

```bash
# infra only — API and UI run on the host (default workflow)
docker compose --profile dev up -d db caddy keycloak

# or everything containerized, including the app on :3000
docker compose --profile dev up
```

#### Export and trust the Caddy local CA

Caddy issues its own local development certificates. Export its root CA certificate from the running container:

```bash
docker compose cp \
  caddy:/data/caddy/pki/authorities/local/root.crt \
  ./caddy/root.crt
```

Install that certificate into your system trust store so browsers and other local tooling trust `*.localhost` served by Caddy:

```bash
# Linux
sudo cp ./caddy/root.crt /usr/local/share/ca-certificates/caddy-local.crt
sudo update-ca-certificates

# macOS
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain ./caddy/root.crt
```

```powershell
# Windows (admin PowerShell)
Import-Certificate -FilePath .\caddy\root.crt -CertStoreLocation Cert:\LocalMachine\Root
```

Note: recreating the `caddy_data` volume (e.g. `docker compose down -v`) generates a new CA — re-export and re-trust the cert afterwards.

#### Hosts entries (macOS and Windows)

Browsers resolve `*.localhost` subdomains themselves, but the OS resolver on
macOS and Windows does not — Node fails with `getaddrinfo ENOTFOUND
keycloak.localhost` during upstream federation calls. Add hosts entries
(most Linux distros resolve `*.localhost` natively and can skip this):

```bash
# macOS
echo "127.0.0.1 app.localhost keycloak.localhost" | sudo tee -a /etc/hosts
```

```powershell
# Windows (admin PowerShell)
Add-Content C:\Windows\System32\drivers\etc\hosts "`n127.0.0.1 app.localhost", "127.0.0.1 keycloak.localhost"
```

#### Configure Node.js to trust the local CA

Node does not automatically use your OS trust store in every setup, so local OIDC calls should also trust the exported certificate explicitly.

Set this in your `.env` file:

```env
NODE_EXTRA_CA_CERTS="$PWD/caddy/root.crt"
```

This matches the default shown in `.env.example` and allows the app to call `https://keycloak.localhost` successfully during upstream federation flows.

#### Configure Keycloak Endpoint

Update **`config/upstream-identity-federation.json`** to point at the local Keycloak issuer exposed by Caddy (realm and client as defined in the checked-in `keycloak/config/realm.json`):

```json
{
  "url": "https://keycloak.localhost/realms/digital-trust-common-service",
  "clientId": "dtsc-oidc-provider",
  "clientSecret": "my-secret"
}
```

#### Configure Docker Compose

The local compose file already sets the Keycloak hostname correctly:

```yaml
environment:
  - KC_HOSTNAME=https://keycloak.localhost
```

The checked-in **`keycloak/config/realm.json`** already uses the local front-door hostname for redirect URIs:

```json
{
  "clientId": "dtsc-oidc-provider",
  "redirectUris": ["https://app.localhost/*"],
  "webOrigins": ["https://app.localhost"]
}
```

#### Configure OIDC Provider Issuer

Set the **`OIDC_ISSUER`** environment variable to the local Caddy endpoint for the app's OIDC provider:

```env
OIDC_ISSUER=https://app.localhost/oidc
```

This URL is used by Keycloak clients to discover the OIDC provider configuration and validate tokens.

**Important**: The local CA certificate must be trusted both by your system and by Node via `NODE_EXTRA_CA_CERTS`, or OIDC discovery/token requests will fail with TLS errors.

#### Serving the UI through Caddy

`https://app.localhost` serves the SPA and the API on one HTTPS origin — the
local twin of the production Caddy config (#160) and a prerequisite for the
interactive PKCE flow (#83), which needs the SPA, `/oidc` and cookies on the
same origin.

Caddy proxies non-API paths to a Vite dev server on port `5173`. Run it either
way:

```bash
# Default workflow: on the host
cd apps/ui && npm run dev

# Or containerized (behind the `ui` profile) — convenience only: first start
# runs `npm ci`, and hot reload isn't guaranteed across bind mounts. For
# actual hot reload UI development, run the dev server on the host.
docker compose --profile ui up ui
```

Both publish port `5173`, so Caddy reaches the dev server at
`host.docker.internal:5173` in either case. Once the dev stack
(`docker compose --profile dev up -d db caddy keycloak`) and a dev server are
running, open
`https://app.localhost` — HMR works through the proxy, and `/api`, `/oidc` and
`/health` hit the API without any CORS or cross-site cookie concerns.

## Running the Application

### Option 1: Docker Compose (Recommended for Development)

Start all services (app, database, and migrations) with one command:

```bash
docker compose up
```

This will:
- Start PostgreSQL database
- Run database migrations automatically
- Start the application server on http://localhost:3000

**Useful commands:**
```bash
# Stop all services
docker compose down

# View logs
docker compose logs -f app

# Rebuild containers
docker compose up --build
```

### Option 2: Local Development (npm)

For faster development iterations, run locally with a separate database:

#### Start Database

```bash
# Using Docker for just the database
docker compose up db

# Or configure DB_HOST to an external PostgreSQL instance
```

#### Start Application

```bash
# Development mode with hot reload
npm run start:dev

# Production mode
npm run start:prod
```

The application will be available at http://localhost:3000

## Database Migrations

### Create a New Migration

```bash
npm run migration:create
```

This creates a new migration file in `libs/database/src/migrations/` following the naming convention: `XXXXXX_description.ts`

### Run Migrations (Up)

```bash
# After building the project
npm run build
npm run migrate:up
```

**In Docker**: Migrations run automatically when containers start. To re-run:
```bash
docker compose up migrate
```

### Rollback Last Migration (Down)

```bash
npm run build
npm run migrate:down
```

## Development Seed Data (IN-11)

After migrations, load idempotent demo data for local UI/API development:

```bash
npm run seed
```

Or with Docker Compose (runs migrate, then seed):

```bash
docker compose up seed
```

To seed automatically when the application starts, set in `.env`:

```env
SEED_ON_START=true
```

`SEED_ON_START` is ignored when `NODE_ENV=production` unless you also set `SEED_ALLOW_PRODUCTION=true`.

**What gets seeded**

| Resource | Details |
|----------|---------|
| Tenants | `acme-corp`, `test-org` (active), `suspended-co` (suspended) |
| Users | owner / admin / member per tenant |
| Connectors | Mock Traction endpoint per tenant |
| Credential defs | Person credential, Employee badge (active tenants) |
| Issuance profiles | Published `person-credential/1.0`, draft `employee-badge/1.0` |
| Verification profile | Published `identity-check/1.0` with age predicate |
| OAuth clients | One per tenant; new clients use secret `dev-seed-client-secret` |
| Connections | Five states per active tenant |
| Operations | pending, completed, failed per active tenant |

Re-running the seed updates existing rows keyed by slug, external IDs, and profile name/version — it does not create duplicates.

## Authorization scope catalog (AU-04)

The canonical OAuth scope names live in `@app/auth` (`libs/auth/src/constants/scopes.constants.ts`) and are seeded into the `role_scope` table by migration `000013_create-role-scopes`.

### Scope levels

| Level | Scopes |
|-------|--------|
| **Level 1 — tenant superuser** | `tenants:admin` (implicitly grants all Level 2 + Level 3 scopes) |
| **Level 2 — domain operations** | `credentials:offer`, `credentials:verify`, `credentials:hold`, `credentials:revoke`, `connections:manage`, `profiles:manage`, `users:manage`, `clients:manage` |
| **Level 3 — read-only** | `logs:read`, `audit:read` |

### Role → scope seed (`role_scope` table)

| Role | Scopes |
|------|--------|
| `owner` | `tenants:admin` |
| `admin` | all Level 2 + Level 3 scopes (including `credentials:hold` / `credentials:revoke`) |
| `member` | `credentials:offer`, `credentials:verify` |
| `readonly` | _(none — GET endpoints that require no specific scope)_ |

`platform-admin` is **not** a scope. It is a JWT **role** claim that bypasses `ScopeGuard` and `TenantGuard`. Until interactive user login lands (AU-02), machine clients may carry `platform-admin` via the `oauth_client.roles` column.

**Setting `oauth_client.roles` for platform-admin machine clients:**

1. Prefer the OAuth client API: `POST /api/v1/oauth-clients` with `"roles": ["platform-admin"]`, or `PATCH /api/v1/oauth-clients/:id` with the same field. Responses include `roles`.
2. Tokens issued via `client_credentials` for that client include a `roles` claim, which `ScopeGuard` uses (e.g. for `GET /admin/operations/stats`).

**User-token scope resolution:** the `role_scope` seed is consumed by `ScopeGuard` indirectly (scopes must appear on the JWT). Mapping `tenant_user.role` → `role_scope` → JWT `scope` at issuance is deferred to **[AU-02 #35](https://github.com/bcgov/digital-trust-common-service/issues/35)** (interactive login + `extraTokenClaims`). `RoleScopeRepository` is injectable for that work. Client-credentials tokens continue to take scopes from `oauth_client.scopes` at registration.

### Migration from placeholder scopes

AU-04 replaces early placeholder scope names (`read:credentials`, `write:credentials`, `read:connections`, `write:connections`) with the architecture catalog above. After upgrading:

1. Run migrations (`000013_create-role-scopes`).
2. Update `OIDC_SCOPES` in `.env` if you override the default allowlist.
3. Re-seed or update existing `oauth_client.scopes` rows to use the new names — clients registered with placeholder scopes will fail token requests until updated.

The server-wide allowlist is configured via `OIDC_SCOPES` (see `.env.example`). Every scope granted to an `oauth_client` must appear in that allowlist.

## Role → scope overrides (AU-07)

The `role_scope` seed above is the platform default. A tenant can replace the
scopes of a role for itself; overrides live in `tenant_role_scope`
(migration `000019_create-tenant-role-scope`) and are resolved at token
issuance, so they reach the JWT `scope` claim.

### Endpoints

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/v1/scopes` | Any valid JWT |
| `GET` | `/api/v1/roles` | Any valid JWT — platform defaults |
| `GET` | `/api/v1/tenants/:tenantId/roles` | Any valid JWT for that tenant — effective mapping |
| `PATCH` | `/api/v1/tenants/:tenantId/roles/:role/scopes` | `tenants:admin` |
| `DELETE` | `/api/v1/tenants/:tenantId/roles/:role/scopes` | `tenants:admin` |

The two catalog `GET`s require authentication but no scope. "Public
information" here means non-secret, not anonymous: serving it unauthenticated
publishes the platform's full capability taxonomy and adds pre-auth surface
that has no rate limiting in front of it yet (AG-03 #77).

Writes require `tenants:admin` rather than `users:manage`. `admin` holds
`users:manage`, so guarding with it would let an admin grant themselves any
scope.

A caller may not grant a scope it does not itself hold. This is a no-op while
the route requires `tenants:admin` — which expands to everything — but it is
the invariant that keeps the endpoint safe if TM-02 ever delegates role
management to a lesser principal.

Two things about how it is applied:

- It runs on the **resulting** scopes, inside the write transaction, so it
  covers `DELETE` as well as `PATCH`. The platform default can be wider than
  the override it replaces, so checking only the submitted body would leave
  reset as a way around the check: a principal that cannot raise a role to the
  default could simply reset it there instead.
- `platform-admin` is exempt. `ScopeGuard` admits it on the role claim alone,
  so its token legitimately carries no tenant scopes, and applying the check
  would reject every non-empty write from a principal the guards already trust
  above the tenant.

### Absent row vs. empty array

This is the easiest thing to get wrong. In the global `role_scope` table,
"no rows for a role" means the role has no scopes — that is how `readonly` is
represented. In `tenant_role_scope` the semantics are deliberately different:

| State | Meaning |
|-------|---------|
| No row for `(tenant_id, role)` | Inherit the platform default |
| Row with `scopes = '{}'` | The role has been deliberately stripped to no scopes |

`readonly` legitimately has zero scopes, so an empty array cannot double as
"reset". `PATCH` always writes a row; `DELETE` removes it. That is why reset is
a separate verb rather than `PATCH` with `scopes: []`.

`GET /tenants/:tenantId/roles` reports `source: "default" | "override"` per
role so a client can show what has been customised.

### Hierarchy validation

`owner > admin > member > readonly`. Every role must be a subset of the one
above it. Two things about how this is checked:

- It runs on **expanded** scopes. `owner` holds only `tenants:admin`, which
  `ScopeAuthorizationService.expandEffectiveScopes` turns into every scope, so
  a raw set comparison reports the seeded defaults as invalid.
- It runs across the **whole mapping**, not just the edited role. Narrowing
  `admin` alone would otherwise leave `member` holding scopes its parent lacks.

Violations are rejected with `400` naming the offending role and scopes. They
are not cascade-pruned: one call quietly revoking privileges from roles the
caller never named is a surprising side effect, and the audit entry would not
reflect what the caller asked for. A client that wants the cascade can read the
400 and issue the second call explicitly.

### Narrowing forces a logout

Removing a scope from a role deletes every OIDC session, grant, and token
belonging to the tenant's active users in that role.

This is not defensive over-reach. The `scope` claim comes from the
oidc-provider Grant persisted at login, and oidc-provider does not re-save the
Grant when a refresh token rotates (see `libs/oidc/src/oidc-config.service.ts`).
A user's scopes are therefore frozen for the entire refresh chain — days, in
practice — so without revocation an admin who "removed" a permission would find
it still live long after the fact.

Widening needs no action and applies at the next login.

The write, the revocation, and the audit entry share one transaction, which
begins by taking `pg_advisory_xact_lock` on the tenant. The lock is what makes
this safe at `replicaCount: 3`: validation reads the whole mapping, decides,
then writes, so two concurrent writes to different roles could otherwise each
pass against a stale snapshot and commit a combined state that violates the
hierarchy. Row locks cannot close it, because "inherit the default" is the
*absence* of a row and `FOR UPDATE` has nothing to lock.

The advisory lock serializes writers only — nothing on the login path takes
it — so a login that read the old, wider mapping can save its grant after the
in-transaction delete has already passed over it. The write therefore sweeps a
second time after commit, once the new mapping is visible everywhere, and
audits anything that sweep catches as a `revoke`.

That shrinks the window rather than closing it: a login that read the old
mapping before commit can still save after the sweep. Closing it fully means
holding a shared lock across the grant write, which is not reachable today —
oidc-provider saves grants through its own adapter connection, not an
`EntityManager` the write transaction could enlist, so a shared lock taken on
our connection would not cover the insert that matters.

### Not cached

Override resolution hits the database on each login, and should stay that way.
There is no cross-replica invalidation bus, so a TTL cache would leave other
replicas handing out revoked scopes until it expired. If profiling ever demands
one, it needs explicit invalidation (`LISTEN`/`NOTIFY`), not a bare TTL.

### Auditing

The controller carries `@SkipAutoAudit()` and the service writes its own entry
inside the write transaction. This is not an opt-out:
`AuditAutoInterceptor.resolveResourceId` reads `params.id` only, so it silently
drops routes keyed on `:role` (#192). Writing directly also captures the
revoked-session count, which the interceptor cannot see.

Two details worth preserving:

- `PATCH` records `AuditAction.UPDATE` and `DELETE` records
  `AuditAction.DELETE`, even though both run through the same write path.
  Flattening them would leave consumers unable to distinguish an override
  replacement from its removal.
- The actor type follows `AuthContext.tokenType`, so a `client_credentials`
  caller is recorded as `AuditActorType.CLIENT` rather than a user.
- A write that changes nothing writes no entry, so the table stays a change
  log. "Changes nothing" compares the source as well as the scope list: pinning
  a role to scopes identical to the current default still flips it from inherit
  to override, which is a real change and is recorded.

`audit_log.resource_id` is `UUID NOT NULL` and a role name is not a UUID, so
the entry identifies the tenant and carries `role` in `metadata`.

### Client credentials are unaffected

Machine tokens take their scopes from `oauth_client.scopes` at registration
(AU-06 #39). Tenant role overrides do not touch them.

## TenantGuard (AU-05)

`TenantGuard` enforces tenant isolation after `JwtGuard` and `ScopeGuard`:

1. If the route has no `:tenantId` param (or it is blank), the guard is a **no-op** (safe on admin / mixed stacks).
2. `platform-admin` bypasses the check and may access any `:tenantId`.
3. Otherwise the JWT `tenant_id` claim must equal the route `:tenantId`.
4. On success, the resolved id is stamped on `request.tenantId` for downstream handlers (distinct from `request.auth.tenantId`, which is the JWT claim).

Missing `request.auth` (JwtGuard not run) → **401** `AUTHENTICATION_REQUIRED`.
Mismatch / missing `tenant_id` claim → **403** `{ error: { code: "TENANT_ACCESS_DENIED", required_tenant_id, token_tenant_id } }`.

**v1 is claim-match only.** Live `TenantUser` membership lookup (PE-02) is deferred until interactive user tokens (AU-02) / tenant switching (AU-09). Client-credentials tokens already carry a fixed `tenant_id` from `oauth_client`.

Product controllers are not all wired yet — rollout is tracked in **[AU-followup #165](https://github.com/bcgov/digital-trust-common-service/issues/165)**. Integration coverage uses ephemeral `/api/v1/integration/tenant-check/:tenantId` routes.

### Guard rollout gaps for #165

`TenantGuard` only reads **`params.tenantId`**. When wiring controllers, classify each route:

| Shape | Examples today | TenantGuard behavior | Rollout action |
|-------|----------------|----------------------|----------------|
| Path `:tenantId` | `tenants/:tenantId/audit-logs`, `…/tenant/:tenantId` | Enforced | Add `@UseGuards(JwtGuard, ScopeGuard, TenantGuard)` |
| Tenant UUID as `:id` | `GET/PUT/DELETE /tenants/:id` | **No-op** (param name is `id`) | Rename to `:tenantId`, or teach guard / use a dedicated platform-admin policy |
| Body-only `tenantId` | create connection / oauth-client / credential-definition / etc. | **No-op** | Prefer nested `/tenants/:tenantId/...` routes, or extend guard to read body (explicit follow-up) |
| Resource `:id` | `GET /connections/:id`, `PATCH /oauth-clients/:id` | **No-op** (`id` is the resource, not the tenant) | After load, assert `resource.tenantId === auth.tenantId` (service-layer or resource tenant check) — path param alone is insufficient |
| Admin / no tenant | `/admin/operations/stats` | No-op (correct) | `JwtGuard` + `ScopeGuard` / `@RequireRoles('platform-admin')` only |

Do **not** treat every `:id` as a tenant id — most are resource primary keys.

## JWT audience (AU-164)

App-issued access tokens carry a stable API `aud`, not the OIDC issuer URL:

- Default `JWT_AUDIENCE` / RFC 8707 default resource: `https://digital-trust-common-service`
- `JwtGuard` accepts **only** that audience
- Clients omit `resource` at `/oidc/token` for API tokens
- Downstream gateways (OB-07 Loki) request `resource=<absolute URI>` and must be listed in `JWT_ADDITIONAL_AUDIENCES` (e.g. `https://loki-gateway`). Those JWTs are rejected by `JwtGuard` by design.

`JWT_AUDIENCE` and extra resources must be absolute URIs without fragments (RFC 8707 / oidc-provider). Override via `.env` if needed; Helm `config.JWT_AUDIENCE` defaults to the same URI in every environment.

## Testing

### Run Unit Tests

```bash
# All tests
npm run test

# Watch mode
npm run test:watch

# With coverage
npm run test:cov
```

Unit tests are named `*.spec.ts` and co-located under `src/` in `apps/` or `libs/`.

### Run Integration Tests

```bash
npm run test:integration
```

Integration tests are named `*.integration-spec.ts` and co-located under
`apps/` or `libs/` (e.g.
`libs/credential-ports/src/testing/integration-smoke.integration-spec.ts`).
They're excluded from the unit `jest` run and given their own config
(`apps/digital-trust-common-service/test/jest-integration.json`).

By default `npm run test:integration` targets the local Docker Compose `test`
profile's isolated PostgreSQL database (`localhost:5433` /
`dc_common_service_test`), overridable via `DB_*` env vars. Start it first:

```bash
docker compose --profile test up -d db-test migrate-test seed-test
npm run test:integration
docker compose --profile test down -v
```

This starts `db-test` on port `5433`, runs migrations via `migrate-test`, and
applies the placeholder integration-test seed script (`libs/database/src/seeds/test-seed.sql`,
a marker table only — use `npm run seed` against a dev database for full demo data).

Note CI runs integration tests against a different PostgreSQL instance
(GitHub Actions `services: postgres` on `localhost:5432` /
`dc_common_service`) — check your `DB_*` variables if a test behaves
differently locally vs. in CI.

### Audit log partitions

The `audit_log` table is range-partitioned by month. Migration
`000007_create-audit-log-schema` creates the current UTC month plus the next
three months.

Rolling maintenance is handled by the `audit.partition-maintain` pg-boss
worker: it runs once on startup and on a daily cron (`AUDIT_PARTITION_CRON`,
default `0 3 * * *`), ensuring the current month plus
`AUDIT_PARTITION_MONTHS_AHEAD` (default `3`) exist via
`CREATE TABLE IF NOT EXISTS … PARTITION OF audit_log`.

Manual fallback (ops):

```sql
CREATE TABLE IF NOT EXISTS audit_log_YYYY_MM
  PARTITION OF audit_log
  FOR VALUES FROM ('YYYY-MM-01T00:00:00.000Z') TO ('YYYY-MM+1-01T00:00:00.000Z');
```

Dropping/archiving old partitions is out of scope until a retention policy is
defined.

### Run E2E Tests

```bash
npm run test:e2e
```

Requires database to be running. Typically used in CI/CD pipelines.

### Test Helpers

`@app/credential-ports` exports shared test doubles and fixtures for use in
any of the tiers above:

- `MockAdapter` — a functional in-memory `AgentAdapter` test double.
  Unlike the fail-closed `StubAdapter` (always rejects with
  `NotImplementedException`), it can run in `success`, `delayed`, or
  `failure` mode, persists state in memory, and records every call via
  `getCalls()`/`reset()`:

  ```ts
  import { ConnectorUnavailableError, MockAdapter } from '@app/credential-ports';

  const adapter = new MockAdapter();
  adapter.configure({
    mode: 'failure',
    failureError: new ConnectorUnavailableError('Traction offline'),
  });

  await expect(adapter.getExchange('missing-id')).rejects.toThrow(
    'Traction offline',
  );
  expect(adapter.getCalls('getExchange')).toHaveLength(1);
  ```

- Test data factories — `createTestTenant()`, `createTestUser()`,
  `createTestClient()`, `createTestCredDef()`, and `createFullTenantSetup()`
  (composes the above into a fully wired tenant fixture), each accepting
  optional overrides:

  ```ts
  import { createFullTenantSetup } from '@app/credential-ports';

  const setup = createFullTenantSetup({ tenant: { name: 'Docs Demo Tenant' } });
  expect(setup.owner.tenantId).toBe(setup.tenant.id);
  ```

## Code Quality

### Linting and Formatting

```bash
# Fix linting issues and format code
npm run lint

# Check linting without fixing (CI mode)
npm run lint:ci

# Format code with Prettier
npm run format
```

## Building

### Build for Production

```bash
npm run build
```

Output is generated in the `dist/` directory.

### Start Production Server

```bash
npm run start:prod
```

## Project Structure

```
├── apps/
│   └── digital-trust-common-service/          # Main application
│       ├── src/
│       │   ├── main.ts             # Application entry point
│       │   ├── app.module.ts       # Root module
│       │   ├── app.controller.ts   # Root controller
│       │   ├── health/             # Health check endpoints
│       │   ├── shutdown/           # Graceful shutdown
│       │   ├── jobs/               # Job processing
│       │   ├── tenants/            # Tenant management
│       │   └── tenant-users/       # Tenant user management
│       └── test/                   # E2E tests
├── libs/
│   ├── common/                     # Common utilities
│   ├── database/                   # Database configuration & migrations
│   ├── auth/                       # Authentication/Authorization
│   └── pg-boss/                    # Job queue service
├── docker-compose.yml              # Docker setup
├── package.json                    # Dependencies & scripts
└── .env.example                    # Example environment variables
```

## Frontend UI (apps/ui)

The React admin UI is a **standalone npm package** with its own lockfile and
toolchain — it is not part of the root install, the NestJS build, the root
ESLint config, or the root Jest run (all of which explicitly ignore it).

```bash
# Terminal 1: backend (either way)
docker compose up
# or: npm run start:dev

# Terminal 2: frontend
cd apps/ui
npm install
npm run dev          # http://localhost:5173
```

The Vite dev server proxies `/api`, `/oidc` and `/health` to the backend
(`VITE_PROXY_TARGET` in `apps/ui/.env`, default `http://localhost:3000`),
mirroring the production Caddy reverse proxy — the SPA uses relative URLs only.
Sign-in runs in **mock mode** (`VITE_AUTH_MODE=mock`) until the interactive
OIDC flow lands (AU-02 / UI-02).

Checks (mirrored by the `ui` job in CI): `npm run lint`, `npm run format:check`,
`npm test`, `npm run build`. API types are generated from the OpenAPI spec via
`npm run types:spec` (or `types:live` against a running backend). See
`apps/ui/README.md` for structure and conventions.

## Useful Development Endpoints

- Health Check: `GET http://localhost:3000/health/live`
- API Documentation: Check `docs/openapi.yaml`

## Troubleshooting

### Database Connection Issues

1. Ensure PostgreSQL is running and accessible at configured host/port
2. Verify credentials in `.env` file match database setup
3. Check database exists: `DB_NAME=dc_common_service`

### Port Already in Use

```bash
# Change port in .env
PORT=3001

# Or kill process using port 3000
lsof -ti:3000 | xargs kill -9
```

### Docker Issues

```bash
# Clean up containers and volumes
docker compose down -v

# Rebuild everything
docker compose up --build
```

### Migration Failures

```bash
# Check current migration status
docker compose logs migrate

# Rollback to previous migration
npm run migrate:down

# Rebuild and try again
npm run build && npm run migrate:up
```



## Additional Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [TypeORM Documentation](https://typeorm.io/)
- [Docker Documentation](https://docs.docker.com/)
- Project Architecture: See `docs/ARCHITECTURE.md`
