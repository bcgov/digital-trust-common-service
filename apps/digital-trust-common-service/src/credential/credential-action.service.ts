import {
  AdapterError,
  AgentAdapter,
  CredentialExchangeState,
} from '@app/credential-ports';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import {
  Operation,
  OperationResult,
  OperationState,
} from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';

export type CredentialHolderAction = 'accept' | 'reject';

interface ActionOutcome {
  readonly state: OperationState;
  readonly result: OperationResult;
}

/**
 * Backs POST /tenants/:tenantId/credentials/:exchangeId/accept|reject (CA-05).
 *
 * `exchangeId` is the Operation UUID returned by the not-yet-built CA-03
 * credential-offer endpoint, not the persisted Credential record id — see
 * `docs/openapi.yaml`. The offer Operation's `externalId` carries the
 * back-end agent's exchange id, which is what HolderPort needs.
 */
@Injectable()
export class CredentialActionService {
  private readonly logger = new Logger(CredentialActionService.name);

  public constructor(
    private readonly operationRepository: OperationRepository,
    private readonly operationService: OperationService,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly domainAudit: DomainAuditService,
  ) {}

  public async accept(
    tenantId: string,
    exchangeId: string,
  ): Promise<Operation> {
    return this.perform('accept', tenantId, exchangeId);
  }

  public async reject(
    tenantId: string,
    exchangeId: string,
  ): Promise<Operation> {
    return this.perform('reject', tenantId, exchangeId);
  }

  private async perform(
    action: CredentialHolderAction,
    tenantId: string,
    exchangeId: string,
  ): Promise<Operation> {
    const offer = await this.operationRepository.findByIdForTenant(
      exchangeId,
      tenantId,
    );

    // A cross-tenant id and a missing one are indistinguishable 404s, same as
    // OperationRepository.findByIdForTenant's own tenant-scoped WHERE. An
    // offer that never recorded the agent's exchange id (externalId) cannot
    // be actioned either, so it is treated the same as not found.
    if (!offer || !offer.externalId) {
      throw new NotFoundException(
        `Credential offer '${exchangeId}' was not found`,
      );
    }

    const actionOperation = await this.operationService.createOperation({
      tenantId,
      type:
        action === 'accept'
          ? OPERATION_TYPE.CREDENTIAL_ACCEPT
          : OPERATION_TYPE.CREDENTIAL_REJECT,
      request: {
        method: 'POST',
        path: `${API_BASE_PATH}/tenants/${tenantId}/credentials/${exchangeId}/${action}`,
        body: {},
      },
      externalId: offer.externalId,
    });

    try {
      const { adapter } = await this.adapterRegistry.resolve(tenantId);
      const outcome =
        action === 'accept'
          ? await this.completeAccept(adapter, offer.externalId)
          : await this.completeReject(adapter, offer.externalId);

      const completed = await this.operationService.transitionState(
        actionOperation.id,
        outcome.state,
        outcome.result,
      );

      await this.emitAudit(tenantId, exchangeId, action, outcome.state);

      return completed;
    } catch (error) {
      if (!(error instanceof AdapterError)) {
        throw error;
      }

      this.logger.warn(
        `Credential ${action} failed for exchange '${exchangeId}': ${error.message}`,
      );

      const failed = await this.operationService.transitionState(
        actionOperation.id,
        OperationState.FAILED,
        { code: error.code, message: error.message },
      );

      await this.emitAudit(tenantId, exchangeId, action, OperationState.FAILED);

      return failed;
    }
  }

  /**
   * Only a `Done` exchange state means the back-end agent confirmed the
   * acceptance synchronously; any other state means the agent is still
   * processing it, so the caller must poll the returned Operation.
   */
  private async completeAccept(
    adapter: AgentAdapter,
    externalId: string,
  ): Promise<ActionOutcome> {
    const exchange = await adapter.acceptOffer(externalId);
    const synchronous = exchange.state === CredentialExchangeState.Done;

    return {
      state: synchronous ? OperationState.COMPLETED : OperationState.PROCESSING,
      result: synchronous ? { ...exchange } : null,
    };
  }

  /** HolderPort.rejectOffer resolves with void, so a resolved call is always synchronous. */
  private async completeReject(
    adapter: AgentAdapter,
    externalId: string,
  ): Promise<ActionOutcome> {
    await adapter.rejectOffer(externalId);

    return { state: OperationState.COMPLETED, result: {} };
  }

  private async emitAudit(
    tenantId: string,
    exchangeId: string,
    action: CredentialHolderAction,
    state: OperationState,
  ): Promise<void> {
    await this.domainAudit.emit({
      tenantId,
      action: AuditAction.HOLD,
      resourceType: 'credential',
      resourceId: exchangeId,
      metadata: { action, state },
    });
  }
}
