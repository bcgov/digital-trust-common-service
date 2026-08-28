import { z } from 'zod';

// All URLs in the app are relative (same-origin via dev/Caddy proxy), so the
// only runtime switches are ones that change app behavior, not addresses.
const envSchema = z.object({
  // mock: fake local login, no backend required
  // oidc: real PKCE flow against this origin's /oidc provider
  // A blank `VITE_AUTH_MODE=` line yields '' (not undefined), which must fall
  // back to the default rather than fail the enum and blank the whole app.
  VITE_AUTH_MODE: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['mock', 'oidc']).default('mock'),
  ),

  // client_id of the SPA's public (PKCE) OIDC client. Well-known rather than
  // generated, so one build works against any environment that registers a
  // client under this id — the dev seed registers exactly this one.
  VITE_OIDC_CLIENT_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().default('dtsc-ui'),
  ),

  // Scopes requested at sign-in. The default is the set every role holds:
  // `readonly` users carry no API scopes, and the provider's interaction
  // handler rejects (rather than trims) a request for scopes the user's role
  // lacks — so adding e.g. `tenants:admin` here locks those users out.
  VITE_OIDC_SCOPES: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().default('openid profile email tenant offline_access'),
  ),
});

export const env = envSchema.parse(import.meta.env);
