import { CredentialFormat, RequestedPredicate } from '@app/credential-ports';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type PresentationSubmission =
  'submitting' | 'submitted' | 'rejected' | 'uncertain';
export type PresentationExchangeState =
  | 'pending'
  | 'request-sent'
  | 'presentation-received'
  | 'verified'
  | 'failed'
  | 'abandoned';

export interface ExpectedPresentationEvidence {
  nonce: string;
  attributes: string[];
  predicates: Pick<RequestedPredicate, 'name' | 'pType' | 'pValue'>[];
}

@Entity({ name: 'presentation_exchange' })
@Index('idx_presentation_exchange_tenant', ['tenantId'])
@Index(
  'uq_presentation_exchange_backend',
  ['tenantId', 'connectorId', 'externalId'],
  { unique: true },
)
export class PresentationExchange {
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @Column({ name: 'connector_id', type: 'uuid' })
  public connectorId!: string;

  @Column({ name: 'connection_id', type: 'uuid', nullable: true })
  public connectionId!: string | null;

  @Column({ name: 'external_connection_id', type: 'varchar', length: 255 })
  public externalConnectionId!: string;

  @Column({ type: 'varchar', length: 32 })
  public protocol!: string;

  @Column({ type: 'varchar', length: 32 })
  public format!: CredentialFormat;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  public state!: PresentationExchangeState;

  @Column({ name: 'external_id', type: 'varchar', length: 255, nullable: true })
  public externalId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  public submission!: PresentationSubmission;

  @Column({ name: 'request_operation_id', type: 'uuid', nullable: true })
  public requestOperationId!: string | null;

  @Column({ name: 'profile_id', type: 'uuid', nullable: true })
  public profileId!: string | null;

  @Column({
    name: 'profile_version',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  public profileVersion!: string | null;

  @Column({ name: 'definition_id', type: 'uuid', nullable: true })
  public definitionId!: string | null;

  @Column({
    name: 'definition_version',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  public definitionVersion!: string | null;

  @Column({ name: 'expected_evidence', type: 'jsonb', nullable: true })
  public expectedEvidence!: ExpectedPresentationEvidence | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
