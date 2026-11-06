import type { AuthContext } from '@app/auth';
import type { ConnectorContext } from '@app/credential-ports';
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
import { EncryptionService } from '../common/crypto/encryption.service';
import {
  getPostgresErrorCode,
  isUniqueConstraintViolation,
} from '../common/postgres-error';
import { ConnectorType } from '../connection/connection.entity';
import { CredentialRepository } from '../credential/credential.repository';
import { AgentLogPartitionCache } from '../log-access/agent-log-partition.cache';
import { TenantService } from '../tenant/tenant.service';

import { ConnectorHealthCheckService } from './connector-health-check.service';
import { Connector } from './connector.entity';
import {
  ConnectorRepository,
  ConnectorDeletionResult,
} from './connector.repository';
import {
  CONNECTOR_MANAGERS,
  AbstractConnector,
  type ConnectorManagers,
} from './connectors/abstract-connector.service';
import {
  ConnectorDto,
  CreateConnectorCredentialDto,
} from './dto/create-connector.dto';
import { UpdateConnectorCredentialDto } from './dto/update-connector.dto';

const AGENT_LOG_ID_BINDING_DOMAIN = 'connector-agent-log-id:v1';
const AGENT_LOG_ID_UNIQUE_INDEX = 'uq_connector_credential_agent_log_id_hash';
const AGENT_LOG_ID_CONFLICT_MESSAGE =
  'This agent sub-wallet is already bound to another connector.';

/**
 * What is stored in `credentials_encrypted`: the tenant-supplied credentials
 * plus the agent log identifier the service captured from the agent's token.
 * The identifier is never part of any request DTO.
 */
type StoredConnectorCredentials = ConnectorDto & {
  agentLogId?: string;
};

@Injectable()
export class ConnectorService {
  private readonly logger = new Logger(ConnectorService.name);

  public constructor(
    private readonly credentialRepository: ConnectorRepository,
    @Inject(forwardRef(() => TenantService))
    private readonly tenantService: TenantService,
    private readonly encryptionService: EncryptionService,
    private readonly healthCheckService: ConnectorHealthCheckService,
    private readonly credentialUsageRepository: CredentialRepository,
    @Inject(CONNECTOR_MANAGERS)
    private readonly connectorManagers: ConnectorManagers,
    private readonly agentPartitionCache: AgentLogPartitionCache,
  ) {}

  public async create(
    tenantId: string,
    dto: CreateConnectorCredentialDto,
    auth: AuthContext,
  ): Promise<Connector> {
    assertTenantAccess(auth, tenantId);
    await this.tenantService.findById(tenantId);

    const manager = this.connectorManagers[dto.connectorType];
    manager?.prepareCredentials(dto.credentials);

    const agentLogId = await this.assertHealthy(
      dto.connectorType,
      dto.endpointUrl,
      dto.credentials,
    );

    const encryptedCredentials = this.encryptionService.encrypt(
      this.withAgentLogId(dto.credentials, agentLogId),
    );

    let credential: Connector;

    try {
      credential = await this.credentialRepository.create({
        tenantId,
        connectorType: dto.connectorType,
        credentialsEncrypted: encryptedCredentials.ciphertext,
        endpointUrl: dto.endpointUrl,
        active: true,
        keyVersion: encryptedCredentials.keyVersion,
        agentLogIdHash: this.hashAgentLogId(dto.connectorType, agentLogId),
      } as Connector);
    } catch (error) {
      this.throwIfAgentLogIdConflict(error);
      throw error;
    }

    this.agentPartitionCache.invalidate(tenantId);

    if (manager) {
      const context: ConnectorContext = {
        connectorId: credential.id,
        tenantId,
        endpointUrl: credential.endpointUrl,
        credentials: { ...dto.credentials },
      };

      try {
        await manager.ensureWebhookRegistered(context);
      } catch (registrationError) {
        const confirmedRegistered = await this.reconcileFailedRegistration(
          manager,
          context,
          () => this.deleteOrLogFailure(credential.id),
        );

        this.agentPartitionCache.invalidate(tenantId);

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
   * A registration call can fail after the connector has already applied the PUT
   * (e.g. the response times out), so a bare try/catch can't tell "never
   * happened" apart from "happened, but we didn't hear back". This checks
   * the connector agent actual state before deciding what's safe:
   * - registered remotely: the failure was cosmetic, keep the persisted row.
   * - confirmed not registered: safe to run the cleanup callback.
   * - verification itself fails: state is unknown, so nothing is reverted —
   *   an unverified revert risks diverging from a change the connector agent did apply.
   * Returns true only when the remote state is confirmed to already match.
   */
  private async reconcileFailedRegistration(
    manager: AbstractConnector,
    context: ConnectorContext,
    onConfirmedNotRegistered?: () => Promise<void>,
  ): Promise<boolean> {
    let isRegistered: boolean;

    try {
      isRegistered = await manager.isWebhookRegistered(context);
    } catch (verificationError) {
      this.logger.error(
        `Could not verify webhook registration state for connector '${context.connectorId}' after a registration failure; leaving it as-is pending manual reconciliation.`,
        verificationError instanceof Error
          ? verificationError.stack
          : verificationError,
      );
      return false;
    }

    if (isRegistered) {
      this.logger.warn(
        `Webhook registration for connector '${context.connectorId}' reported failure but the connector confirms it was applied; keeping the persisted state.`,
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

  private async assertHealthy(
    connectorType: ConnectorType,
    endpointUrl: string,
    credentials: ConnectorDto,
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
    credentials: ConnectorDto,
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
    credential: Connector,
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
          const decrypted = this.encryptionService.decrypt<ConnectorDto>(
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
  ): Promise<Connector> {
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

  public async findByTenant(tenantId: string): Promise<Connector[]> {
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
  ): Promise<Connector[]> {
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
  ): Promise<Connector[]> {
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
   * Lookup for inbound webhook verification, where the caller has no tenant JWT and thus no
   * AuthContext for findById's tenant check — the connector id and its
   * stored secret are themselves the credential presented. Returns null
   * (never throws/404s) on any mismatch so the guard can respond identically
   * whether the id doesn't exist or isn't active.
   */
  public async findActiveForWebhook(id: string): Promise<Connector | null> {
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
  ): Promise<Connector> {
    let snapshot = await this.findById(tenantId, id, auth);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const updates = await this.buildCredentialUpdates(snapshot, dto);
      let stale = false;
      let updated: Connector | null;

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

      this.agentPartitionCache.invalidate(tenantId);

      if (!updated) {
        throw new NotFoundException(
          `Connector credential with ID '${id}' was not found.`,
        );
      }

      if (stale) {
        snapshot = updated;
        continue;
      }

      this.connectorManagers[updated.connectorType]?.evict(id);
      await this.lazyRotateKeyIfNeeded(updated);
      return updated;
    }

    throw new ConflictException(
      'Connector changed during validation. Retry the update.',
    );
  }

  private async buildCredentialUpdates(
    existing: Connector,
    dto: UpdateConnectorCredentialDto,
  ): Promise<Partial<Omit<Connector, 'tenant'>>> {
    const updates: Partial<Omit<Connector, 'tenant'>> = {};
    const endpointUrl = dto.endpointUrl ?? existing.endpointUrl;
    let credentialsToPersist: ConnectorDto | undefined;

    if (dto.endpointUrl !== undefined) {
      updates.endpointUrl = dto.endpointUrl;
    }

    if (dto.credentials !== undefined) {
      const existingCredentials =
        this.encryptionService.decrypt<StoredConnectorCredentials>(
          existing.credentialsEncrypted,
          existing.keyVersion,
        );
      credentialsToPersist = this.connectorManagers[
        existing.connectorType
      ]?.mergeCredentials(existingCredentials, dto.credentials) ?? {
        ...existingCredentials,
        ...(dto.credentials.apiKey !== undefined
          ? { apiKey: dto.credentials.apiKey }
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

    const manager = this.connectorManagers[existing.connectorType];

    if (manager && credentialsToPersist) {
      const context: ConnectorContext = {
        connectorId: existing.id,
        tenantId: existing.tenantId,
        endpointUrl,
        credentials: { ...credentialsToPersist },
      };

      try {
        await manager.ensureWebhookRegistered(context);
      } catch (registrationError) {
        // Nothing to revert: the DB write below hasn't happened yet, so a
        // confirmed-unregistered result just falls through to the throw.
        const confirmedRegistered = await this.reconcileFailedRegistration(
          manager,
          context,
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
    existing: Connector,
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
      this.agentPartitionCache.invalidate(tenantId);
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
    try {
      return await this.credentialRepository.deactivateAllForTenant(tenantId);
    } finally {
      this.agentPartitionCache.invalidate(tenantId);
    }
  }

  public async testConnectivity(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<{ status: string; latencyMs: number; message?: string }> {
    const credential = await this.findById(tenantId, id, auth);

    const decrypted = this.encryptionService.decrypt<ConnectorDto>(
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
