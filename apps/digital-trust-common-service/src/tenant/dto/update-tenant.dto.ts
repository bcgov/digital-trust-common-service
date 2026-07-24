import { IsObject, IsOptional, IsString, Length } from 'class-validator';

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  @Length(1, 255)
  public name?: string;

  @IsOptional()
  @IsString()
  public description?: string;

  @IsOptional()
  @IsObject()
  public config?: Record<string, unknown>;
}
