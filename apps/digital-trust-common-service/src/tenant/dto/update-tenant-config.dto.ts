import { Expose } from 'class-transformer';
import { IsArray, IsEnum, IsObject, IsOptional, IsUUID } from 'class-validator';

import { CredentialDefinitionFormat } from '../../credential-definition/credential-definition.entity';

export class UpdateTenantConfigDto {
  @Expose({ name: 'allowed_formats' })
  @IsOptional()
  @IsArray()
  @IsEnum(CredentialDefinitionFormat, { each: true })
  public allowedFormats?: CredentialDefinitionFormat[];

  @Expose({ name: 'default_connector' })
  @IsOptional()
  @IsUUID()
  public defaultConnector?: string | null;

  @Expose()
  @IsOptional()
  @IsObject()
  public features?: Record<string, unknown>;
}
