import { IsArray, IsEnum, IsObject, IsOptional, IsUUID } from 'class-validator';

import { CredentialDefinitionFormat } from '../../credential-definition/credential-definition.entity';

export class UpdateTenantConfigDto {
  @IsOptional()
  @IsArray()
  @IsEnum(CredentialDefinitionFormat, { each: true })
  public allowed_formats?: CredentialDefinitionFormat[];

  @IsOptional()
  @IsUUID()
  public default_connector?: string | null;

  @IsOptional()
  @IsObject()
  public features?: Record<string, unknown>;
}
