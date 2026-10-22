import type { BatchObservableResult, Meter } from '@opentelemetry/api';

import {
  type QueueCounts,
  QueueMetricsService,
  QUEUE_DEAD_LETTERED_METRIC,
  QUEUE_RUNNING_METRIC,
  QUEUE_WAITING_METRIC,
} from './queue-metrics.service';

interface Observation {
  readonly metric: unknown;
  readonly value: number;
  readonly attributes: Record<string, unknown>;
}

function queue(overrides: Partial<QueueCounts> & { name: string }) {
  return {
    readyCount: 0,
    queuedCount: 0,
    activeCount: 0,
    ...overrides,
  };
}

describe('QueueMetricsService', () => {
  const setup = (getQueues: () => Promise<QueueCounts[]>) => {
    const service = new QueueMetricsService({ getQueues });
    const observations: Observation[] = [];
    const instruments: Record<string, unknown> = {};
    let callback:
      ((result: BatchObservableResult) => Promise<void>) | undefined;

    const meter = {
      createObservableGauge: jest.fn((name: string) => {
        instruments[name] = { name };
        return instruments[name];
      }),
      addBatchObservableCallback: jest.fn((cb: typeof callback) => {
        callback = cb;
      }),
    } as unknown as Meter;

    service.register(meter);

    const collect = async () => {
      await callback?.({
        observe: (metric: unknown, value: number, attributes: never) => {
          observations.push({ metric, value, attributes });
        },
      });

      return observations;
    };

    return { collect, instruments };
  };

  it('reports ready (not queued) jobs as waiting, and active as running', async () => {
    const { collect, instruments } = setup(() =>
      Promise.resolve([
        queue({
          name: 'webhook.dispatch',
          readyCount: 3,
          queuedCount: 10,
          activeCount: 2,
        }),
      ]),
    );

    const observed = await collect();

    expect(observed).toEqual(
      expect.arrayContaining([
        {
          metric: instruments[QUEUE_WAITING_METRIC],
          value: 3,
          attributes: { 'queue.name': 'webhook.dispatch' },
        },
        {
          metric: instruments[QUEUE_RUNNING_METRIC],
          value: 2,
          attributes: { 'queue.name': 'webhook.dispatch' },
        },
      ]),
    );
  });

  it('reads dead-lettered jobs from the partner queue, only when one exists', async () => {
    const { collect, instruments } = setup(() =>
      Promise.resolve([
        queue({ name: 'audit.write', deadLetter: 'audit.write.dlq' }),
        queue({ name: 'audit.write.dlq', queuedCount: 4 }),
        queue({ name: 'oidc-purge' }),
      ]),
    );

    const dead = (await collect()).filter(
      (o) => o.metric === instruments[QUEUE_DEAD_LETTERED_METRIC],
    );

    expect(dead).toEqual([
      {
        metric: dead[0].metric,
        value: 4,
        attributes: { 'queue.name': 'audit.write' },
      },
    ]);
  });

  it('skips pg-boss internal queues', async () => {
    const { collect } = setup(() =>
      Promise.resolve([queue({ name: '__pgboss__send-it' })]),
    );

    await expect(collect()).resolves.toEqual([]);
  });

  it('labels by queue name only', async () => {
    const { collect } = setup(() =>
      Promise.resolve([queue({ name: 'oidc-purge' })]),
    );

    for (const o of await collect()) {
      expect(Object.keys(o.attributes)).toEqual(['queue.name']);
    }
  });

  it('reports nothing, without throwing, when pg-boss cannot be read', async () => {
    const { collect } = setup(() => Promise.reject(new Error('down')));

    await expect(collect()).resolves.toEqual([]);
  });
});
