import { ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsUUID, ValidateIf } from 'class-validator';

export class RecoverCredentialDefinitionDto {
  @Expose({ name: 'schema_transaction_id' })
  @ApiPropertyOptional({
    name: 'schema_transaction_id',
    format: 'uuid',
    description:
      'Optional wallet endorsement transaction to verify and adopt; never trusted without backend validation',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsUUID()
  public schemaTransactionId?: string;

  @Expose({ name: 'definition_transaction_id' })
  @ApiPropertyOptional({
    name: 'definition_transaction_id',
    format: 'uuid',
    description:
      'Optional credential-definition endorsement transaction to verify and adopt',
  })
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @IsUUID()
  public definitionTransactionId?: string;
}
