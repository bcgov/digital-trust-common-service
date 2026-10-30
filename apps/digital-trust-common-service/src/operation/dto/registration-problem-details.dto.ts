import { randomUUID } from 'crypto';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PROBLEM_DOCUMENT =
  'https://github.com/bcgov/digital-trust-common-service/blob/main/docs/DEVELOPER.md';

const REGISTRATION_PROBLEM = {
  type: `${PROBLEM_DOCUMENT}#credential-registration-failed`,
  title: 'Credential registration failed',
};

export class RegistrationProblemDetailsDto {
  @ApiProperty({
    format: 'uri',
    example: REGISTRATION_PROBLEM.type,
    description:
      'RFC 9457 problem-type URI; clients identify the problem by this value, not the title or detail',
  })
  public type!: string;

  @ApiProperty()
  public title!: string;

  @ApiProperty({
    description: 'Sanitized diagnostic; never the raw backend response',
  })
  public detail!: string;

  @ApiPropertyOptional({
    format: 'uri',
    description:
      'Opaque URI identifying this recorded occurrence; not a dereferenceable endpoint',
    example: 'urn:uuid:123e4567-e89b-42d3-a456-426614174000',
  })
  public instance?: string;

  @ApiProperty({ description: 'Registration step where the problem occurred' })
  public stage!: string;

  @ApiProperty({
    description:
      'Whether the system is scheduling an automatic retry; terminal failures are not retried',
  })
  public retryable!: boolean;

  @ApiPropertyOptional({
    description: 'Upstream HTTP status, not the polling response status',
  })
  public backend_status?: number;

  @ApiPropertyOptional()
  public backend_code?: string;

  public static create(
    input: Pick<
      RegistrationProblemDetailsDto,
      'detail' | 'stage' | 'retryable' | 'backend_status' | 'backend_code'
    >,
  ): RegistrationProblemDetailsDto {
    return {
      ...REGISTRATION_PROBLEM,
      ...input,
      instance: `urn:uuid:${randomUUID()}`,
    };
  }

  public static fromStored(
    value: unknown,
  ): RegistrationProblemDetailsDto | null {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('type' in value) ||
      typeof value.type !== 'string' ||
      !('title' in value) ||
      typeof value.title !== 'string' ||
      !('detail' in value) ||
      typeof value.detail !== 'string' ||
      !('stage' in value) ||
      typeof value.stage !== 'string' ||
      !('retryable' in value) ||
      typeof value.retryable !== 'boolean'
    ) {
      return null;
    }
    // Normalize earlier stored about:blank diagnostics without inventing an
    // occurrence identifier or changing the recorded backend information.
    const identity =
      value.type === 'about:blank'
        ? REGISTRATION_PROBLEM
        : { type: value.type, title: value.title };
    return {
      ...identity,
      detail: value.detail,
      stage: value.stage,
      retryable: value.retryable,
      ...('instance' in value && typeof value.instance === 'string'
        ? { instance: value.instance }
        : {}),
      ...('backend_status' in value && typeof value.backend_status === 'number'
        ? { backend_status: value.backend_status }
        : {}),
      ...('backend_code' in value && typeof value.backend_code === 'string'
        ? { backend_code: value.backend_code }
        : {}),
    };
  }
}
