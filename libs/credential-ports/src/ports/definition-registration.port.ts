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
  readonly status: {
    readonly revocation: { readonly enabled: boolean };
  };
}

export interface RegistrationSubmission {
  readonly state: 'finished' | 'wait' | 'action' | 'failed';
  readonly id?: string;
  readonly jobId?: string;
  readonly transactionId?: string;
  readonly detail?: string;
  readonly status?: number;
  readonly backendCode?: string;
}

/** Agent-owned artifact registration, separate from credential exchanges. */
export interface DefinitionRegistrationPort {
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
