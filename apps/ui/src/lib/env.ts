import { z } from 'zod';

// Build-time switches only. Vite inlines VITE_* values into the bundle, so
// nothing here may differ between deployments of one image — settings that do
// are read at runtime from /config.json instead (see config.ts). All URLs in
// the app are relative (same-origin via dev/Caddy proxy), so there are no
// addresses here either.
const envSchema = z.object({
  // mock: fake local login, no backend required
  // oidc: real PKCE flow against this origin's /oidc provider
  // A build variant rather than configuration: the inlined value fixes the
  // selection at build time, so no runtime input can flip a hosted image to
  // mock login. (The mock module remains as dead code in an oidc bundle;
  // oidc-client-ts is a lazy chunk a mock build never fetches.)
  // A blank `VITE_AUTH_MODE=` line yields '' (not undefined), which must fall
  // back to the default rather than fail the enum and blank the whole app.
  VITE_AUTH_MODE: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['mock', 'oidc']).default('mock'),
  ),
});

export const env = envSchema.parse(import.meta.env);
