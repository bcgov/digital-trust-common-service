import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { WebhookRegistration } from './webhook-registration.entity';

@Injectable()
export class WebhookRegistrationRepository {
  public constructor(
    @InjectRepository(WebhookRegistration)
    private readonly repository: Repository<WebhookRegistration>,
  ) {}

  public create(
    tenantId: string,
    data: Pick<
      WebhookRegistration,
      'endpointUrl' | 'events' | 'credentialsEncrypted' | 'keyVersion'
    >,
  ): Promise<WebhookRegistration> {
    const registration = this.repository.create({ ...data, tenantId });
    return this.repository.save(registration);
  }

  public findByTenant(tenantId: string): Promise<WebhookRegistration[]> {
    return this.repository.find({
      where: { tenantId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  public findActiveByTenant(tenantId: string): Promise<WebhookRegistration[]> {
    return this.repository.find({
      where: { tenantId, active: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  public findActiveForDispatch(
    tenantId: string,
  ): Promise<WebhookRegistration[]> {
    return this.repository
      .createQueryBuilder('registration')
      .addSelect([
        'registration.credentialsEncrypted',
        'registration.keyVersion',
      ])
      .where('registration.tenant_id = :tenantId', { tenantId })
      .andWhere('registration.active = true')
      .orderBy('registration.created_at', 'ASC')
      .addOrderBy('registration.id', 'ASC')
      .getMany();
  }

  public findByTenantAndId(
    tenantId: string,
    id: string,
  ): Promise<WebhookRegistration | null> {
    return this.repository.findOne({ where: { tenantId, id } });
  }

  public async deleteByTenantAndId(
    tenantId: string,
    id: string,
  ): Promise<boolean> {
    const result = await this.repository.delete({ tenantId, id });
    return result.affected === 1;
  }
}
