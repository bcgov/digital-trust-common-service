import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { CredentialDefinitionFormat } from '../../credential-definition/credential-definition.entity';
import {
  IssuanceProfile,
  IssuanceProfileProtocolHint,
  IssuanceProfileStatus,
} from '../issuance-profile.entity';

export class IssuanceProfileResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the issuance profile',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    name: 'tenant_id',
    description: 'The tenant ID this issuance profile belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public tenantId!: string;

  @ApiProperty({
    description: 'Human-friendly profile identifier',
    example: 'drivers-license',
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

  @Expose({ name: 'credential_definition_id' })
  @ApiProperty({
    name: 'credential_definition_id',
    description: 'Credential definition this profile wraps',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public credentialDefinitionId!: string;

  @ApiProperty({
    description:
      'Denormalized credential format copied from the credential definition',
    enum: CredentialDefinitionFormat,
    example: CredentialDefinitionFormat.ANONCREDS,
  })
  public format!: CredentialDefinitionFormat;

  @Expose({ name: 'connector_id' })
  @ApiProperty({
    name: 'connector_id',
    description: 'Connector credential that handles this profile',
    example: '123e4567-e89b-12d3-a456-426614174000',
    required: false,
    nullable: true,
  })
  public connectorId?: string | null;

  @Expose({ name: 'attribute_schema' })
  @ApiProperty({
    name: 'attribute_schema',
    description: 'Attributes/claims the consumer must supply',
    example: { given_name: { type: 'string', required: true } },
  })
  public attributeSchema!: Record<string, unknown>;

  @ApiProperty({
    description: 'Pre-filled attribute values',
    required: false,
    nullable: true,
  })
  public defaults?: Record<string, unknown> | null;

  @ApiProperty({
    description: 'UI/metadata display hints',
    required: false,
    nullable: true,
  })
  public display?: Record<string, unknown> | null;

  @ApiProperty({
    description: 'Extensible issuer-specific metadata',
    example: {},
  })
  public metadata!: Record<string, unknown>;

  @Expose({ name: 'protocol_hint' })
  @ApiProperty({
    name: 'protocol_hint',
    description: 'Preferred delivery protocol',
    enum: IssuanceProfileProtocolHint,
    example: IssuanceProfileProtocolHint.AUTO,
  })
  public protocolHint!: IssuanceProfileProtocolHint;

  @ApiProperty({
    description: 'Lifecycle status of the profile',
    enum: IssuanceProfileStatus,
    example: IssuanceProfileStatus.DRAFT,
  })
  public status!: IssuanceProfileStatus;

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
    profile: IssuanceProfile,
  ): IssuanceProfileResponseDto {
    const dto = new IssuanceProfileResponseDto();
    dto.id = profile.id;
    dto.tenantId = profile.tenantId;
    dto.name = profile.name;
    dto.version = profile.version;
    dto.description = profile.description;
    dto.credentialDefinitionId = profile.credentialDefinitionId;
    dto.format = profile.format;
    dto.connectorId = profile.connectorId;
    dto.attributeSchema = profile.attributeSchema;
    dto.defaults = profile.defaults;
    dto.display = profile.display;
    dto.metadata = profile.metadata;
    dto.protocolHint = profile.protocolHint;
    dto.status = profile.status;
    dto.createdAt = profile.createdAt;
    dto.updatedAt = profile.updatedAt;
    return dto;
  }
}

export class IssuanceProfilesPaginationDto {
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
  }): IssuanceProfilesPaginationDto {
    const dto = new IssuanceProfilesPaginationDto();
    dto.nextCursor = pagination.next_cursor;
    dto.hasMore = pagination.has_more;
    return dto;
  }
}

export class PaginatedIssuanceProfilesResponseDto {
  @ApiProperty({ type: [IssuanceProfileResponseDto] })
  public data!: IssuanceProfileResponseDto[];

  @ApiProperty({ type: IssuanceProfilesPaginationDto })
  public pagination!: IssuanceProfilesPaginationDto;
}
