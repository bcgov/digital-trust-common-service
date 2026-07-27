import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TenantUser } from './tenant-user.entity';

@Injectable()
export class TenantUserRepository {
  public constructor(
    @InjectRepository(TenantUser)
    private readonly repository: Repository<TenantUser>,
  ) {}

  public async create(tenantUser: Partial<TenantUser>): Promise<TenantUser> {
    const entity = this.repository.create(tenantUser);
    return await this.repository.save(entity);
  }

  public async findById(id: string): Promise<TenantUser | null> {
    return await this.repository.findOne({
      where: { id },
    });
  }

  public async findByTenantId(tenantId: string): Promise<TenantUser[]> {
    return await this.repository.find({
      where: { tenantId },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  public async findByExternalUserId(
    externalUserId: string,
  ): Promise<TenantUser[]> {
    return await this.repository.find({
      where: { externalUserId },
    });
  }

  public async findByTenantAndExternalUserId(
    tenantId: string,
    externalUserId: string,
  ): Promise<TenantUser | null> {
    return await this.repository.findOne({
      where: {
        tenantId,
        externalUserId,
      },
    });
  }

  public async update(tenantUser: TenantUser): Promise<TenantUser> {
    return await this.repository.save(tenantUser);
  }

  public async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
