import { Exclude, Expose } from 'class-transformer';
import {
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

@Exclude()
export class CreateTenantDto {
  @Expose()
  @IsString()
  @Length(1, 255)
  public name!: string;

  @Expose()
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  public slug!: string;

  @Expose()
  @IsOptional()
  @IsString()
  public description?: string;

  @Expose()
  @IsOptional()
  @IsObject()
  public config!: Record<string, unknown>;

  @Expose({ name: 'owner_email' })
  @IsEmail()
  @MaxLength(255)
  public ownerEmail!: string;
}
