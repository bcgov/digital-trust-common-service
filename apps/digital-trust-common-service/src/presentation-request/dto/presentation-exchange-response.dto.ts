import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import { PresentationExchange } from '../presentation-exchange.entity';

export class PresentationExchangeResponseDto {
  @ApiProperty({ format: 'uuid' })
  public id!: string;

  @ApiProperty({ description: 'Normalized exchange state' })
  public state!: string;

  @ApiProperty({ description: 'Submission outcome' })
  public submission!: string;

  @Expose({ name: 'verification_profile_id' })
  @ApiPropertyOptional({
    name: 'verification_profile_id',
    format: 'uuid',
    nullable: true,
  })
  public verificationProfileId!: string | null;

  @Expose({ name: 'verification_profile_version' })
  @ApiPropertyOptional({ name: 'verification_profile_version', nullable: true })
  public verificationProfileVersion!: string | null;

  @Expose({ name: 'presentation_definition_id' })
  @ApiPropertyOptional({
    name: 'presentation_definition_id',
    format: 'uuid',
    nullable: true,
  })
  public presentationDefinitionId!: string | null;

  @Expose({ name: 'presentation_definition_version' })
  @ApiPropertyOptional({
    name: 'presentation_definition_version',
    nullable: true,
  })
  public presentationDefinitionVersion!: string | null;

  @Expose({ name: 'created_at' })
  @ApiProperty({ name: 'created_at' })
  public createdAt!: Date;

  @Expose({ name: 'updated_at' })
  @ApiProperty({ name: 'updated_at' })
  public updatedAt!: Date;

  public static fromEntity(
    exchange: PresentationExchange,
  ): PresentationExchangeResponseDto {
    const result = new PresentationExchangeResponseDto();
    result.id = exchange.id;
    result.state = exchange.state;
    result.submission = exchange.submission;
    result.verificationProfileId = exchange.profileId;
    result.verificationProfileVersion = exchange.profileVersion;
    result.presentationDefinitionId = exchange.definitionId;
    result.presentationDefinitionVersion = exchange.definitionVersion;
    result.createdAt = exchange.createdAt;
    result.updatedAt = exchange.updatedAt;
    return result;
  }
}
