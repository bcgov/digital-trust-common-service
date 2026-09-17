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
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import {
  credentialStatesBelow,
  operationStatesBelow,
} from '../protocol-state-change/state-mapping';

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
    private readonly operationRepository: OperationRepository,
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
      const { adapter, context } = await this.adapterRegistry.resolve(
        tenantId,
        undefined,
        {
          connectorId: credential.connectorId,
        },
      );

      const result = await adapter.revoke(context, credential.externalId);

      // RevocationPort exposes only a final boolean, with no intermediate
      // "pending ledger write" signal, so every resolved call is treated as
      // synchronous/completed. This is a documented limitation until the
      // port grows a pending state (see PR description).
      //
      // The protocol.state-change worker also correlates this same
      // `operation` by externalId (TOPIC_OPERATION_TYPES includes
      // CREDENTIAL_REVOKE for revocation_registry) and can win the race
      // while adapter.revoke() above is still in flight, transitioning
      // `operation` to COMPLETED or FAILED before this method resumes. A
      // plain transitionState/updateState here would regress an
      // already-completed operation back to failed, or overwrite an
      // already-revoked credential/operation and duplicate audit side
      // effects. transitionStateIfForward/updateStateIfForward guard the
      // writes with the same `WHERE state IN (...)` query the protocol
      // worker itself uses, so only the caller that actually wins applies
      // its outcome — a loss reports the operation's actual current state
      // instead.
      if (!result.revoked) {
        const failed = await this.operationService.transitionStateIfForward(
          operation.id,
          OperationState.FAILED,
          operationStatesBelow(OperationState.FAILED),
          {
            code: 'REVOCATION_FAILED',
            message: result.error ?? 'Revocation was not applied',
          },
        );

        const current =
          failed ?? (await this.operationRepository.findById(operation.id));

        if (!current) {
          throw new NotFoundException('Operation not found');
        }

        await this.emitAudit(tenantId, credentialId, current.state);

        return current;
      }

      const revokedAt = result.revokedAt
        ? new Date(result.revokedAt)
        : new Date();

      await this.credentialRepository.updateStateIfForward(
        credentialId,
        tenantId,
        CredentialState.REVOKED,
        credentialStatesBelow(CredentialState.REVOKED),
        { revokedAt },
      );

      const completed = await this.operationService.transitionStateIfForward(
        operation.id,
        OperationState.COMPLETED,
        operationStatesBelow(OperationState.COMPLETED),
        { ...result },
      );

      const current =
        completed ?? (await this.operationRepository.findById(operation.id));

      if (!current) {
        throw new NotFoundException('Operation not found');
      }

      await this.emitAudit(tenantId, credentialId, current.state);

      return current;
    } catch (error) {
      if (!(error instanceof AdapterError)) {
        throw error;
      }

      this.logger.warn(
        `Credential revocation failed for credential '${credentialId}': ${error.message}`,
      );

      // Same race as the synchronous-completion path above: the protocol
      // worker may have already completed (or failed) this operation while
      // the adapter call was rejecting here, so this write is guarded too.
      // On a loss, report the operation's actual current state instead of
      // regressing it to FAILED.
      const failed = await this.operationService.transitionStateIfForward(
        operation.id,
        OperationState.FAILED,
        operationStatesBelow(OperationState.FAILED),
        { code: error.code, message: error.message },
      );

      const current =
        failed ?? (await this.operationRepository.findById(operation.id));

      if (!current) {
        throw new NotFoundException('Operation not found');
      }

      await this.emitAudit(tenantId, credentialId, current.state);

      return current;
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
