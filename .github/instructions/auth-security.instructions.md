---
applyTo: 'libs/auth/**,libs/oidc/**,apps/**/oauth-client/**,apps/**/connector-credential/**,apps/**/common/crypto/**'
description: Auth guards, scopes, OIDC provider customisations, and cryptographic invariants.
---

# Auth, OIDC, and crypto

This is the highest-risk code in the repository. Changes here need a spec and a clear rationale, and
must never be made "to get a test passing".

## Guards

Custom guards in `libs/auth/src` — there is no Passport.

```ts
@ApiJwtAuth()
@Controller({ path: 'admin/operations', version: API_VERSION })
@RequireRoles(PLATFORM_ADMIN_ROLE)
@UseGuards(JwtGuard, ScopeGuard)
```

- Order matters: `ScopeGuard` returns 401 when `request.auth` is missing, treating an absent context
  as an authentication failure. It must run after `JwtGuard`.
- `JwtGuard` validates app-issued JWTs against JWKS via `JwtValidationService` and `JwksCacheService`.
- `TenantGuard` is still a stub that throws `NotImplementedException`. Until it lands, tenant checks
  stay explicit in services and repositories — do not assume a guard is protecting you.
- `platform-admin` is a JWT **role**, not a scope, and short-circuits both guards.
- Read the caller with `@CurrentAuth()` and declare requirements with `@RequireScopes(...)` /
  `@RequireRoles(...)`. Never parse the `Authorization` header by hand.

## Scopes

The catalog lives in `libs/auth/src/constants/scopes.constants.ts` and is seeded into `role_scope` by
`libs/database/src/migrations/000013_create-role-scopes.ts`. A new scope needs all three of:

1. the constant,
2. a migration granting it to the right roles,
3. inclusion in the `OIDC_SCOPES` server allowlist — a client scope outside the allowlist fails token
   issuance.

## Cryptographic invariants

Do not change any of these without an explicit migration plan for existing data:

- **Client secrets** are argon2 hashes in `oauth_client.client_secret_hash`. The `oidc-provider`
  default plaintext `compareClientSecret` is deliberately overridden with argon2 verification. The
  full secret is shown once at registration and never stored or logged.
- **Connector credentials** use AES-256-GCM in `common/crypto/encryption.service.ts`. The stored
  layout is exactly `[12-byte IV][16-byte auth tag][ciphertext]` with `keyVersion` persisted
  alongside. Changing lengths, order, or the algorithm corrupts every existing row.
- **Encryption keys** load from `CONNECTOR_ENCRYPTION_KEYS_PATH` as
  `{ currentVersion, keys: { "1": "<64 hex chars>" } }` and support versioned rotation via
  `requiresRotation()`.
- **OIDC signing keys** are RS256 JWKS from `OIDC_KEYS_PATH`, auto-generated in development and
  required in production. See `docs/OIDC-KEY-ROTATION.md`.
- **PKCE is required for every client**, which is stricter than RFC 7636. Resource Indicators
  (RFC 8707) are enabled. Access tokens live 5 minutes, refresh tokens 8 hours with rotation.
- `OIDC_COOKIE_KEYS` is an ordered list: the first key signs, the rest verify.

## Handling secrets

Never log or return tokens, client secrets, key material, or decrypted connector credentials — not in
error messages, not in audit payloads, not in test fixtures. Sample keys belong in `config/` fixtures
or the chart's `ci/placeholder-oidc-keys.json`, never in source or values files.

`libs/oidc` depends on the application only through ports (`OidcClientLookupPort`). Keep it that way:
new application coupling goes behind a port and an adapter.
