import { ApiJwtAuth, CurrentAuth, JwtGuard, TenantGuard } from '@app/auth';
import type { AuthContext } from '@app/auth';
import {
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { API_VERSION } from '../common/constants/api-version.constants';
import { TenantTierRateLimitGuard } from '../rate-limit/tenant-tier-rate-limit.guard';
import { TenantStatusGuard } from '../tenant/tenant-status.guard';

import { ListOperationItemsQueryDto } from './dto/list-operation-items-query.dto';
import { ListOperationsQueryDto } from './dto/list-operations-query.dto';
import { OperationRequestResponseDto } from './dto/operation-request-response.dto';
import {
  OperationResponseDto,
  OperationsPaginationDto,
  PaginatedOperationsResponseDto,
} from './dto/operation-response.dto';
import { parseOperationWait } from './operation-wait.util';
import { OperationService, PaginatedOperations } from './operation.service';

const operationExample = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  batch_id: null,
  type: 'credential.offer',
  state: 'pending',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  result: null,
};

/**
 * Operation polling. No scope is required beyond a tenant-scoped token:
 * reads are authorized by TenantGuard claim-match, not ScopeGuard, so a readonly
 * role can poll the operations its tenant created.
 */
@ApiTags('Operations')
@ApiJwtAuth()
@UseGuards(JwtGuard, TenantGuard, TenantStatusGuard, TenantTierRateLimitGuard)
@ApiUnauthorizedResponse({ description: 'Authentication is required' })
@ApiForbiddenResponse({
  description: 'Token tenant claim does not match the requested tenant',
})
@Controller({ path: 'tenants/:tenantId/operations', version: API_VERSION })
export class OperationController {
  public constructor(private readonly operations: OperationService) {}

  @Get()
  @ApiOperation({
    summary: 'List tenant operations',
    description:
      'Any authenticated tenant-scoped token may read its tenant operations; no operations:read scope is required. Filters combine by exact match. Pages are ordered by created_at DESC, then id DESC, using opaque cursors. Returning a completed or failed operation marks its first view and recalculates its TTL without changing updated_at.',
  })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Tenant operations with optional state and type filters',
    type: PaginatedOperationsResponseDto,
    examples: {
      pending: {
        summary: 'Pending credential offers',
        value: {
          data: [operationExample],
          pagination: { next_cursor: null, has_more: false },
        },
      },
      empty: {
        summary: 'No matching operations',
        value: { data: [], pagination: { next_cursor: null, has_more: false } },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Invalid tenant UUID, query filters, limit, or pagination cursor',
  })
  public async findByTenantId(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListOperationsQueryDto,
  ): Promise<PaginatedOperationsResponseDto> {
    const page = await this.operations.listForTenant(tenantId, query);
    return this.toPaginatedResponse(page);
  }

  @Get(':operationId/request')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Retrieve the original operation request',
    description:
      'Any authenticated token scoped to this tenant can retrieve the original method, path, and unredacted body. The body may contain credential attributes and other PII. Access is synchronously audited with actor identity, access time, and operation_id before disclosure; the body is never copied into audit metadata. Request data shares the operation TTL and is removed by operation purge. Terminal reads apply first-view TTL shortening. Field-level redaction is not implemented.',
  })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({ name: 'operationId', format: 'uuid' })
  @ApiOkResponse({
    description:
      'Original unredacted request, returned only after access is audited. May contain PII; removed when the operation is purged.',
    type: OperationRequestResponseDto,
    headers: {
      'Cache-Control': {
        description: 'Do not cache the original request or its PII.',
        schema: { type: 'string', example: 'no-store' },
      },
    },
    examples: {
      originalRequest: {
        summary: 'Original request context',
        value: {
          method: 'POST',
          path: '/api/v1/tenants/123e4567-e89b-42d3-a456-426614174001/credentials/offer',
          body: {},
        },
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Audit write failed; the original request is not returned',
  })
  @ApiBadRequestResponse({
    description: 'A path parameter is not a valid UUID',
  })
  @ApiNotFoundResponse({
    description: 'Operation not found or belongs to another tenant',
  })
  public async findRequest(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @CurrentAuth() auth: AuthContext,
  ): Promise<OperationRequestResponseDto> {
    const request = await this.operations.getRequestForTenant(
      tenantId,
      operationId,
      auth,
    );
    return OperationRequestResponseDto.fromRequest(request);
  }

  @Get(':operationId/items')
  @ApiOperation({
    summary: 'List batch child operations',
    description:
      'Requires only a token scoped to this tenant. The operation must be a batch parent (type ends in -batch and batch_id is null). State filtering and opaque cursor pagination apply to child operations. Prefer: wait=30 checks all tenant-scoped child states and exchange progress and the parent once per second until a progress change or timeout, including changes outside the requested page. Terminal parents return immediately. Timeout returns HTTP 200 with the normal page; no timeout fields are added. Terminal children returned on the page receive first-view TTL treatment.',
  })
  @ApiHeader({
    name: 'Prefer',
    required: false,
    description:
      'Optional wait=30 long-poll. Non-negative integer seconds, capped at 30; wait=0 returns immediately. Invalid or duplicate wait values return 400. Unrelated preferences are ignored.',
    schema: { type: 'string', example: 'wait=30' },
  })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({ name: 'operationId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Batch child operations with optional state filtering',
    type: PaginatedOperationsResponseDto,
    examples: {
      failedItems: {
        summary: 'Failed children of a batch',
        value: {
          data: [
            {
              ...operationExample,
              batch_id: '123e4567-e89b-42d3-a456-426614174009',
              state: 'failed',
              result: { code: 'ADAPTER_TIMEOUT', message: 'Adapter timed out' },
            },
          ],
          pagination: { next_cursor: null, has_more: false },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Invalid path UUID, query filters, limit, pagination cursor, or Prefer wait value',
  })
  @ApiNotFoundResponse({
    description:
      'Batch parent not found, belongs to another tenant, or is not a batch parent',
  })
  public async findItems(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @Query() query: ListOperationItemsQueryDto,
    @Headers('prefer') prefer?: string,
    @Res({ passthrough: true }) response?: Response,
  ): Promise<PaginatedOperationsResponseDto> {
    const waitSeconds = parseOperationWait(prefer);
    if (waitSeconds > 0) {
      const page = await this.withDisconnectSignal(response, (signal) =>
        this.operations.waitForItemsForTenant(
          tenantId,
          operationId,
          query,
          waitSeconds,
          signal,
        ),
      );
      return this.toPaginatedResponse(page);
    }
    const page = await this.operations.listItemsForTenant(
      tenantId,
      operationId,
      query,
    );
    return this.toPaginatedResponse(page);
  }

  @Get(':operationId')
  @ApiHeader({
    name: 'Prefer',
    required: false,
    description:
      'Optional wait=30 status long-poll. Non-negative integer seconds, capped at 30; wait=0 returns immediately. Invalid or duplicate wait values return 400. Unrelated preferences are ignored.',
    schema: { type: 'string', example: 'wait=30' },
  })
  @ApiOperation({
    summary: 'Retrieve operation status and result',
    description:
      'Any authenticated token scoped to this tenant may poll the operation, including readonly users. Prefer: wait=30 checks this operation once per second until its state or steps change or the capped wait expires. Terminal operations return immediately; timeout returns HTTP 200 with the normal operation envelope and no extra fields. Operation failures remain HTTP 200 with state=failed. On the first completed/failed retrieval, viewed_at is set once and expires_at is recalculated using the tenant operation TTL settings; updated_at does not change. Processing batch summaries use live tenant-scoped child counts. Settlement marks a parent failed if any child fails; completed and failed parents with stored counts return a settled summary whose totals survive child purge. Parent-level failures without stored counts retain { code, message }. At most 100 retained child errors are included; use /items?state=failed for all retained failures. Original requests are exposed only by the separately audited /request endpoint.',
  })
  @ApiParam({ name: 'tenantId', format: 'uuid' })
  @ApiParam({ name: 'operationId', format: 'uuid' })
  @ApiOkResponse({
    description: 'Operation status and result',
    type: OperationResponseDto,
    examples: {
      pending: {
        summary: 'Pending non-batch operation',
        value: operationExample,
      },
      completed: {
        summary: 'Completed operation with type-specific data',
        value: {
          ...operationExample,
          state: 'completed',
          result: { credential_exchange_id: 'exchange-id' },
        },
      },
      failed: {
        summary: 'Failed operation, still HTTP 200',
        value: {
          ...operationExample,
          state: 'failed',
          result: { code: 'ADAPTER_TIMEOUT', message: 'Adapter timed out' },
        },
      },
      batchProcessing: {
        summary: 'Live batch state counts',
        value: {
          ...operationExample,
          type: 'credential.offer-batch',
          state: 'processing',
          result: {
            total: 10,
            pending: 2,
            processing: 3,
            completed: 4,
            failed: 1,
          },
        },
      },
      batchCompleted: {
        summary: 'Successfully settled batch',
        value: {
          ...operationExample,
          type: 'credential.offer-batch',
          state: 'completed',
          result: { total: 10, completed: 10, failed: 0, errors: [] },
        },
      },
      batchFailed: {
        summary: 'Mixed-success batch settled as failed',
        value: {
          ...operationExample,
          type: 'credential.offer-batch',
          state: 'failed',
          result: {
            total: 10,
            completed: 9,
            failed: 1,
            errors: [
              {
                id: '123e4567-e89b-42d3-a456-426614174002',
                code: 'ADAPTER_TIMEOUT',
                message: 'Adapter timed out',
              },
            ],
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid path UUID or Prefer wait value',
  })
  @ApiNotFoundResponse({
    description:
      'Operation not found, or it belongs to another tenant — the two are not distinguished',
  })
  public async findById(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('operationId', ParseUUIDPipe) operationId: string,
    @Headers('prefer') prefer?: string,
    @Res({ passthrough: true }) response?: Response,
  ): Promise<OperationResponseDto> {
    const waitSeconds = parseOperationWait(prefer);
    const operation =
      waitSeconds > 0
        ? await this.withDisconnectSignal(response, (signal) =>
            this.operations.waitForStatusForTenant(
              tenantId,
              operationId,
              waitSeconds,
              signal,
            ),
          )
        : await this.operations.getForTenant(tenantId, operationId);

    return OperationResponseDto.fromEntity(operation);
  }

  private async withDisconnectSignal<T>(
    response: Response | undefined,
    load: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const abort = new AbortController();
    const onClose = () => abort.abort();
    response?.once('close', onClose);
    try {
      return await load(abort.signal);
    } finally {
      response?.off('close', onClose);
    }
  }

  private toPaginatedResponse(
    page: PaginatedOperations,
  ): PaginatedOperationsResponseDto {
    return {
      data: page.data.map((operation) =>
        OperationResponseDto.fromEntity(operation),
      ),
      pagination: OperationsPaginationDto.from(
        page.pagination.next_cursor,
        page.pagination.has_more,
      ),
    };
  }
}
