import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { FullPageError } from '@/components/full-page-status';
import { Button } from '@/components/ui/button';
import { loadAppConfig } from '@/lib/config';
import { routes } from '@/routes/routes';

import './index.css';

const router = createBrowserRouter(routes);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}
const root = createRoot(container);

function renderFatal(message: string) {
  root.render(
    <StrictMode>
      <FullPageError message={message}>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </FullPageError>
    </StrictMode>,
  );
}

// Nothing renders until the runtime config is in: the auth client is built
// from it, and there is no useful page to show without one.
async function bootstrap() {
  // Mock mode: MSW answers /api, since a real backend 401s the mock token.
  // Literal check, not `env`, so an oidc build drops the branch and MSW.
  if (import.meta.env.VITE_AUTH_MODE !== 'oidc') {
    try {
      const { startMockApi } = await import('@/test/msw/browser');
      await startMockApi();
    } catch (cause) {
      console.error('Mock API failed to start', cause);
      renderFatal(
        'The mock API could not start (service workers need https or localhost).',
      );
      return;
    }
  }

  try {
    await loadAppConfig();
  } catch (cause) {
    console.error('Runtime configuration failed to load', cause);
    renderFatal(
      'We could not load the application configuration (config.json). Reloading may help.',
    );
    return;
  }

  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

void bootstrap();
