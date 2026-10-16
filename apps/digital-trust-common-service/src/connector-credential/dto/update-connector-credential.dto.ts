import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Expose, Type } from 'class-transformer';
import { IsObject, ValidateIf, ValidateNested } from 'class-validator';

import {
  ConnectorCredentialsDto,
  CreateConnectorCredentialDto,
} from './create-connector-credential.dto';

class UpdateConnectorCredentialsDto extends PartialType(
  ConnectorCredentialsDto,
  { skipNullProperties: false },
) {}

export class UpdateConnectorCredentialDto extends PartialType(
  OmitType(CreateConnectorCredentialDto, [
    'connectorType',
    'credentials',
  ] as const),
  { skipNullProperties: false },
) {
  @Expose()
  @ApiPropertyOptional({
    description:
      'Credential fields to rotate. Omitted fields retain their current values.',
    type: UpdateConnectorCredentialsDto,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateConnectorCredentialsDto)
  public credentials?: UpdateConnectorCredentialsDto;
}
