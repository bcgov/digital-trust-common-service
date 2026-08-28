import {
  AgentAdapter,
  ConnectorType,
  CredentialFormat,
} from '@app/credential-ports';

import { ConnectorCredential } from '../connector-credential/connector-credential.entity';

/**
 * Everything a caller needs to perform a credential operation: the adapter to
 * delegate to, the connector record holding its endpoint and credentials, and
 * the credential format the operation resolved to.
 */
export interface ResolvedAdapter {
  readonly adapter: AgentAdapter;
  readonly connector: ConnectorCredential;
  readonly format: CredentialFormat;
}

export interface ResolveOptions {
  /**
   * Explicit connector to use, bypassing the tenant default. Set by callers
   * that already know the connector — e.g. an issuance profile's `connector_id`.
   */
  readonly connectorId?: string;

  /**
   * Platform-admin escape hatch (`?adapter=traction`). Honoured only when
   * `ADAPTER_OVERRIDE_ENABLED` is on AND `isPlatformAdmin` is true; otherwise
   * the request is rejected rather than silently ignored.
   */
  readonly adapterOverride?: ConnectorType;

  /** Whether the calling principal holds the `platform-admin` role. */
  readonly isPlatformAdmin?: boolean;
}
