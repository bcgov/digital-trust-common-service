import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Tenant } from './tenant.entity';

@Injectable()
export class TenantRepository {
  public constructor(
    @InjectRepository(Tenant)
    private readonly repo: Repository<Tenant>,
  ) {}

  public findAll(): Promise<Tenant[]> {
    return this.repo.find();
  }

  public findById(id: string): Promise<Tenant | null> {
    return this.repo.findOne({
      where: { id },
    });
  }

  public findBySlug(slug: string): Promise<Tenant | null> {
    return this.repo.findOne({
      where: { slug },
    });
  }

  public create(data: Partial<Tenant>): Tenant {
    return this.repo.create(data);
  }

  public save(entity: Tenant): Promise<Tenant> {
    return this.repo.save(entity);
  }

  public async delete(id: string): Promise<void> {
    await this.repo.softDelete(id);
  }

  public async restore(id: string): Promise<void> {
    await this.repo.restore(id);
  }
}
