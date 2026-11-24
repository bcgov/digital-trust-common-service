import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, MoreThan, Repository } from 'typeorm';

import {
  PresentationExchange,
  PresentationExchangeState,
} from './presentation-exchange.entity';

const STATE_RANK: Record<PresentationExchangeState, number> = {
  pending: 0,
  'request-sent': 1,
  'presentation-received': 2,
  verified: 3,
  failed: 3,
  abandoned: 3,
};

@Injectable()
export class PresentationExchangeRepository {
  public constructor(
    @InjectRepository(PresentationExchange)
    private readonly repository: Repository<PresentationExchange>,
  ) {}

  public create(
    data: Partial<PresentationExchange>,
    manager: EntityManager,
  ): Promise<PresentationExchange> {
    return manager.save(
      PresentationExchange,
      manager.create(PresentationExchange, data),
    );
  }

  public findForTenant(
    tenantId: string,
    id: string,
  ): Promise<PresentationExchange | null> {
    return this.repository.findOne({ where: { tenantId, id } });
  }

  public findByBackend(
    tenantId: string,
    connectorId: string,
    externalId: string,
    manager?: EntityManager,
  ): Promise<PresentationExchange | null> {
    return (
      manager?.getRepository(PresentationExchange) ?? this.repository
    ).findOne({
      where: { tenantId, connectorId, externalId },
      ...(manager ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }

  public lock(
    tenantId: string,
    id: string,
    manager: EntityManager,
  ): Promise<PresentationExchange | null> {
    return manager.findOne(PresentationExchange, {
      where: { tenantId, id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  public hasRecentSubmission(
    tenantId: string,
    connectorId: string,
  ): Promise<boolean> {
    return this.repository.exists({
      where: {
        tenantId,
        connectorId,
        submission: In(['submitting', 'uncertain']),
        createdAt: MoreThan(new Date(Date.now() - 10 * 60 * 1000)),
      },
    });
  }

  public findUncertainByNonce(
    tenantId: string,
    connectorId: string,
    externalConnectionId: string,
    nonce: string,
  ): Promise<PresentationExchange[]> {
    return this.repository
      .createQueryBuilder('exchange')
      .where('exchange.tenant_id = :tenantId', { tenantId })
      .andWhere('exchange.connector_id = :connectorId', { connectorId })
      .andWhere('exchange.external_connection_id = :externalConnectionId', {
        externalConnectionId,
      })
      .andWhere("exchange.submission = 'uncertain'")
      .andWhere('exchange.external_id IS NULL')
      .andWhere("exchange.expected_evidence ->> 'nonce' = :nonce", { nonce })
      .getMany();
  }

  public hasUncertainSubmission(
    tenantId: string,
    connectorId: string,
  ): Promise<boolean> {
    return this.repository.exists({
      where: { tenantId, connectorId, submission: 'uncertain' },
    });
  }

  public async observe(
    exchange: PresentationExchange,
    externalId: string | null,
    state: PresentationExchangeState,
    manager: EntityManager,
  ): Promise<boolean> {
    if (
      externalId &&
      exchange.externalId &&
      exchange.externalId !== externalId
    ) {
      throw new ConflictException(
        'Presentation exchange backend correlation changed',
      );
    }
    if (externalId) {
      exchange.externalId = externalId;
      exchange.submission = 'submitted';
    }
    const changed = STATE_RANK[state] > STATE_RANK[exchange.state];
    if (changed) exchange.state = state;
    await manager.save(exchange);
    return changed;
  }
}
