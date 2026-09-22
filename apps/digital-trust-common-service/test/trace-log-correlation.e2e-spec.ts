import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Locks in the trace-to-log correlation contract: a log line emitted inside an
 * active span carries the trace context, and one emitted outside it does not.
 *
 * Nothing in this repository writes those fields.
 * `@opentelemetry/instrumentation-pino` patches `pino` when the SDK starts, so
 * the behaviour depends entirely on `main.ts` importing
 * `@app/common/telemetry/tracing` before Nest — and on the pino
 * instrumentation staying enabled. Both are silent to break: the logger keeps
 * working, the fields just stop appearing.
 *
 * The probe runs as a subprocess because Jest's module registry bypasses the
 * `require-in-the-middle` hook the instrumentation relies on; see the comment
 * in `support/trace-log-correlation-probe.cjs`.
 */
describe('trace-to-log correlation', () => {
  const probe = join(__dirname, 'support', 'trace-log-correlation-probe.cjs');

  interface LogRecord {
    authorization?: string;
    message: string;
    span_id?: string;
    trace_flags?: string;
    trace_id?: string;
  }

  let records: LogRecord[];

  const find = (message: string): LogRecord => {
    const record = records.find((entry) => entry.message === message);

    if (!record) {
      throw new Error(`probe did not emit a line for "${message}"`);
    }

    return record;
  };

  beforeAll(() => {
    if (!existsSync(join(__dirname, '..', '..', '..', 'dist'))) {
      throw new Error(
        'dist/ is missing — run `npm run build` before e2e tests',
      );
    }

    const output = execFileSync('node', [probe], { encoding: 'utf8' });
    const match = /__PROBE__(.*)__PROBE__/s.exec(output);

    if (!match) {
      throw new Error(`probe produced no parseable output:\n${output}`);
    }

    records = JSON.parse(match[1]) as LogRecord[];
  });

  it('emits no trace context before a span is active', () => {
    expect(find('before any span')).not.toHaveProperty('trace_id');
    expect(find('before any span')).not.toHaveProperty('span_id');
    expect(find('before any span')).not.toHaveProperty('trace_flags');
  });

  it('adds trace context to a line emitted inside a span', () => {
    const record = find('inside first span');

    expect(record.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(record.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(record.trace_flags).toBe('01');
  });

  it('correlates the error path with the same trace', () => {
    const record = find('error inside first span');

    expect(record.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(record.trace_id).toBe(find('inside first span').trace_id);
  });

  it('does not carry trace context across unrelated spans', () => {
    const first = find('inside first span');
    const second = find('inside second span');

    expect(second.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(second.trace_id).not.toBe(first.trace_id);
    expect(second.span_id).not.toBe(first.span_id);
  });

  it('does not leave stale trace context on lines emitted after a span ends', () => {
    expect(find('after spans ended')).not.toHaveProperty('trace_id');
    expect(find('after spans ended')).not.toHaveProperty('span_id');
  });

  it('keeps redaction intact on a correlated line', () => {
    const record = find('secret inside first span');

    expect(record.authorization).toBe('[Redacted]');
    expect(record.trace_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('emits every line as valid JSON', () => {
    expect(records).toHaveLength(6);
    expect(records.every((record) => typeof record.message === 'string')).toBe(
      true,
    );
  });
});
