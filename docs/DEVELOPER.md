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

For local development, you need to use **ngrok** to expose your local services over HTTPS:

#### Install and Start ngrok

Create a ngrok configuration file at `~/.ngrok2/ngrok.yml` (or `~/Library/Application Support/ngrok/ngrok.yml` on macOS):

```yaml
authtoken: YOUR_NGROK_AUTH_TOKEN

tunnels:
  oidc-provider:
    addr: 3000
    proto: http
  keycloak:
    addr: 8080
    proto: http
```

Then start all tunnels with:

```bash
ngrok start --all
```

ngrok will provide URLs like `https://xxxx-xx-xxx-xx-xxx-x.ngrok.io` for each tunnel. Note the URLs assigned to `oidc-provider` and `keycloak`.

#### Configure Keycloak Endpoint

Update **`config/upstream-identity-federation.json`** with the ngrok URL for Keycloak:

```json
{
  "url": "https://YOUR_KEYCLOAK_NGROK_URL/realms/vc-common-service",
  "clientId": "vc-common-service",
  "clientSecret": "your-client-secret"
}
```

#### Configure Docker Compose

Update **`docker-compose.yml`** to use the ngrok URL for Keycloak:

```yaml
environment:
  - KC_HOSTNAME=https://YOUR_KEYCLOAK_NGROK_URL
```

Also update **`keycloak/config/realm.json`** to set client redirect URIs to your ngrok URL:

```json
{
  "clientId": "dtsc-oidc-provider",
  "redirectUris": [
    "https://YOUR_OIDC_PROVIDER_NGROK_URL/*", "https://YOUR_OIDC_PROVIDER_NGROK_URL/digital-trust/digital-trust-common-service/callback"
  ],
  "webOrigins": ["https://YOUR_OIDC_PROVIDER_NGROK_URL"],
}
```

#### Configure OIDC Provider Issuer

Set the **`OIDC_ISSUER`** environment variable to your ngrok endpoint for localhost:3000:

```env
OIDC_ISSUER=https://YOUR_OIDC_PROVIDER_NGROK_URL/oidc
```

This URL is used by Keycloak clients to discover the OIDC provider configuration and validate tokens.

**Important**: All client configurations in `keycloak/config/realm.json` that reference your OIDC provider must use the same ngrok endpoint URL.

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
