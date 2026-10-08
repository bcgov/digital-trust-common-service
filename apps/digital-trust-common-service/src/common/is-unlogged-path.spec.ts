import type { IncomingMessage } from 'node:http';

import { isUnloggedPath } from './is-unlogged-path';

function buildRequest(originalUrl: string): IncomingMessage {
  return { originalUrl } as IncomingMessage;
}

describe('isUnloggedPath', () => {
  it('excludes the liveness probe', () => {
    expect(isUnloggedPath(buildRequest('/health/live'))).toBe(true);
  });

  it('excludes the readiness probe', () => {
    expect(isUnloggedPath(buildRequest('/health/ready'))).toBe(true);
  });

  it('keeps the operator diagnostics endpoint logged', () => {
    expect(isUnloggedPath(buildRequest('/health/status'))).toBe(false);
  });

  it('ignores the query string when matching', () => {
    expect(isUnloggedPath(buildRequest('/health/ready?foo=bar'))).toBe(true);
  });

  it('logs everything else', () => {
    expect(isUnloggedPath(buildRequest('/api/v1/tenants'))).toBe(false);
  });
});
