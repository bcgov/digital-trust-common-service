import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { IsEnum, IsObject, IsOptional, IsUrl } from 'class-validator';

import { ConnectionProtocol } from '../connection.entity';

/**
 * The connector itself is not caller-selected: create() resolves the
 * tenant's connector via AdapterRegistry, and their_label/their_did/
 * external_connection_id/state are populated by the connection.create
 * worker once the connector-side invitation exists, not supplied up front.
 * tenantId itself is a path parameter (POST /tenants/{tenantId}/connections),
 * not a body field.
 *
 * Two modes, selected by whether invitationUrl is present: omitted creates a
 * new invitation; provided accepts an existing invitation from another party.
 */
export class CreateConnectionDto {
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
