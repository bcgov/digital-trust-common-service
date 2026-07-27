import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from './credential-definition.entity';
import { CredentialDefinitionRepository } from './credential-definition.repository';
import { CreateCredentialDefinitionDto } from './dto/create-credential-definition.dto';
import { UpdateCredentialDefinitionDto } from './dto/update-credential-definition.dto';

@Injectable()
export class CredentialDefinitionService {
  public constructor(
    private readonly credentialDefinitionRepository: CredentialDefinitionRepository,
  ) {}

  public async create(
    dto: CreateCredentialDefinitionDto,
  ): Promise<CredentialDefinition> {
    const existing =
      await this.credentialDefinitionRepository.findByTenantAndNameAndFormat(
        dto.tenantId,
        dto.name,
        dto.format,
      );

    if (existing) {
      throw new ConflictException(
        'Credential definition with this name and format already exists for this tenant.',
      );
    }

    return await this.credentialDefinitionRepository.create({
      tenantId: dto.tenantId,
      name: dto.name,
      format: dto.format,
      schemaDefinition: dto.schemaDefinition,
      externalId: dto.externalId,
      connectorType: dto.connectorType,
      metadata: dto.metadata,
    });
  }

  public async findById(id: string): Promise<CredentialDefinition> {
    const credentialDefinition =
      await this.credentialDefinitionRepository.findById(id);

    if (!credentialDefinition) {
      throw new NotFoundException(
        `Credential definition '${id}' was not found.`,
      );
    }

    return credentialDefinition;
  }

  public async findByTenantId(
    tenantId: string,
  ): Promise<CredentialDefinition[]> {
    return await this.credentialDefinitionRepository.findByTenantId(tenantId);
  }

  public async findByFormat(
    format: CredentialDefinitionFormat,
  ): Promise<CredentialDefinition[]> {
    return await this.credentialDefinitionRepository.findByFormat(format);
  }

  public async findByConnector(
    connectorType: CredentialDefinitionConnectorType,
  ): Promise<CredentialDefinition[]> {
    return await this.credentialDefinitionRepository.findByConnector(
      connectorType,
    );
  }

  public async update(
    id: string,
    dto: UpdateCredentialDefinitionDto,
  ): Promise<CredentialDefinition> {
    const credentialDefinition = await this.findById(id);

    if (dto.name !== undefined) {
      credentialDefinition.name = dto.name;
    }

    if (dto.metadata !== undefined) {
      credentialDefinition.metadata = dto.metadata;
    }

    return await this.credentialDefinitionRepository.update(
      credentialDefinition,
    );
  }

  public async delete(id: string): Promise<void> {
    await this.findById(id);

    await this.credentialDefinitionRepository.delete(id);
  }
}
