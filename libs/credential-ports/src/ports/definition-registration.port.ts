import { ConnectorContext } from './connector-context';

export interface IssuerSelection {
  readonly id?: string;
  readonly method?: string;
}

export interface RegisteredSchema {
  readonly id: string;
  readonly definition: Record<string, unknown>;
}

export interface DefinitionOptions {
  readonly tag: string;
  readonly revocation: { readonly enabled: boolean };
}

export interface RegistrationSubmission {
  readonly state: 'finished' | 'wait' | 'action';
  readonly id?: string;
  readonly jobId?: string;
  readonly transactionId?: string;
}

export interface RegistrationObservation {
  readonly id: string;
  readonly jobId?: string;
  readonly transactionId: string;
  readonly state: string;
}

/** Agent-owned artifact registration, separate from credential exchanges. */
export interface DefinitionRegistrationPort {
  inspectRegistration(
    context: ConnectorContext,
    intent: {
      artifact: 'schema' | 'credential_definition';
      issuerId: string;
      schema: Record<string, unknown>;
      schemaId?: string;
      options: DefinitionOptions;
      transactionId?: string;
      jobId?: string;
    },
  ): Promise<RegistrationObservation | null>;
  resolveIssuer(
    context: ConnectorContext,
    selection?: IssuerSelection,
  ): Promise<string>;
  resolveSchema(
    context: ConnectorContext,
    id: string,
  ): Promise<RegisteredSchema>;
  findSchema(
    context: ConnectorContext,
    issuerId: string,
    definition: Record<string, unknown>,
  ): Promise<RegisteredSchema | null>;
  publishSchema(
    context: ConnectorContext,
    issuerId: string,
    definition: Record<string, unknown>,
  ): Promise<RegistrationSubmission>;
  findDefinition(
    context: ConnectorContext,
    issuerId: string,
    schemaId: string,
    options: DefinitionOptions,
  ): Promise<string | null>;
  publishDefinition(
    context: ConnectorContext,
    issuerId: string,
    schemaId: string,
    options: DefinitionOptions,
  ): Promise<RegistrationSubmission>;
  verifyRevocation(
    context: ConnectorContext,
    definitionId: string,
  ): Promise<boolean>;
}
