import { metrics } from '@opentelemetry/api';
import type { ObjectLiteral } from 'typeorm';

import {
  ADAPTER_CALLS_METRIC,
  ATTR_ADAPTER_METHOD,
  ATTR_ADAPTER_OUTCOME,
  ATTR_CONNECTOR_TYPE,
  ATTR_OPERATION_OUTCOME,
  ATTR_OPERATION_TYPE,
  BusinessMetricsService,
  CREDENTIAL_OPERATIONS_METRIC,
  UNCLASSIFIED_LABEL,
  boundedLabel,
} from './business-metrics.service';

describe('BusinessMetricsService', () => {
  let service: BusinessMetricsService;
  let counters: Map<string, { add: jest.Mock }>;
  let createCounter: jest.Mock;
  let getMeter: jest.SpyInstance;

  beforeEach(() => {
    counters = new Map();
    createCounter = jest.fn((name: string) => {
      const counter = { add: jest.fn() };
      counters.set(name, counter);

      return counter;
    });

    getMeter = jest
      .spyOn(metrics, 'getMeter')
      .mockReturnValue({ createCounter } as never);

    service = new BusinessMetricsService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const addCalls = (name: string): unknown[][] => {
    const counter = counters.get(name);

    return counter ? (counter.add.mock.calls as unknown[][]) : [];
  };

  describe('recordCredentialOperation', () => {
    it('counts one operation against its type and outcome', () => {
      service.recordCredentialOperation('credential.offer', 'completed');

      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)).toEqual([
        [
          1,
          {
            [ATTR_OPERATION_TYPE]: 'credential.offer',
            [ATTR_OPERATION_OUTCOME]: 'completed',
          },
        ],
      ]);
    });

    it('records failures under the same instrument', () => {
      service.recordCredentialOperation('credential.revoke', 'failed');

      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)[0][1]).toEqual({
        [ATTR_OPERATION_TYPE]: 'credential.revoke',
        [ATTR_OPERATION_OUTCOME]: 'failed',
      });
    });

    it('never carries a tenant identifier', () => {
      service.recordCredentialOperation('credential.offer', 'completed');

      const attributes = addCalls(CREDENTIAL_OPERATIONS_METRIC)[0][1] as Record<
        string,
        string
      >;

      expect(Object.keys(attributes).sort()).toEqual([
        ATTR_OPERATION_OUTCOME,
        ATTR_OPERATION_TYPE,
      ]);
    });
  });

  describe('recordAdapterCall', () => {
    it('counts one call against connector, method, and outcome', () => {
      service.recordAdapterCall('traction', 'offerCredential', 'success');

      expect(addCalls(ADAPTER_CALLS_METRIC)).toEqual([
        [
          1,
          {
            [ATTR_CONNECTOR_TYPE]: 'traction',
            [ATTR_ADAPTER_METHOD]: 'offerCredential',
            [ATTR_ADAPTER_OUTCOME]: 'success',
          },
        ],
      ]);
    });

    it('records the error class as the outcome', () => {
      service.recordAdapterCall('credo', 'revoke', 'CONNECTOR_UNAVAILABLE');

      expect(addCalls(ADAPTER_CALLS_METRIC)[0][1]).toEqual({
        [ATTR_CONNECTOR_TYPE]: 'credo',
        [ATTR_ADAPTER_METHOD]: 'revoke',
        [ATTR_ADAPTER_OUTCOME]: 'CONNECTOR_UNAVAILABLE',
      });
    });

    it('never carries a tenant identifier', () => {
      service.recordAdapterCall('traction', 'offerCredential', 'success');

      const attributes = addCalls(ADAPTER_CALLS_METRIC)[0][1] as Record<
        string,
        string
      >;

      expect(Object.keys(attributes).sort()).toEqual(
        [ATTR_ADAPTER_METHOD, ATTR_ADAPTER_OUTCOME, ATTR_CONNECTOR_TYPE].sort(),
      );
    });
  });

  describe('cardinality backstop', () => {
    it.each([
      ['credential.offer', 'credential.offer'],
      ['CONNECTOR_UNAVAILABLE', 'CONNECTOR_UNAVAILABLE'],
      ['offerCredential', 'offerCredential'],
      ['traction-2', 'traction-2'],
    ])('passes the safe value %s through', (value, expected) => {
      expect(boundedLabel(value)).toBe(expected);
    });

    it.each([
      // A UUID is the shape that would grow series without limit. The
      // hex-letter-leading form is the one the character-class check would
      // otherwise admit, and tenant identifiers are UUIDs.
      ['11111111-1111-1111-1111-111111111111'],
      ['f47ac10b-58cc-4372-a567-0e02b2c3d479'],
      ['ABCDEF01-58cc-4372-a567-0e02b2c3d479'],
      [''],
      ['has space'],
      ['https://tenant.example.com/path'],
      ['a'.repeat(65)],
    ])('buckets the unbounded value %s', (value) => {
      expect(boundedLabel(value)).toBe(UNCLASSIFIED_LABEL);
    });

    it('applies the backstop to a recorded dimension', () => {
      service.recordAdapterCall(
        '11111111-1111-1111-1111-111111111111',
        'offerCredential',
        'success',
      );

      expect(addCalls(ADAPTER_CALLS_METRIC)[0][1]).toMatchObject({
        [ATTR_CONNECTOR_TYPE]: UNCLASSIFIED_LABEL,
      });
    });

    it('keeps a tenant identifier out of a recorded operation type', () => {
      service.recordCredentialOperation(
        'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        'completed',
      );

      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)[0][1]).toMatchObject({
        [ATTR_OPERATION_TYPE]: UNCLASSIFIED_LABEL,
      });
    });
  });

  describe('transactional deferral', () => {
    const managerFor = (
      queryRunner: unknown,
    ): Parameters<BusinessMetricsService['recordCredentialOperation']>[2] =>
      ({ queryRunner }) as never;

    let queryRunner: { isTransactionActive: boolean; data: ObjectLiteral };

    /** TypeORM clears this only for the real COMMIT, not a savepoint release. */
    const commit = (): void => {
      queryRunner.isTransactionActive = false;
      service.flushDeferred(queryRunner as never);
    };

    const rollback = (): void => {
      queryRunner.isTransactionActive = false;
      service.discardDeferred(queryRunner as never);
    };

    beforeEach(() => {
      queryRunner = { isTransactionActive: true, data: {} };
      service.beginDeferredScope(queryRunner as never);
    });

    it('holds the record while the transaction is open', () => {
      service.recordCredentialOperation(
        'credential.offer',
        'completed',
        managerFor(queryRunner),
      );

      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)).toHaveLength(0);
    });

    it('records once the transaction commits', () => {
      service.recordCredentialOperation(
        'credential.offer',
        'completed',
        managerFor(queryRunner),
      );

      commit();

      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)).toEqual([
        [
          1,
          {
            [ATTR_OPERATION_TYPE]: 'credential.offer',
            [ATTR_OPERATION_OUTCOME]: 'completed',
          },
        ],
      ]);
    });

    it('drops the record when the transaction rolls back', () => {
      service.recordCredentialOperation(
        'credential.offer',
        'completed',
        managerFor(queryRunner),
      );

      rollback();
      service.flushDeferred(queryRunner as never);

      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)).toHaveLength(0);
    });

    it('does not replay a flushed record on a later commit', () => {
      service.recordCredentialOperation(
        'credential.offer',
        'completed',
        managerFor(queryRunner),
      );

      commit();
      service.flushDeferred(queryRunner as never);

      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)).toHaveLength(1);
    });

    it('holds every record made in one transaction', () => {
      service.recordCredentialOperation(
        'credential.offer',
        'completed',
        managerFor(queryRunner),
      );
      service.recordCredentialOperation(
        'credential.revoke',
        'failed',
        managerFor(queryRunner),
      );

      commit();

      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)).toHaveLength(2);
    });

    it('records immediately when the manager has no open transaction', () => {
      queryRunner.isTransactionActive = false;

      service.recordCredentialOperation(
        'credential.offer',
        'completed',
        managerFor(queryRunner),
      );

      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)).toHaveLength(1);
    });

    it('records immediately when no manager is supplied', () => {
      service.recordCredentialOperation('credential.offer', 'completed');

      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)).toHaveLength(1);
    });

    it('tolerates a commit that deferred nothing', () => {
      expect(() => commit()).not.toThrow();
      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)).toHaveLength(0);
    });
  });

  describe('nested transactions', () => {
    // TypeORM runs a nested transaction as a savepoint on the same query
    // runner and broadcasts the same commit and rollback events for it, and
    // clears isTransactionActive only for the real COMMIT or ROLLBACK. A
    // depth-unaware flush would release the outer transaction's records while
    // it is still open, which is the double count the deferral exists to stop.
    let queryRunner: { isTransactionActive: boolean; data: ObjectLiteral };

    const record = (operationType: string): void => {
      service.recordCredentialOperation(operationType, 'completed', {
        queryRunner,
      } as never);
    };

    const recordedTypes = (): unknown[] =>
      addCalls(CREDENTIAL_OPERATIONS_METRIC).map(
        (call) => (call[1] as Record<string, string>)[ATTR_OPERATION_TYPE],
      );

    beforeEach(() => {
      queryRunner = { isTransactionActive: true, data: {} };
      service.beginDeferredScope(queryRunner as never);
    });

    /** A savepoint release leaves the enclosing transaction open. */
    const releaseSavepoint = (): void =>
      service.flushDeferred(queryRunner as never);

    /** A savepoint rollback likewise leaves it open. */
    const rollbackToSavepoint = (): void =>
      service.discardDeferred(queryRunner as never);

    const commit = (): void => {
      queryRunner.isTransactionActive = false;
      service.flushDeferred(queryRunner as never);
    };

    const rollback = (): void => {
      queryRunner.isTransactionActive = false;
      service.discardDeferred(queryRunner as never);
    };

    it('does not release the outer records when an inner level commits', () => {
      record('credential.offer');
      service.beginDeferredScope(queryRunner as never);
      record('credential.revoke');

      releaseSavepoint();

      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)).toHaveLength(0);
    });

    it('records both levels once the outer transaction commits', () => {
      record('credential.offer');
      service.beginDeferredScope(queryRunner as never);
      record('credential.revoke');
      releaseSavepoint();

      commit();

      expect(recordedTypes()).toEqual([
        'credential.offer',
        'credential.revoke',
      ]);
    });

    it('drops only the inner records when an inner level rolls back', () => {
      record('credential.offer');
      service.beginDeferredScope(queryRunner as never);
      record('credential.revoke');

      rollbackToSavepoint();
      commit();

      expect(recordedTypes()).toEqual(['credential.offer']);
    });

    it('drops every level when the outer transaction rolls back', () => {
      record('credential.offer');
      service.beginDeferredScope(queryRunner as never);
      record('credential.revoke');
      releaseSavepoint();

      rollback();

      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)).toHaveLength(0);
    });

    it('handles more than one level of nesting', () => {
      record('credential.offer');
      service.beginDeferredScope(queryRunner as never);
      record('credential.revoke');
      service.beginDeferredScope(queryRunner as never);
      record('credential.accept');

      // Innermost rolls back, the level above it commits.
      rollbackToSavepoint();
      releaseSavepoint();
      commit();

      expect(recordedTypes()).toEqual([
        'credential.offer',
        'credential.revoke',
      ]);
    });

    it('leaves nothing behind on the query runner after settling', () => {
      record('credential.offer');

      commit();

      expect(Object.keys(queryRunner.data)).toEqual([]);
    });
  });

  describe('failure containment', () => {
    beforeEach(() => {
      createCounter.mockImplementation((name: string) => {
        const counter = {
          add: jest.fn(() => {
            throw new Error('exporter exploded');
          }),
        };
        counters.set(name, counter);

        return counter;
      });
    });

    it('never fails the operation it is counting', () => {
      expect(() =>
        service.recordCredentialOperation('credential.offer', 'completed'),
      ).not.toThrow();
    });

    it('never fails the adapter call it is counting', () => {
      expect(() =>
        service.recordAdapterCall('traction', 'revoke', 'success'),
      ).not.toThrow();
    });

    it('never fails the commit broadcast it is flushed from', () => {
      const queryRunner = { isTransactionActive: true, data: {} };

      service.beginDeferredScope(queryRunner as never);
      service.recordCredentialOperation('credential.offer', 'completed', {
        queryRunner,
      } as never);
      queryRunner.isTransactionActive = false;

      expect(() => service.flushDeferred(queryRunner as never)).not.toThrow();
    });
  });

  describe('instrument creation', () => {
    it('resolves the meter lazily, so the SDK is registered first', () => {
      const fresh = new BusinessMetricsService();

      expect(getMeter).not.toHaveBeenCalled();

      fresh.recordCredentialOperation('credential.offer', 'completed');

      expect(getMeter).toHaveBeenCalled();
    });

    it('creates each counter once and reuses it', () => {
      service.recordCredentialOperation('credential.offer', 'completed');
      service.recordCredentialOperation('credential.reject', 'failed');
      service.recordAdapterCall('traction', 'revoke', 'success');
      service.recordAdapterCall('traction', 'revoke', 'TIMEOUT');

      expect(createCounter).toHaveBeenCalledTimes(2);
      expect(addCalls(CREDENTIAL_OPERATIONS_METRIC)).toHaveLength(2);
      expect(addCalls(ADAPTER_CALLS_METRIC)).toHaveLength(2);
    });

    it('declares both instruments with a unit and description', () => {
      service.recordCredentialOperation('credential.offer', 'completed');
      service.recordAdapterCall('traction', 'revoke', 'success');

      expect(createCounter).toHaveBeenCalledWith(
        CREDENTIAL_OPERATIONS_METRIC,
        expect.objectContaining({
          description: expect.any(String),
          unit: '{operation}',
        }),
      );
      expect(createCounter).toHaveBeenCalledWith(
        ADAPTER_CALLS_METRIC,
        expect.objectContaining({
          description: expect.any(String),
          unit: '{call}',
        }),
      );
    });
  });
});
