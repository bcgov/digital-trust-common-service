import { CredentialExchangeState } from '@app/credential-ports';
import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { CredentialExchange } from './credential-exchange.entity';
import type {
  ExchangeState,
  IssueSubmission,
} from './credential-exchange.entity';

const STATE_RANK: Record<ExchangeState, number> = {
  pending: 0,
  [CredentialExchangeState.ProposalSent]: 1,
  [CredentialExchangeState.OfferSent]: 2,
  [CredentialExchangeState.OfferReceived]: 2,
  [CredentialExchangeState.RequestSent]: 3,
  [CredentialExchangeState.RequestReceived]: 3,
  [CredentialExchangeState.CredentialIssued]: 4,
  [CredentialExchangeState.CredentialReceived]: 4,
  [CredentialExchangeState.Done]: 5,
  [CredentialExchangeState.Abandoned]: 5,
  failed: 5,
};

@Injectable()
export class CredentialExchangeRepository {
  public constructor(
    @InjectRepository(CredentialExchange)
    private readonly repository: Repository<CredentialExchange>,
  ) {}

  public async create(
    data: Partial<CredentialExchange>,
    manager: EntityManager,
  ): Promise<CredentialExchange> {
    return manager.save(
      CredentialExchange,
      manager.create(CredentialExchange, data),
    );
  }

  public findForTenant(
    tenantId: string,
    id: string,
  ): Promise<CredentialExchange | null> {
    return this.repository.findOne({ where: { tenantId, id } });
  }

  public lock(
    tenantId: string,
    id: string,
    manager: EntityManager,
  ): Promise<CredentialExchange | null> {
    return manager.findOne(CredentialExchange, {
      where: { tenantId, id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  public save(
    exchange: CredentialExchange,
    manager: EntityManager,
  ): Promise<CredentialExchange> {
    return manager.save(exchange);
  }

  public async setSubmission(
    tenantId: string,
    id: string,
    state: IssueSubmission,
  ): Promise<void> {
    await this.repository.update(
      { tenantId, id, issueSubmission: 'submitting' },
      { issueSubmission: state },
    );
  }

  public async observe(
    tenantId: string,
    connectorId: string,
    externalId: string,
    state: string,
    manager: EntityManager,
    id?: string,
  ): Promise<void> {
    state = state.replace(/_/g, '-');
    const exchange = await manager.findOne(CredentialExchange, {
      where: id
        ? { tenantId, connectorId, id }
        : { tenantId, connectorId, externalId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!exchange) return;
    if (exchange.externalId && exchange.externalId !== externalId) {
      throw new ConflictException('Exchange backend correlation changed');
    }
    exchange.externalId = externalId;
    if (Object.prototype.hasOwnProperty.call(STATE_RANK, state)) {
      const next = state as ExchangeState;
      const isFailure =
        next === 'failed' || next === CredentialExchangeState.Abandoned;
      if (
        STATE_RANK[next] > STATE_RANK[exchange.state] &&
        (!isFailure || STATE_RANK[exchange.state] < 4)
      ) {
        exchange.state = next;
      }
      if (
        (exchange.state === CredentialExchangeState.CredentialIssued ||
          exchange.state === CredentialExchangeState.CredentialReceived ||
          exchange.state === CredentialExchangeState.Done) &&
        exchange.issueSubmission !== 'not-submitted'
      ) {
        exchange.issueSubmission = 'submitted';
      }
    }
    await manager.save(exchange);
  }
}
