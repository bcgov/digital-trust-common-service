import type { AuthContext } from '@app/auth';
import {
  type AgentAdapter,
  ConnectionState as AdapterConnectionState,
  type Connection as AdapterConnection,
  type ConnectorContext,
  type Invitation,
} from '@app/credential-ports';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { AdapterRegistry } from '../adapter-registry/adapter-registry.service';
import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import {
  assertResourceTenantOrNotFound,
  assertTenantAccess,
} from '../common/assert-tenant-access';
import { API_BASE_PATH } from '../common/constants/api-version.constants';
import { decodeCursor, encodeCursor } from '../common/cursor-pagination';
import { OPERATION_TYPE } from '../operation/operation-type.constants';
import { Operation, OperationState } from '../operation/operation.entity';
import { OperationService } from '../operation/operation.service';

import { Connection, ConnectionState } from './connection.entity';
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

/**
 * `invitationId`, `invitationUrl`, and `multiUse` are internal correlation
 * state the webhook worker trusts to decide whether to update or clone a
 * connection row (see applyConnectionOutcome) — a caller-supplied metadata
 * object must never be able to set them, or a crafted value could redirect
 * a later webhook onto (or clone from) an unrelated connection.
 */
function sanitizeCallerMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = { ...metadata };
  delete sanitized.invitationId;
  delete sanitized.invitationUrl;
  delete sanitized.multiUse;

  return sanitized;
}

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
  ): Promise<Operation> {
    assertTenantAccess(auth, tenantId);

    const { adapter, connector, context } =
      await this.adapterRegistry.resolve(tenantId);

    const created = await this.connectionRepository.create({
      tenantId,
      connectorType: connector.connectorType,
      protocol: dto.protocol,
      state: dto.invitationUrl
        ? ConnectionState.REQUESTED
        : ConnectionState.INVITED,
      metadata: sanitizeCallerMetadata(dto.metadata ?? {}),
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
      const result = dto.invitationUrl
        ? await this.acceptInvitation(
            created,
            adapter,
            context,
            dto.invitationUrl,
          )
        : await this.createInvitation(created, adapter, context, dto);

      return await this.operationService.transitionState(
        operation.id,
        OperationState.COMPLETED,
        result,
      );
    } catch (error) {
      await this.markAbandoned(created.id);

      this.logger.warn(
        `connection.create failed for connection '${created.id}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return await this.operationService.transitionState(
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
    }
  }

  /**
   * Create-invitation mode: generates a new invitation on the connector and
   * links it to the local connection row. The result carries invitation_url
   * for the caller to hand to the other party.
   */
  private async createInvitation(
    created: Connection,
    adapter: AgentAdapter,
    context: ConnectorContext,
    dto: CreateConnectionDto,
  ): Promise<Record<string, unknown>> {
    const invitation = await adapter.createInvitation(context, {
      alias: dto.alias,
      label: dto.label,
      goalCode: dto.goalCode,
      multiUse: dto.multiUse,
    });

    await this.applyInvitationResult(created.id, invitation, dto.multiUse);

    return {
      connection_id: created.id,
      invitation_url: invitation.invitationUrl,
    };
  }

  /**
   * Accept-invitation mode: accepts another party's invitation URL on the
   * connector and adopts its reported connection state onto the local row.
   * The result carries connection_id + state so the caller can poll or fetch
   * the connection without a separate list() round trip.
   */
  private async acceptInvitation(
    created: Connection,
    adapter: AgentAdapter,
    context: ConnectorContext,
    invitationUrl: string,
  ): Promise<Record<string, unknown>> {
    const remote = await adapter.acceptInvitation(context, invitationUrl);
    const updated = await this.applyRemoteConnectionState(created, remote);

    return {
      connection_id: updated.id,
      state: updated.state,
    };
  }

  private async applyInvitationResult(
    connectionId: string,
    invitation: Invitation,
    multiUse?: boolean,
  ): Promise<Connection> {
    const connection = await this.connectionRepository.findById(connectionId);

    if (!connection) {
      throw new NotFoundException(
        `Connection '${connectionId}' was not found.`,
      );
    }

    if (invitation.connectionId) {
      connection.externalConnectionId = invitation.connectionId;
    }

    connection.metadata = {
      ...connection.metadata,
      invitationUrl: invitation.invitationUrl,
      invitationId: invitation.invitationId,
      // Distinguishes a reusable multi-use invitation template (never itself
      // a specific party's connection) from a single-use invitation's own
      // connection row, for applyConnectionOutcome's create-vs-update choice.
      multiUse: Boolean(multiUse),
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
    return connection;
  }

  /**
   * Persists a connection's state, their-label, and external connection id
   * as reported by the connector immediately after accepting an invitation.
   */
  private async applyRemoteConnectionState(
    connection: Connection,
    remote: AdapterConnection,
  ): Promise<Connection> {
    const state = mapAdapterConnectionState(remote.state);

    if (
      connection.state === state &&
      connection.theirLabel === remote.theirLabel &&
      connection.theirDid === remote.theirDid &&
      connection.externalConnectionId === remote.id
    ) {
      return connection;
    }

    connection.state = state;
    connection.theirLabel = remote.theirLabel;
    connection.theirDid = remote.theirDid;
    connection.externalConnectionId = remote.id;

    return await this.connectionRepository.update(connection);
  }

  public async findByTenantId(
    tenantId: string,
    options: { limit?: number; cursor?: string | null } = {},
  ): Promise<PaginatedConnections> {
    const connections =
      await this.connectionRepository.findByTenantId(tenantId);

    return this.paginate(connections, options);
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
   * Paginates an already-fetched connection list in memory. Kept as an
   * in-memory cursor over the full tenant/state result set rather than
   * pushing LIMIT/OFFSET into the query, matching the shared cursor
   * convention used elsewhere in this service.
   */
  private paginate(
    connections: Connection[],
    options: { limit?: number; cursor?: string | null },
  ): PaginatedConnections {
    const limit = options.limit ?? 20;
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;

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
        ? encodeCursor({
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null;

    return {
      data,
      pagination: { next_cursor: nextCursor, has_more: hasMore },
    };
  }

  /**
   * Deletes a connection locally and, when it has been linked to a
   * connector-side connection, on the connector too. A connection still
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

  /**
   * Tenant-scoped lookup for the protocol.state-change worker, which has no
   * AuthContext (it's a system caller, not a request), so it can't use
   * findById's assertResourceTenantOrNotFound path. Returns null rather than
   * throwing, since "no matching connection for this tenant" is a legitimate
   * no-op for the worker rather than an error.
   */
  public async findByExternalConnectionIdForTenant(
    tenantId: string,
    externalConnectionId: string,
  ): Promise<Connection | null> {
    return this.connectionRepository.findByExternalConnectionIdForTenant(
      tenantId,
      externalConnectionId,
    );
  }

  /**
   * Tenant-scoped lookup for the protocol.state-change worker, which has no
   * AuthContext (it's a system caller, not a request), so it can't use
   * findById's assertResourceTenantOrNotFound path. Returns null rather than
   * throwing, since "no matching connection for this tenant" is a legitimate
   * no-op for the worker rather than an error.
   */
  public async findByInvitationMsgIdForTenant(
    tenantId: string,
    invitationMsgId: string,
  ): Promise<Connection | null> {
    return this.connectionRepository.findByInvitationMsgIdForTenant(
      tenantId,
      invitationMsgId,
    );
  }

  /**
   * A multi-use invitation's connection row represents the reusable
   * invitation itself, not any one party that accepted it, so it must stay
   * untouched here and can't be the row a per-connection webhook transitions
   * (see applyConnectionOutcome). This clones a fresh connection row from it
   * for the newly-connecting party, keyed on their own `externalId`, in the
   * same transaction as the caller's guarded state write so a rollback
   * (e.g. the webhook-dispatch enqueue failing) doesn't leave an orphaned
   * connection with no corresponding notification.
   *
   * Created directly in `state`, the outcome the triggering webhook already
   * reported, rather than a fixed INVITED followed by a separate guarded
   * transition: connectionStatesBelow's forward-guard is built for
   * protecting an existing row from regressing, but a row that didn't exist
   * a moment ago has no prior state to protect, and `state` may itself be
   * INVITED's floor (rank 0), which no `fromStates` guard could ever match.
   */
  public async createFromInvitationTemplate(
    template: Connection,
    externalId: string,
    state: ConnectionState,
    theirDid: string | undefined,
    manager: EntityManager,
  ): Promise<Connection> {
    // invitationUrl/invitationId only mean anything for the row that owns
    // the invitation (the template itself); the per-party row this spins
    // off is a real connection, not an invitation, so it doesn't need them.
    const metadata = { ...(template.metadata ?? {}) };
    delete metadata.invitationUrl;
    delete metadata.invitationId;

    const created = await this.connectionRepository.create(
      {
        tenantId: template.tenantId,
        connectorType: template.connectorType,
        protocol: template.protocol,
        state,
        externalConnectionId: externalId,
        theirDid,
        metadata,
      },
      manager,
    );

    await this.domainAudit.emit(
      {
        tenantId: created.tenantId,
        action: AuditAction.CREATE,
        resourceType: 'connection',
        resourceId: created.id,
      },
      manager,
    );

    return created;
  }

  /**
   * System-triggered state transition applied by the protocol.state-change
   * worker. No AuthContext check here for the same reason as above.
   *
   * Guarded rather than an unconditional read-modify-write: pg-boss's
   * at-least-once delivery means the same webhook can be handled more than
   * once concurrently, so the worker checking "is this a forward transition"
   * against an earlier read and then writing separately would let two
   * deliveries both pass the check and both write (and both fire the domain
   * audit below). `fromStates` — state-mapping.ts's `connectionStatesBelow()`
   * — is enforced by the database at write time
   * (ConnectionRepository.updateStateIfForward's `WHERE state IN (...)`).
   * Returns null when another delivery already won the race (or the
   * connection has moved on since), so the caller must skip the domain audit
   * and any further side effects for this call.
   */
  public async applyProtocolStateIfForward(
    connection: Connection,
    state: ConnectionState,
    fromStates: ConnectionState[],
    manager?: EntityManager,
  ): Promise<Connection | null> {
    const won = await this.connectionRepository.updateStateIfForward(
      connection.id,
      connection.tenantId,
      state,
      fromStates,
      manager,
    );

    if (!won) {
      return null;
    }

    connection.state = state;

    await this.domainAudit.emit(
      {
        tenantId: connection.tenantId,
        action: AuditAction.UPDATE,
        resourceType: 'connection',
        resourceId: connection.id,
      },
      manager,
    );

    return connection;
  }
}
