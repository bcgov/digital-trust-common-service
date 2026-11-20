import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';

import { WebhookRegistration } from '../webhook-registration.entity';
import {
  WebhookEvent,
  WebhookRegistrationStatus,
} from '../webhook-registration.enums';

@Exclude()
export class WebhookRegistrationResponseDto {
  @Expose()
  @ApiProperty({ description: 'Webhook registration ID', format: 'uuid' })
  public id!: string;

  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    name: 'tenant_id',
    description: 'Tenant that owns the registration',
    format: 'uuid',
  })
  public tenantId!: string;

  @Expose({ name: 'endpoint_url' })
  @ApiProperty({
    name: 'endpoint_url',
    description: 'Registered HTTPS delivery endpoint',
    format: 'uri',
  })
  public endpointUrl!: string;

  @Expose()
  @ApiProperty({
    description: 'Subscribed event types',
    enum: WebhookEvent,
    isArray: true,
  })
  public events!: WebhookEvent[];

  @Expose()
  @ApiProperty({
    description: 'Registration status, derived from whether it is active',
    enum: WebhookRegistrationStatus,
  })
  public status!: WebhookRegistrationStatus;

  @Expose({ name: 'created_at' })
  @ApiProperty({
    name: 'created_at',
    description: 'Time the registration was created',
    type: Date,
  })
  public createdAt!: Date;

  @Expose({ name: 'updated_at' })
  @ApiProperty({
    name: 'updated_at',
    description: 'Time the registration was last updated',
    type: Date,
  })
  public updatedAt!: Date;

  public static fromEntity(
    registration: WebhookRegistration,
  ): WebhookRegistrationResponseDto {
    const dto = new WebhookRegistrationResponseDto();
    dto.id = registration.id;
    dto.tenantId = registration.tenantId;
    dto.endpointUrl = registration.endpointUrl;
    dto.events = registration.events;
    dto.status = registration.active
      ? WebhookRegistrationStatus.ACTIVE
      : WebhookRegistrationStatus.INACTIVE;
    dto.createdAt = registration.createdAt;
    dto.updatedAt = registration.updatedAt;
    return dto;
  }
}
