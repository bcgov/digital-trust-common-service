import { buildMonthlyPartitionSpecs } from './000007_create-audit-log-schema';

describe('buildMonthlyPartitionSpecs', () => {
  it('builds inclusive current month plus monthsAhead partitions', () => {
    const specs = buildMonthlyPartitionSpecs(
      new Date('2026-07-15T12:00:00.000Z'),
      2,
    );

    expect(specs).toEqual([
      {
        name: 'audit_log_2026_07',
        from: '2026-07-01T00:00:00.000Z',
        to: '2026-08-01T00:00:00.000Z',
      },
      {
        name: 'audit_log_2026_08',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-09-01T00:00:00.000Z',
      },
      {
        name: 'audit_log_2026_09',
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      },
    ]);
  });
});
