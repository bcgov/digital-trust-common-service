import type { EntityManager } from 'typeorm';

import {
  CredentialDefinition,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import type {
  CreateCredentialDefinitionDto,
  RegistrationSchema,
} from './dto/create-credential-definition.dto';

export interface PreparedCredentialDefinition {
  connectorId: string;
  connectorType: CredentialDefinition['connectorType'];
  schemaDefinition: Record<string, unknown>;
  registration: CredentialDefinition['registration'];
}

export interface CredentialDefinitionFormatHandler {
  readonly format: CredentialDefinitionFormat;
  normalizeOptions(options: unknown): Record<string, unknown>;
  normalizeSchema(schema: RegistrationSchema): RegistrationSchema;
  getClaimsSchema(
    schemaDefinition: Readonly<Record<string, unknown>>,
  ): Record<string, unknown>;
  getMandatoryClaims(
    schemaDefinition: Readonly<Record<string, unknown>>,
  ): readonly string[];
  prepareClaimsForValidation?(
    schemaDefinition: Readonly<Record<string, unknown>>,
    claims: Readonly<Record<string, unknown>>,
  ): {
    claims: Record<string, unknown>;
    omittedClaims: string[];
  };
  prepare(
    tenantId: string,
    dto: CreateCredentialDefinitionDto,
  ): Promise<PreparedCredentialDefinition>;
  register(
    definition: CredentialDefinition,
    manager: EntityManager,
  ): Promise<void>;
}

export const CREDENTIAL_DEFINITION_FORMAT_HANDLERS = Symbol(
  'CREDENTIAL_DEFINITION_FORMAT_HANDLERS',
);
