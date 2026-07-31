import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Credential, CredentialState } from './credential.entity';

@Injectable()
export class CredentialRepository {
  public constructor(
    @InjectRepository(Credential)
    private readonly repository: Repository<Credential>,
  ) {}

  public async create(data: Partial<Credential>): Promise<Credential> {
    const entity = this.repository.create(data);
    return await this.repository.save(entity);
  }

  public async findById(id: string): Promise<Credential | null> {
    return await this.repository.findOne({ where: { id } });
  }

  public async findByTenant(tenantId: string): Promise<Credential[]> {
    return await this.repository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  public async findByExternalId(
    tenantId: string,
    externalId: string,
  ): Promise<Credential | null> {
    return await this.repository.findOne({
      where: { tenantId, externalId },
    });
  }

  public async findByProfile(
    tenantId: string,
    issuanceProfileId: string,
  ): Promise<Credential[]> {
    return await this.repository.find({
      where: { tenantId, issuanceProfileId },
      order: { createdAt: 'DESC' },
    });
  }

  public async updateState(
    id: string,
    state: CredentialState,
    timestamps?: { issuedAt?: Date; revokedAt?: Date },
  ): Promise<void> {
    await this.repository.update(id, {
      state,
      ...(timestamps?.issuedAt !== undefined
        ? { issuedAt: timestamps.issuedAt }
        : {}),
      ...(timestamps?.revokedAt !== undefined
        ? { revokedAt: timestamps.revokedAt }
        : {}),
    });
  }
}
