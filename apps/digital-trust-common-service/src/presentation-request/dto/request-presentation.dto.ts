import { Expose } from 'class-transformer';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

import { CredentialDefinitionFormat } from '../../credential-definition/credential-definition.entity';

/**
 * Body for `POST /tenants/:tenantId/presentations/request`. Two mutually
 * exclusive modes — profile-based (`verification_profile_id`) or raw
 * (`presentation_definition` + `format`) — plus the shared, mode-independent
 * `connection_id`. Field-level decorators only cover shape (string/object/
 * enum); the cross-field mode rules (exactly one of the two, `format`
 * required with raw mode, `connection_id` required for MVP) are business
 * rules validated in `PresentationRequestService`, same as
 * `VerificationProfileService`'s presentation_definition structural checks.
 */
export class RequestPresentationDto {
  @Expose({ name: 'verification_profile_id' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  public verificationProfileId?: string;

  @Expose({ name: 'presentation_definition' })
  @IsOptional()
  @IsObject()
  public presentationDefinition?: Record<string, unknown>;

  @Expose()
  @IsOptional()
  @IsEnum(CredentialDefinitionFormat)
  public format?: CredentialDefinitionFormat;

  @Expose({ name: 'connection_id' })
  @IsOptional()
  @IsUUID()
  public connectionId?: string;
}
