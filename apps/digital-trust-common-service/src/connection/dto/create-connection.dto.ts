import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsUrl,
  IsUUID,
  ValidateIf,
} from 'class-validator';

import { ConnectionProtocol } from '../connection.entity';

/**
 * create() resolves the selected or default tenant connector via AdapterRegistry.
 * their_label/their_did/external_connection_id/state are populated from the
 * connector's response, not supplied up front.
 * tenantId itself is a path parameter (POST /tenants/{tenantId}/connections),
 * not a body field.
 *
 * Two modes, selected by whether invitationUrl is present: omitted creates a
 * new invitation; provided accepts an existing invitation from another party.
 */
export class CreateConnectionDto {
  @Expose({ name: 'connector_id' })
  @ApiPropertyOptional({
    name: 'connector_id',
    description:
      'Tenant-owned active connector UUID. Omit or use "default" to select ' +
      'the tenant default connector; if none is configured, the tenant must ' +
      'have exactly one active connector.',
    oneOf: [
      { type: 'string', format: 'uuid' },
      { type: 'string', enum: ['default'] },
    ],
    example: 'default',
  })
  @ValidateIf(
    (_object: unknown, value: unknown) =>
      value !== undefined && value !== 'default',
  )
  @IsUUID()
  public connectorId?: string;

  @Expose()
  @ApiProperty({
    description: 'The DIDComm protocol version to use for the connection',
    enum: ConnectionProtocol,
    example: ConnectionProtocol.DIDCOMM_V2,
  })
  @IsEnum(ConnectionProtocol)
  public protocol!: ConnectionProtocol;

  @Expose({ name: 'invitation_url' })
  @ApiPropertyOptional({
    description:
      'URL of an existing invitation to accept. If provided, creates a ' +
      'connection by accepting this invitation rather than generating a ' +
      'new one.',
    example: 'https://example.com/invitations/abc123',
  })
  @IsOptional()
  @IsUrl()
  public invitationUrl?: string;

  @Expose()
  @ApiPropertyOptional({
    description:
      'Free-form metadata to associate with the connection. When creating ' +
      'a new invitation (no invitation_url), the following well-known keys ' +
      'are also read to configure it: `alias` (string, internal label), ' +
      '`label` (string, shown to the other party), `goalCode` (string), ' +
      '`multiUse` (boolean, defaults to false).',
    example: {
      alias: 'acme-partner',
      label: 'Acme Corp',
      goalCode: 'aries.rel.build',
      multiUse: false,
    },
  })
  @IsOptional()
  @IsObject()
  public metadata?: Record<string, unknown>;
}
