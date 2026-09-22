import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import {
  BusinessMetricsService,
  UNCLASSIFIED_LABEL,
} from '../common/telemetry/business-metrics.service';
import { TenantService } from '../tenant/tenant.service';

import {
  computeOperationExpiresAt,
  isTerminalOperationState,
} from './operation-ttl.util';
import { isKnownOperationType } from './operation-type.constants';
import {
  Operation,
  OperationRequest,
  OperationResult,
  OperationState,
} from './operation.entity';
import { OperationRepository } from './operation.repository';

export interface CreateOperationInput {
  tenantId: string;
  type: string;
  request: OperationRequest;
  batchId?: string | null;
  externalId?: string | null;
}

@Injectable()
export class OperationService {
  private readonly logger = new Logger(OperationService.name);

  public constructor(
    private readonly operations: OperationRepository,
    private readonly tenants: TenantService,
    private readonly businessMetrics: BusinessMetricsService,
  ) {}

  /**
   * Compute the expiry timestamp for an operation based on its state and view status.
   * Shared by CT-06 (#70) and ME-02 (#91). Non-terminal states (pending/processing) are
   * never shortened by viewing — only completed/failed have view-based TTL reduction.
   *
   * `tenantConfig` is the tenant's `config` JSONB blob (see Tenant entity). Per-tenant
   * overrides are read from `tenantConfig.operation_ttl.*`, falling back to system
   * defaults for any key that is absent or invalid (PE-08 / #31). PROCESSING uses the
   * fixed, non-overridable DEFAULT_CREATED_TTL_MS rather than the tenant's
   * completed_unviewed override, since that override is scoped to completed-but-not-
   * viewed operations only and must not affect operations still in flight.
   */
  public computeExpiresAt(
    state: OperationState,
    createdAt: Date,
    viewedAt?: Date | null,
    tenantConfig?: Record<string, unknown> | null,
  ): Date {
    return computeOperationExpiresAt(state, createdAt, viewedAt, tenantConfig);
  }

  public async createOperation(
    input: CreateOperationInput,
  ): Promise<Operation> {
    const now = new Date();
    const tenant = await this.tenants.findById(input.tenantId);

    // On create the operation is pending: expires_at = created_at +
    // tenant.config.operation_ttl.pending_stale (default 24h), resolved via
    // computeExpiresAt() so creation and any later recompute (e.g.
    // markViewed() on a still-pending operation) agree on the same value —
    // otherwise viewing a still-pending operation would rewrite its expiry
    // to a different TTL than the one it was created with.
    const operation = this.operations.create({
      tenantId: input.tenantId,
      type: input.type,
      request: input.request,
      batchId: input.batchId ?? null,
      externalId: input.externalId ?? null,
      state: OperationState.PENDING,
      expiresAt: this.computeExpiresAt(
        OperationState.PENDING,
        now,
        null,
        tenant.config,
      ),
    });

    return this.operations.save(operation);
  }

  /**
   * Tenant-scoped read backing GET /tenants/:tenantId/operations/:operationId.
   *
   * Only terminal states (completed/failed) are marked viewed: the TTL rules ignore
   * viewedAt for pending/processing, so stamping it on every poll of an in-flight
   * operation would be a write with no effect on expiry.
   */
  public async getForTenant(tenantId: string, id: string): Promise<Operation> {
    const operation = await this.operations.findByIdForTenant(id, tenantId);

    if (!operation) {
      throw new NotFoundException('Operation not found');
    }

    if (!isTerminalOperationState(operation.state) || operation.viewedAt) {
      return operation;
    }

    return this.applyViewed(operation);
  }

  /**
   * Stamps viewedAt in any state, unlike getForTenant. This is the writer-side
   * call for the webhook and state-update workers, where "viewed" records that a
   * consumer took delivery of the record rather than that someone polled the
   * route; the e2e pins that a still-PENDING operation can be marked viewed
   * without its TTL moving. Read paths should use getForTenant.
   */
  public async markViewed(id: string): Promise<Operation> {
    const operation = await this.operations.findById(id);

    if (!operation) {
      throw new NotFoundException('Operation not found');
    }

    if (operation.viewedAt) {
      return operation;
    }

    return this.applyViewed(operation);
  }

  private async applyViewed(operation: Operation): Promise<Operation> {
    const tenant = await this.tenants.findById(operation.tenantId);
    const viewedAt = new Date();
    const expiresAt = this.computeExpiresAt(
      operation.state,
      operation.createdAt,
      viewedAt,
      tenant.config,
    );

    const stored = await this.operations.markFirstView(
      operation.id,
      viewedAt,
      expiresAt,
    );

    // No row updated means either a concurrent poll stamped it first, or the
    // purge removed the row between the read and this write. Re-read to tell
    // them apart: the winner's values are authoritative, and a row that is gone
    // must not be served from the copy loaded moments ago.
    if (!stored) {
      const current = await this.operations.findById(operation.id);

      if (!current) {
        throw new NotFoundException('Operation not found');
      }

      return current;
    }

    operation.viewedAt = stored.viewedAt;
    operation.expiresAt = stored.expiresAt;

    return operation;
  }

  public async transitionState(
    id: string,
    state: OperationState,
    result?: OperationResult,
    manager?: EntityManager,
  ): Promise<Operation> {
    const operation = await this.operations.findById(id);

    if (!operation) {
      throw new NotFoundException('Operation not found');
    }

    const tenant = await this.tenants.findById(operation.tenantId);

    operation.state = state;

    if (result !== undefined) {
      operation.result = result;
    }

    operation.expiresAt = this.computeExpiresAt(
      state,
      operation.createdAt,
      operation.viewedAt,
      tenant.config,
    );

    const saved = await this.operations.save(operation, manager);

    this.recordTerminalOutcome(saved.type, state, manager);

    return saved;
  }

  /**
   * Guarded counterpart to transitionState for callers where the same
   * logical transition can be delivered more than once concurrently (the
   * protocol.state-change worker, given pg-boss's at-least-once delivery).
   * `fromStates` — the full set of states a forward move into `state` could
   * legitimately come from, via state-mapping.ts's `operationStatesBelow()`
   * — is enforced by the database at write time (OperationRepository.
   * transitionIfForward's `WHERE state IN (...)`), not by a value this call
   * read moments earlier. Returns null when another delivery already won (or
   * the operation has moved on since), so the caller must skip any audit,
   * domain event, or webhook dispatch for this call rather than re-firing
   * them.
   */
  public async transitionStateIfForward(
    id: string,
    state: OperationState,
    fromStates: OperationState[],
    result?: OperationResult,
    manager?: EntityManager,
  ): Promise<Operation | null> {
    const operation = await this.operations.findById(id);

    if (!operation) {
      throw new NotFoundException('Operation not found');
    }

    const tenant = await this.tenants.findById(operation.tenantId);
    const expiresAt = this.computeExpiresAt(
      state,
      operation.createdAt,
      operation.viewedAt,
      tenant.config,
    );

    const won = await this.operations.transitionIfForward(
      id,
      operation.tenantId,
      fromStates,
      {
        state,
        expiresAt,
        ...(result !== undefined ? { result } : {}),
      },
      manager,
    );

    if (!won) {
      return null;
    }

    // Reload rather than mutate the pre-write copy in memory: the guarded
    // UPDATE above also bumps the @UpdateDateColumn, and returning the
    // pre-write entity would expose a stale updatedAt to callers.
    const updated = await this.operations.findById(id, manager);

    if (!updated) {
      throw new NotFoundException('Operation not found');
    }

    this.recordTerminalOutcome(updated.type, state, manager);

    return updated;
  }

  /**
   * Counts an operation that has reached a terminal state.
   *
   * Placed on the two state-transition methods rather than at their call sites
   * because those are the only writers of a terminal state — the batch-parent
   * settlement in OperationRepository.claimBatchSettlement only claims the
   * right to finalize, and the winner comes back through transitionState. A
   * counter spread across call sites would miss the next one added.
   *
   * Only `completed` and `failed` are counted: pending and processing are not
   * outcomes, and counting them would make the total disagree with the number
   * of operations. `transitionStateIfForward` calls this only when its guarded
   * UPDATE won, so a duplicate pg-boss delivery of the same transition does not
   * double count — but only once that UPDATE is committed, which is why
   * `manager` is handed on: BusinessMetricsService holds the record until the
   * caller's transaction commits, and drops it if the transaction rolls back
   * and the worker replays the job.
   */
  private recordTerminalOutcome(
    type: string,
    state: OperationState,
    manager?: EntityManager,
  ): void {
    if (state !== OperationState.COMPLETED && state !== OperationState.FAILED) {
      return;
    }

    this.businessMetrics.recordCredentialOperation(
      // `type` is an open varchar, so anything could be stored there. The
      // metric dimension has to stay bounded, and an unrecognised type is
      // itself worth seeing rather than dropping.
      isKnownOperationType(type) ? type : UNCLASSIFIED_LABEL,
      state === OperationState.COMPLETED ? 'completed' : 'failed',
      manager,
    );
  }
}
