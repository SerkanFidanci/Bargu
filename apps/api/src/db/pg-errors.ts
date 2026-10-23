import { DatabaseError } from 'pg';

/** Postgres error codes the API answers itself instead of failing with a 500. */
export const PG = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  /** Also a row refused by a row-level security policy. */
  insufficientPrivilege: '42501',
} as const;

/** Whether a query failed with this Postgres code (drizzle keeps the driver's error in `cause`). */
export function isPgError(error: unknown, code: string): boolean {
  const cause = error instanceof Error && 'cause' in error ? error.cause : undefined;
  return [error, cause].some(
    (candidate) => candidate instanceof DatabaseError && candidate.code === code,
  );
}
