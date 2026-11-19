import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import type { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';

import type { VerificationProfileStatus } from './verification-profile.entity';

@Entity({ name: 'presentation_definition' })
@Unique('uq_presentation_definition_tenant_name_version', [
  'tenantId',
  'name',
  'version',
])
@Index('idx_presentation_definition_tenant_status', ['tenantId', 'status'])
export class PresentationDefinition {
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ type: 'varchar', length: 100 })
  public name!: string;

  @Column({ type: 'varchar', length: 20 })
  public version!: string;

  @Column({ type: 'text', nullable: true })
  public description?: string | null;

  @Column({ name: 'presentation_definition', type: 'jsonb' })
  public presentationDefinition!: Record<string, unknown>;

  @Column({
    name: 'requested_attributes',
    type: 'text',
    array: true,
    nullable: true,
  })
  public requestedAttributes?: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  public predicates?: Record<string, unknown>[] | null;

  @Column({
    name: 'presentation_format',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  public presentationFormat?: CredentialDefinitionFormat | null;

  @Column({
    type: 'enum',
    enum: ['draft', 'published', 'deprecated'],
    enumName: 'presentation_definition_status',
    default: 'draft',
  })
  public status!: VerificationProfileStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
