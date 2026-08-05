import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  VerificationProfile,
  VerificationProfileStatus,
} from './verification-profile.entity';

@Injectable()
export class VerificationProfileRepository {
  public constructor(
    @InjectRepository(VerificationProfile)
    private readonly repository: Repository<VerificationProfile>,
  ) {}

  public async create(
    profile: Partial<VerificationProfile>,
  ): Promise<VerificationProfile> {
    const entity = this.repository.create(profile);
    return await this.repository.save(entity);
  }

  public async findById(id: string): Promise<VerificationProfile | null> {
    return await this.repository.findOne({ where: { id } });
  }

  public async findByTenant(tenantId: string): Promise<VerificationProfile[]> {
    return await this.repository.find({
      where: { tenantId },
      order: { createdAt: 'ASC' },
    });
  }

  public async findPublicByTenant(
    tenantId: string,
  ): Promise<VerificationProfile[]> {
    return await this.repository.find({
      where: { tenantId, isPublic: true },
      order: { createdAt: 'ASC' },
    });
  }

  public async findByNameAndVersion(
    tenantId: string,
    name: string,
    version: string,
  ): Promise<VerificationProfile | null> {
    return await this.repository.findOne({
      where: { tenantId, name, version },
    });
  }

  public async updateStatus(
    id: string,
    status: VerificationProfileStatus,
  ): Promise<void> {
    await this.repository.update(id, { status });
  }

  public async save(
    profile: VerificationProfile,
  ): Promise<VerificationProfile> {
    return await this.repository.save(profile);
  }
}
