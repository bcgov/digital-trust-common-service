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
