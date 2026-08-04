import { IsString } from 'class-validator';

export class DecryptConnectorCredentialDto {
  @IsString()
  public key!: string;
}
