import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  CredentialDefinition,
  CredentialDefinitionConnectorType,
  CredentialDefinitionFormat,
} from './credential-definition.entity';

@Injectable()
export class CredentialDefinitionRepository {
  public constructor(
    @InjectRepository(CredentialDefinition)
    private readonly repository: Repository<CredentialDefinition>,
  ) {}

  public async create(
    credentialDefinition: Partial<CredentialDefinition>,
  ): Promise<CredentialDefinition> {
    const entity = this.repository.create(credentialDefinition);
    return await this.repository.save(entity);
  }

  public async findById(id: string): Promise<CredentialDefinition | null> {
    return await this.repository.findOne({
      where: { id },
    });
  }

  public async findByTenantId(
    tenantId: string,
  ): Promise<CredentialDefinition[]> {
    return await this.repository.find({
      where: { tenantId },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  public async findByTenantAndName(
    tenantId: string,
    name: string,
  ): Promise<CredentialDefinition | null> {
    return await this.repository.findOne({
      where: { tenantId, name },
    });
  }

  public async findByTenantAndNameAndFormat(
    tenantId: string,
    name: string,
    format: CredentialDefinitionFormat,
  ): Promise<CredentialDefinition | null> {
    return await this.repository.findOne({
      where: { tenantId, name, format },
    });
  }

  public async findByFormat(
    format: CredentialDefinitionFormat,
    tenantId: string,
  ): Promise<CredentialDefinition[]> {
    return await this.repository.find({
      where: { format, tenantId },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  public async findByConnector(
    connectorType: CredentialDefinitionConnectorType,
    tenantId: string,
  ): Promise<CredentialDefinition[]> {
    return await this.repository.find({
      where: { connectorType, tenantId },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  public async update(
    credentialDefinition: CredentialDefinition,
  ): Promise<CredentialDefinition> {
    return await this.repository.save(credentialDefinition);
  }

  /**
   * Deactivates a credential definition rather than removing its row: other
   * records (e.g. an issuance profile) may still reference its id, and
   * deactivation stops it from being offered for new issuance without
   * breaking those references.
   */
  public async deactivate(id: string): Promise<void> {
    await this.repository.update({ id }, { isActive: false });
  }
}
