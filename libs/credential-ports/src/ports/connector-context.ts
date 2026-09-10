/**
 * Everything a port method needs to address one tenant's connector for a
 * single call: which connector to use, where its agent lives, and its
 * decrypted, connector-type-specific credentials.
 *
 * Resolved by the application layer (AdapterRegistry plus its own
 * credential decryption) before any port method is invoked. Adapters never
 * resolve a connector or decrypt credentials themselves — this keeps tenant
 * routing explicit at every call site instead of relying on ambient state.
 */
export interface ConnectorContext {
  /** ConnectorCredential.id — stable per-connector identity, e.g. for token caching. */
  readonly connectorId: string;

  /** Tenant that owns this connector, for logging and error context. */
  readonly tenantId: string;

  /** Base endpoint URL for the connector's agent. */
  readonly endpointUrl: string;

  /**
   * Decrypted, connector-type-specific credentials (e.g. apiKey and
   * tractionTenantId for Traction). Kept as an untyped bag at the port
   * layer, which is agent-agnostic; each adapter validates and casts its
   * own expected shape.
   */
  readonly credentials: Readonly<Record<string, unknown>>;
}
