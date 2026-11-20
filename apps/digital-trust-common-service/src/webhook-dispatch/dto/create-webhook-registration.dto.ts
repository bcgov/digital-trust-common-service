import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsUrl,
} from 'class-validator';

import { WebhookEvent } from '../webhook-registration.enums';

export class CreateWebhookRegistrationDto {
  @Expose({ name: 'endpoint_url' })
  @ApiProperty({
    name: 'endpoint_url',
    description:
      'Public HTTPS endpoint for webhook delivery, without embedded credentials or a fragment.',
    example: 'https://example.com/webhooks/credentials',
    format: 'uri',
  })
  @IsUrl({
    protocols: ['https'],
    require_protocol: true,
    require_valid_protocol: true,
    disallow_auth: true,
    allow_fragments: false,
  })
  public endpointUrl!: string;

  @Expose()
  @ApiProperty({
    description:
      'Distinct event types to subscribe to; at least one is required.',
    enum: WebhookEvent,
    isArray: true,
    minItems: 1,
    uniqueItems: true,
    example: [WebhookEvent.CREDENTIAL_ISSUED],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsEnum(WebhookEvent, { each: true })
  public events!: WebhookEvent[];
}
