import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import {
  Operation,
  OperationRequest,
  OperationResult,
  OperationState,
} from './operation.entity';
import { OperationRepository } from './operation.repository';

// System-default TTL durations (milliseconds). PE-08 (#31) makes these configurable
// per tenant via tenant.config.operation_ttl.*, falling back to these defaults.
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const TTL = {
  PENDING_STALE_MS: 24 * HOUR_MS, // stale pending sweep horizon (used by PE-08)
  CREATED_DEFAULT_MS: 72 * HOUR_MS, // default horizon from creation
  COMPLETED_VIEWED_MS: 1 * HOUR_MS, // completed, after first view
  FAILED_VIEWED_MS: 24 * HOUR_MS, // failed, after first view
  FAILED_UNVIEWED_MS: 7 * DAY_MS, // failed, not yet viewed
} as const;

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

  public constructor(private readonly operations: OperationRepository) {}

  /**
   * Compute the expiry timestamp for an operation based on its state and view status.
   * Shared by CT-06 (#70) and ME-02 (#91). Non-terminal states (pending/processing) are
   * never shortened by viewing — only completed/failed have view-based TTL reduction.
   * PE-08 (#31) will layer per-tenant config overrides on top of these system defaults.
   */
  public computeExpiresAt(
    state: OperationState,
    createdAt: Date,
    viewedAt?: Date | null,
  ): Date {
    switch (state) {
      case OperationState.PENDING:
        return new Date(createdAt.getTime() + TTL.PENDING_STALE_MS);
      case OperationState.PROCESSING:
        return new Date(createdAt.getTime() + TTL.CREATED_DEFAULT_MS);
      case OperationState.COMPLETED:
        return viewedAt
          ? new Date(viewedAt.getTime() + TTL.COMPLETED_VIEWED_MS)
          : new Date(createdAt.getTime() + TTL.CREATED_DEFAULT_MS);
      case OperationState.FAILED:
        return viewedAt
          ? new Date(viewedAt.getTime() + TTL.FAILED_VIEWED_MS)
          : new Date(createdAt.getTime() + TTL.FAILED_UNVIEWED_MS);
      default:
        return new Date(createdAt.getTime() + TTL.CREATED_DEFAULT_MS);
    }
  }

  public async createOperation(
    input: CreateOperationInput,
  ): Promise<Operation> {
    const now = new Date();
    // On create the operation is pending: expires_at = created_at + 72h (issue spec).
    // The 24h pending-stale value is applied only by the PE-08 sweep, not at creation.
    const operation = this.operations.create({
      tenantId: input.tenantId,
      type: input.type,
      request: input.request,
      batchId: input.batchId ?? null,
      externalId: input.externalId ?? null,
      state: OperationState.PENDING,
      expiresAt: new Date(now.getTime() + TTL.CREATED_DEFAULT_MS),
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

    operation.viewedAt = new Date();
    operation.expiresAt = this.computeExpiresAt(
      operation.state,
      operation.createdAt,
      operation.viewedAt,
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

    operation.state = state;

    if (result !== undefined) {
      operation.result = result;
    }

    operation.expiresAt = this.computeExpiresAt(
      state,
      operation.createdAt,
      operation.viewedAt,
    );

    return this.operations.save(operation);
  }
}
