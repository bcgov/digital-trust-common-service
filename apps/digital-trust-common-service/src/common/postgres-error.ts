/**
 * Extracts the Postgres error code (e.g. `23505` unique_violation, `23503`
 * foreign_key_violation) from a TypeORM `QueryFailedError`-shaped error, if
 * present.
 */
export function getPostgresErrorCode(error: unknown): string | undefined {
  return (error as { driverError?: { code?: string } } | undefined)?.driverError
    ?.code;
}

function getPostgresErrorConstraint(error: unknown): string | undefined {
  return (error as { driverError?: { constraint?: string } } | undefined)
    ?.driverError?.constraint;
}

/**
 * True when `error` is a Postgres unique-violation (`23505`), optionally
 * scoped to a specific constraint name. Used to translate a losing race on
 * a unique index/constraint into a domain-level conflict rather than
 * surfacing the raw database error.
 */
export function isUniqueConstraintViolation(
  error: unknown,
  constraintName?: string,
): boolean {
  if (getPostgresErrorCode(error) !== '23505') {
    return false;
  }

  return (
    constraintName === undefined ||
    getPostgresErrorConstraint(error) === constraintName
  );
}
