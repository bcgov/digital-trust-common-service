import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

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
    } else if (exchange.submission === 'submitting') {
      exchange.submission = 'uncertain';
    }
    const changed = STATE_RANK[state] > STATE_RANK[exchange.state];
    if (changed) exchange.state = state;
    await manager.save(exchange);
    return changed;
  }
}
