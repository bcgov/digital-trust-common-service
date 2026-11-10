import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { setAuthHandlers } from '@/lib/api/client';
import i18n from '@/lib/i18n';

import { resetCredentialDefinitionMocks } from '@/mocks/handlers';
import { server } from '@/mocks/server';

// The default 1s for findBy/waitFor is too short when workers compete for CPU.
configure({ asyncUtilTimeout: 5_000 });

// jsdom ships no Pointer Events capture API. sonner claims the pointer on
// pointerdown to track swipe-to-dismiss, which otherwise throws out of the
// event handler and fails the run even when the assertions pass.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.scrollTo = () => {};
}

// jsdom's CSS parser chokes on the modern syntax in the style-injected BCDS
// react-components CSS (fine in real browsers). Filter exactly that message
// so real console errors stay visible instead of drowning in it.
const consoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (String(args[0]).includes('Could not parse CSS stylesheet')) return;
  consoleError(...args);
};

beforeAll(async () => {
  // Pin English so assertions on copy do not depend on the host's locale.
  await i18n.changeLanguage('en');
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetCredentialDefinitionMocks();
  sessionStorage.clear();
  setAuthHandlers(null);
});

afterAll(() => server.close());
