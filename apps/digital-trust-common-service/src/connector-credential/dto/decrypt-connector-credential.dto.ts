import { Expose } from 'class-transformer';
import { IsString } from 'class-validator';

export class DecryptConnectorCredentialDto {
  @Expose()
  @IsString()
  public key!: string;
}
