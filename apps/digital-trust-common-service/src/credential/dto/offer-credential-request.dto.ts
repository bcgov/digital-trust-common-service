import { Expose } from 'class-transformer';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import { CredentialDefinitionFormat } from '../../credential-definition/credential-definition.entity';

/**
 * Either `profileId` or `credentialDefinitionId` must be provided (not
 * both) — enforced by CredentialOfferService, not here, since it depends
 * on both fields together. `connectionId`'s presence/absence determines
 * delivery protocol; MVP requires it (DIDComm-only — see
 * `docs/openapi.yaml`).
 */
export class OfferCredentialRequestDto {
  @Expose({ name: 'profile_id' })
  @IsOptional()
  @IsString()
  public profileId?: string;

  @Expose({ name: 'credential_definition_id' })
  @IsOptional()
  @IsUUID()
  public credentialDefinitionId?: string;

  @Expose()
  @IsOptional()
  @IsEnum(CredentialDefinitionFormat)
  public format?: CredentialDefinitionFormat;

  @Expose({ name: 'connection_id' })
  @IsOptional()
  @IsUUID()
  public connectionId?: string;

  @Expose()
  @IsOptional()
  @IsObject()
  public attributes?: Record<string, unknown>;
}
