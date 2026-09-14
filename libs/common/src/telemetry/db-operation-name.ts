import type { Attributes } from '@opentelemetry/api';
import type { IAttributesProcessor } from '@opentelemetry/sdk-metrics';
import { ATTR_DB_OPERATION_NAME } from '@opentelemetry/semantic-conventions';

/**
 * `@opentelemetry/instrumentation-pg` derives `db.operation.name` by trimming
 * the query text and slicing to the first space character. SQL written as a
 * multi-line template literal puts a newline straight after the verb, so
 * `SELECT\n  ...` reports `"SELECT\n"` — a different series from the same
 * operation written on one line.
 *
 * Most of ours come from pg-boss, whose `dist/plans.js` is written that way
 * throughout, so this cannot be fixed by reformatting our own SQL. Deployed, it
 * produced nine `db_operation_name` values for six real verbs — `SELECT`,
 * `INSERT`, `UPDATE`, `DELETE`, `CREATE` and `WITH`, plus `SELECT\n`, `WITH\n`
 * and `BEGIN;\n` — inflating the dimension by half with no added information,
 * and splitting dashboard panels that group by it.
 *
 * Trailing semicolons are stripped for the same reason: `BEGIN;` and `BEGIN`
 * are the same operation.
 *
 * Deliberately not upper-cased. Every value observed is already upper-case, so
 * case folding would only mask a genuine difference if one ever appeared.
 */
export function normalizeDbOperationName(value: string): string {
  return value.trim().replace(/;+$/, '');
}

/**
 * Applies {@link normalizeDbOperationName} to the `db.operation.name` dimension
 * of a metric, leaving every other attribute untouched.
 */
export const dbOperationNameProcessor: IAttributesProcessor = {
  process(incoming: Attributes): Attributes {
    const value = incoming[ATTR_DB_OPERATION_NAME];

    if (typeof value !== 'string') {
      return incoming;
    }

    const normalized = normalizeDbOperationName(value);

    if (normalized === value) {
      return incoming;
    }

    return { ...incoming, [ATTR_DB_OPERATION_NAME]: normalized };
  },
};
