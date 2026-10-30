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

export interface ExchangeTransition {
  readonly exchangeId: string;
  readonly from: ExchangeState;
  readonly to: ExchangeState;
}

function isExchangeState(state: string): state is ExchangeState {
  return Object.prototype.hasOwnProperty.call(STATE_RANK, state);
}

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

  private advance(
    exchange: CredentialExchange,
    next: ExchangeState,
  ): ExchangeTransition | null {
    const from = exchange.state;
    const isFailure =
      next === 'failed' || next === CredentialExchangeState.Abandoned;
    if (
      STATE_RANK[next] <= STATE_RANK[from] ||
      (isFailure && STATE_RANK[from] >= 4)
    ) {
      return null;
    }
    exchange.state = next;
    return { exchangeId: exchange.id, from, to: next };
  }

  public async markFailed(
    tenantId: string,
    id: string,
    manager: EntityManager,
  ): Promise<void> {
    const exchange = await this.lock(tenantId, id, manager);
    if (exchange && this.advance(exchange, 'failed')) {
      await this.save(exchange, manager);
    }
  }

  public async observe(
    tenantId: string,
    connectorId: string,
    externalId: string,
    state: string,
    manager: EntityManager,
    id?: string,
  ): Promise<ExchangeTransition | null> {
    state = state.replace(/_/g, '-');
    const exchange = await manager.findOne(CredentialExchange, {
      where: id
        ? { tenantId, connectorId, id }
        : { tenantId, connectorId, externalId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!exchange) return null;
    if (exchange.externalId && exchange.externalId !== externalId) {
      throw new ConflictException('Exchange backend correlation changed');
    }
    exchange.externalId = externalId;
    let transition: ExchangeTransition | null = null;
    if (isExchangeState(state)) {
      transition = this.advance(exchange, state);
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
    return transition;
  }
}
