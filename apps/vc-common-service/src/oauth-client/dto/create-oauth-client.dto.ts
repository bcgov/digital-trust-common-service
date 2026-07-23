import {
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateOAuthClientDto {
  @IsUUID()
  public tenantId!: string;

  @IsString()
  @MaxLength(255)
  public name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public scopes?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public redirectUris?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  public grantTypes?: string[];

  @IsOptional()
  @IsUUID()
  public createdBy?: string;
}
