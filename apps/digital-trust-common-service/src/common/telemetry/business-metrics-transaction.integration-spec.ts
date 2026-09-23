import { AppDataSource } from '@app/database/data-source';
import { buildSslConfig } from '@app/database/ssl.util';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { metrics } from '@opentelemetry/api';
import { DataSource } from 'typeorm';

import { BusinessMetricsModule } from './business-metrics.module';
import {
  ATTR_OPERATION_TYPE,
  BusinessMetricsService,
} from './business-metrics.service';
import { TransactionalMetricsSubscriber } from './transactional-metrics.subscriber';

/**
 * The deferral is only correct if TypeORM really broadcasts what the unit specs
 * assume: a commit event after COMMIT, a rollback event after ROLLBACK, and the
 * same two events for a savepoint released or rolled back inside an open
 * transaction. Those specs drive the service with a hand-built query runner, so
 * they would keep passing if the subscriber stopped being registered, if the
 * event names changed, or if a TypeORM upgrade moved when isTransactionActive
 * is cleared — each of which silently either loses committed counts or
 * double counts them.
 *
 * This exercises the wiring and the ordering for real: a Nest module graph
 * holding the actual DataSource, against the test database, with only the
 * exporter faked so the counter is observable.
 */
describe('business metrics transaction integration', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let service: BusinessMetricsService;
  let add: jest.Mock;

  /** Records against the caller's transaction, as OperationService does. */
  const record = (
    manager: Parameters<BusinessMetricsService['recordCredentialOperation']>[2],
    operationType: string,
  ): void => {
    service.recordCredentialOperation(operationType, 'completed', manager);
  };

  const recordedTypes = (): unknown[] =>
    (add.mock.calls as unknown[][]).map(
      (call) => (call[1] as Record<string, string>)[ATTR_OPERATION_TYPE],
    );

  beforeAll(async () => {
    // Installed before the module is built: the service resolves its meter on
    // first use, so this is what makes the counter observable without standing
    // up an exporter.
    add = jest.fn();
    jest.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter: jest.fn(() => ({ add })),
    } as never);

    moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          ...AppDataSource.options,
          // No table is read or written here — only transaction control — so
          // the entity set is deliberately empty and no migration is run.
          entities: [],
          ssl: buildSslConfig(
            process.env.DB_SSL,
            process.env.DB_SSL_REJECT_UNAUTHORIZED,
            process.env.DB_SSL_CA,
          ),
        } as Parameters<typeof TypeOrmModule.forRoot>[0]),
        // Imported as a whole rather than providing the service by hand, so a
        // subscriber dropped from the module's providers fails this spec.
        BusinessMetricsModule,
      ],
    }).compile();

    await moduleRef.init();

    dataSource = moduleRef.get(DataSource);
    service = moduleRef.get(BusinessMetricsService);
  });

  afterAll(async () => {
    await moduleRef?.close();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    add.mockClear();
  });

  it('registers the subscriber on the real data source', () => {
    expect(
      dataSource.subscribers.some(
        (subscriber) => subscriber instanceof TransactionalMetricsSubscriber,
      ),
    ).toBe(true);
  });

  it('holds the record until the transaction commits', async () => {
    await dataSource.transaction(async (manager) => {
      await manager.query('SELECT 1');
      record(manager, 'credential.offer');

      // Still inside the transaction: nothing is durable yet.
      expect(add).not.toHaveBeenCalled();
    });

    expect(recordedTypes()).toEqual(['credential.offer']);
  });

  it('drops the record when the transaction rolls back', async () => {
    await expect(
      dataSource.transaction(async (manager) => {
        await manager.query('SELECT 1');
        record(manager, 'credential.offer');

        throw new Error('caller rolled back');
      }),
    ).rejects.toThrow('caller rolled back');

    expect(add).not.toHaveBeenCalled();
  });

  it('does not release outer records when an inner savepoint commits', async () => {
    await dataSource.transaction(async (outer) => {
      await outer.query('SELECT 1');
      record(outer, 'credential.offer');

      await outer.transaction(async (inner) => {
        await inner.query('SELECT 1');
        record(inner, 'credential.revoke');
      });

      // The inner level released its savepoint, but the outer transaction is
      // still open, so neither record is durable.
      expect(add).not.toHaveBeenCalled();
    });

    expect(recordedTypes()).toEqual(['credential.offer', 'credential.revoke']);
  });

  it('drops only the inner records when an inner savepoint rolls back', async () => {
    await dataSource.transaction(async (outer) => {
      await outer.query('SELECT 1');
      record(outer, 'credential.offer');

      await expect(
        outer.transaction(async (inner) => {
          await inner.query('SELECT 1');
          record(inner, 'credential.revoke');

          throw new Error('inner rolled back');
        }),
      ).rejects.toThrow('inner rolled back');
    });

    expect(recordedTypes()).toEqual(['credential.offer']);
  });

  it('drops every level when the outer transaction rolls back', async () => {
    await expect(
      dataSource.transaction(async (outer) => {
        await outer.query('SELECT 1');
        record(outer, 'credential.offer');

        await outer.transaction(async (inner) => {
          await inner.query('SELECT 1');
          record(inner, 'credential.revoke');
        });

        throw new Error('outer rolled back');
      }),
    ).rejects.toThrow('outer rolled back');

    expect(add).not.toHaveBeenCalled();
  });

  it('leaves nothing behind on the query runner after a transaction settles', async () => {
    let data: object | undefined;

    await dataSource.transaction(async (manager) => {
      await manager.query('SELECT 1');
      record(manager, 'credential.offer');
      data = manager.queryRunner?.data;
    });

    expect(data).toBeDefined();
    expect(Object.keys(data ?? {})).toEqual([]);
  });
});
