import { AdapterError } from '@app/credential-ports';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationService } from '../operation/operation.service';

import { CredentialState } from './credential.entity';
import { CredentialRepository } from './credential.repository';

/**
 * Credential formats whose adapters currently expose a revocation registry.
 * AnonCreds is the MVP format that supports revocation; the other formats
 * declared on `CredentialDefinitionFormat` (sd-jwt, mdl, w3c-vc) do not yet
 * have a revocation mechanism wired through the port layer, so a revoke
 * request against one of them is rejected up front (400) rather than
 * attempted and failing unpredictably at the adapter.
 */
const REVOCABLE_FORMATS: ReadonlySet<CredentialDefinitionFormat> = new Set([
  CredentialDefinitionFormat.ANONCREDS,
]);

/**
 * Backs POST /tenants/:tenantId/credentials/:credentialId/revoke.
 *
 * `credentialId` is the persisted Credential record id (contrast with the
 * accept/reject routes, which key off the Operation id) — see
 * `docs/openapi.yaml`.
 */
@Injectable()
export class CredentialRevokeService {
  private readonly logger = new Logger(CredentialRevokeService.name);

  public constructor(
    private readonly credentialRepository: CredentialRepository,
    private readonly operationService: OperationService,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly domainAudit: DomainAuditService,
  ) {}

  public async revoke(
    tenantId: string,
    credentialId: string,
  ): Promise<Operation> {
    const credential = await this.credentialRepository.findByIdForTenant(
      credentialId,
      tenantId,
    );

    // A cross-tenant id and a missing one are indistinguishable 404s, same as
    // CredentialRepository.findByIdForTenant's own tenant-scoped WHERE.
    if (!credential) {
      throw new NotFoundException(`Credential '${credentialId}' was not found`);
    }

    if (!REVOCABLE_FORMATS.has(credential.format)) {
      throw new BadRequestException(
        `Credential format '${credential.format}' does not support revocation`,
      );
    }

    if (!credential.externalId) {
      throw new BadRequestException(
        `Credential '${credentialId}' has no adapter-assigned identifier to revoke`,
      );
    }

    const operation = await this.operationService.createOperation({
      tenantId,
      type: OPERATION_TYPE.CREDENTIAL_REVOKE,
      request: {
        method: 'POST',
        path: `${API_BASE_PATH}/tenants/${tenantId}/credentials/${credentialId}/revoke`,
        body: {},
      },
      externalId: credential.externalId,
    });

    try {
      const { adapter } = await this.adapterRegistry.resolve(
        tenantId,
        undefined,
        {
          connectorId: credential.connectorId,
        },
      );

      const result = await adapter.revoke(credential.externalId);

      // RevocationPort exposes only a final boolean, with no intermediate
      // "pending ledger write" signal, so every resolved call is treated as
      // synchronous/completed. This is a documented limitation until the
      // port grows a pending state (see PR description).
      if (!result.revoked) {
        const failed = await this.operationService.transitionState(
          operation.id,
          OperationState.FAILED,
          {
            code: 'REVOCATION_FAILED',
            message: result.error ?? 'Revocation was not applied',
          },
        );

        await this.emitAudit(tenantId, credentialId, OperationState.FAILED);

        return failed;
      }

      const revokedAt = result.revokedAt
        ? new Date(result.revokedAt)
        : new Date();

      await this.credentialRepository.updateState(
        credentialId,
        CredentialState.REVOKED,
        { revokedAt },
      );

      const completed = await this.operationService.transitionState(
        operation.id,
        OperationState.COMPLETED,
        { ...result },
      );

      await this.emitAudit(tenantId, credentialId, OperationState.COMPLETED);

      return completed;
    } catch (error) {
      if (!(error instanceof AdapterError)) {
        throw error;
      }

      this.logger.warn(
        `Credential revocation failed for credential '${credentialId}': ${error.message}`,
      );

      const failed = await this.operationService.transitionState(
        operation.id,
        OperationState.FAILED,
        { code: error.code, message: error.message },
      );

      await this.emitAudit(tenantId, credentialId, OperationState.FAILED);

      return failed;
    }
  }

  private async emitAudit(
    tenantId: string,
    credentialId: string,
    state: OperationState,
  ): Promise<void> {
    await this.domainAudit.emit({
      tenantId,
      action: AuditAction.REVOKE,
      resourceType: 'credential',
      resourceId: credentialId,
      metadata: { state },
    });
  }
}
