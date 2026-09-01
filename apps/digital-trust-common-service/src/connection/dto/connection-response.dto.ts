import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

import {
  Connection,
  ConnectionProtocol,
  ConnectionState,
  ConnectorType,
} from '../connection.entity';

export class ConnectionResponseDto {
  @ApiProperty({
    description: 'The unique identifier of the connection',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public id!: string;

  @Expose({ name: 'tenant_id' })
  @ApiProperty({
    name: 'tenant_id',
    description: 'The tenant ID this connection belongs to',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  public tenantId!: string;

  @Expose({ name: 'external_connection_id' })
  @ApiProperty({
    name: 'external_connection_id',
    description: 'The external connection ID',
    example: 'ext-conn-123',
  })
  public externalConnectionId!: string;

  @Expose({ name: 'their_label' })
  @ApiProperty({
    name: 'their_label',
    description: 'The label of the other party',
    example: 'Alice',
    required: false,
    nullable: true,
  })
  public theirLabel?: string | null;

  @Expose({ name: 'their_did' })
  @ApiProperty({
    name: 'their_did',
    description: 'The DID of the other party',
    example: 'did:example:123',
    required: false,
    nullable: true,
  })
  public theirDid?: string | null;

  @ApiProperty({
    description: 'The current state of the connection',
    enum: ConnectionState,
    example: ConnectionState.ACTIVE,
  })
  public state!: ConnectionState;

  @Expose({ name: 'connector_type' })
  @ApiProperty({
    name: 'connector_type',
    description: 'The connector type used for this connection',
    enum: ConnectorType,
    example: ConnectorType.TRACTION,
  })
  public connectorType!: ConnectorType;

  @ApiProperty({
    description: 'The protocol used for this connection',
    enum: ConnectionProtocol,
    example: ConnectionProtocol.DIDCOMM_V1,
  })
  public protocol!: ConnectionProtocol;

  @ApiProperty({
    description: 'Additional metadata associated with the connection',
    example: { key: 'value' },
  })
  public metadata!: Record<string, unknown>;

  @Expose({ name: 'created_at' })
  @ApiProperty({
    name: 'created_at',
    description: 'The date and time when the connection was created',
    example: '2024-01-01T00:00:00Z',
  })
  public createdAt!: Date;

  @Expose({ name: 'updated_at' })
  @ApiProperty({
    name: 'updated_at',
    description: 'The date and time when the connection was last updated',
    example: '2024-01-01T00:00:00Z',
  })
  public updatedAt!: Date;

  public static fromEntity(connection: Connection): ConnectionResponseDto {
    const dto = new ConnectionResponseDto();
    dto.id = connection.id;
    dto.tenantId = connection.tenantId;
    dto.externalConnectionId = connection.externalConnectionId;
    dto.theirLabel = connection.theirLabel;
    dto.theirDid = connection.theirDid;
    dto.state = connection.state;
    dto.connectorType = connection.connectorType;
    dto.protocol = connection.protocol;
    dto.metadata = connection.metadata;
    dto.createdAt = connection.createdAt;
    dto.updatedAt = connection.updatedAt;
    return dto;
  }
}
