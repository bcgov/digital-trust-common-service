import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

import { WebhookRegistration } from '../webhook-registration.entity';

import { WebhookRegistrationResponseDto } from './webhook-registration-response.dto';

@Exclude()
export class CreateWebhookRegistrationResponseDto extends WebhookRegistrationResponseDto {
  @Expose({ name: 'signing_secret' })
  @ApiProperty({
    name: 'signing_secret',
    description:
      'Server-generated HMAC signing secret, returned only at creation. Store it securely; it cannot be retrieved again.',
    readOnly: true,
  })
  public signingSecret!: string;

  public static from(
    registration: WebhookRegistration,
    signingSecret: string,
  ): CreateWebhookRegistrationResponseDto {
    const dto = Object.assign(
      new CreateWebhookRegistrationResponseDto(),
      WebhookRegistrationResponseDto.fromEntity(registration),
    );
    dto.signingSecret = signingSecret;
    return dto;
  }
}
