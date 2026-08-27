import { z } from 'zod';

/**
 * Settings that differ between deployments, read at startup from
 * `/config.json` rather than inlined by Vite at build time — which is what
 * lets one image serve every environment. Locally the file is
 * `public/config.json`: the dev server serves it as-is and the build copies
 * it into `dist/`, so the image carries the same defaults. In Kubernetes the
 * chart renders `frontend.config.*` into a ConfigMap and mounts it over that
 * copy.
 *
 * `VITE_AUTH_MODE` stays build-time on purpose: it decides which code ships,
 * not how the shipped code is configured.
 */
const appConfigSchema = z.object({
  // client_id of the SPA's public (PKCE) OIDC client. Each environment
  // registers a client under the id it serves here; the dev seed registers
  // `dtsc-ui` locally.
  oidcClientId: z.string().min(1),

  // Scopes requested at sign-in. Keep to the set every role holds: `readonly`
  // users carry no API scopes, and the provider's interaction handler rejects
  // (rather than trims) a request for scopes the user's role lacks — so adding
  // e.g. `tenants:admin` here locks those users out.
  oidcScopes: z.string().min(1),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const APP_CONFIG_PATH = '/config.json';

let appConfig: AppConfig | null = null;

/**
 * Fetches and validates the runtime config. Rejects rather than falling back
 * to defaults: a config an operator wrote and the app quietly ignored would
 * only surface later, as an OIDC error on the provider's page, a long way
 * from the cause.
 */
export async function loadAppConfig(): Promise<AppConfig> {
  // Absolute so it resolves the same way wherever fetch runs (jsdom included).
  // `no-cache` makes the browser revalidate rather than reuse a cached copy,
  // so a changed file reaches the next page load without a hard reload.
  const response = await fetch(new URL(APP_CONFIG_PATH, window.location.href), {
    cache: 'no-cache',
  });
  if (!response.ok) {
    throw new Error(`${APP_CONFIG_PATH} responded ${response.status}`);
  }

  // Behind the SPA fallback a missing file comes back as index.html with a
  // 200, so a parse failure is the realistic "file is not there" signal.
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error(`${APP_CONFIG_PATH} is not valid JSON`);
  }

  const result = appConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`${APP_CONFIG_PATH} is invalid — ${issues}`);
  }

  appConfig = result.data;
  return appConfig;
}

/**
 * The loaded config. `main.tsx` awaits `loadAppConfig()` before rendering
 * anything, so by the time a component or the auth client asks, it is there.
 */
export function getAppConfig(): AppConfig {
  if (!appConfig) {
    throw new Error('App config read before loadAppConfig() resolved');
  }
  return appConfig;
}
