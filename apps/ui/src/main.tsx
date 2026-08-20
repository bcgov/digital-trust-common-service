import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { routes } from '@/routes/routes';

import './index.css';

const router = createBrowserRouter(routes);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
