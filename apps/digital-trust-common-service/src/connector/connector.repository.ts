import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Not, Repository } from 'typeorm';

import { ConnectorType } from '../connection/connection.entity';
import { Tenant } from '../tenant/tenant.entity';

import { Connector } from './connector.entity';

export enum ConnectorDeletionResult {
  DELETED = 'deleted',
  DEFAULT = 'default',
  NOT_FOUND = 'not-found',
}

@Injectable()
export class ConnectorRepository {
  public constructor(
    @InjectRepository(Connector)
    private readonly repository: Repository<Connector>,
  ) {}

  public async findById(id: string): Promise<Connector | null> {
    return await this.repository.findOne({
      where: { id },
      relations: { tenant: true },
    });
  }

  public findByTenantAndIdForUpdate(
    tenantId: string,
    id: string,
    manager: EntityManager,
  ): Promise<Connector | null> {
    return manager.getRepository(Connector).findOne({
      where: { tenantId, id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  public async findByTenant(tenantId: string): Promise<Connector[]> {
    return await this.repository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      relations: { tenant: true },
    });
  }

  public async findByTenantAndConnectorType(
    tenantId: string,
    connectorType: ConnectorType,
  ): Promise<Connector[]> {
    return await this.repository.find({
      where: { tenantId, connectorType },
      order: { createdAt: 'DESC' },
      relations: { tenant: true },
    });
  }

  public async findByTenantAndConnectorTypeAndActive(
    tenantId: string,
    connectorType: ConnectorType,
    active: boolean,
  ): Promise<Connector[]> {
    return await this.repository.find({
      where: { tenantId, connectorType, active },
      order: { createdAt: 'DESC' },
      relations: { tenant: true },
    });
  }

  public async findActiveByTenantAndId(
    tenantId: string,
    id: string,
  ): Promise<Connector | null> {
    return await this.repository.findOne({
      where: { tenantId, id, active: true },
    });
  }

  public async existsOtherActiveWithAgentLogIdHash(
    agentLogIdHash: string,
    excludeId: string,
  ): Promise<boolean> {
    return await this.repository.exists({
      where: { agentLogIdHash, active: true, id: Not(excludeId) },
    });
  }

  public async create(connector: Connector): Promise<Connector> {
    const entity = this.repository.create(connector);
    return await this.repository.save(entity);
  }

  public async update(
    id: string,
    updates: Partial<Omit<Connector, 'tenant'>>,
  ): Promise<Connector | null> {
    await this.repository.update(id, updates);
    return await this.findById(id);
  }

  public async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  public async deleteUnlessDefault(
    tenantId: string,
    id: string,
  ): Promise<ConnectorDeletionResult> {
    return this.repository.manager.transaction(async (manager) => {
      const tenant = await manager.getRepository(Tenant).findOne({
        where: { id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!tenant) return ConnectorDeletionResult.NOT_FOUND;
      if (tenant.config?.default_connector === id) {
        return ConnectorDeletionResult.DEFAULT;
      }

      const result = await manager
        .getRepository(Connector)
        .delete({ tenantId, id });
      return result.affected
        ? ConnectorDeletionResult.DELETED
        : ConnectorDeletionResult.NOT_FOUND;
    });
  }

  public async updateWithLock(
    tenantId: string,
    id: string,
    buildUpdates: (
      credential: Connector,
    ) =>
      | Partial<Omit<Connector, 'tenant'>>
      | Promise<Partial<Omit<Connector, 'tenant'>>>,
    manager?: EntityManager,
  ): Promise<Connector | null> {
    const update = async (manager: EntityManager) => {
      const repository = manager.getRepository(Connector);
      const existing = await repository.findOne({
        where: { tenantId, id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!existing) return null;

      const updates = await buildUpdates(existing);
      if (Object.keys(updates).length > 0) {
        await repository.update({ tenantId, id }, updates);
      }
      return repository.findOne({
        where: { tenantId, id },
        relations: { tenant: true },
      });
    };
    return manager
      ? update(manager)
      : this.repository.manager.transaction(update);
  }

  /**
   * Deactivates every currently-active connector credential for the tenant.
   * Reactivating the tenant does not auto-restore these; connectors must be
   * re-authenticated per tenant lifecycle policy. Returns the number of
   * credentials deactivated.
   */
  public async deactivateAllForTenant(tenantId: string): Promise<number> {
    const result = await this.repository.update(
      { tenantId, active: true },
      { active: false },
    );
    return result.affected ?? 0;
  }
}
