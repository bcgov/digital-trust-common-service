import type { EntityManager } from 'typeorm';

import {
  CredentialDefinition,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import type { CreateCredentialDefinitionDto } from './dto/create-credential-definition.dto';

export interface PreparedCredentialDefinition {
  connectorId: string;
  connectorType: CredentialDefinition['connectorType'];
  schemaDefinition: Record<string, unknown>;
  registration: CredentialDefinition['registration'];
}

export interface CredentialDefinitionFormatHandler {
  readonly format: CredentialDefinitionFormat;
  normalizeOptions(options: unknown): Record<string, unknown>;
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
