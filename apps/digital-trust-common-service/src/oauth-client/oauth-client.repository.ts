import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { OAuthClient, OAuthClientRevokedReason } from './oauth-client.entity';

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

  /**
   * Revokes every not-yet-revoked client for the tenant, tagging each with
   * `TENANT_DEACTIVATION` so `restoreAllForTenant` can later tell them apart
   * from clients revoked individually for cause. Returns the number of
   * clients revoked.
   */
  public async revokeAllForTenant(tenantId: string): Promise<number> {
    const result = await this.repository.update(
      { tenantId, revokedAt: IsNull() },
      {
        revokedAt: new Date(),
        revokedReason: OAuthClientRevokedReason.TENANT_DEACTIVATION,
      },
    );
    return result.affected ?? 0;
  }

  /**
   * Restores only the clients this repository previously bulk-revoked for a
   * tenant deactivation, leaving individually-revoked clients (reason null)
   * untouched. Returns the number of clients restored.
   */
  public async restoreAllForTenant(tenantId: string): Promise<number> {
    const result = await this.repository.update(
      { tenantId, revokedReason: OAuthClientRevokedReason.TENANT_DEACTIVATION },
      { revokedAt: null, revokedReason: null },
    );
    return result.affected ?? 0;
  }
}
