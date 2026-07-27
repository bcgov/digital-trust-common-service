import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { TenantService } from '../tenant/tenant.service';

import { resolveOperationTtlMs } from './operation-ttl.util';
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
   * defaults for any key that is absent or invalid (PE-08 / #31).
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
        return new Date(createdAt.getTime() + ttl.completedUnviewed);
      case OperationState.COMPLETED:
        return viewedAt
          ? new Date(viewedAt.getTime() + ttl.completedViewed)
          : new Date(createdAt.getTime() + ttl.completedUnviewed);
      case OperationState.FAILED:
        return viewedAt
          ? new Date(viewedAt.getTime() + ttl.failedViewed)
          : new Date(createdAt.getTime() + ttl.failedUnviewed);
      default:
        return new Date(createdAt.getTime() + ttl.completedUnviewed);
    }
  }

  public async createOperation(
    input: CreateOperationInput,
  ): Promise<Operation> {
    const now = new Date();
    const tenant = await this.tenants.findById(input.tenantId);
    const ttl = resolveOperationTtlMs(tenant.config);

    // On create the operation is pending: expires_at = created_at + completed_unviewed TTL
    // (issue spec: 72h default). The pending_stale TTL is applied only by the PE-08
    // purge sweep for stale pending operations, not at creation.
    const operation = this.operations.create({
      tenantId: input.tenantId,
      type: input.type,
      request: input.request,
      batchId: input.batchId ?? null,
      externalId: input.externalId ?? null,
      state: OperationState.PENDING,
      expiresAt: new Date(now.getTime() + ttl.completedUnviewed),
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
