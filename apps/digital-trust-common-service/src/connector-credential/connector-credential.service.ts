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
import { EntityManager } from 'typeorm';

import { formatAgentLogBindingKey } from '../common/agent-log-partition-key';
import {
  assertResourceTenantOrNotFound,
  assertTenantAccess,
} from '../common/assert-tenant-access';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { EncryptionService } from '../common/crypto/encryption.service';
import {
  getPostgresErrorCode,
  isUniqueConstraintViolation,
} from '../common/postgres-error';
import { ConnectorType } from '../connection/connection.entity';
import { CredentialRepository } from '../credential/credential.repository';
import { TenantService } from '../tenant/tenant.service';
import { TractionTokenManager } from '../traction/traction-token-manager.service';
import { TractionWebhookRegistrar } from '../traction/traction-webhook-registrar.service';

import { ConnectorCredential } from './connector-credential.entity';
import {
  ConnectorCredentialRepository,
  ConnectorDeletionResult,
} from './connector-credential.repository';
import { ConnectorHealthCheckService } from './connector-health-check.service';
import {
  ConnectorCredentialsDto,
  CreateConnectorCredentialDto,
} from './dto/create-connector-credential.dto';
import { UpdateConnectorCredentialDto } from './dto/update-connector-credential.dto';

const AGENT_LOG_ID_BINDING_DOMAIN = 'connector-agent-log-id:v1';
const AGENT_LOG_ID_UNIQUE_INDEX = 'uq_connector_credential_agent_log_id_hash';
const AGENT_LOG_ID_CONFLICT_MESSAGE =
  'This agent sub-wallet is already bound to another connector.';

/**
 * What is stored in `credentials_encrypted`: the tenant-supplied credentials
 * plus the agent log identifier the service captured from the agent's token.
 * The identifier is never part of any request DTO.
 */
type StoredConnectorCredentials = ConnectorCredentialsDto & {
  agentLogId?: string;
};

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
    private readonly tokenManager: TractionTokenManager,
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

    const agentLogId = await this.assertHealthy(
      dto.connectorType,
      dto.endpointUrl,
      dto.credentials,
    );

    const encryptedCredentials = this.encryptionService.encrypt(
      this.withAgentLogId(dto.credentials, agentLogId),
    );

    let credential: ConnectorCredential;

    try {
      credential = await this.credentialRepository.create({
        tenantId,
        connectorType: dto.connectorType,
        credentialsEncrypted: encryptedCredentials.ciphertext,
        endpointUrl: dto.endpointUrl,
        active: true,
        keyVersion: encryptedCredentials.keyVersion,
        agentLogIdHash: this.hashAgentLogId(dto.connectorType, agentLogId),
      } as ConnectorCredential);
    } catch (error) {
      this.throwIfAgentLogIdConflict(error);
      throw error;
    }

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

    await this.tenantService.setDefaultConnectorIfUnset(
      tenantId,
      credential.id,
      auth,
    );

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
    onConfirmedNotRegistered?: () => Promise<void>,
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

    await onConfirmedNotRegistered?.();
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
   * whatever URL is registered (see TractionWebhookController), so this is
   * deliberately just the base connector webhook path with no topic segment.
   */
  private buildWebhookUrl(connectorId: string): string {
    const origin = this.oidcConfigService.getConfig().publicUrl;

    return `${origin}${API_BASE_PATH}/connectors/${connectorId}/webhooks/traction`;
  }

  private async assertHealthy(
    connectorType: ConnectorType,
    endpointUrl: string,
    credentials: ConnectorCredentialsDto,
  ): Promise<string | undefined> {
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

    return healthCheck.agentLogId;
  }

  /**
   * Replaces whatever agent log identifier the credentials carry with the one
   * the service just captured, or drops it when none was captured. A value
   * arriving from a caller is never carried through.
   */
  private withAgentLogId(
    credentials: ConnectorCredentialsDto,
    agentLogId: string | undefined,
  ): StoredConnectorCredentials {
    const rest: StoredConnectorCredentials = { ...credentials };
    delete rest.agentLogId;

    return agentLogId === undefined ? rest : { ...rest, agentLogId };
  }

  private hashAgentLogId(
    connectorType: ConnectorType,
    agentLogId: string | undefined,
  ): string | null {
    return agentLogId === undefined
      ? null
      : this.encryptionService.deriveBlindIndex(
          AGENT_LOG_ID_BINDING_DOMAIN,
          formatAgentLogBindingKey(connectorType, agentLogId),
        );
  }

  private throwIfAgentLogIdConflict(error: unknown): void {
    if (isUniqueConstraintViolation(error, AGENT_LOG_ID_UNIQUE_INDEX)) {
      throw new ConflictException(AGENT_LOG_ID_CONFLICT_MESSAGE);
    }
  }

  private async lazyRotateKeyIfNeeded(
    credential: ConnectorCredential,
    manager?: EntityManager,
  ): Promise<void> {
    if (this.encryptionService.requiresRotation(credential.keyVersion)) {
      const rotated = await this.credentialRepository.updateWithLock(
        credential.tenantId,
        credential.id,
        (current) => {
          if (!this.encryptionService.requiresRotation(current.keyVersion)) {
            return {};
          }
          const decrypted =
            this.encryptionService.decrypt<ConnectorCredentialsDto>(
              current.credentialsEncrypted,
              current.keyVersion,
            );
          const encryptedCredentials =
            this.encryptionService.encrypt(decrypted);
          return {
            credentialsEncrypted: encryptedCredentials.ciphertext,
            keyVersion: encryptedCredentials.keyVersion,
          };
        },
        manager,
      );

      if (rotated) Object.assign(credential, rotated);
    }
  }

  public async findById(
    tenantId: string,
    id: string,
    auth?: AuthContext,
    manager?: EntityManager,
  ): Promise<ConnectorCredential> {
    const credential = manager
      ? await this.credentialRepository.findByTenantAndIdForUpdate(
          tenantId,
          id,
          manager,
        )
      : await this.credentialRepository.findById(id);
    const notFound = `Connector credential with ID '${id}' was not found.`;

    if (!credential || credential.tenantId !== tenantId) {
      throw new NotFoundException(notFound);
    }

    assertResourceTenantOrNotFound(auth, credential.tenantId, notFound);
    await this.lazyRotateKeyIfNeeded(credential, manager);

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
    let snapshot = await this.findById(tenantId, id, auth);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const updates = await this.buildCredentialUpdates(snapshot, dto);
      let stale = false;
      let updated: ConnectorCredential | null;

      try {
        updated = await this.credentialRepository.updateWithLock(
          tenantId,
          id,
          (current) => {
            stale =
              current.endpointUrl !== snapshot.endpointUrl ||
              current.connectorType !== snapshot.connectorType ||
              current.active !== snapshot.active ||
              current.keyVersion !== snapshot.keyVersion ||
              !current.credentialsEncrypted.equals(
                snapshot.credentialsEncrypted,
              );
            return stale ? {} : updates;
          },
        );
      } catch (error) {
        this.throwIfAgentLogIdConflict(error);
        throw error;
      }

      if (!updated) {
        throw new NotFoundException(
          `Connector credential with ID '${id}' was not found.`,
        );
      }

      if (stale) {
        snapshot = updated;
        continue;
      }

      this.tokenManager.evict(id);
      await this.lazyRotateKeyIfNeeded(updated);
      return updated;
    }

    throw new ConflictException(
      'Connector changed during validation. Retry the update.',
    );
  }

  private async buildCredentialUpdates(
    existing: ConnectorCredential,
    dto: UpdateConnectorCredentialDto,
  ): Promise<Partial<Omit<ConnectorCredential, 'tenant'>>> {
    const updates: Partial<Omit<ConnectorCredential, 'tenant'>> = {};
    const endpointUrl = dto.endpointUrl ?? existing.endpointUrl;
    let credentialsToPersist: ConnectorCredentialsDto | undefined;

    if (dto.endpointUrl !== undefined) {
      updates.endpointUrl = dto.endpointUrl;
    }

    if (dto.credentials !== undefined) {
      const existingCredentials =
        this.encryptionService.decrypt<StoredConnectorCredentials>(
          existing.credentialsEncrypted,
          existing.keyVersion,
        );
      credentialsToPersist = {
        ...existingCredentials,
        ...(dto.credentials.apiKey !== undefined
          ? { apiKey: dto.credentials.apiKey }
          : {}),
        ...(dto.credentials.tractionTenantId !== undefined
          ? { tractionTenantId: dto.credentials.tractionTenantId }
          : {}),
        ...(dto.credentials.webhookSecret !== undefined
          ? { webhookSecret: dto.credentials.webhookSecret }
          : {}),
      };

      const agentLogId = await this.assertHealthy(
        existing.connectorType,
        endpointUrl,
        credentialsToPersist,
      );

      credentialsToPersist = this.withAgentLogId(
        credentialsToPersist,
        agentLogId,
      );
      updates.agentLogIdHash = await this.assertAgentLogIdAvailable(
        existing,
        agentLogId,
        existingCredentials,
      );

      const encryptedCredentials =
        this.encryptionService.encrypt(credentialsToPersist);

      updates.credentialsEncrypted = encryptedCredentials.ciphertext;
      updates.keyVersion = encryptedCredentials.keyVersion;
    } else if (dto.endpointUrl !== undefined) {
      // Credentials aren't being rotated, but the endpoint changed — still
      // validate it (SSRF checks included) against the existing credentials.
      const existingCredentials =
        this.encryptionService.decrypt<StoredConnectorCredentials>(
          existing.credentialsEncrypted,
          existing.keyVersion,
        );

      const agentLogId = await this.assertHealthy(
        existing.connectorType,
        endpointUrl,
        existingCredentials,
      );

      // A new endpoint can sit in front of a different sub-wallet, so the
      // stored identifier is refreshed from the token the check just read.
      if (agentLogId !== existingCredentials.agentLogId) {
        updates.agentLogIdHash = await this.assertAgentLogIdAvailable(
          existing,
          agentLogId,
          existingCredentials,
        );

        const encryptedCredentials = this.encryptionService.encrypt(
          this.withAgentLogId(existingCredentials, agentLogId),
        );

        updates.credentialsEncrypted = encryptedCredentials.ciphertext;
        updates.keyVersion = encryptedCredentials.keyVersion;
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException(
        'At least one of endpoint_url or credentials must be provided.',
      );
    }

    if (
      existing.connectorType === ConnectorType.TRACTION &&
      credentialsToPersist
    ) {
      const webhookUrl = this.buildWebhookUrl(existing.id);
      const webhookSecret = credentialsToPersist.webhookSecret as string;
      const context: ConnectorContext = {
        connectorId: existing.id,
        tenantId: existing.tenantId,
        endpointUrl,
        credentials: { ...credentialsToPersist },
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
        // Nothing to revert: the DB write below hasn't happened yet, so a
        // confirmed-unregistered result just falls through to the throw.
        const confirmedRegistered = await this.reconcileFailedRegistration(
          context,
          webhookUrl,
          webhookSecret,
        );

        if (!confirmedRegistered) {
          throw registrationError;
        }
      }
    }

    return updates;
  }

  /**
   * Rejects a sub-wallet held by another active connector before any call
   * that would mutate that wallet (webhook re-registration). The unique
   * index remains the atomic guarantee; this only avoids the side effect.
   * The connector being updated is excluded so re-saving the same sub-wallet
   * stays idempotent. Deliberately not tenant-filtered: a binding is global.
   * A refresh that returns no identifier for an already-bound connector is
   * rejected so an update can never silently erase an established binding.
   */
  private async assertAgentLogIdAvailable(
    existing: ConnectorCredential,
    agentLogId: string | undefined,
    existingCredentials: StoredConnectorCredentials,
  ): Promise<string | null> {
    const hash = this.hashAgentLogId(existing.connectorType, agentLogId);

    if (
      hash === null &&
      (existing.agentLogIdHash !== null ||
        existingCredentials.agentLogId !== undefined)
    ) {
      throw new UnprocessableEntityException(
        'The connector no longer reports its agent identifier; the existing binding was kept.',
      );
    }

    if (
      hash !== null &&
      (await this.credentialRepository.existsOtherActiveWithAgentLogIdHash(
        hash,
        existing.id,
      ))
    ) {
      throw new ConflictException(AGENT_LOG_ID_CONFLICT_MESSAGE);
    }

    return hash;
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
      const result = await this.credentialRepository.deleteUnlessDefault(
        tenantId,
        id,
      );
      if (result === ConnectorDeletionResult.DEFAULT) {
        throw new ConflictException(
          'Cannot delete the default connector. Select a different default connector in tenant settings first.',
        );
      }
      if (result === ConnectorDeletionResult.NOT_FOUND) {
        throw new NotFoundException(
          `Connector credential with ID '${id}' was not found.`,
        );
      }
    } catch (error) {
      // Defense in depth: the fk_credential_connector constraint is ON DELETE RESTRICT,
      // so a race can still fail here even if the pre-check passed.
      if (getPostgresErrorCode(error) === '23503') {
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

    const { status, latencyMs, message } = await this.healthCheckService.check(
      credential.connectorType,
      credential.endpointUrl,
      decrypted,
    );

    return { status, latencyMs, ...(message !== undefined ? { message } : {}) };
  }
}
