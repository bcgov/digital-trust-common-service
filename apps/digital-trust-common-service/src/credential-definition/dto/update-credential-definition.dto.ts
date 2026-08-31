import { Exclude, Expose } from 'class-transformer';
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

@Exclude()
export class UpdateCredentialDefinitionDto {
  @Expose()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  public name?: string;

  @Expose()
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}
