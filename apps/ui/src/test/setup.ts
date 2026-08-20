import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { setAuthHandlers } from '@/lib/api/client';

import { server } from './msw/server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
  sessionStorage.clear();
  setAuthHandlers(null);
});

afterAll(() => server.close());
