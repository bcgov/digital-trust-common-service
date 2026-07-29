import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorType } from '../connection/connection.entity';
import { TenantService } from '../tenant/tenant.service';

import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialRepository } from './connector-credential.repository';
import { CreateConnectorCredentialDto } from './dto/create-connector-credential.dto';
import { UpdateConnectorCredentialDto } from './dto/update-connector-credential.dto';

@Injectable()
export class ConnectorCredentialService {
  public constructor(
    private readonly credentialRepository: ConnectorCredentialRepository,
    private readonly tenantService: TenantService,
    private readonly encryptionService: EncryptionService,
  ) {}

  public async create(
    dto: CreateConnectorCredentialDto,
  ): Promise<ConnectorCredential> {
    const tenant = await this.tenantService.findById(dto.tenantId);
    if (!tenant) {
      throw new NotFoundException(
        `Tenant with ID '${dto.tenantId}' was not found.`,
      );
    }

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

  private async lazyRotateKeyIfNeeded(
    credential: ConnectorCredential,
  ): Promise<void> {
    if (this.encryptionService.requiresRotation(credential.keyVersion)) {
      const decrypted = this.encryptionService.decrypt<string>(
        credential.credentialsEncrypted,
        credential.keyVersion,
      );

      const encryptedCredentials = this.encryptionService.encrypt(decrypted);

      credential.credentialsEncrypted = encryptedCredentials.ciphertext;
      credential.keyVersion = encryptedCredentials.keyVersion;

      await this.credentialRepository.update(credential.id, {
        credentialsEncrypted: encryptedCredentials.ciphertext,
        keyVersion: encryptedCredentials.keyVersion,
      });
    }
  }

  public async findById(id: string): Promise<ConnectorCredential> {
    const credential = await this.credentialRepository.findById(id);

    if (!credential) {
      throw new NotFoundException(
        `Connector credential with ID '${id}' was not found.`,
      );
    }

    await this.lazyRotateKeyIfNeeded(credential);

    return credential;
  }

  public async findByTenant(tenantId: string): Promise<ConnectorCredential[]> {
    const credentials = await this.credentialRepository.findByTenant(tenantId);
    if (!credentials || credentials.length === 0) {
      throw new NotFoundException(
        `No connector credentials found for tenant with ID '${tenantId}'.`,
      );
    }

    await Promise.all(credentials.map((c) => this.lazyRotateKeyIfNeeded(c)));
    return credentials;
  }

  public async findByTenantAndConnectorType(
    tenantId: string,
    connectorType: ConnectorType,
  ): Promise<ConnectorCredential[]> {
    const credentials =
      await this.credentialRepository.findByTenantAndConnectorType(
        tenantId,
        connectorType,
      );

    if (!credentials || credentials.length === 0) {
      throw new NotFoundException(
        `No connector credentials found for tenant with ID '${tenantId}'.`,
      );
    }

    await Promise.all(credentials.map((c) => this.lazyRotateKeyIfNeeded(c)));
    return credentials;
  }

  public async findByTenantAndConnectorTypeAndActive(
    tenantId: string,
    connectorType: ConnectorType,
    active: boolean,
  ): Promise<ConnectorCredential[]> {
    const credentials =
      await this.credentialRepository.findByTenantAndConnectorTypeAndActive(
        tenantId,
        connectorType,
        active,
      );
    if (!credentials || credentials.length === 0) {
      throw new NotFoundException(
        `No connector credentials found for tenant with ID '${tenantId}'.`,
      );
    }

    await Promise.all(credentials.map((c) => this.lazyRotateKeyIfNeeded(c)));
    return credentials;
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

    await this.lazyRotateKeyIfNeeded(updated);

    return updated;
  }

  public async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.credentialRepository.delete(id);
  }

  public async decryptCredential(key: string, id: string): Promise<string> {
    const credential = await this.findById(id);

    if (!credential) {
      throw new NotFoundException(
        `Connector credential with ID '${id}' was not found.`,
      );
    }

    if (key.length !== 64) {
      throw new BadRequestException(
        `Invalid key format. Expected 64 hex characters (32 bytes) but got ${key.length} characters.`,
      );
    }

    let keyBuffer: Buffer;

    try {
      keyBuffer = Buffer.from(key, 'hex');
    } catch {
      throw new BadRequestException(`Key must be a valid hexadecimal string.`);
    }

    if (keyBuffer.length !== 32) {
      throw new BadRequestException(
        `Invalid key length. Expected 32 bytes (256 bits) but got ${keyBuffer.length} bytes.`,
      );
    }

    try {
      const decrypted = this.encryptionService.decryptWithKey<string>(
        credential.credentialsEncrypted,
        keyBuffer,
      );

      return decrypted;
    } catch (error) {
      throw new BadRequestException(
        `Failed to decrypt connector credential with ID '${id}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
