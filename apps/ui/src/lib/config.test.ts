import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { server } from '@/test/msw/server';

import { APP_CONFIG_PATH } from './config';

const VALID = {
  oidcClientId: 'dtsc-ui',
  oidcScopes: 'openid profile email tenant offline_access',
};

// The module caches the loaded config, so each test gets a fresh copy.
async function freshModule() {
  vi.resetModules();
  return import('./config');
}

function serve(body: BodyInit | null, init?: ResponseInit) {
  server.use(http.get(APP_CONFIG_PATH, () => new HttpResponse(body, init)));
}

function serveJson(body: unknown) {
  serve(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('runtime config', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads and validates /config.json', async () => {
    serveJson(VALID);
    const { loadAppConfig, getAppConfig } = await freshModule();

    await expect(loadAppConfig()).resolves.toEqual(VALID);
    expect(getAppConfig()).toEqual(VALID);
  });

  // Reading before the load resolved would hand out a client id of nothing;
  // main.tsx guarantees the order, and this is what keeps that guarantee
  // honest.
  it('refuses to answer before the config has loaded', async () => {
    const { getAppConfig } = await freshModule();

    expect(() => getAppConfig()).toThrow('before loadAppConfig()');
  });

  // A ConfigMap change has to reach the next page load. Browsers would
  // otherwise happily serve a cached config.json for the heuristic freshness
  // lifetime of a file with no explicit expiry.
  it('revalidates rather than reusing a cached copy', async () => {
    serveJson(VALID);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { loadAppConfig } = await freshModule();

    await loadAppConfig();

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).href).toBe(
      new URL(APP_CONFIG_PATH, window.location.href).href,
    );
    expect(init).toMatchObject({ cache: 'no-cache' });
  });

  it('rejects a failed response instead of falling back to defaults', async () => {
    serve(null, { status: 500 });
    const { loadAppConfig } = await freshModule();

    await expect(loadAppConfig()).rejects.toThrow(
      `${APP_CONFIG_PATH} responded 500`,
    );
  });

  // The realistic "file missing" case: Caddy's SPA fallback answers
  // index.html with a 200 for any unknown path.
  it('rejects the SPA fallback page served in place of the file', async () => {
    serve('<!doctype html><html></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
    const { loadAppConfig } = await freshModule();

    await expect(loadAppConfig()).rejects.toThrow('is not valid JSON');
  });

  it('rejects a config missing a required key, naming it', async () => {
    serveJson({ oidcClientId: 'dtsc-ui' });
    const { loadAppConfig } = await freshModule();

    await expect(loadAppConfig()).rejects.toThrow(/oidcScopes/);
  });

  // A scope list without these still parses, but breaks the app in slow
  // motion (no OIDC request, no tenant claims, or a session that dies at the
  // first token expiry). The loader's job is to fail here instead.
  it('rejects a scope list missing what the app depends on', async () => {
    serveJson({ oidcClientId: 'dtsc-ui', oidcScopes: 'openid profile email' });
    const { loadAppConfig } = await freshModule();

    await expect(loadAppConfig()).rejects.toThrow(
      /openid, tenant, offline_access/,
    );
  });
});
