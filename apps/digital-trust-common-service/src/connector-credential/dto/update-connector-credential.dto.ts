import { OmitType, PartialType } from '@nestjs/swagger';

import { CreateConnectorCredentialDto } from './create-connector-credential.dto';

export class UpdateConnectorCredentialDto extends PartialType(
  OmitType(CreateConnectorCredentialDto, ['connectorType'] as const),
) {}
