import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Tenant } from '../tenant/tenant.entity';

import { WebhookEvent } from './webhook-registration.enums';

@Entity({ name: 'webhook_registration' })
@Index('idx_webhook_registration_tenant_active', ['tenantId', 'active'])
// Require at least one event and reject null elements; column NOT NULL only
// prevents the entire array from being null. The enum restricts event names.
@Check(
  'chk_webhook_registration_events',
  'cardinality("events") > 0 AND array_position("events", NULL) IS NULL',
)
export class WebhookRegistration {
  @ApiProperty({ description: 'Webhook registration ID', format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiProperty({ description: 'Owning tenant ID', format: 'uuid' })
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @ApiHideProperty()
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  public tenant!: Tenant;

  @ApiProperty({ description: 'Webhook delivery endpoint', format: 'uri' })
  @Column({ name: 'endpoint_url', type: 'text' })
  public endpointUrl!: string;

  @ApiProperty({
    description: 'Subscribed events',
    enum: WebhookEvent,
    isArray: true,
  })
  @Column({
    type: 'enum',
    enum: WebhookEvent,
    enumName: 'webhook_event',
    array: true,
  })
  public events!: WebhookEvent[];

  @ApiProperty({ description: 'Whether the registration is active' })
  @Column({ type: 'boolean', default: true })
  public active!: boolean;

  @ApiHideProperty()
  @Exclude()
  @Column({ name: 'credentials_encrypted', type: 'bytea', select: false })
  public credentialsEncrypted!: Buffer<ArrayBufferLike>;

  @ApiHideProperty()
  @Exclude()
  @Column({ name: 'key_version', type: 'integer', select: false })
  public keyVersion!: number;

  @ApiProperty({ description: 'Creation time', type: Date })
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @ApiProperty({ description: 'Last update time', type: Date })
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
