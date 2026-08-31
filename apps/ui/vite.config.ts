import path from 'node:path';

import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Dev-server proxy mirrors the production Caddy reverse proxy (see
// ui-scaffold-plan §11 / #160): the SPA only ever talks to its own origin,
// and /api, /oidc, /health are forwarded to the API. Because of this, every
// URL in the app is relative — no VITE_API_URL exists.
const PROXIED_PATHS = ['/api', '/oidc', '/health'];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, '');
  const proxyTarget = env.VITE_PROXY_TARGET ?? 'http://localhost:3000';

  return {
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      proxy: Object.fromEntries(
        PROXIED_PATHS.map((p) => [
          p,
          { target: proxyTarget, changeOrigin: true },
        ]),
      ),
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Vitest loads .env like the dev server does, so a developer running
      // with VITE_AUTH_MODE=oidc would otherwise have every AuthProvider
      // render try the real OIDC client — without a loaded runtime config.
      // The suite covers that client directly; app-level tests run in mock.
      env: { VITE_AUTH_MODE: 'mock' },
    },
  };
});
