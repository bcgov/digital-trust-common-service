import type { AuthContext } from '@app/auth';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import {
  assertResourceTenantOrNotFound,
  assertTenantAccess,
} from '../common/assert-tenant-access';
import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorType } from '../connection/connection.entity';
import { TenantService } from '../tenant/tenant.service';

import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialRepository } from './connector-credential.repository';
import { CreateConnectorCredentialDto } from './dto/create-connector-credential.dto';
import { UpdateConnectorCredentialDto } from './dto/update-connector-credential.dto';

@Injectable()
export class ConnectorCredentialService {
  private readonly logger = new Logger(ConnectorCredentialService.name);

  public constructor(
    private readonly credentialRepository: ConnectorCredentialRepository,
    @Inject(forwardRef(() => TenantService))
    private readonly tenantService: TenantService,
    private readonly encryptionService: EncryptionService,
  ) {}

  public async create(
    dto: CreateConnectorCredentialDto,
    auth: AuthContext,
  ): Promise<ConnectorCredential> {
    assertTenantAccess(auth, dto.tenantId);
    await this.tenantService.findById(dto.tenantId);

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

  public async findById(
    id: string,
    auth?: AuthContext,
  ): Promise<ConnectorCredential> {
    const credential = await this.credentialRepository.findById(id);
    const notFound = `Connector credential with ID '${id}' was not found.`;

    if (!credential) {
      throw new NotFoundException(notFound);
    }

    assertResourceTenantOrNotFound(auth, credential.tenantId, notFound);
    await this.lazyRotateKeyIfNeeded(credential);

    return credential;
  }

  public async findByTenant(tenantId: string): Promise<ConnectorCredential[]> {
    const credentials = await this.credentialRepository.findByTenant(tenantId);
    if (!credentials || credentials.length === 0) {
      return [];
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
      return [];
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
      return [];
    }

    await Promise.all(credentials.map((c) => this.lazyRotateKeyIfNeeded(c)));
    return credentials;
  }

  public async update(
    id: string,
    dto: UpdateConnectorCredentialDto,
    auth: AuthContext,
  ): Promise<ConnectorCredential> {
    await this.findById(id, auth);

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

  public async delete(id: string, auth: AuthContext): Promise<void> {
    await this.findById(id, auth);
    await this.credentialRepository.delete(id);
  }

  /** Used by the tenant status-change cascade when a tenant is deactivated. */
  public async deactivateAllForTenant(tenantId: string): Promise<number> {
    return this.credentialRepository.deactivateAllForTenant(tenantId);
  }

  public async decryptCredential(
    key: string,
    id: string,
    auth: AuthContext,
  ): Promise<string> {
    // Type guard: ensure key is a string (defense in depth against parameter tampering)
    if (Array.isArray(key)) {
      this.logger.warn(`Key parameter is an array for credential ID: ${id}`);
      throw new BadRequestException('Invalid key provided.');
    }

    if (typeof key !== 'string') {
      this.logger.warn(
        `Key parameter is not a string for credential ID: ${id}`,
      );
      throw new BadRequestException('Invalid key provided.');
    }

    const credential = await this.findById(id, auth);

    if (key.length !== 64) {
      this.logger.warn(
        `Invalid key length for credential ID ${id}: expected 64 characters, got ${key.length}`,
      );
      throw new BadRequestException('Invalid key provided.');
    }

    // Validate hex format using regex before attempting Buffer conversion
    if (!/^[0-9a-fA-F]{64}$/.test(key)) {
      this.logger.warn(
        `Invalid key format for credential ID ${id}: not a valid hexadecimal string`,
      );
      throw new BadRequestException('Invalid key provided.');
    }

    let keyBuffer: Buffer;

    try {
      keyBuffer = Buffer.from(key, 'hex');
    } catch (error) {
      this.logger.error(
        `Failed to convert key to buffer for credential ID ${id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException('Invalid key provided.');
    }

    if (keyBuffer.length !== 32) {
      this.logger.warn(
        `Invalid key buffer length for credential ID ${id}: expected 32 bytes, got ${keyBuffer.length} bytes`,
      );
      throw new BadRequestException('Invalid key provided.');
    }

    try {
      const decrypted = this.encryptionService.decryptWithKey<string>(
        credential.credentialsEncrypted,
        keyBuffer,
      );

      return decrypted;
    } catch (error) {
      this.logger.error(
        `Failed to decrypt connector credential with ID '${id}': ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadRequestException('Invalid key provided.');
    }
  }
}
