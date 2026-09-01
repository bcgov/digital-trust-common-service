import { Expose } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateConnectorCredentialDto {
  @Expose({ name: 'endpoint_url' })
  @IsOptional()
  @IsString()
  public endpointUrl?: string;

  @Expose()
  @IsOptional()
  @IsBoolean()
  public active?: boolean;
}
