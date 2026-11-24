import { JOB_QUEUES } from '@app/pg-boss';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { ConnectionRepository } from '../connection/connection.repository';
import { JobsService } from '../jobs/jobs.service';
import { OperationState } from '../operation/operation.entity';
import { OperationRepository } from '../operation/operation.repository';
import { OperationService } from '../operation/operation.service';
import {
  operationStatesBelow,
  resolveProtocolOutcome,
} from '../protocol-state-change/state-mapping';

import { PresentationExchangeRepository } from './presentation-exchange.repository';
import {
  presentationStage,
  verifiedPresentationResult,
} from './presentation-result';
import { presentationSteps } from './presentation-steps';

@Injectable()
export class PresentationExchangeLifecycleService {
  private readonly logger = new Logger(
    PresentationExchangeLifecycleService.name,
  );

  public constructor(
    private readonly exchanges: PresentationExchangeRepository,
    private readonly adapters: AdapterRegistry,
    private readonly connections: ConnectionRepository,
    private readonly operations: OperationRepository,
    private readonly operationService: OperationService,
    private readonly jobs: JobsService,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  public async observe(
    tenantId: string,
    connectorId: string,
    externalId: string,
  ): Promise<boolean> {
    let snapshot = await this.exchanges.findByBackend(
      tenantId,
      connectorId,
      externalId,
    );
    const unresolved =
      !snapshot &&
      (await this.exchanges.hasUncertainSubmission(tenantId, connectorId))
        ? await this.adapters.resolve(tenantId, undefined, { connectorId })
        : null;
    let remote = unresolved
      ? await unresolved.adapter.getPresentation(unresolved.context, externalId)
      : null;
    if (!snapshot) {
      if (remote?.connectionId && remote.requestNonce) {
        const candidates = await this.exchanges.findUncertainByNonce(
          tenantId,
          connectorId,
          remote.connectionId,
          remote.requestNonce,
        );
        if (candidates.length === 1) snapshot = candidates[0];
      }
    }
    if (!snapshot) {
      if (await this.exchanges.hasRecentSubmission(tenantId, connectorId)) {
        throw new Error(
          'Presentation submission correlation is pending; retry.',
        );
      }
      return false;
    }

    const connection = snapshot.connectionId
      ? await this.connections.findByIdForTenant(
          tenantId,
          snapshot.connectionId,
        )
      : null;
    if (
      !connection ||
      connection.externalConnectionId !== snapshot.externalConnectionId ||
      (connection.connectorId && connection.connectorId !== connectorId)
    ) {
      throw new Error('Presentation connection correlation changed.');
    }
    if (!remote) {
      const resolved = await this.adapters.resolve(tenantId, snapshot.format, {
        connectorId,
      });
      remote = await resolved.adapter.getPresentation(
        resolved.context,
        externalId,
      );
    }
    if (
      !remote ||
      (remote.externalId ?? remote.id) !== externalId ||
      remote.connectionId !== snapshot.externalConnectionId
    ) {
      throw new Error('Presentation backend correlation mismatch.');
    }
    const outcome = resolveProtocolOutcome(
      'present_proof',
      remote.state,
      remote.verified,
    );
    if (!outcome) {
      this.logger.warn(
        'Unsupported presentation state; reconciliation required.',
      );
      return true;
    }
    const result =
      outcome.operationState === OperationState.COMPLETED
        ? verifiedPresentationResult(
            remote,
            externalId,
            snapshot.externalConnectionId,
            snapshot.expectedEvidence,
          )
        : outcome.operationState === OperationState.FAILED
          ? {
              code: 'PRESENTATION_REQUEST_FAILED',
              message: 'Presentation verification failed',
            }
          : undefined;
    const stage = presentationStage(remote.state);

    const changed = await this.dataSource.transaction(async (manager) => {
      const local = await this.exchanges.lock(tenantId, snapshot.id, manager);
      if (
        !local ||
        local.connectorId !== connectorId ||
        (local.externalId !== externalId &&
          !(local.externalId === null && local.submission === 'uncertain')) ||
        local.externalConnectionId !== snapshot.externalConnectionId ||
        JSON.stringify(local.expectedEvidence) !==
          JSON.stringify(snapshot.expectedEvidence)
      ) {
        throw new Error('Presentation correlation changed; retry.');
      }
      const state =
        outcome.operationState === OperationState.COMPLETED
          ? 'verified'
          : outcome.operationState === OperationState.FAILED
            ? 'failed'
            : stage >= 2
              ? 'presentation-received'
              : stage >= 1
                ? 'request-sent'
                : 'pending';
      const changed = await this.exchanges.observe(
        local,
        externalId,
        state,
        manager,
      );
      if (changed && local.requestOperationId) {
        const operation = await this.operations.findByIdForTenant(
          local.requestOperationId,
          tenantId,
          manager,
        );
        if (
          operation &&
          operation.presentationExchangeId === local.id &&
          operation.expiresAt.getTime() > Date.now()
        ) {
          const steps = presentationSteps(stage, outcome.operationState);
          const updated = await this.operationService.transitionStateIfForward(
            operation.id,
            outcome.operationState,
            operationStatesBelow(outcome.operationState),
            result,
            manager,
            externalId,
            steps,
            true,
          );
          if (
            !updated &&
            outcome.operationState === OperationState.PROCESSING
          ) {
            await this.operationService.updateStepsIfActive(
              operation.id,
              tenantId,
              steps,
              manager,
            );
          }
        }
      }
      if (changed) {
        await this.jobs.sendInTransaction(
          manager,
          JOB_QUEUES.WEBHOOK_DISPATCH,
          {
            tenantId,
            event: outcome.event ?? `presentation-exchange.${state}`,
            resourceId: local.id,
            occurredAt: new Date().toISOString(),
          },
        );
      }
      return changed;
    });
    if (changed && outcome.event) {
      this.eventEmitter.emit(outcome.event, { tenantId, externalId });
    }
    return true;
  }
}
