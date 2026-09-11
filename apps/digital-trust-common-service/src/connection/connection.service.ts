import type { AuthContext } from '@app/auth';
import {
  ConnectionState as AdapterConnectionState,
  type Connection as AdapterConnection,
  type Invitation,
} from '@app/credential-ports';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import {
  assertResourceTenantOrNotFound,
  assertTenantAccess,
} from '../common/assert-tenant-access';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { OperationState } from '../operation/operation.entity';
import { OperationService } from '../operation/operation.service';

import {
  Connection,
  ConnectionProtocol,
  ConnectionState,
  ConnectorType,
} from './connection.entity';
import { ConnectionRepository } from './connection.repository';
import { CreateConnectionDto } from './dto/create-connection.dto';

/**
 * Maps the connector-reported connection state (the ConnectionPort's
 * agent-agnostic vocabulary) onto the persisted ConnectionState. The two
 * enums are not the same values: 'error' has no direct equivalent locally,
 * so it is treated the same as an abandoned connection.
 */
function mapAdapterConnectionState(
  state: AdapterConnectionState,
): ConnectionState {
  switch (state) {
    case AdapterConnectionState.Invitation:
      return ConnectionState.INVITED;
    case AdapterConnectionState.Request:
      return ConnectionState.REQUESTED;
    case AdapterConnectionState.Response:
      return ConnectionState.RESPONDED;
    case AdapterConnectionState.Active:
      return ConnectionState.ACTIVE;
    case AdapterConnectionState.Completed:
      return ConnectionState.COMPLETED;
    case AdapterConnectionState.Error:
      return ConnectionState.ABANDONED;
  }
}

export type ConnectionCursor = {
  createdAt: string;
  id: string;
};

export type PaginatedConnections = {
  data: Connection[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
  };
};

@Injectable()
export class ConnectionService {
  private readonly logger = new Logger(ConnectionService.name);

  public constructor(
    private readonly connectionRepository: ConnectionRepository,
    private readonly domainAudit: DomainAuditService,
    private readonly adapterRegistry: AdapterRegistry,
    private readonly operationService: OperationService,
  ) {}

  /**
   * Creates the connection row in its initial (invited) state, then calls
   * the tenant's connector adapter (e.g. TractionAdapter) to create the
   * invitation inline: unlike issuance/verification, invitation creation is
   * itself the immediate operation — there is nothing further for the
   * connector to do asynchronously — so the request waits on the adapter
   * call and returns the connection with its real external connection ID
   * populated. An Operation of type OPERATION_TYPE.CONNECTION_CREATE is
   * still recorded (pending -> processing -> completed/failed) so connection
   * creation attempts are tracked the same way as every other tenant action.
   */
  public async create(
    tenantId: string,
    dto: CreateConnectionDto,
    auth: AuthContext,
  ): Promise<Connection> {
    assertTenantAccess(auth, tenantId);

    const { adapter, connector, context } =
      await this.adapterRegistry.resolve(tenantId);

    const created = await this.connectionRepository.create({
      tenantId,
      connectorType: connector.connectorType,
      protocol: dto.protocol,
      state: ConnectionState.INVITED,
      metadata: dto.metadata ?? {},
    });

    await this.domainAudit.emit({
      tenantId: created.tenantId,
      action: AuditAction.CREATE,
      resourceType: 'connection',
      resourceId: created.id,
    });

    const operation = await this.operationService.createOperation({
      tenantId,
      type: OPERATION_TYPE.CONNECTION_CREATE,
      request: {
        method: 'POST',
        path: `${API_BASE_PATH}/tenants/${tenantId}/connections`,
        body: dto as unknown as Record<string, unknown>,
      },
    });

    await this.operationService.transitionState(
      operation.id,
      OperationState.PROCESSING,
    );

    try {
      const invitation = await adapter.createInvitation(context, {
        alias: dto.alias,
        label: dto.label,
        goalCode: dto.goalCode,
        multiUse: dto.multiUse,
      });

      const updated = await this.applyInvitationResult(created.id, invitation);

      await this.operationService.transitionState(
        operation.id,
        OperationState.COMPLETED,
        {
          connectionId: created.id,
          externalConnectionId: invitation.invitationId,
          invitationUrl: invitation.invitationUrl,
        },
      );

      return updated;
    } catch (error) {
      await this.markAbandoned(created.id);

      await this.operationService.transitionState(
        operation.id,
        OperationState.FAILED,
        {
          code: 'CONNECTION_CREATE_FAILED',
          message:
            error instanceof Error
              ? error.message
              : `Connector invitation could not be created for connection '${created.id}'.`,
        },
      );

      this.logger.warn(
        `connection.create failed for connection '${created.id}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      throw error;
    }
  }

  private async applyInvitationResult(
    connectionId: string,
    invitation: Invitation,
  ): Promise<Connection> {
    const connection = await this.connectionRepository.findById(connectionId);

    if (!connection) {
      throw new NotFoundException(
        `Connection '${connectionId}' was not found.`,
      );
    }

    // Traction's out-of-band invitation flow has no connection record yet at
    // creation time, so invitation.connectionId is typically absent here;
    // externalConnectionId stays null until syncAllWithAdapter correlates
    // this connection to one by invitationId (see applyRemoteConnectionState).
    if (invitation.connectionId) {
      connection.externalConnectionId = invitation.connectionId;
    }

    connection.metadata = {
      ...connection.metadata,
      invitationUrl: invitation.invitationUrl,
      invitationId: invitation.invitationId,
    };

    return await this.connectionRepository.update(connection);
  }

  private async markAbandoned(connectionId: string): Promise<void> {
    const connection = await this.connectionRepository.findById(connectionId);

    if (!connection) {
      return;
    }

    connection.state = ConnectionState.ABANDONED;
    await this.connectionRepository.update(connection);
  }

  public async findById(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<Connection> {
    const connection = await this.connectionRepository.findById(id);
    const notFound = `Connection '${id}' was not found.`;

    if (!connection || connection.tenantId !== tenantId) {
      throw new NotFoundException(notFound);
    }

    assertResourceTenantOrNotFound(auth, connection.tenantId, notFound);
    return await this.syncWithAdapter(connection);
  }

  /**
   * Refreshes a connection's state and their-label from the connector before
   * returning it, rather than trusting the last value we persisted — the
   * connector is the source of truth for the connection's lifecycle once the
   * invitation has gone out. If the connector cannot be reached, the sync is
   * skipped and the persisted record is returned as-is: a read should not
   * fail just because the connector is temporarily unavailable.
   */
  private async syncWithAdapter(connection: Connection): Promise<Connection> {
    if (!connection.externalConnectionId) {
      return connection;
    }

    try {
      const { adapter, context } = await this.adapterRegistry.resolve(
        connection.tenantId,
      );

      const remote: AdapterConnection = await adapter.getById(
        context,
        connection.externalConnectionId,
      );

      return await this.applyRemoteConnectionState(connection, remote);
    } catch (error) {
      this.logger.warn(
        `Failed to sync connection '${connection.id}' with its connector: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return connection;
    }
  }

  /**
   * Persists a connection's state, their-label, and external connection id
   * when the connector's view differs from what we last stored, otherwise
   * returns it unchanged. Also links a pending connection (no
   * externalConnectionId yet) to the connector record matched for it by
   * invitationId. Shared by syncWithAdapter (one connection, fetched by id)
   * and syncAllWithAdapter (every connection for a tenant, fetched with one
   * list() call) so the diffing rule lives in exactly one place.
   */
  private async applyRemoteConnectionState(
    connection: Connection,
    remote: AdapterConnection,
  ): Promise<Connection> {
    const state = mapAdapterConnectionState(remote.state);

    if (
      connection.state === state &&
      connection.theirLabel === remote.theirLabel &&
      connection.externalConnectionId === remote.id
    ) {
      return connection;
    }

    connection.state = state;
    connection.theirLabel = remote.theirLabel;
    connection.externalConnectionId = remote.id;

    return await this.connectionRepository.update(connection);
  }

  public async findByTenantId(
    tenantId: string,
    options: { limit?: number; cursor?: string | null } = {},
  ): Promise<PaginatedConnections> {
    const connections =
      await this.connectionRepository.findByTenantId(tenantId);
    const reconciled = await this.syncAllWithAdapter(tenantId, connections);

    return this.paginate(reconciled, options);
  }

  /**
   * Refreshes every connection's state and their-label from the tenant's
   * connector, and imports any connector-side connection that has no local
   * row yet (e.g. one accepted directly against the connector, or whose
   * creation job never completed here) — otherwise findByTenantId would
   * only ever surface connections this API itself created invitations for.
   * Matching and importing both go through a single list() call — one
   * round trip for the whole tenant rather than one getById() per
   * connection. Today a tenant resolves to its single connector
   * (AdapterRegistry.resolve), so this reaches the one adapter behind it;
   * as more connector types and per-tenant connectors are added, this is
   * the seam that will need to resolve and query each of them. As with
   * syncWithAdapter, a connector that cannot be reached does not fail the
   * read — the persisted records are returned as-is.
   */
  private async syncAllWithAdapter(
    tenantId: string,
    connections: Connection[],
  ): Promise<Connection[]> {
    let remote: readonly AdapterConnection[];
    let connectorType: ConnectorType;

    try {
      const { adapter, connector, context } =
        await this.adapterRegistry.resolve(tenantId);

      connectorType = connector.connectorType;

      remote = await adapter.list(context, {});
    } catch (error) {
      this.logger.warn(
        `Failed to sync connections for tenant '${tenantId}' with its connector: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return connections;
    }

    const remoteById = new Map(remote.map((entry) => [entry.id, entry]));
    const remoteByInvitationId = new Map(
      remote
        .filter(
          (entry): entry is AdapterConnection & { invitationId: string } =>
            Boolean(entry.invitationId),
        )
        .map((entry) => [entry.invitationId, entry]),
    );

    const matchedRemoteIds = new Set<string>();

    const synced = await Promise.all(
      connections.map(async (connection) => {
        // Once the connector has assigned this connection an id, match on
        // it directly. Until then (see applyInvitationResult), correlate by
        // the invitation that created it instead — the only identifier
        // Traction's out-of-band flow reports up front.
        const match = connection.externalConnectionId
          ? remoteById.get(connection.externalConnectionId)
          : this.matchByInvitationId(connection, remoteByInvitationId);

        if (!match) {
          return connection;
        }

        matchedRemoteIds.add(match.id);

        return this.applyRemoteConnectionState(connection, match);
      }),
    );

    const discovered = await Promise.all(
      remote
        .filter((entry) => !matchedRemoteIds.has(entry.id))
        .map((entry) => this.createFromRemote(tenantId, connectorType, entry)),
    );

    return [...synced, ...discovered];
  }

  private matchByInvitationId(
    connection: Connection,
    remoteByInvitationId: Map<string, AdapterConnection>,
  ): AdapterConnection | undefined {
    const invitationId = connection.metadata?.invitationId;

    return typeof invitationId === 'string'
      ? remoteByInvitationId.get(invitationId)
      : undefined;
  }

  /**
   * Persists a connection the connector already knows about but that has no
   * local row yet. The connector does not report which DIDComm protocol
   * version it negotiated, so this assumes DIDCOMM_V1 — the only protocol
   * TractionAdapter's invitation flow currently produces.
   */
  private async createFromRemote(
    tenantId: string,
    connectorType: ConnectorType,
    remote: AdapterConnection,
  ): Promise<Connection> {
    try {
      const created = await this.connectionRepository.create({
        tenantId,
        connectorType,
        protocol:
          (remote.protocol as ConnectionProtocol) ||
          ConnectionProtocol.DIDCOMM_V1,
        state: mapAdapterConnectionState(remote.state),
        theirLabel: remote.theirLabel,
        externalConnectionId: remote.id,
        metadata: {},
      });

      await this.domainAudit.emit({
        tenantId,
        action: AuditAction.CREATE,
        resourceType: 'connection',
        resourceId: created.id,
      });

      return created;
    } catch (error) {
      // externalConnectionId is uniquely indexed: a concurrent
      // findByTenantId call may have already imported this connection
      // between the list() call and here, so the insert fails rather than
      // duplicating it. Return the row it created instead of failing the
      // whole read.
      const existing =
        await this.connectionRepository.findByExternalConnectionId(remote.id);

      if (!existing) {
        throw error;
      }

      return existing;
    }
  }

  public async findByTenantIdAndState(
    tenantId: string,
    state: ConnectionState,
    options: { limit?: number; cursor?: string | null } = {},
  ): Promise<PaginatedConnections> {
    const connections = await this.connectionRepository.findByTenantIdAndState(
      tenantId,
      state,
    );

    return this.paginate(connections, options);
  }

  /**
   * Paginates an already-fetched, reconciled connection list in memory
   * rather than pushing LIMIT/OFFSET down to the query. findByTenantId must
   * load every local row anyway to reconcile it against the connector's
   * full list() response (see syncAllWithAdapter) and to correctly dedupe
   * discovered connector-only connections against ones that already exist
   * outside the requested page, so there is no cheaper query to run first —
   * pagination here only bounds the response size, not the work done to
   * produce it.
   */
  private paginate(
    connections: Connection[],
    options: { limit?: number; cursor?: string | null },
  ): PaginatedConnections {
    const limit = options.limit ?? 20;
    const cursor = options.cursor ? this.decodeCursor(options.cursor) : null;

    const sorted = [...connections].sort((a, b) => {
      const createdAtDiff = a.createdAt.getTime() - b.createdAt.getTime();
      return createdAtDiff !== 0 ? createdAtDiff : a.id.localeCompare(b.id);
    });

    const afterCursor = cursor
      ? sorted.filter((connection) => {
          const createdAt = connection.createdAt.toISOString();
          return (
            createdAt > cursor.createdAt ||
            (createdAt === cursor.createdAt && connection.id > cursor.id)
          );
        })
      : sorted;

    const hasMore = afterCursor.length > limit;
    const data = afterCursor.slice(0, limit);
    const last = data[data.length - 1];
    const nextCursor =
      hasMore && last
        ? this.encodeCursor({
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null;

    return {
      data,
      pagination: { next_cursor: nextCursor, has_more: hasMore },
    };
  }

  public encodeCursor(cursor: ConnectionCursor): string {
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  public decodeCursor(raw: string): ConnectionCursor {
    try {
      const parsed = JSON.parse(
        Buffer.from(raw, 'base64url').toString('utf8'),
      ) as ConnectionCursor;

      if (!parsed?.createdAt || !parsed?.id) {
        throw new Error('invalid cursor shape');
      }

      return parsed;
    } catch {
      throw new BadRequestException('Invalid pagination cursor.');
    }
  }

  /**
   * Deletes a connection locally and, when it has been linked to a
   * connector-side connection, on the connector too — otherwise the next
   * syncAllWithAdapter() would re-import it from the connector's list()
   * since the connector never learned it was deleted. A connection still
   * pending correlation (no externalConnectionId yet) has nothing to delete
   * on the connector side.
   */
  public async delete(
    tenantId: string,
    id: string,
    auth: AuthContext,
  ): Promise<void> {
    const connection = await this.findById(tenantId, id, auth);

    if (connection.externalConnectionId) {
      const { adapter, context } = await this.adapterRegistry.resolve(tenantId);

      await adapter.deleteById(context, connection.externalConnectionId);
    }

    await this.connectionRepository.delete(id);

    await this.domainAudit.emit({
      tenantId: connection.tenantId,
      action: AuditAction.DELETE,
      resourceType: 'connection',
      resourceId: id,
    });
  }

  /** Used by the tenant status-change cascade when a tenant is deactivated. */
  public async abandonAllForTenant(tenantId: string): Promise<number> {
    return this.connectionRepository.abandonAllForTenant(tenantId);
  }
}
