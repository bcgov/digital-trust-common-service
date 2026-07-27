import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OAuthClient } from './oauth-client.entity';

@Injectable()
export class OAuthClientRepository {
  public constructor(
    @InjectRepository(OAuthClient)
    private readonly repository: Repository<OAuthClient>,
  ) {}

  public async findById(id: string): Promise<OAuthClient | null> {
    return this.repository.findOne({
      where: { id },
      relations: { tenant: true },
    });
  }

  public async findByClientId(clientId: string): Promise<OAuthClient | null> {
    return await this.repository.findOne({
      where: { clientId },
      relations: { tenant: true },
    });
  }

  public async findByTenant(tenantId: string): Promise<OAuthClient[]> {
    return await this.repository.find({
      where: { tenantId },
      order: {
        createdAt: 'ASC',
      },
      relations: { tenant: true },
    });
  }

  public async create(client: OAuthClient): Promise<OAuthClient> {
    const entity = this.repository.create(client);
    return await this.repository.save(entity);
  }

  public async update(client: OAuthClient): Promise<OAuthClient> {
    return await this.repository.save(client);
  }

  public async revoke(id: string): Promise<void> {
    await this.repository.update(id, {
      revokedAt: new Date(),
    });
  }
}
