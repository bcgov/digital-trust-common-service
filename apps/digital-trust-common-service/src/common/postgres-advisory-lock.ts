export function isAdvisoryLockAcquired(row: unknown): boolean {
  return (
    typeof row === 'object' &&
    row !== null &&
    'locked' in row &&
    row.locked === true
  );
}
