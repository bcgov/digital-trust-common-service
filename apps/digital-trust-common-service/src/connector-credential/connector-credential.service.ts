import { randomBytes } from 'crypto';

import type { AuthContext } from '@app/auth';
import type { ConnectorContext } from '@app/credential-ports';
import { OidcConfigService } from '@app/oidc/config';
import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  assertResourceTenantOrNotFound,
  assertTenantAccess,
} from '../common/assert-tenant-access';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { EncryptionService } from '../common/crypto/encryption.service';
import { ConnectorType } from '../connection/connection.entity';
import { CredentialRepository } from '../credential/credential.repository';
import { TenantService } from '../tenant/tenant.service';
import { TractionWebhookRegistrar } from '../traction/traction-webhook-registrar.service';

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
  private readonly logger = new Logger(ConnectorCredentialService.name);

  public constructor(
    private readonly credentialRepository: ConnectorCredentialRepository,
    @Inject(forwardRef(() => TenantService))
    private readonly tenantService: TenantService,
    private readonly encryptionService: EncryptionService,
    private readonly healthCheckService: ConnectorHealthCheckService,
    private readonly credentialUsageRepository: CredentialRepository,
    private readonly webhookRegistrar: TractionWebhookRegistrar,
    private readonly oidcConfigService: OidcConfigService,
  ) {}

  public async create(
    tenantId: string,
    dto: CreateConnectorCredentialDto,
    auth: AuthContext,
  ): Promise<ConnectorCredential> {
    assertTenantAccess(auth, tenantId);
    await this.tenantService.findById(tenantId);

    if (
      dto.connectorType === ConnectorType.TRACTION &&
      !dto.credentials.webhookSecret
    ) {
      dto.credentials.webhookSecret = randomBytes(32).toString('hex');
    }

    await this.assertHealthy(
      dto.connectorType,
      dto.endpointUrl,
      dto.credentials,
    );

    const encryptedCredentials = this.encryptionService.encrypt(
      dto.credentials,
    );

    const credential = await this.credentialRepository.create({
      tenantId,
      connectorType: dto.connectorType,
      credentialsEncrypted: encryptedCredentials.ciphertext,
      endpointUrl: dto.endpointUrl,
      active: true,
      keyVersion: encryptedCredentials.keyVersion,
    } as ConnectorCredential);

    if (dto.connectorType === ConnectorType.TRACTION) {
      const webhookUrl = this.buildWebhookUrl(credential.id);
      const webhookSecret = dto.credentials.webhookSecret as string;
      const context: ConnectorContext = {
        connectorId: credential.id,
        tenantId,
        endpointUrl: credential.endpointUrl,
        credentials: { ...dto.credentials },
      };

      try {
        await this.webhookRegistrar.ensureWebhookRegistered(
          context,
          webhookUrl,
          webhookSecret,
        );
      } catch (registrationError) {
        const confirmedRegistered = await this.reconcileFailedRegistration(
          context,
          webhookUrl,
          webhookSecret,
          () => this.deleteOrLogFailure(credential.id),
        );

        if (!confirmedRegistered) {
          throw registrationError;
        }
      }
    }

    return credential;
  }

  /**
   * A registration call can fail after Traction has already applied the PUT
   * (e.g. the response times out), so a bare try/catch can't tell "never
   * happened" apart from "happened, but we didn't hear back". This checks
   * Traction's actual wallet state before deciding what's safe:
   * - registered remotely: the failure was cosmetic, keep the persisted row.
   * - confirmed not registered: safe to run the cleanup callback.
   * - verification itself fails: state is unknown, so nothing is reverted —
   *   an unverified revert risks diverging from a change Traction did apply.
   * Returns true only when the remote state is confirmed to already match.
   */
  private async reconcileFailedRegistration(
    context: ConnectorContext,
    webhookUrl: string,
    webhookSecret: string,
    onConfirmedNotRegistered: () => Promise<void>,
  ): Promise<boolean> {
    let isRegistered: boolean;

    try {
      isRegistered = await this.webhookRegistrar.isWebhookRegistered(
        context,
        webhookUrl,
        webhookSecret,
      );
    } catch (verificationError) {
      this.logger.error(
        `Could not verify Traction's webhook registration state for connector '${context.connectorId}' after a registration failure; leaving it as-is pending manual reconciliation.`,
        verificationError instanceof Error
          ? verificationError.stack
          : verificationError,
      );
      return false;
    }

    if (isRegistered) {
      this.logger.warn(
        `Webhook registration for connector '${context.connectorId}' reported failure but Traction confirms it was applied; keeping the persisted state.`,
      );
      return true;
    }

    await onConfirmedNotRegistered();
    return false;
  }

  private async deleteOrLogFailure(id: string): Promise<void> {
    try {
      await this.credentialRepository.delete(id);
    } catch (cleanupError) {
      this.logger.error(
        `Failed to delete connector credential '${id}' after webhook registration failure; manual cleanup required.`,
        cleanupError instanceof Error ? cleanupError.stack : cleanupError,
      );
    }
  }

  /**
   * The URL Traction calls back on. ACA-Py appends `/topic/{topic}/` to
   * whatever URL is registered (see ConnectorWebhookController), so this is
   * deliberately just the base connector webhook path with no topic segment.
   */
  private buildWebhookUrl(connectorId: string): string {
    const origin = this.oidcConfigService.getConfig().publicUrl;

    return `${origin}${API_BASE_PATH}/connectors/${connectorId}/webhooks`;
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
    tenantId: string,
    id: string,
    auth?: AuthContext,
  ): Promise<ConnectorCredential> {
    const credential = await this.credentialRepository.findById(id);
    const notFound = `Connector credential with ID '${id}' was not found.`;

    if (!credential || credential.tenantId !== tenantId) {
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

  /**
   * Lookup for inbound webhook verification, where the caller (the connector
   * provider, e.g. Traction or Credo) has no tenant JWT and thus no
   * AuthContext for findById's tenant check — the connector id and its
   * stored secret are themselves the credential presented. Returns null
   * (never throws/404s) on any mismatch so the guard can respond identically
   * whether the id doesn't exist or isn't active.
   */
  public async findActiveForWebhook(
    id: string,
  ): Promise<ConnectorCredential | null> {
    const credential = await this.credentialRepository.findById(id);

    if (!credential || !credential.active) {
      return null;
    }

    await this.lazyRotateKeyIfNeeded(credential);
    return credential;
  }

  public async update(
    tenantId: string,
    id: string,
    dto: UpdateConnectorCredentialDto,
    auth: AuthContext,
  ): Promise<ConnectorCredential> {
    const existing = await this.findById(tenantId, id, auth);

    const updates: Partial<Omit<ConnectorCredential, 'tenant'>> = {};
    const endpointUrl = dto.endpointUrl ?? existing.endpointUrl;

    if (dto.endpointUrl !== undefined) {
      updates.endpointUrl = dto.endpointUrl;
    }

    if (dto.credentials !== undefined) {
      if (
        existing.connectorType === ConnectorType.TRACTION &&
        !dto.credentials.webhookSecret
      ) {
        // A PATCH replaces the whole credentials object, so omitting
        // webhook_secret here (e.g. when only rotating api_key) must not
        // erase the secret Traction already sends back on callbacks.
        const existingCredentials =
          this.encryptionService.decrypt<ConnectorCredentialsDto>(
            existing.credentialsEncrypted,
            existing.keyVersion,
          );

        dto.credentials.webhookSecret = existingCredentials.webhookSecret;
      }

      await this.assertHealthy(
        existing.connectorType,
        endpointUrl,
        dto.credentials,
      );

      const encryptedCredentials = this.encryptionService.encrypt(
        dto.credentials,
      );

      updates.credentialsEncrypted = encryptedCredentials.ciphertext;
      updates.keyVersion = encryptedCredentials.keyVersion;
    } else if (dto.endpointUrl !== undefined) {
      // Credentials aren't being rotated, but the endpoint changed — still
      // validate it (SSRF checks included) against the existing credentials.
      const existingCredentials =
        this.encryptionService.decrypt<ConnectorCredentialsDto>(
          existing.credentialsEncrypted,
          existing.keyVersion,
        );

      await this.assertHealthy(
        existing.connectorType,
        endpointUrl,
        existingCredentials,
      );
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException(
        'At least one of endpoint_url or credentials must be provided.',
      );
    }

    const updated = await this.credentialRepository.update(id, updates);

    if (!updated) {
      throw new NotFoundException(
        `Connector credential with ID '${id}' was not found.`,
      );
    }

    if (existing.connectorType === ConnectorType.TRACTION && dto.credentials) {
      const webhookUrl = this.buildWebhookUrl(updated.id);
      const webhookSecret = dto.credentials.webhookSecret as string;
      const context: ConnectorContext = {
        connectorId: updated.id,
        tenantId,
        endpointUrl: updated.endpointUrl,
        credentials: { ...dto.credentials },
      };

      try {
        // Re-register so external agents wallet_webhook_urls entry reflects
        // whatever we just persisted, including a preserved/rotated secret.
        await this.webhookRegistrar.ensureWebhookRegistered(
          context,
          webhookUrl,
          webhookSecret,
        );
      } catch (registrationError) {
        const confirmedRegistered = await this.reconcileFailedRegistration(
          context,
          webhookUrl,
          webhookSecret,
          () => this.revertOrLogFailure(id, existing, updates),
        );

        if (!confirmedRegistered) {
          throw registrationError;
        }
      }
    }

    await this.lazyRotateKeyIfNeeded(updated);

    return updated;
  }

  private async revertOrLogFailure(
    id: string,
    existing: ConnectorCredential,
    appliedUpdates: Partial<Omit<ConnectorCredential, 'tenant'>>,
  ): Promise<void> {
    const revert: Partial<Omit<ConnectorCredential, 'tenant'>> = {
      credentialsEncrypted: existing.credentialsEncrypted,
      keyVersion: existing.keyVersion,
    };

    if (appliedUpdates.endpointUrl !== undefined) {
      revert.endpointUrl = existing.endpointUrl;
    }

    try {
      await this.credentialRepository.update(id, revert);
    } catch (cleanupError) {
      this.logger.error(
        `Failed to revert connector credential '${id}' after webhook registration failure; manual cleanup required.`,
        cleanupError instanceof Error ? cleanupError.stack : cleanupError,
      );
    }
  }

  public async delete(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<void> {
    await this.findById(tenantId, id, auth);

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
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<{ status: string; latencyMs: number; message?: string }> {
    const credential = await this.findById(tenantId, id, auth);

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
