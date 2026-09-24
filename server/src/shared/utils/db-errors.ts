/**
 * Database error classifiers shared across modules that write through Drizzle.
 *
 * Body moved verbatim from `modules/ranks/keywords.service.ts` (the exported
 * copy); `modules/team/team.service.ts` used to carry a private mirror. Kept
 * here so any surviving Postgres-writing module gets the same
 * unique-violation detection.
 */
export function isUniqueViolation(err: unknown): boolean {
    if (!err || typeof err !== 'object')
        return false;
    const anyErr = err as {
        code?: unknown;
        message?: unknown;
        cause?: unknown;
    };
    const code = anyErr.code;
    const message = anyErr.message;
    const cause = anyErr.cause;
    const messageMatches = typeof message === 'string' && /unique|duplicate key value/i.test(message);
    if (code === '23505' || messageMatches)
        return true;
    if (cause && typeof cause === 'object')
        return isUniqueViolation(cause);
    return false;
}
