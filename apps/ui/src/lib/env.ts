import { z } from 'zod';

// All URLs in the app are relative (same-origin via dev/Caddy proxy), so the
// only runtime switches are ones that change app behavior, not addresses.
const envSchema = z.object({
  // mock: fake local login until the interactive OIDC flow exists (#83 / AU-02)
  // A blank `VITE_AUTH_MODE=` line yields '' (not undefined), which must fall
  // back to the default rather than fail the enum and blank the whole app.
  VITE_AUTH_MODE: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['mock', 'oidc']).default('mock'),
  ),
});

export const env = envSchema.parse(import.meta.env);
