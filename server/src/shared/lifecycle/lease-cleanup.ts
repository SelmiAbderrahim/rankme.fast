import { AsyncLocalStorage } from 'node:async_hooks';
const leaseCleanupContext = new AsyncLocalStorage<boolean>();
/**
 * Lease cleanup is compensating bookkeeping, so it must remain possible after
 * a nested account or site lease has already been released by another response
 * completion listener. Both Mongo lifecycle barriers recognize this context.
 */
export function runWithLeaseCleanup<Result>(callback: () => Result): Result {
    return leaseCleanupContext.run(true, callback);
}
export function isLeaseCleanup(): boolean {
    return leaseCleanupContext.getStore() === true;
}
