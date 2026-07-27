import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Connection, ConnectionState } from './connection.entity';

@Injectable()
export class ConnectionRepository {
  public constructor(
    @InjectRepository(Connection)
    private readonly repository: Repository<Connection>,
  ) {}

  public async create(connection: Partial<Connection>): Promise<Connection> {
    const entity = this.repository.create(connection);
    return await this.repository.save(entity);
  }

  public async findById(id: string): Promise<Connection | null> {
    return await this.repository.findOne({
      where: { id },
      relations: { tenant: true },
    });
  }

  public async findByExternalConnectionId(
    externalConnectionId: string,
  ): Promise<Connection | null> {
    return await this.repository.findOne({
      where: { externalConnectionId },
      relations: { tenant: true },
    });
  }

  public async findByTenantId(tenantId: string): Promise<Connection[]> {
    return await this.repository.find({
      where: { tenantId },
      order: {
        createdAt: 'ASC',
      },
      relations: { tenant: true },
    });
  }

  public async findByTenantIdAndState(
    tenantId: string,
    state: ConnectionState,
  ): Promise<Connection[]> {
    return await this.repository.find({
      where: { tenantId, state },
      order: {
        createdAt: 'ASC',
      },
      relations: { tenant: true },
    });
  }

  public async update(connection: Connection): Promise<Connection> {
    return await this.repository.save(connection);
  }

  public async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
