import {
  DEFAULT_CREATED_TTL_MS,
  DEFAULT_OPERATION_TTL_MS,
  computeOperationExpiresAt,
  parseDurationMs,
  resolveOperationTtlMs,
} from './operation-ttl.util';
import { OperationState } from './operation.entity';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('parseDurationMs', () => {
  it('parses numeric millisecond values', () => {
    expect(parseDurationMs(1000)).toBe(1000);
  });

  it.each([
    ['1h', HOUR_MS],
    ['72h', 72 * HOUR_MS],
    ['30m', 30 * 60 * 1000],
    ['7d', 7 * DAY_MS],
    ['500ms', 500],
    ['2.5h', 2.5 * HOUR_MS],
  ])('parses duration string "%s"', (input, expected) => {
    expect(parseDurationMs(input)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [-1],
    [0],
    ['0h'],
    ['not-a-duration'],
    ['5'],
    ['5x'],
    [{}],
  ])('returns null for invalid value %p', (input) => {
    expect(parseDurationMs(input)).toBeNull();
  });
});

describe('resolveOperationTtlMs', () => {
  it('returns system defaults when tenant config is undefined', () => {
    expect(resolveOperationTtlMs(undefined)).toEqual(DEFAULT_OPERATION_TTL_MS);
  });

  it('returns system defaults when tenant config is null', () => {
    expect(resolveOperationTtlMs(null)).toEqual(DEFAULT_OPERATION_TTL_MS);
  });

  it('returns system defaults when tenant config has no operation_ttl key', () => {
    expect(resolveOperationTtlMs({})).toEqual(DEFAULT_OPERATION_TTL_MS);
  });

  it('applies overrides for provided keys and defaults for the rest', () => {
    const resolved = resolveOperationTtlMs({
      operation_ttl: {
        completed_viewed: '30m',
        pending_stale: '48h',
      },
    });

    expect(resolved).toEqual({
      ...DEFAULT_OPERATION_TTL_MS,
      completedViewed: 30 * 60 * 1000,
      pendingStale: 48 * HOUR_MS,
    });
  });

  it('falls back to the default for an invalid override value', () => {
    const resolved = resolveOperationTtlMs({
      operation_ttl: { failed_unviewed: 'garbage' },
    });

    expect(resolved.failedUnviewed).toBe(
      DEFAULT_OPERATION_TTL_MS.failedUnviewed,
    );
  });

  it('ignores a non-object operation_ttl value', () => {
    expect(resolveOperationTtlMs({ operation_ttl: 'not-an-object' })).toEqual(
      DEFAULT_OPERATION_TTL_MS,
    );
  });
});

describe('computeOperationExpiresAt', () => {
  const createdAt = new Date('2024-01-01T00:00:00Z');

  it('uses created TTL for unknown states', () => {
    const expiresAt = computeOperationExpiresAt(
      'unexpected' as OperationState,
      createdAt,
    );

    expect(expiresAt.getTime()).toBe(
      createdAt.getTime() + DEFAULT_CREATED_TTL_MS,
    );
  });
});
