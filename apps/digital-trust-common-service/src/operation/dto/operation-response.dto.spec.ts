import { instanceToPlain } from 'class-transformer';

import { OPERATION_TYPE } from '../operation-type.constants';
import { Operation, OperationState } from '../operation.entity';

import { OperationResponseDto } from './operation-response.dto';

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
});
