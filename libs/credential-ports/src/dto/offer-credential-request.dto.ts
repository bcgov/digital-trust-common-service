import { CredentialFormat } from '../enums/credential-format.enum';

// Name-value attribute included in an offered credential.
export interface CredentialAttribute {
  readonly name: string;
  readonly value: string;
}

// Agent-agnostic credential offer request.
export interface OfferCredentialRequest {
  // Existing DIDComm connection. Absent => connectionless (OID4VCI) flow.
  readonly connectionId?: string;
  // Credential definition identifier for formats that require one.
  readonly credentialDefinitionId?: string;
  readonly format: CredentialFormat;
  readonly claims: Readonly<Record<string, unknown>>;
  readonly schemaDefinition: Readonly<Record<string, unknown>>;
  readonly comment?: string;
  // When true, the adapter issues automatically without a separate step.
  readonly autoIssue?: boolean;
}
