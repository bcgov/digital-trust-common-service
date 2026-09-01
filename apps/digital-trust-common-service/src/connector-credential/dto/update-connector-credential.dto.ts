import { OmitType, PartialType } from '@nestjs/mapped-types';

import { CreateConnectorCredentialDto } from './create-connector-credential.dto';

export class UpdateConnectorCredentialDto extends PartialType(
  OmitType(CreateConnectorCredentialDto, ['connectorType'] as const),
) {}
