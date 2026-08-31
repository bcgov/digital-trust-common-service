import { Exclude, Expose } from 'class-transformer';
import { IsString } from 'class-validator';

@Exclude()
export class DecryptConnectorCredentialDto {
  @Expose()
  @IsString()
  public key!: string;
}
