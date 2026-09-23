import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntitySubscriberInterface,
  TransactionCommitEvent,
  TransactionRollbackEvent,
  TransactionStartEvent,
} from 'typeorm';

import { BusinessMetricsService } from './business-metrics.service';

/**
 * Releases business metric records that were held for an open transaction.
 *
 * A counter increment cannot participate in a transaction, so a record made
 * while one is open describes a state change that may still be rolled back.
 * TypeORM broadcasts these events from the query runner either side of the
 * decision, which gives the increment the same durability as the row it
 * describes.
 *
 * All three events are needed because TypeORM implements a nested transaction
 * as a savepoint on the same query runner, and broadcasts the same commit and
 * rollback events when that savepoint is released or rolled back as it does
 * for the real `COMMIT` and `ROLLBACK`. Tracking the start of each level is
 * what lets BusinessMetricsService tell the two apart, so an inner level
 * cannot release the outer level's records early, or discard records the
 * outer transaction goes on to commit.
 *
 * Registration is by constructor rather than the `@EventSubscriber()`
 * decorator, so the subscriber is the Nest-managed instance holding the
 * injected {@link BusinessMetricsService} rather than one TypeORM built itself.
 */
@Injectable()
export class TransactionalMetricsSubscriber implements EntitySubscriberInterface {
  public constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly businessMetrics: BusinessMetricsService,
  ) {
    dataSource.subscribers.push(this);
  }

  public afterTransactionStart(event: TransactionStartEvent): void {
    this.businessMetrics.beginDeferredScope(event.queryRunner);
  }

  public afterTransactionCommit(event: TransactionCommitEvent): void {
    this.businessMetrics.flushDeferred(event.queryRunner);
  }

  public afterTransactionRollback(event: TransactionRollbackEvent): void {
    this.businessMetrics.discardDeferred(event.queryRunner);
  }
}
