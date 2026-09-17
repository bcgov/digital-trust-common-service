import { JOB_QUEUES } from '@app/pg-boss';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, EntityManager } from 'typeorm';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { ConnectionService } from '../connection/connection.service';
import { CredentialState } from '../credential/credential.entity';
import { CredentialRepository } from '../credential/credential.repository';
import { JobsService } from '../jobs/jobs.service';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';

import type { ProtocolStateChangeJobData } from './protocol-state-change.worker';
import {
  connectionStatesBelow,
  credentialStatesBelow,
  operationStatesBelow,
  ProtocolOutcome,
  resolveProtocolOutcome,
  TOPIC_OPERATION_TYPES,
} from './state-mapping';

interface OperationOutcomeResult {
  readonly transitioned: boolean;
  /** Null when no Operation is linked to this externalId at all. */
  readonly operationType: string | null;
}

@Injectable()
export class ProtocolStateChangeService {
  private readonly logger = new Logger(ProtocolStateChangeService.name);

  public constructor(
    private readonly operationRepository: OperationRepository,
    private readonly operationService: OperationService,
    private readonly credentialRepository: CredentialRepository,
    private readonly connectionService: ConnectionService,
    private readonly jobsService: JobsService,
    private readonly domainAudit: DomainAuditService,
    private readonly eventEmitter: EventEmitter2,
    private readonly dataSource: DataSource,
  ) {}

  public async process(data: ProtocolStateChangeJobData): Promise<void> {
    const outcome = resolveProtocolOutcome(data.topic, data.protocolState);

    if (!outcome) {
      this.logger.warn(
        `Unrecognized ${data.topic} state '${data.protocolState}' for tenant ${data.tenantId}; ignoring`,
      );
      return;
    }

    // The guarded state writes below and the webhook-dispatch enqueue are
    // committed together: if the pg-boss insert fails, the whole
    // transaction rolls back instead of leaving the Operation/Credential/
    // Connection durably transitioned with no corresponding notification.
    // Without this, a pg-boss redelivery of this same job would find the
    // state already past the guard's `fromStates` window and silently
    // drop the webhook forever — rolling back the state write alongside
    // the enqueue means a redelivery instead sees the pre-transition state
    // again and retries both together.
    const result = await this.dataSource.transaction(async (manager) => {
      const operationOutcome = await this.applyOperationOutcome(
        data,
        outcome,
        manager,
      );
      let transitioned = operationOutcome.transitioned;
      const operationType = operationOutcome.operationType;

      if (
        operationOutcome.operationType === null ||
        operationOutcome.transitioned
      ) {
        if (data.topic === 'connections') {
          transitioned =
            (await this.applyConnectionOutcome(data, outcome, manager)) ||
            transitioned;
        } else {
          transitioned =
            (await this.applyCredentialOutcome(data, outcome, manager)) ||
            transitioned;
        }
      }

      if (!transitioned) {
        return { transitioned, event: null };
      }

      // A holder-initiated accept still confirms via an issue_credential
      // webhook like any issuer-driven issuance, but from the holder's own
      // perspective that confirmation *is* their acceptance landing, not a
      // fresh issuance — so `credential.issued` is overridden to
      // `credential.accepted` when the Operation this webhook resolved is the
      // holder's in-flight CredentialActionService accept, keeping the event
      // name consistent with the synchronous-acceptance case in
      // CredentialActionService. There's no equivalent override for reject:
      // HolderPort.rejectOffer always resolves synchronously (see
      // CredentialActionService.completeReject), so a CREDENTIAL_REJECT
      // Operation is never left in-flight for a later webhook to confirm.
      const event =
        outcome.event === 'credential.issued' &&
        operationType === OPERATION_TYPE.CREDENTIAL_ACCEPT
          ? 'credential.accepted'
          : outcome.event;

      // Only the six named domain events are meaningful to in-process
      // listeners (they're keyed on those exact strings), but every actual
      // transition — named or a raw topic/protocolState pair — is dispatched
      // to tenant webhook listeners.
      await this.jobsService.sendInTransaction(
        manager,
        JOB_QUEUES.WEBHOOK_DISPATCH,
        {
          tenantId: data.tenantId,
          event: event ?? `${data.topic}.${data.protocolState}`,
          resourceId: data.externalId,
          occurredAt: new Date().toISOString(),
        },
      );

      return { transitioned, event };
    });

    // In-process only, and only once the transition + durable enqueue above
    // have actually committed.
    if (result.event) {
      this.eventEmitter.emit(result.event, {
        tenantId: data.tenantId,
        externalId: data.externalId,
      });
    }
  }

  private async applyOperationOutcome(
    data: ProtocolStateChangeJobData,
    outcome: ProtocolOutcome,
    manager: EntityManager,
  ): Promise<OperationOutcomeResult> {
    const operation = await this.operationRepository.findByExternalIdForTenant(
      data.tenantId,
      data.externalId,
      TOPIC_OPERATION_TYPES[data.topic],
    );

    if (!operation) {
      // Not every topic has a linked Operation (e.g. an out-of-band
      // connections update with no create() Operation) — best-effort only.
      return { transitioned: false, operationType: null };
    }

    const updated = await this.operationService.transitionStateIfForward(
      operation.id,
      outcome.operationState,
      operationStatesBelow(outcome.operationState),
      outcome.operationState === OperationState.FAILED
        ? {
            code: `${data.topic.toUpperCase()}_FAILED`,
            message: data.protocolState,
          }
        : data.payload,
      manager,
    );

    if (!updated) {
      return { transitioned: false, operationType: operation.type };
    }

    if (operation.batchId) {
      await this.settleBatchParent(operation.batchId, data.tenantId, manager);
    }

    // findByExternalIdForTenant resolves the *most recently created*
    // in-flight Operation sharing this externalId (see its own doc): once a
    // holder-initiated accept/reject has created its own Operation
    // (CredentialActionService), that Operation — not the original
    // credential.offer one — is what this webhook lands on from here on.
    // But the offer Operation is the one returned by the 202 response and
    // referenced by Credential.operationId, i.e. what a polling client
    // actually holds; left alone, it would stay pending/processing forever
    // even though the exchange has now concluded. Mirror the same terminal
    // outcome onto it too, once the action Operation itself has actually
    // reached one.
    if (
      (operation.type === OPERATION_TYPE.CREDENTIAL_ACCEPT ||
        operation.type === OPERATION_TYPE.CREDENTIAL_REJECT) &&
      (outcome.operationState === OperationState.COMPLETED ||
        outcome.operationState === OperationState.FAILED)
    ) {
      await this.settleRelatedOfferOperation(data, outcome, manager);
    }

    return { transitioned: true, operationType: operation.type };
  }

  /**
   * Guarded the same way as the action Operation's own transition
   * (transitionStateIfForward + operationStatesBelow), so a duplicate or
   * out-of-order webhook delivery can't double-apply or regress the offer
   * Operation either — it is just as reachable by pg-boss's at-least-once
   * delivery as the action Operation is. Best-effort: if the Credential row
   * can't be found (e.g. this externalId never had one, or a data
   * inconsistency), there is no offer Operation to resolve and nothing more
   * to do here — the action Operation's own transition above already
   * succeeded and stands on its own.
   */
  private async settleRelatedOfferOperation(
    data: ProtocolStateChangeJobData,
    outcome: ProtocolOutcome,
    manager: EntityManager,
  ): Promise<void> {
    const credential = await this.credentialRepository.findByExternalId(
      data.tenantId,
      data.externalId,
    );

    if (!credential) {
      return;
    }

    await this.operationService.transitionStateIfForward(
      credential.operationId,
      outcome.operationState,
      operationStatesBelow(outcome.operationState),
      outcome.operationState === OperationState.FAILED
        ? {
            code: `${data.topic.toUpperCase()}_FAILED`,
            message: data.protocolState,
          }
        : data.payload,
      manager,
    );
  }

  private async applyCredentialOutcome(
    data: ProtocolStateChangeJobData,
    outcome: ProtocolOutcome,
    manager: EntityManager,
  ): Promise<boolean> {
    if (!outcome.credentialState) {
      return false;
    }

    const credential = await this.credentialRepository.findByExternalId(
      data.tenantId,
      data.externalId,
    );

    if (!credential) {
      return false;
    }

    const won = await this.credentialRepository.updateStateIfForward(
      credential.id,
      data.tenantId,
      outcome.credentialState,
      credentialStatesBelow(outcome.credentialState),
      {
        issuedAt:
          outcome.credentialState === CredentialState.ISSUED
            ? new Date()
            : undefined,
        revokedAt:
          outcome.credentialState === CredentialState.REVOKED
            ? new Date()
            : undefined,
      },
      manager,
    );

    if (!won) {
      return false;
    }

    await this.domainAudit.emit(
      {
        tenantId: data.tenantId,
        action: AuditAction.UPDATE,
        resourceType: 'credential',
        resourceId: credential.id,
      },
      manager,
    );

    return true;
  }

  private async applyConnectionOutcome(
    data: ProtocolStateChangeJobData,
    outcome: ProtocolOutcome,
    manager: EntityManager,
  ): Promise<boolean> {
    if (!outcome.connectionState) {
      return false;
    }

    const connection =
      await this.connectionService.findByExternalConnectionIdForTenant(
        data.tenantId,
        data.externalId,
      );

    if (!connection) {
      return false;
    }

    const updated = await this.connectionService.applyProtocolStateIfForward(
      connection,
      outcome.connectionState,
      connectionStatesBelow(outcome.connectionState),
      manager,
    );

    return updated !== null;
  }

  /**
   * After a child operation lands in a terminal state, checks whether every
   * sibling in the batch is also terminal and, if so, settles the parent:
   * failed if any child failed, otherwise completed. Locks the parent row
   * first (OperationRepository.lockBatchParent) so concurrent siblings
   * recount one at a time instead of racing each other's uncommitted
   * updates under READ COMMITTED — see that method's doc for why an
   * unlocked recount can leave the parent stuck `processing` forever. Also
   * guarded by claimBatchSettlement so only the sibling that wins the lock
   * ordering *and* still finds the parent `processing` actually settles it.
   *
   * `tenantId` — the child operation's own tenant, not read back from the
   * parent — is threaded through the lock, recount, and claim so a
   * cross-tenant or malformed `batchId` link can never lock, count, or
   * settle another tenant's parent operation. This is a system-triggered
   * path with no AuthContext, so that boundary has to be enforced here
   * rather than assumed from wherever the batchId originated.
   */
  private async settleBatchParent(
    batchId: string,
    tenantId: string,
    manager: EntityManager,
  ): Promise<void> {
    await this.operationRepository.lockBatchParent(batchId, tenantId, manager);

    const counts = await this.operationRepository.countByBatchGroupedByState(
      batchId,
      tenantId,
      manager,
    );
    const inFlight =
      counts[OperationState.PENDING] + counts[OperationState.PROCESSING];

    if (inFlight > 0) {
      return;
    }

    const finalState =
      counts[OperationState.FAILED] > 0
        ? OperationState.FAILED
        : OperationState.COMPLETED;

    const claimed = await this.operationRepository.claimBatchSettlement(
      batchId,
      tenantId,
      finalState,
      manager,
    );

    if (!claimed) {
      // Another sibling already settled the parent (or it wasn't
      // `processing` anymore for some other reason) — nothing more to do.
      return;
    }

    await this.operationService.transitionState(
      batchId,
      finalState,
      {
        ...counts,
      },
      manager,
    );
  }
}
