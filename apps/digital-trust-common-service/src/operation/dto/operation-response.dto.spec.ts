import { instanceToPlain } from 'class-transformer';

import { decodeCursor, encodeCursor } from '../../common/cursor-pagination';
import { OPERATION_TYPE } from '../operation-type.constants';
import { Operation, OperationState } from '../operation.entity';

import {
  OperationResponseDto,
  OperationsPaginationDto,
  PaginatedOperationsResponseDto,
} from './operation-response.dto';

describe('paginated operation responses', () => {
  it('serializes an empty page with no next cursor', () => {
    const page = new PaginatedOperationsResponseDto();
    page.data = [];
    page.pagination = OperationsPaginationDto.from(null, false);

    expect(instanceToPlain(page)).toEqual({
      data: [],
      pagination: { next_cursor: null, has_more: false },
    });
  });

  it.each([null, 'parent'])(
    'serializes a page with batch_id %j using the shared cursor format',
    (batchId) => {
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      const operation = Object.assign(new Operation(), {
        id: '123e4567-e89b-42d3-a456-426614174000',
        tenantId: 'tenant',
        batchId,
        type: OPERATION_TYPE.CREDENTIAL_OFFER,
        state: OperationState.PENDING,
        createdAt,
        updatedAt: createdAt,
        request: { method: 'POST', path: '/credentials/offer', body: {} },
        externalId: 'external',
        viewedAt: null,
        expiresAt: createdAt,
      });
      const cursor = { createdAt: createdAt.toISOString(), id: operation.id };
      const nextCursor = encodeCursor(cursor);
      const page = new PaginatedOperationsResponseDto();
      page.data = [OperationResponseDto.fromEntity(operation)];
      page.pagination = OperationsPaginationDto.from(nextCursor, true);

      const response = JSON.parse(JSON.stringify(instanceToPlain(page))) as {
        pagination: { next_cursor: string };
      };

      expect(response).toEqual({
        data: [
          {
            id: operation.id,
            batch_id: batchId,
            type: OPERATION_TYPE.CREDENTIAL_OFFER,
            state: OperationState.PENDING,
            created_at: createdAt.toISOString(),
            updated_at: createdAt.toISOString(),
            result: null,
          },
        ],
        pagination: { next_cursor: nextCursor, has_more: true },
      });
      expect(decodeCursor(response.pagination.next_cursor)).toEqual(cursor);
    },
  );
});

describe('operation response envelope', () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const updatedAt = new Date('2026-01-01T00:01:00.000Z');

  it.each([
    { state: OperationState.PENDING, result: null },
    { state: OperationState.PROCESSING, result: null },
    {
      state: OperationState.COMPLETED,
      result: { credential_exchange_id: 'exchange' },
    },
    {
      state: OperationState.FAILED,
      result: { code: 'ADAPTER_TIMEOUT', message: 'Adapter timed out' },
    },
  ])(
    'serializes the $state envelope without internal fields',
    ({ state, result }) => {
      const operation = Object.assign(new Operation(), {
        id: 'operation',
        tenantId: 'tenant',
        type: OPERATION_TYPE.CREDENTIAL_OFFER,
        state,
        createdAt,
        updatedAt,
        result,
        request: { method: 'POST', path: '/credentials/offer', body: {} },
        externalId: 'external',
        viewedAt: updatedAt,
        expiresAt: updatedAt,
      });
      const response = JSON.parse(
        JSON.stringify(
          instanceToPlain(OperationResponseDto.fromEntity(operation)),
        ),
      );

      expect(response).toEqual({
        id: 'operation',
        batch_id: null,
        type: OPERATION_TYPE.CREDENTIAL_OFFER,
        state,
        created_at: createdAt.toISOString(),
        updated_at: updatedAt.toISOString(),
        result,
      });
    },
  );

  it('serializes batch linkage without adding other fields', () => {
    const operation = Object.assign(new Operation(), {
      id: 'child',
      batchId: 'parent',
      type: OPERATION_TYPE.CREDENTIAL_OFFER,
      state: OperationState.PENDING,
      createdAt,
      updatedAt,
    });

    const response = JSON.parse(
      JSON.stringify(
        instanceToPlain(OperationResponseDto.fromEntity(operation)),
      ),
    );

    expect(response).toEqual({
      id: 'child',
      batch_id: 'parent',
      type: OPERATION_TYPE.CREDENTIAL_OFFER,
      state: OperationState.PENDING,
      created_at: createdAt.toISOString(),
      updated_at: updatedAt.toISOString(),
      result: null,
    });
  });
});

describe('registration operation response', () => {
  const operation = (
    result: Operation['result'],
    registration = true,
  ): Operation =>
    Object.assign(new Operation(), {
      id: 'operation',
      type: registration
        ? OPERATION_TYPE.CREDENTIAL_DEFINITION_REGISTER
        : OPERATION_TYPE.CREDENTIAL_OFFER,
      state: OperationState.PROCESSING,
      result,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

  it('returns null when no registration diagnostics are recorded', () => {
    const response = instanceToPlain(
      OperationResponseDto.fromEntity(
        operation({ credential_definition_id: 'definition' }),
      ),
    );
    expect(response.problem_details).toBeNull();
    expect(response.result).toEqual({ credential_definition_id: 'definition' });
    expect(Object.keys(response).sort()).toEqual([
      'batch_id',
      'created_at',
      'id',
      'problem_details',
      'result',
      'state',
      'type',
      'updated_at',
    ]);
  });

  it('exposes sanitized diagnostics separately without losing result references', () => {
    const problem = {
      type: 'https://github.com/bcgov/digital-trust-common-service/blob/main/docs/DEVELOPER.md#credential-registration-failed',
      title: 'Credential registration failed',
      detail: 'Issuer rejected',
      stage: 'schema_publication',
      retryable: false,
      backend_status: 400,
      backend_code: 'INVALID_ISSUER',
      instance: 'urn:uuid:123e4567-e89b-42d3-a456-426614174000',
    };
    const response = instanceToPlain(
      OperationResponseDto.fromEntity(
        operation({
          credential_definition_id: 'definition',
          code: 'REGISTRATION_FAILED',
          message: 'Issuer rejected',
          problem_details: problem,
        }),
      ),
    );
    expect(response.problem_details).toEqual(problem);
    expect(response.result).toEqual({
      credential_definition_id: 'definition',
      code: 'REGISTRATION_FAILED',
      message: 'Issuer rejected',
    });
  });

  it('does not change the envelope of unrelated operations', () => {
    const dto = OperationResponseDto.fromEntity(
      operation({ value: 'existing-result' }, false),
    );
    expect(Object.keys(dto)).not.toContain('problemDetails');
    const response = JSON.parse(
      JSON.stringify(
        instanceToPlain(
          OperationResponseDto.fromEntity(
            operation({ value: 'existing-result' }, false),
          ),
        ),
      ),
    );
    expect(response).not.toHaveProperty('problem_details');
    expect(response.result).toEqual({ value: 'existing-result' });
  });

  it('returns only the local exchange reference for a completed linked action', () => {
    const localExchangeId = '123e4567-e89b-42d3-a456-426614174010';
    const linked = Object.assign(
      operation(
        {
          credential_exchange_id: 'private-backend-id',
          attributes: ['secret'],
        },
        false,
      ),
      {
        exchangeId: localExchangeId,
        state: OperationState.COMPLETED,
      },
    );
    const response = instanceToPlain(OperationResponseDto.fromEntity(linked));
    expect(response.exchange_id).toBe(localExchangeId);
    expect(response.result).toEqual({ exchange_id: localExchangeId });
    expect(JSON.stringify(response)).not.toContain('private-backend-id');
    expect(JSON.stringify(response)).not.toContain('secret');
  });
});
