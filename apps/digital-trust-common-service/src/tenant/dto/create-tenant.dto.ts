import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateTenantDto {
  @IsString()
  @Length(1, 255)
  public name!: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  public slug!: string;

  @IsOptional()
  @IsString()
  public description?: string;

  @IsOptional()
  @IsObject()
  public config!: Record<string, unknown>;

  @IsEmail()
  @MaxLength(255)
  public ownerEmail!: string;
}
