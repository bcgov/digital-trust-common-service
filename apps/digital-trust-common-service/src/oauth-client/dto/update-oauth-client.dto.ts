import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOAuthClientDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public name?: string;

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
}
