import type { Span } from '@opentelemetry/api';

import { getServerSpan, rememberServerSpan } from './server-span';

describe('server-span', () => {
  const span = { setAttribute: jest.fn() } as unknown as Span;

  it('returns the span recorded for a request', () => {
    const request = {};
    rememberServerSpan(request, span);

    expect(getServerSpan(request)).toBe(span);
  });

  it('returns undefined when no span was recorded', () => {
    expect(getServerSpan({})).toBeUndefined();
  });

  it('returns undefined for values that cannot carry a span', () => {
    expect(getServerSpan(undefined)).toBeUndefined();
    expect(getServerSpan(null)).toBeUndefined();
    expect(getServerSpan('request')).toBeUndefined();
  });

  it('keeps spans separate per request', () => {
    const first = {};
    const second = {};
    const otherSpan = { setAttribute: jest.fn() } as unknown as Span;

    rememberServerSpan(first, span);
    rememberServerSpan(second, otherSpan);

    expect(getServerSpan(first)).toBe(span);
    expect(getServerSpan(second)).toBe(otherSpan);
  });
});
