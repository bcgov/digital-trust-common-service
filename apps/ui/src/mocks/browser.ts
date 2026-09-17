import { http, HttpResponse } from 'msw';
import { setupWorker } from 'msw/browser';

import { API_BASE_PATH } from '@/lib/api/constants';
import type { components } from '@/lib/api/types.gen';

import { handlers } from './handlers';

// Mock mode's API. The catch-all keeps an unmocked call off a real backend.
const worker = setupWorker(
  ...handlers,
  http.all(`${API_BASE_PATH}/*`, ({ request }) =>
    HttpResponse.json(
      {
        error: {
          code: 'NOT_MOCKED',
          message: `Mock mode has no fixture for ${request.method} ${new URL(request.url).pathname}`,
        },
      } satisfies components['schemas']['ErrorResponse'],
      { status: 501 },
    ),
  ),
);

// 'bypass' for the rest (assets, HMR) is safe only with that catch-all.
export const startMockApi = () =>
  worker.start({ onUnhandledRequest: 'bypass' });
