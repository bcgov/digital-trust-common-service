import type { AuthContext } from '@app/auth';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditAction } from '../audit-log/audit-log.entity';
import { DomainAuditService } from '../audit-log/domain-audit.service';
import {
  assertResourceTenantOrNotFound,
  assertTenantAccess,
} from '../common/assert-tenant-access';

import { Connection, ConnectionState } from './connection.entity';
import { ConnectionRepository } from './connection.repository';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { UpdateConnectionDto } from './dto/update-connection.dto';

@Injectable()
export class ConnectionService {
  public constructor(
    private readonly connectionRepository: ConnectionRepository,
    private readonly domainAudit: DomainAuditService,
  ) {}

  public async create(
    dto: CreateConnectionDto,
    auth: AuthContext,
  ): Promise<Connection> {
    assertTenantAccess(auth, dto.tenantId);

    const existing = await this.connectionRepository.findByExternalConnectionId(
      dto.externalConnectionId,
    );

    if (existing) {
      throw new ConflictException(
        'Connection with this external ID already exists.',
      );
    }

    const created = await this.connectionRepository.create({
      tenantId: dto.tenantId,
      externalConnectionId: dto.externalConnectionId,
      theirLabel: dto.theirLabel,
      theirDid: dto.theirDid,
      state: dto.state,
      connectorType: dto.connectorType,
      protocol: dto.protocol,
      metadata: dto.metadata || {},
    });

    await this.domainAudit.emit({
      tenantId: created.tenantId,
      action: AuditAction.CREATE,
      resourceType: 'connection',
      resourceId: created.id,
    });

    return created;
  }

  public async findById(id: string, auth: AuthContext): Promise<Connection> {
    const connection = await this.connectionRepository.findById(id);
    const notFound = `Connection '${id}' was not found.`;

    if (!connection) {
      throw new NotFoundException(notFound);
    }

    assertResourceTenantOrNotFound(auth, connection.tenantId, notFound);
    return connection;
  }

  public async findByExternalConnectionId(
    externalConnectionId: string,
    auth: AuthContext,
  ): Promise<Connection> {
    const connection =
      await this.connectionRepository.findByExternalConnectionId(
        externalConnectionId,
      );
    const notFound = `Connection with external ID '${externalConnectionId}' was not found.`;

    if (!connection) {
      throw new NotFoundException(notFound);
    }

    assertResourceTenantOrNotFound(auth, connection.tenantId, notFound);
    return connection;
  }

  public async findByTenantId(tenantId: string): Promise<Connection[]> {
    return await this.connectionRepository.findByTenantId(tenantId);
  }

  public async findByTenantIdAndState(
    tenantId: string,
    state: ConnectionState,
  ): Promise<Connection[]> {
    return await this.connectionRepository.findByTenantIdAndState(
      tenantId,
      state,
    );
  }

  public async update(
    id: string,
    dto: UpdateConnectionDto,
    auth: AuthContext,
  ): Promise<Connection> {
    const connection = await this.findById(id, auth);

    if (dto.theirLabel !== undefined) {
      connection.theirLabel = dto.theirLabel;
    }

    if (dto.theirDid !== undefined) {
      connection.theirDid = dto.theirDid;
    }

    if (dto.state !== undefined) {
      connection.state = dto.state;
    }

    if (dto.protocol !== undefined) {
      connection.protocol = dto.protocol;
    }

    if (dto.metadata !== undefined) {
      connection.metadata = dto.metadata;
    }

    const updated = await this.connectionRepository.update(connection);

    await this.domainAudit.emit({
      tenantId: updated.tenantId,
      action: AuditAction.UPDATE,
      resourceType: 'connection',
      resourceId: updated.id,
    });

    return updated;
  }

  public async delete(id: string, auth: AuthContext): Promise<void> {
    const connection = await this.findById(id, auth);

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
