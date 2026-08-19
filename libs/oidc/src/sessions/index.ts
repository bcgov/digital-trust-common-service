/**
 * Narrow entrypoint for account-scoped session queries.
 *
 * Mirrors `@app/oidc/config`: the package barrel (`@app/oidc`) pulls in
 * `OidcModule`, and with it `oidc-provider` and `jose` — both ESM-only, so
 * importing it from app code drags them into every test that touches that
 * code. Consumers that only need force-logout / session-count queries import
 * `@app/oidc/sessions`, which reaches no further than TypeORM.
 */
export { OidcAccountSessionModule } from '../oidc-account-session.module';
export { OidcAccountSessionRepository } from '../oidc-account-session.repository';
export type {
  AccountSession,
  DeletedModelCount,
} from '../oidc-account-session.repository';
