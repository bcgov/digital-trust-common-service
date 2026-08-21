---
applyTo: '**/*.spec.ts,**/*.integration-spec.ts,**/*.e2e-spec.ts,apps/*/test/**'
description: Unit, integration, and e2e test tiers, setup requirements, and mocking patterns.
---

# Testing

Three tiers, three configs. Put a test in the cheapest tier that can prove the behaviour.

| Tier | Config | Pattern | Location |
| --- | --- | --- | --- |
| Unit | `jest` key in `package.json` | `*.spec.ts` | co-located with the source |
| Integration | `apps/digital-trust-common-service/test/jest-integration.json` | `*.integration-spec.ts` | co-located with the source |
| E2E | `apps/digital-trust-common-service/test/jest-e2e.json` | `*.e2e-spec.ts` | `apps/digital-trust-common-service/test/` |

```bash
npm test                                                             # unit
docker compose --profile test up -d db-test migrate-test seed-test   # Postgres on :5433
npm run test:integration
npm run build && npm run migrate:up && npm run test:e2e
docker compose --profile test down -v
```

There are no testcontainers — the docker-compose `test` profile is the database. Integration and e2e
run with `maxWorkers: 1` against a shared database, so each test must create and clean up its own
rows and must not assume an empty table.

## Patterns

- Build the module with `Test.createTestingModule({ ... })`.
- Mock collaborators with plain object literals of `jest.fn()` injected via
  `{ provide: Thing, useValue: mock }`. There is no `@golevelup/ts-jest` or `createMock` helper.
- Guarded controllers use `.overrideGuard(JwtGuard).useValue({ canActivate: () => true })` — see
  `admin/admin-operations.controller.spec.ts`.
- Reuse the shared doubles from `@app/credential-ports/testing`: `MockAdapter` (configurable
  success/delayed/failure with `getCalls()` and `reset()`), `StubAdapter`, and the
  `createTestTenant` / `createTestUser` / `createTestClient` / `createTestCredDef` /
  `createFullTenantSetup` factories.
- E2E and integration bootstrap through `configureApp()`, so they exercise production routing.
  `openid-client` is mocked in `test/jest-e2e-setup.ts` to avoid outbound IdP calls.
- Cover tenant isolation explicitly: for any tenant-scoped query, assert that another tenant's data
  is not returned.

## Constraints

- Adding an ESM-only dependency means updating `transformIgnorePatterns` in **all three** configs
  (`package.json`, `jest-integration.json`, `jest-e2e.json`), which are currently identical.
- A new `@app/*` alias must be added to the `moduleNameMapper` of all three configs, which currently
  agree — keep them in sync.
- Spec files relax `no-explicit-any` and the `no-unsafe-*` rules. Do not carry those habits into
  `src`.
- Integration defaults (`DB_PORT=5433`, `dc_common_service_test`, encryption key path) are set in
  `test/jest-integration-setup.ts` in Node rather than the shell — add new defaults there.
