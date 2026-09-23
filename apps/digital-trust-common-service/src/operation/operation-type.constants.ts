/**
 * The operation types this service creates, in one place so writers and readers
 * agree on the exact string rather than each repeating a literal.
 *
 * Deliberately a const object rather than a TypeScript enum or a database enum:
 * `openapi.yaml` declares `Operation.type` as an open string with these as known
 * values, and later slices add batch, presentation, and connection types. A
 * closed enum on the wire would break that contract and force a migration for
 * every new type; the column stays `varchar`.
 */
export const OPERATION_TYPE = {
  CREDENTIAL_OFFER: 'credential.offer',
  CREDENTIAL_OFFER_BATCH: 'credential.offer-batch',
  CREDENTIAL_ACCEPT: 'credential.accept',
  CREDENTIAL_REJECT: 'credential.reject',
  CREDENTIAL_REVOKE: 'credential.revoke',
  CREDENTIAL_REVOKE_BATCH: 'credential.revoke-batch',
  PRESENTATION_REQUEST: 'presentation.request',
  CONNECTION_CREATE: 'connection.create',
} as const;

export type OperationType =
  (typeof OPERATION_TYPE)[keyof typeof OPERATION_TYPE];

/** True when the type names a batch parent rather than a standalone operation. */
export function isBatchOperationType(type: string): boolean {
  return type.endsWith('-batch');
}

const KNOWN_OPERATION_TYPES = new Set<string>(Object.values(OPERATION_TYPE));

/**
 * True when the type is one this service declares, rather than an arbitrary
 * string the open `varchar` column and open API contract both permit.
 *
 * Exists for the business metrics in `common/telemetry/business-metrics.service.ts`:
 * `operation.type` is a metric dimension, and a dimension whose values are not
 * drawn from a fixed set creates permanent series for every distinct value ever
 * written. Callers narrowing a type for a metric label must route anything this
 * rejects to a single fallback bucket instead.
 */
export function isKnownOperationType(type: string): type is OperationType {
  return KNOWN_OPERATION_TYPES.has(type);
}
