import {
  AdapterError,
  AgentAdapter,
  ConnectorContext,
  CredentialExchangeState,
} from '@app/credential-ports';
import { JOB_QUEUES } from '@app/pg-boss';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { JobsService } from '../jobs/jobs.service';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import {
  Operation,
  OperationResult,
  OperationState,
} from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import { operationStatesBelow } from '../protocol-state-change/state-mapping';

export type CredentialHolderAction = 'accept' | 'reject';

interface ActionOutcome {
  readonly state: OperationState;
  readonly result: OperationResult;
}

/**
 * Backs POST /tenants/:tenantId/credentials/:exchangeId/accept|reject.
 *
 * `exchangeId` is the Operation UUID returned by the credential-offer
 * endpoint, not the persisted Credential record id — see
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
    private readonly eventEmitter: EventEmitter2,
    private readonly jobsService: JobsService,
    private readonly dataSource: DataSource,
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

    // A cross-tenant id, a missing id, an Operation that isn't a credential
    // offer, and an offer that never recorded the agent's exchange id
    // (externalId) are all indistinguishable 404s: none of them is an
    // actionable offer for this tenant, same as
    // OperationRepository.findByIdForTenant's own tenant-scoped WHERE.
    if (
      !offer ||
      offer.type !== OPERATION_TYPE.CREDENTIAL_OFFER ||
      !offer.externalId
    ) {
      throw new NotFoundException(
        `Credential offer '${exchangeId}' was not found`,
      );
    }

    // findByExternalIdForTenant's recency ordering (see its own doc comment)
    // only disambiguates which *protocol* an externalId belongs to; it does
    // not uniquely correlate a webhook back to one of several sibling
    // accept/reject Operations for the same offer. Without this check, a
    // concurrent call or a client retry would create a second
    // CREDENTIAL_ACCEPT/REJECT Operation for the same externalId, and the
    // protocol.state-change worker would only ever complete the newest one —
    // leaving the older sibling PENDING/PROCESSING forever. Reusing an
    // already in-flight holder-action Operation for this offer instead of
    // creating a new one keeps that correlation one-to-one.
    const inFlightAction =
      await this.operationRepository.findByExternalIdForTenant(
        tenantId,
        offer.externalId,
        [
          action === 'accept'
            ? OPERATION_TYPE.CREDENTIAL_ACCEPT
            : OPERATION_TYPE.CREDENTIAL_REJECT,
        ],
      );

    if (inFlightAction) {
      // A PROCESSING row means the adapter already confirmed this action is
      // under way — the eventual issue_credential webhook is what resolves
      // it, and returning it here is correct. A PENDING row instead means
      // createOperation persisted it durably but this method never reached
      // the adapter call/transition below — most likely a previous attempt
      // that crashed in that exact window. Nothing else ever advances a
      // stuck PENDING row (no sweep/lease reclaims it), so returning it
      // as-is here would leave it unresolved until it expires. Retrying the
      // adapter call against that same row is what actually recovers it.
      if (inFlightAction.state === OperationState.PROCESSING) {
        return inFlightAction;
      }

      return this.executeAction(
        action,
        tenantId,
        exchangeId,
        offer.externalId,
        inFlightAction,
      );
    }

    // The check above is not an atomic claim: two concurrent requests can
    // both observe no in-flight row and both reach this insert. The
    // `uq_operation_inflight_holder_action` partial unique index (see its
    // migration) is what actually enforces "at most one in-flight
    // credential.accept/credential.reject Operation per tenant/externalId"
    // — the loser's INSERT fails with a unique violation (23505) rather
    // than silently creating the duplicate this check was meant to prevent.
    let actionOperation: Operation;

    try {
      actionOperation = await this.operationService.createOperation({
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
    } catch (error) {
      const pgCode = (error as { driverError?: { code?: string } }).driverError
        ?.code;

      if (pgCode !== '23505') {
        throw error;
      }

      // Lost the race: a concurrent call already claimed the single
      // in-flight holder-action slot this index allows for this offer.
      // Return that winner instead of surfacing the constraint violation.
      // findByExternalIdForTenant excludes terminal states and would miss a
      // winner that has already completed/failed by now, and it isn't
      // scoped to this action alone — findLatestByExternalIdAndTypeForTenant
      // finds the winner regardless of state and only for this action type.
      const winner =
        await this.operationRepository.findLatestByExternalIdAndTypeForTenant(
          tenantId,
          offer.externalId,
          action === 'accept'
            ? OPERATION_TYPE.CREDENTIAL_ACCEPT
            : OPERATION_TYPE.CREDENTIAL_REJECT,
        );

      if (!winner) {
        throw error;
      }

      // Same recovery as the pre-check above: a winner still PENDING never
      // reached the adapter call/transition, whether that's this request's
      // own crashed prior attempt or the concurrent one that won the insert
      // race just now.
      if (winner.state === OperationState.PENDING) {
        return this.executeAction(
          action,
          tenantId,
          exchangeId,
          offer.externalId,
          winner,
        );
      }

      return winner;
    }

    return this.executeAction(
      action,
      tenantId,
      exchangeId,
      offer.externalId,
      actionOperation,
    );
  }

  /**
   * Calls the adapter and durably transitions `actionOperation` off PENDING.
   * Shared by a freshly created actionOperation and a durable PENDING one
   * recovered from a previous attempt (see perform()) — from this point on
   * the two are indistinguishable: either way, the adapter call and guarded
   * transition below are what a stuck PENDING row is actually waiting on.
   */
  private async executeAction(
    action: CredentialHolderAction,
    tenantId: string,
    exchangeId: string,
    externalId: string,
    actionOperation: Operation,
  ): Promise<Operation> {
    try {
      const { adapter, context } = await this.adapterRegistry.resolve(tenantId);
      const outcome =
        action === 'accept'
          ? await this.completeAccept(adapter, context, externalId)
          : await this.completeReject(adapter, context, externalId);

      // Only a synchronous completion is a real domain event here — a
      // PROCESSING outcome means the agent hasn't confirmed yet, and the
      // eventual confirmation arrives later as an issue_credential webhook
      // handled by the protocol.state-change worker instead.
      //
      // That worker correlates the same actionOperation by externalId
      // (TOPIC_OPERATION_TYPES includes CREDENTIAL_ACCEPT for
      // issue_credential) and can win the race while the adapter call above
      // is still in flight, transitioning actionOperation to COMPLETED or
      // FAILED before this method resumes. A plain transitionState here
      // would regress an already-completed operation back to PROCESSING, or
      // overwrite it and re-publish a duplicate credential.accepted/
      // credential.rejected for a synchronous result. transitionStateIfForward
      // guards the write with the same `WHERE state IN (...)` query the
      // protocol worker itself uses, so only the caller that actually wins
      // proceeds to enqueue/emit.
      //
      // The webhook-dispatch enqueue happens in the same DB transaction as
      // the state write: if the pg-boss insert fails, the whole transition
      // rolls back instead of leaving the Operation durably COMPLETED with
      // no corresponding notification and no durable retry path — the
      // caller then sees a real error for a command that genuinely didn't
      // take effect, rather than one that silently did.
      const { operation: completed, won } = await this.dataSource.transaction(
        async (manager) => {
          const updated = await this.operationService.transitionStateIfForward(
            actionOperation.id,
            outcome.state,
            operationStatesBelow(outcome.state),
            outcome.result,
            manager,
          );

          if (!updated) {
            // The protocol worker already completed (or failed) this same
            // actionOperation first. Our own outcome is stale: report the
            // operation's actual current state and skip the enqueue below,
            // rather than silently dropping the fact that we lost.
            const current = await this.operationRepository.findById(
              actionOperation.id,
            );

            if (!current) {
              throw new NotFoundException('Operation not found');
            }

            return { operation: current, won: false };
          }

          if (outcome.state === OperationState.COMPLETED) {
            await this.jobsService.sendInTransaction(
              manager,
              JOB_QUEUES.WEBHOOK_DISPATCH,
              {
                tenantId,
                event: this.domainEventName(action),
                resourceId: externalId,
                occurredAt: new Date().toISOString(),
              },
            );
          }

          return { operation: updated, won: true };
        },
      );

      await this.emitAudit(tenantId, exchangeId, action, completed.state);

      // In-process only, and only once the transition + durable enqueue
      // above have actually committed — no compensating action needed if
      // this fails, unlike the webhook dispatch. Skipped when this caller
      // lost the race above, so the protocol worker's own confirmation is
      // the only thing that ever emits credential.accepted/rejected for
      // that outcome.
      if (won && outcome.state === OperationState.COMPLETED) {
        this.eventEmitter.emit(this.domainEventName(action), {
          tenantId,
          externalId,
        });
      }

      return completed;
    } catch (error) {
      if (!(error instanceof AdapterError)) {
        throw error;
      }

      this.logger.warn(
        `Credential ${action} failed for exchange '${exchangeId}': ${error.message}`,
      );

      // Same race as the synchronous-completion path above: the protocol
      // worker may have already completed (or failed) this actionOperation
      // while the adapter call was rejecting here, so this write is guarded
      // too. On a loss, report the operation's actual current state instead
      // of regressing it to FAILED, and skip the enqueue below.
      const current = await this.dataSource.transaction(async (manager) => {
        const failed = await this.operationService.transitionStateIfForward(
          actionOperation.id,
          OperationState.FAILED,
          operationStatesBelow(OperationState.FAILED),
          { code: error.code, message: error.message },
          manager,
        );

        if (!failed) {
          const existing = await this.operationRepository.findById(
            actionOperation.id,
          );

          if (!existing) {
            throw new NotFoundException('Operation not found');
          }

          return existing;
        }

        await this.jobsService.sendInTransaction(
          manager,
          JOB_QUEUES.WEBHOOK_DISPATCH,
          {
            tenantId,
            event: `credential.${action}.failed`,
            resourceId: externalId,
            occurredAt: new Date().toISOString(),
          },
        );

        return failed;
      });

      await this.emitAudit(tenantId, exchangeId, action, current.state);

      return current;
    }
  }

  /**
   * Only a `Done` exchange state means the back-end agent confirmed the
   * acceptance synchronously; any other state means the agent is still
   * processing it, so the caller must poll the returned Operation.
   */
  private async completeAccept(
    adapter: AgentAdapter,
    context: ConnectorContext,
    externalId: string,
  ): Promise<ActionOutcome> {
    const exchange = await adapter.acceptOffer(context, externalId);
    const synchronous = exchange.state === CredentialExchangeState.Done;

    return {
      state: synchronous ? OperationState.COMPLETED : OperationState.PROCESSING,
      result: synchronous ? { ...exchange } : null,
    };
  }

  /** HolderPort.rejectOffer resolves with void, so a resolved call is always synchronous. */
  private async completeReject(
    adapter: AgentAdapter,
    context: ConnectorContext,
    externalId: string,
  ): Promise<ActionOutcome> {
    await adapter.rejectOffer(context, externalId);

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

  /**
   * `credential.accepted`/`credential.rejected` are the holder's own
   * confirmed action, distinct from the protocol.state-change worker's
   * `credential.issued`/`credential.rejected` (issuer-side exchange
   * outcome) — both queues can legitimately fire independently.
   */
  private domainEventName(
    action: CredentialHolderAction,
  ): 'credential.accepted' | 'credential.rejected' {
    return action === 'accept' ? 'credential.accepted' : 'credential.rejected';
  }
}
