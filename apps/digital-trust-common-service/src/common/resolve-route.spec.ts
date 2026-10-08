import type { IncomingMessage } from 'node:http';

import { resolveRoute } from './resolve-route';

function buildRequest(fields: {
  baseUrl?: string;
  path?: string;
}): IncomingMessage {
  return {
    ...(fields.path === undefined ? {} : { route: { path: fields.path } }),
    ...(fields.baseUrl === undefined ? {} : { baseUrl: fields.baseUrl }),
  } as IncomingMessage;
}

describe('resolveRoute', () => {
  it('returns the matched route pattern', () => {
    expect(resolveRoute(buildRequest({ path: '/tenants/:tenantId' }))).toBe(
      '/tenants/:tenantId',
    );
  });

  it('prefixes the mounted base path, e.g. the global /api/v1 prefix', () => {
    expect(
      resolveRoute(
        buildRequest({ baseUrl: '/api/v1', path: '/tenants/:tenantId' }),
      ),
    ).toBe('/api/v1/tenants/:tenantId');
  });

  it('returns undefined when no route matched, rather than the raw path', () => {
    expect(resolveRoute(buildRequest({}))).toBeUndefined();
  });
});
