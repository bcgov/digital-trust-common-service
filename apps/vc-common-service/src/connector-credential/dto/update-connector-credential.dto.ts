import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateConnectorCredentialDto {
  @IsOptional()
  @IsString()
  public endpointUrl?: string;

  @IsOptional()
  @IsBoolean()
  public active?: boolean;
}
