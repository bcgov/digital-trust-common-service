import { CredentialExchangeState } from '@app/credential-ports';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { CredentialDefinitionFormat } from '../credential-definition/credential-definition.entity';

export type IssueSubmission =
  'not-submitted' | 'submitting' | 'submitted' | 'uncertain';
export type ExchangeState = CredentialExchangeState | 'pending' | 'failed';

@Entity({ name: 'credential_exchange' })
@Index('idx_credential_exchange_issue_operation', ['issueOperationId'])
@Index(
  'uq_credential_exchange_backend',
  ['tenantId', 'connectorId', 'externalId'],
  { unique: true },
)
export class CredentialExchange {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  public id!: string;

  @ApiHideProperty()
  @Column({ name: 'tenant_id', type: 'uuid' })
  public tenantId!: string;

  @ApiHideProperty()
  @Column({ name: 'connector_id', type: 'uuid' })
  public connectorId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'connection_id', type: 'uuid', nullable: true })
  public connectionId!: string | null;

  @ApiProperty({ enum: ['issuer', 'holder'] })
  @Column({ type: 'varchar', length: 16 })
  public role!: 'issuer' | 'holder';

  @ApiProperty({ description: 'Delivery protocol' })
  @Column({ type: 'varchar', length: 32 })
  public protocol!: string;

  @ApiProperty({ enum: CredentialDefinitionFormat })
  @Column({ type: 'varchar', length: 32 })
  public format!: CredentialDefinitionFormat;

  @ApiProperty({ description: 'Normalized protocol progress' })
  @Column({ type: 'varchar', length: 32, default: 'pending' })
  public state!: ExchangeState;

  @ApiHideProperty()
  @Column({ name: 'external_id', type: 'varchar', length: 255, nullable: true })
  public externalId!: string | null;

  @ApiProperty({
    enum: ['not-submitted', 'submitting', 'submitted', 'uncertain'],
  })
  @Column({
    name: 'issue_submission',
    type: 'varchar',
    length: 32,
    default: 'not-submitted',
  })
  public issueSubmission!: IssueSubmission;

  @ApiProperty({ format: 'uuid', nullable: true })
  @Column({ name: 'issue_operation_id', type: 'uuid', nullable: true })
  public issueOperationId!: string | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  public createdAt!: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  public updatedAt!: Date;
}
