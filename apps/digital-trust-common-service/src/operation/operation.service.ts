import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { TenantService } from '../tenant/tenant.service';

import {
  computeOperationExpiresAt,
  isTerminalOperationState,
} from './operation-ttl.util';
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
   * Tenant-scoped read backing GET /tenants/:tenantId/operations/:operationId (AG-02).
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
   * call for CT-06 (#70) and ME-02 (#91), where "viewed" records that a consumer
   * took delivery of the record rather than that someone polled the route; the
   * e2e pins that a still-PENDING operation can be marked viewed without its TTL
   * moving. Read paths should use getForTenant.
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

    // No row updated means a concurrent poll stamped it first. Its values are
    // authoritative; re-read rather than returning the ones we did not write.
    if (!stored) {
      return (await this.operations.findById(operation.id)) ?? operation;
    }

    operation.viewedAt = stored.viewedAt;
    operation.expiresAt = stored.expiresAt;

    return operation;
  }

  public async transitionState(
    id: string,
    state: OperationState,
    result?: OperationResult,
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

    return this.operations.save(operation);
  }
}
