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

// Nothing renders until the runtime config is in: the auth client is built
// from it, and there is no useful page to show without one.
async function bootstrap() {
  try {
    await loadAppConfig();
  } catch (cause) {
    console.error('Runtime configuration failed to load', cause);
    root.render(
      <StrictMode>
        <FullPageError message="We could not load the application configuration (config.json). Reloading may help.">
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </FullPageError>
      </StrictMode>,
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
