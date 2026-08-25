import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { setAuthHandlers } from '@/lib/api/client';

import { server } from './msw/server';

// jsdom's CSS parser chokes on the modern syntax in the style-injected BCDS
// react-components CSS (fine in real browsers). Filter exactly that message
// so real console errors stay visible instead of drowning in it.
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (String(args[0]).includes('Could not parse CSS stylesheet')) return;
  consoleError(...args);
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
  sessionStorage.clear();
  setAuthHandlers(null);
});

afterAll(() => server.close());
