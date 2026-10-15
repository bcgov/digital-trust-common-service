import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { setAuthHandlers } from '@/lib/api/client';

import { server } from '@/mocks/server';

// jsdom implements no media queries at all, and vaul reads `matchMedia` on
// mount to decide whether to animate. Report "no match" so components render
// their default, non-reduced-motion path.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom ships no Pointer Events capture API. vaul claims the pointer on
// pointerdown to track drag-to-dismiss, which otherwise throws out of the
// event handler and fails the run even when the assertions pass.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

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
