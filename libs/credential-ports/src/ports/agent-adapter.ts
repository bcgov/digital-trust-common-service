import { ConnectorType } from '../enums/connector-type.enum';
import { CredentialFormat } from '../enums/credential-format.enum';

import { ConnectionPort } from './connection.port';
import { HolderPort } from './holder.port';
import { IssuerPort } from './issuer.port';
import { RevocationPort } from './revocation.port';
import { VerifierPort } from './verifier.port';

/**
 * Self-describing capabilities an adapter advertises to the AdapterRegistry so
 * resolution can pick an adapter and validate a requested credential format
 * without hardcoding per-connector knowledge in the registry.
 */
export interface AdapterCapabilities {
  /** Connector this adapter implements; the registry key. */
  readonly connectorType: ConnectorType;

  /**
   * Formats this adapter can handle, most-preferred first. The first entry is
   * the connector's primary format, used when a caller omits the format.
   */
  readonly supportedFormats: readonly CredentialFormat[];
}

/**
 * Combines issuer, verifier, holder, connection, and revocation one-shot port semantics.
 */
export interface AgentAdapter
  extends
    AdapterCapabilities,
    IssuerPort,
    VerifierPort,
    HolderPort,
    ConnectionPort,
    RevocationPort {}
