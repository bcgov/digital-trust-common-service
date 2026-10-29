import {
  ApiProperty,
  ApiPropertyOptional,
  PartialType,
  PickType,
} from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import {
  Equals,
  IsArray,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { CredentialDefinitionFormat } from '../../credential-definition/credential-definition.entity';
import { VerificationProfile } from '../verification-profile.entity';

import {
  VerificationPredicateDto,
  VerificationPredicateCondition,
} from './verification-predicate.dto';
import {
  VerificationProfileResponseDto,
  VerificationProfilesPaginationDto,
} from './verification-profile-response.dto';

export class PresentationDefinitionPredicateDto extends VerificationPredicateDto {
  @ApiProperty({
    enum: ['<', '<=', '>', '>='],
    description:
      'Supported AnonCreds numeric comparison (equality is unsupported)',
  })
  @IsIn(['<', '<=', '>', '>='])
  declare public condition: Exclude<
    VerificationPredicateCondition,
    VerificationPredicateCondition.EQUAL
  >;
}

export class PresentationDefinitionQueryDto {
  @ApiProperty({
    enum: ['dif-presentation-exchange'],
    description:
      'Only DIF attribute selection and the separate numeric predicates below are supported. Native AnonCreds, DCQL and QueryByExample input are not supported.',
  })
  @Equals('dif-presentation-exchange')
  public type!: 'dif-presentation-exchange';

  @Expose({ name: 'presentation_definition' })
  @ApiProperty({
    name: 'presentation_definition',
    type: 'object',
    additionalProperties: true,
    description:
      'DIF subset: id and non-empty input_descriptors; each field selects a single credentialSubject attribute. Filters, groups, submission requirements and other constraints are rejected.',
  })
  @IsObject()
  public presentationDefinition!: Record<string, unknown>;

  @ApiPropertyOptional({ type: [PresentationDefinitionPredicateDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PresentationDefinitionPredicateDto)
  public predicates?: PresentationDefinitionPredicateDto[];
}

export class PresentationDefinitionOptionsDto {
  @ApiProperty({
    enum: [CredentialDefinitionFormat.ANONCREDS],
    description: 'Proof output format. Only AnonCreds execution is supported.',
  })
  @Equals(CredentialDefinitionFormat.ANONCREDS)
  public format!: CredentialDefinitionFormat.ANONCREDS;
}

export class CreatePresentationDefinitionDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  public name!: string;

  @ApiProperty({ maxLength: 20 })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  public version!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  public description?: string;

  @ApiProperty({ type: PresentationDefinitionQueryDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PresentationDefinitionQueryDto)
  public query!: PresentationDefinitionQueryDto;

  @ApiProperty({ type: PresentationDefinitionOptionsDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PresentationDefinitionOptionsDto)
  public options!: PresentationDefinitionOptionsDto;
}

export class UpdatePresentationDefinitionDto extends PartialType(
  PickType(CreatePresentationDefinitionDto, [
    'description',
    'query',
    'options',
  ]),
  { skipNullProperties: false },
) {}

export class PresentationDefinitionResponseDto extends PickType(
  VerificationProfileResponseDto,
  [
    'id',
    'tenantId',
    'name',
    'version',
    'description',
    'status',
    'createdAt',
    'updatedAt',
  ],
) {
  @ApiProperty({ type: PresentationDefinitionQueryDto })
  public query!: PresentationDefinitionQueryDto;

  @ApiProperty({
    type: 'object',
    description:
      'Output format; null for legacy profiles that infer it from the connector.',
    properties: { format: { type: 'string', nullable: true } },
  })
  public options!: { format: CredentialDefinitionFormat | null };

  public static fromEntity(
    profile: VerificationProfile,
  ): PresentationDefinitionResponseDto {
    const dto = new PresentationDefinitionResponseDto();
    dto.id = profile.id;
    dto.tenantId = profile.tenantId;
    dto.name = profile.name;
    dto.version = profile.version;
    dto.description = profile.description;
    dto.status = profile.status;
    dto.createdAt = profile.createdAt;
    dto.updatedAt = profile.updatedAt;
    dto.query = Object.assign(new PresentationDefinitionQueryDto(), {
      type: 'dif-presentation-exchange',
      presentationDefinition: profile.presentationDefinition,
      predicates: profile.predicates,
    });
    dto.options = { format: profile.presentationFormat ?? null };
    return dto;
  }
}

export class PaginatedPresentationDefinitionsResponseDto {
  @ApiProperty({ type: [PresentationDefinitionResponseDto] })
  public data!: PresentationDefinitionResponseDto[];

  @ApiProperty({ type: VerificationProfilesPaginationDto })
  public pagination!: VerificationProfilesPaginationDto;
}
