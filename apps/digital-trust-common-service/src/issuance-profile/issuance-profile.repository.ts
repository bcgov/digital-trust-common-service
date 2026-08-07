import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  IssuanceProfile,
  IssuanceProfileStatus,
} from './issuance-profile.entity';

@Injectable()
export class IssuanceProfileRepository {
  public constructor(
    @InjectRepository(IssuanceProfile)
    private readonly repository: Repository<IssuanceProfile>,
  ) {}

  public async create(
    profile: Partial<IssuanceProfile>,
  ): Promise<IssuanceProfile> {
    const entity = this.repository.create(profile);
    return await this.repository.save(entity);
  }

  public async findById(id: string): Promise<IssuanceProfile | null> {
    return await this.repository.findOne({ where: { id } });
  }

  public async findByTenant(tenantId: string): Promise<IssuanceProfile[]> {
    return await this.repository.find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
    });
  }

  public async findPublished(tenantId: string): Promise<IssuanceProfile[]> {
    return await this.repository.find({
      where: { tenantId, status: IssuanceProfileStatus.PUBLISHED },
      order: { createdAt: 'ASC' },
    });
  }

  public async findByNameAndVersion(
    tenantId: string,
    name: string,
    version: string,
  ): Promise<IssuanceProfile | null> {
    return await this.repository.findOne({
      where: { tenantId, name, version },
    });
  }

  public async updateStatus(
    id: string,
    status: IssuanceProfileStatus,
  ): Promise<void> {
    await this.repository.update(id, { status });
  }

  public async save(profile: IssuanceProfile): Promise<IssuanceProfile> {
    return await this.repository.save(profile);
  }
}
