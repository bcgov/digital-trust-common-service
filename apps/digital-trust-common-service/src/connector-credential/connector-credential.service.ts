import { Injectable, NotFoundException } from '@nestjs/common';

import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorType } from '../connection/connection.entity';

import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialRepository } from './connector-credential.repository';
import { CreateConnectorCredentialDto } from './dto/create-connector-credential.dto';
import { UpdateConnectorCredentialDto } from './dto/update-connector-credential.dto';

@Injectable()
export class ConnectorCredentialService {
  public constructor(
    private readonly credentialRepository: ConnectorCredentialRepository,
    private readonly encryptionService: EncryptionService,
  ) {}

  public async create(
    dto: CreateConnectorCredentialDto,
  ): Promise<ConnectorCredential> {
    const encryptedCredentials = this.encryptionService.encrypt(
      dto.credentialsPlainText,
    );

    const credential = await this.credentialRepository.create({
      tenantId: dto.tenantId,
      connectorType: dto.connectorType,
      credentialsEncrypted: encryptedCredentials.ciphertext,
      endpointUrl: dto.endpointUrl,
      active: dto.active ?? true,
      keyVersion: encryptedCredentials.keyVersion,
    } as ConnectorCredential);

    return credential;
  }

  public async findById(id: string): Promise<ConnectorCredential> {
    const credential = await this.credentialRepository.findById(id);

    if (!credential) {
      throw new NotFoundException(
        `Connector credential with ID '${id}' was not found.`,
      );
    }

    return credential;
  }

  public async findByTenant(tenantId: string): Promise<ConnectorCredential[]> {
    return await this.credentialRepository.findByTenant(tenantId);
  }

  public async findByTenantAndConnectorType(
    tenantId: string,
    connectorType: ConnectorType,
  ): Promise<ConnectorCredential[]> {
    return await this.credentialRepository.findByTenantAndConnectorType(
      tenantId,
      connectorType,
    );
  }

  public async findByTenantAndConnectorTypeAndActive(
    tenantId: string,
    connectorType: ConnectorType,
    active: boolean,
  ): Promise<ConnectorCredential[]> {
    return await this.credentialRepository.findByTenantAndConnectorTypeAndActive(
      tenantId,
      connectorType,
      active,
    );
  }

  public async update(
    id: string,
    dto: UpdateConnectorCredentialDto,
  ): Promise<ConnectorCredential> {
    await this.findById(id);

    const updates: Partial<Omit<ConnectorCredential, 'tenant'>> = {};

    if (dto.endpointUrl !== undefined) {
      updates.endpointUrl = dto.endpointUrl;
    }

    if (typeof dto.active === 'boolean') {
      updates.active = dto.active;
    }

    const updated = await this.credentialRepository.update(id, updates);

    if (!updated) {
      throw new NotFoundException(
        `Connector credential with ID '${id}' was not found.`,
      );
    }

    return updated;
  }

  public async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.credentialRepository.delete(id);
  }
}
