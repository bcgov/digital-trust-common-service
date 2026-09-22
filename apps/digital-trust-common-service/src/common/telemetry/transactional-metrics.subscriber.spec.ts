import { DataSource } from 'typeorm';

import { BusinessMetricsService } from './business-metrics.service';
import { TransactionalMetricsSubscriber } from './transactional-metrics.subscriber';

describe('TransactionalMetricsSubscriber', () => {
  let dataSource: { subscribers: unknown[] };
  let businessMetrics: {
    beginDeferredScope: jest.Mock;
    flushDeferred: jest.Mock;
    discardDeferred: jest.Mock;
  };
  let subscriber: TransactionalMetricsSubscriber;

  beforeEach(() => {
    dataSource = { subscribers: [] };
    businessMetrics = {
      beginDeferredScope: jest.fn(),
      flushDeferred: jest.fn(),
      discardDeferred: jest.fn(),
    };

    subscriber = new TransactionalMetricsSubscriber(
      dataSource as unknown as DataSource,
      businessMetrics as unknown as BusinessMetricsService,
    );
  });

  it('registers itself so TypeORM broadcasts to this instance', () => {
    expect(dataSource.subscribers).toContain(subscriber);
  });

  it('opens a nesting level when a transaction or savepoint starts', () => {
    const queryRunner = { data: {} };

    subscriber.afterTransactionStart({ queryRunner } as never);

    expect(businessMetrics.beginDeferredScope).toHaveBeenCalledWith(
      queryRunner,
    );
  });

  it('releases the held records when the transaction commits', () => {
    const queryRunner = { data: {} };

    subscriber.afterTransactionCommit({ queryRunner } as never);

    expect(businessMetrics.flushDeferred).toHaveBeenCalledWith(queryRunner);
    expect(businessMetrics.discardDeferred).not.toHaveBeenCalled();
  });

  it('drops the held records when the transaction rolls back', () => {
    const queryRunner = { data: {} };

    subscriber.afterTransactionRollback({ queryRunner } as never);

    expect(businessMetrics.discardDeferred).toHaveBeenCalledWith(queryRunner);
    expect(businessMetrics.flushDeferred).not.toHaveBeenCalled();
  });
});
