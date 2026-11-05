import { instanceToPlain } from 'class-transformer';

import {
  Connection,
  ConnectionProtocol,
  ConnectionState,
  ConnectorType,
} from '../connection.entity';

import { ConnectionResponseDto } from './connection-response.dto';

describe('ConnectionResponseDto', () => {
  it.each(['connector-1', null])(
    'serializes the verified connector binding %p without exposing entity relations',
    (connectorId) => {
      const connection = Object.assign(new Connection(), {
        id: 'connection-1',
        tenantId: 'tenant-1',
        externalConnectionId: 'backend-holder-1',
        connectorId,
        connectorType: ConnectorType.TRACTION,
        protocol: ConnectionProtocol.DIDCOMM_V1,
        state: ConnectionState.COMPLETED,
        metadata: { invitationId: 'invitation-1' },
        createdAt: new Date('2026-10-20T00:00:00Z'),
        updatedAt: new Date('2026-10-20T01:00:00Z'),
        tenant: { id: 'tenant-1', config: { internal: true } },
      });

      const dto = ConnectionResponseDto.fromEntity(connection);
      expect(dto).not.toHaveProperty('tenant');
      expect(dto).toMatchObject({
        id: connection.id,
        connectorId,
        metadata: connection.metadata,
      });
      expect(instanceToPlain(dto)).toMatchObject({
        id: connection.id,
        tenant_id: connection.tenantId,
        external_connection_id: connection.externalConnectionId,
        connector_id: connectorId,
        connector_type: ConnectorType.TRACTION,
        protocol: ConnectionProtocol.DIDCOMM_V1,
        state: ConnectionState.COMPLETED,
        created_at: connection.createdAt,
        updated_at: connection.updatedAt,
      });
    },
  );
});
