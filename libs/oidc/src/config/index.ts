/**
 * Narrow entrypoint for OIDC configuration.
 *
 * The package barrel (`@app/oidc`) pulls in `OidcModule`, and with it
 * `oidc-provider` and `jose` — both ESM-only, so importing it from app code
 * drags them into every test that touches that code. Consumers that only
 * need configuration import `@app/oidc/config` instead, which reaches no
 * further than `ConfigModule`.
 */
export { OidcConfigModule } from '../oidc-config.module';
export { OidcConfigService } from '../oidc-config.service';
export type { OidcConfig } from '../oidc-config.service';
