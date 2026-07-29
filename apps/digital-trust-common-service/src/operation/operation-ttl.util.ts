import { Logger } from '@nestjs/common';

const logger = new Logger('OperationTtlConfig');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// System-default TTL durations (milliseconds). Overridable per tenant via
// tenant.config.operation_ttl.* (see CONFIG_KEY_MAP below for the JSONB key names).
export const DEFAULT_OPERATION_TTL_MS = {
  completedViewed: 1 * HOUR_MS,
  completedUnviewed: 72 * HOUR_MS,
  failedViewed: 24 * HOUR_MS,
  failedUnviewed: 7 * DAY_MS,
  pendingStale: 24 * HOUR_MS,
} as const;

// Default horizon (from createdAt) for non-terminal operations (PENDING at
// creation, PROCESSING) that haven't yet reached a state with its own TTL
// semantics. The issue spec (#31) does not define a tenant-configurable key
// for this value — it is intentionally NOT part of operation_ttl.* so that a
// tenant override of completed_unviewed (which only applies to completed,
// not-yet-viewed operations) cannot inadvertently shorten/lengthen the
// lifetime of still-in-flight operations.
export const DEFAULT_CREATED_TTL_MS = 72 * HOUR_MS;

export type OperationTtlKey = keyof typeof DEFAULT_OPERATION_TTL_MS;

export type OperationTtlConfigMs = Record<OperationTtlKey, number>;

const CONFIG_KEY_MAP: Record<OperationTtlKey, string> = {
  completedViewed: 'completed_viewed',
  completedUnviewed: 'completed_unviewed',
  failedViewed: 'failed_viewed',
  failedUnviewed: 'failed_unviewed',
  pendingStale: 'pending_stale',
};

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i;

const UNIT_TO_MS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: HOUR_MS,
  d: DAY_MS,
};

/**
 * Parses a TTL value from tenant config. Accepts a positive finite number of
 * milliseconds, or a duration string such as "1h", "72h", "30m", "7d".
 * Returns null if the value is missing or malformed.
 */
export function parseDurationMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === 'string') {
    const match = DURATION_PATTERN.exec(value.trim());

    if (match) {
      const amount = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      const multiplier = UNIT_TO_MS[unit];

      if (!Number.isFinite(amount) || amount <= 0 || multiplier === undefined) {
        return null;
      }

      return amount * multiplier;
    }
  }

  return null;
}

/**
 * Resolves per-tenant operation TTL overrides from tenant.config.operation_ttl.*,
 * falling back to system defaults for any key that is missing or invalid.
 */
export function resolveOperationTtlMs(
  tenantConfig?: Record<string, unknown> | null,
): OperationTtlConfigMs {
  const operationTtlConfig = tenantConfig?.['operation_ttl'];
  const rawOverrides =
    typeof operationTtlConfig === 'object' && operationTtlConfig !== null
      ? (operationTtlConfig as Record<string, unknown>)
      : {};

  const resolved = {} as OperationTtlConfigMs;

  (Object.keys(DEFAULT_OPERATION_TTL_MS) as OperationTtlKey[]).forEach(
    (key) => {
      const configKey = CONFIG_KEY_MAP[key];
      const rawValue = rawOverrides[configKey];
      const parsed = rawValue === undefined ? null : parseDurationMs(rawValue);

      if (rawValue !== undefined && parsed === null) {
        const safeValue = JSON.stringify(rawValue);
        logger.warn(
          `Invalid operation_ttl.${configKey} value ${safeValue}; falling back to system default`,
        );
      }

      resolved[key] = parsed ?? DEFAULT_OPERATION_TTL_MS[key];
    },
  );

  return resolved;
}
