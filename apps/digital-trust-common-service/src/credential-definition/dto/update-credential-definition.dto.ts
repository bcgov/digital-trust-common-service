import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateCredentialDefinitionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public name?: string;

  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}
