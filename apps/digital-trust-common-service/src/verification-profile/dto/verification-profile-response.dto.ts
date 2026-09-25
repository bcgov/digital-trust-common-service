import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import {
  VerificationProfile,
  VerificationProfileProtocolHint,
  VerificationProfileStatus,
} from '../verification-profile.entity';

export class VerificationProfileResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the verification profile',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    name: 'tenant_id',
    description: 'The tenant ID this verification profile belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public tenantId!: string;

  @Expose({ name: 'issuance_profile_id' })
  @ApiProperty({
    name: 'issuance_profile_id',
    description: 'Issuance profile this verification profile is linked to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public issuanceProfileId!: string;

  @ApiProperty({
    description: 'Human-friendly profile identifier',
    example: 'age-verification',
  })
  public name!: string;

  @ApiProperty({
    description: 'Semver-like profile version',
    example: '1.0',
  })
  public version!: string;

  @ApiProperty({
    description: 'Optional display description',
    required: false,
    nullable: true,
  })
  public description?: string | null;

  @Expose({ name: 'presentation_definition' })
  @ApiProperty({
    name: 'presentation_definition',
    description: 'Pre-built proof request template (DIF PE / format-agnostic)',
    example: { id: 'age-over-18', input_descriptors: [] },
  })
  public presentationDefinition!: Record<string, unknown>;

  @Expose({ name: 'requested_attributes' })
  @ApiProperty({
    name: 'requested_attributes',
    description:
      'Attribute names extracted from presentation_definition, for quick reference',
    required: false,
    nullable: true,
    type: [String],
  })
  public requestedAttributes?: string[] | null;

  @ApiProperty({
    description: 'Predicate constraints for proof requests',
    required: false,
    nullable: true,
  })
  public predicates?: Record<string, unknown>[] | null;

  @ApiProperty({
    description: 'Extensible verifier-specific metadata',
    example: {},
  })
  public metadata!: Record<string, unknown>;

  @Expose({ name: 'public' })
  @ApiProperty({
    name: 'public',
    description: 'When true, discoverable via public endpoint',
    example: false,
  })
  public isPublic!: boolean;

  @Expose({ name: 'protocol_hint' })
  @ApiProperty({
    name: 'protocol_hint',
    description: 'Preferred presentation protocol',
    enum: VerificationProfileProtocolHint,
    example: VerificationProfileProtocolHint.AUTO,
  })
  public protocolHint!: VerificationProfileProtocolHint;

  @ApiProperty({
    description: 'Lifecycle status of the profile',
    enum: VerificationProfileStatus,
    example: VerificationProfileStatus.DRAFT,
  })
  public status!: VerificationProfileStatus;

  @Expose({ name: 'created_at' })
  @ApiProperty({
    name: 'created_at',
    description: 'When the profile was created',
    example: '2024-01-01T00:00:00Z',
  })
  public createdAt!: Date;

  @Expose({ name: 'updated_at' })
  @ApiProperty({
    name: 'updated_at',
    description: 'When the profile was last updated',
    example: '2024-01-01T00:00:00Z',
  })
  public updatedAt!: Date;

  public static fromEntity(
    profile: VerificationProfile,
  ): VerificationProfileResponseDto {
    const dto = new VerificationProfileResponseDto();
    dto.id = profile.id;
    dto.tenantId = profile.tenantId;
    dto.issuanceProfileId = profile.issuanceProfileId;
    dto.name = profile.name;
    dto.version = profile.version;
    dto.description = profile.description;
    dto.presentationDefinition = profile.presentationDefinition;
    dto.requestedAttributes = profile.requestedAttributes;
    dto.predicates = profile.predicates;
    dto.metadata = profile.metadata;
    dto.isPublic = profile.isPublic;
    dto.protocolHint = profile.protocolHint;
    dto.status = profile.status;
    dto.createdAt = profile.createdAt;
    dto.updatedAt = profile.updatedAt;
    return dto;
  }
}

export class VerificationProfilesPaginationDto {
  @Expose({ name: 'next_cursor' })
  @ApiProperty({
    name: 'next_cursor',
    description: 'Cursor to fetch the next page, or null if there is none',
    example: null,
    nullable: true,
  })
  public nextCursor!: string | null;

  @Expose({ name: 'has_more' })
  @ApiProperty({
    name: 'has_more',
    description: 'Whether more results are available beyond this page',
    example: false,
  })
  public hasMore!: boolean;

  public static from(pagination: {
    next_cursor: string | null;
    has_more: boolean;
  }): VerificationProfilesPaginationDto {
    const dto = new VerificationProfilesPaginationDto();
    dto.nextCursor = pagination.next_cursor;
    dto.hasMore = pagination.has_more;
    return dto;
  }
}

export class PaginatedVerificationProfilesResponseDto {
  @ApiProperty({ type: [VerificationProfileResponseDto] })
  public data!: VerificationProfileResponseDto[];

  @ApiProperty({ type: VerificationProfilesPaginationDto })
  public pagination!: VerificationProfilesPaginationDto;
}
