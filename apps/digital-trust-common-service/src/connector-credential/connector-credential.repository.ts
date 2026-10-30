import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Not, Repository } from 'typeorm';

import { ConnectorType } from '../connection/connection.entity';
import { Tenant } from '../tenant/tenant.entity';

import { ConnectorCredential } from './connector-credential.entity';

export enum ConnectorDeletionResult {
  DELETED = 'deleted',
  DEFAULT = 'default',
  NOT_FOUND = 'not-found',
}

@Injectable()
export class ConnectorCredentialRepository {
  public constructor(
    @InjectRepository(ConnectorCredential)
    private readonly repository: Repository<ConnectorCredential>,
  ) {}

  public async findById(id: string): Promise<ConnectorCredential | null> {
    return await this.repository.findOne({
      where: { id },
      relations: { tenant: true },
    });
  }

  public findByTenantAndIdForUpdate(
    tenantId: string,
    id: string,
    manager: EntityManager,
  ): Promise<ConnectorCredential | null> {
    return manager.getRepository(ConnectorCredential).findOne({
      where: { tenantId, id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  public async findByTenant(tenantId: string): Promise<ConnectorCredential[]> {
    return await this.repository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      relations: { tenant: true },
    });
  }

  public async findByTenantAndConnectorType(
    tenantId: string,
    connectorType: ConnectorType,
  ): Promise<ConnectorCredential[]> {
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
  ): Promise<ConnectorCredential[]> {
    return await this.repository.find({
      where: { tenantId, connectorType, active },
      order: { createdAt: 'DESC' },
      relations: { tenant: true },
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

  public async create(
    credential: ConnectorCredential,
  ): Promise<ConnectorCredential> {
    const entity = this.repository.create(credential);
    return await this.repository.save(entity);
  }

  public async update(
    id: string,
    updates: Partial<Omit<ConnectorCredential, 'tenant'>>,
  ): Promise<ConnectorCredential | null> {
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
        .getRepository(ConnectorCredential)
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
      credential: ConnectorCredential,
    ) =>
      | Partial<Omit<ConnectorCredential, 'tenant'>>
      | Promise<Partial<Omit<ConnectorCredential, 'tenant'>>>,
    manager?: EntityManager,
  ): Promise<ConnectorCredential | null> {
    const update = async (manager: EntityManager) => {
      const repository = manager.getRepository(ConnectorCredential);
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
