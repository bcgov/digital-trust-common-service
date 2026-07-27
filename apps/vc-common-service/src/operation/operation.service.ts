import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { TenantService } from '../tenant/tenant.service';

import {
  resolveOperationTtlMs,
  DEFAULT_CREATED_TTL_MS,
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
    const ttl = resolveOperationTtlMs(tenantConfig);

    switch (state) {
      case OperationState.PENDING:
        return new Date(createdAt.getTime() + ttl.pendingStale);
      case OperationState.PROCESSING:
        return new Date(createdAt.getTime() + DEFAULT_CREATED_TTL_MS);
      case OperationState.COMPLETED:
        return viewedAt
          ? new Date(viewedAt.getTime() + ttl.completedViewed)
          : new Date(createdAt.getTime() + ttl.completedUnviewed);
      case OperationState.FAILED:
        return viewedAt
          ? new Date(viewedAt.getTime() + ttl.failedViewed)
          : new Date(createdAt.getTime() + ttl.failedUnviewed);
      default:
        return new Date(createdAt.getTime() + DEFAULT_CREATED_TTL_MS);
    }
  }

  public async createOperation(
    input: CreateOperationInput,
  ): Promise<Operation> {
    const now = new Date();

    // On create the operation is pending: expires_at = created_at + the fixed
    // system default (issue spec: 72h), not the tenant's completed_unviewed
    // override — that override only applies once the operation has actually
    // completed without being viewed (see computeExpiresAt()). The
    // pending_stale TTL is applied only by the PE-08 purge sweep for stale
    // pending operations, not at creation.
    const operation = this.operations.create({
      tenantId: input.tenantId,
      type: input.type,
      request: input.request,
      batchId: input.batchId ?? null,
      externalId: input.externalId ?? null,
      state: OperationState.PENDING,
      expiresAt: new Date(now.getTime() + DEFAULT_CREATED_TTL_MS),
    });

    return this.operations.save(operation);
  }

  public async markViewed(id: string): Promise<Operation> {
    const operation = await this.operations.findById(id);

    if (!operation) {
      throw new NotFoundException('Operation not found');
    }

    if (operation.viewedAt) {
      return operation;
    }

    const tenant = await this.tenants.findById(operation.tenantId);

    operation.viewedAt = new Date();
    operation.expiresAt = this.computeExpiresAt(
      operation.state,
      operation.createdAt,
      operation.viewedAt,
      tenant.config,
    );

    return this.operations.save(operation);
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
