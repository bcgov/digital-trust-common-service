import type { AuthContext } from '@app/auth';
import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  assertResourceTenantOrNotFound,
  assertTenantAccess,
} from '../common/assert-tenant-access';
import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorType } from '../connection/connection.entity';
import { CredentialRepository } from '../credential/credential.repository';
import { TenantService } from '../tenant/tenant.service';

import { ConnectorCredential } from './connector-credential.entity';
import { ConnectorCredentialRepository } from './connector-credential.repository';
import { ConnectorHealthCheckService } from './connector-health-check.service';
import {
  ConnectorCredentialsDto,
  CreateConnectorCredentialDto,
} from './dto/create-connector-credential.dto';
import { UpdateConnectorCredentialDto } from './dto/update-connector-credential.dto';

@Injectable()
export class ConnectorCredentialService {
  public constructor(
    private readonly credentialRepository: ConnectorCredentialRepository,
    @Inject(forwardRef(() => TenantService))
    private readonly tenantService: TenantService,
    private readonly encryptionService: EncryptionService,
    private readonly healthCheckService: ConnectorHealthCheckService,
    private readonly credentialUsageRepository: CredentialRepository,
  ) {}

  public async create(
    tenantId: string,
    dto: CreateConnectorCredentialDto,
    auth: AuthContext,
  ): Promise<ConnectorCredential> {
    assertTenantAccess(auth, tenantId);
    await this.tenantService.findById(tenantId);

    await this.assertHealthy(
      dto.connectorType,
      dto.endpointUrl,
      dto.credentials,
    );

    const encryptedCredentials = this.encryptionService.encrypt(
      dto.credentials,
    );

    return await this.credentialRepository.create({
      tenantId,
      connectorType: dto.connectorType,
      credentialsEncrypted: encryptedCredentials.ciphertext,
      endpointUrl: dto.endpointUrl,
      active: true,
      keyVersion: encryptedCredentials.keyVersion,
    } as ConnectorCredential);
  }

  private async assertHealthy(
    connectorType: ConnectorType,
    endpointUrl: string,
    credentials: ConnectorCredentialsDto,
  ): Promise<void> {
    const healthCheck = await this.healthCheckService.check(
      connectorType,
      endpointUrl,
      credentials,
    );

    if (healthCheck.status !== 'healthy') {
      throw new UnprocessableEntityException(
        `Could not verify connectivity to the connector endpoint: ${healthCheck.message ?? 'unknown error'}`,
      );
    }
  }

  private async lazyRotateKeyIfNeeded(
    credential: ConnectorCredential,
  ): Promise<void> {
    if (this.encryptionService.requiresRotation(credential.keyVersion)) {
      const decrypted = this.encryptionService.decrypt<ConnectorCredentialsDto>(
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
    const existing = await this.findById(id, auth);

    const updates: Partial<Omit<ConnectorCredential, 'tenant'>> = {};

    if (dto.endpointUrl !== undefined) {
      updates.endpointUrl = dto.endpointUrl;
    }

    if (dto.credentials !== undefined) {
      await this.assertHealthy(
        existing.connectorType,
        dto.endpointUrl ?? existing.endpointUrl,
        dto.credentials,
      );

      const encryptedCredentials = this.encryptionService.encrypt(
        dto.credentials,
      );

      updates.credentialsEncrypted = encryptedCredentials.ciphertext;
      updates.keyVersion = encryptedCredentials.keyVersion;
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

    const hasDependents =
      await this.credentialUsageRepository.existsByConnectorId(id);

    if (hasDependents) {
      throw new ConflictException(
        'Cannot delete connector: credential records still reference it.',
      );
    }

    try {
      await this.credentialRepository.delete(id);
    } catch (error) {
      const pgCode = (error as { driverError?: { code?: string } }).driverError
        ?.code;
      // Defense in depth: the fk_credential_connector constraint is ON DELETE RESTRICT,
      // so a race can still fail here even if the pre-check passed.
      if (pgCode === '23503') {
        throw new ConflictException(
          'Cannot delete connector: credential records still reference it.',
        );
      }
      throw error;
    }
  }

  /** Used by the tenant status-change cascade when a tenant is deactivated. */
  public async deactivateAllForTenant(tenantId: string): Promise<number> {
    return this.credentialRepository.deactivateAllForTenant(tenantId);
  }

  public async testConnectivity(
    id: string,
    auth: AuthContext,
  ): Promise<{ status: string; latencyMs: number; message?: string }> {
    const credential = await this.findById(id, auth);

    const decrypted = this.encryptionService.decrypt<ConnectorCredentialsDto>(
      credential.credentialsEncrypted,
      credential.keyVersion,
    );

    return await this.healthCheckService.check(
      credential.connectorType,
      credential.endpointUrl,
      decrypted,
    );
  }
}
