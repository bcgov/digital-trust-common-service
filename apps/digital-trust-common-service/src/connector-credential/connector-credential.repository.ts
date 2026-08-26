import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ConnectorType } from '../connection/connection.entity';

import { ConnectorCredential } from './connector-credential.entity';

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
