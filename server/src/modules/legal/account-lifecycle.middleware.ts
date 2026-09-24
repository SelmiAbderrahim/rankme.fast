import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import { logger } from '../../config/logger.js';
import { ACCOUNT_WORK_LEASE_HEARTBEAT_MS, acquireAccountWorkLease, currentAccountWorkLease, releaseAccountWorkLease, renewAccountWorkLease, runWithAccountWorkLeaseContext, } from './account-lifecycle.js';
/**
 * Hold one account lease through response completion. Authentication middleware
 * calls this only after establishing identity; the continuation therefore owns
 * every downstream request write, provider call, stream, and enqueue.
 */
export async function continueWithAccountWorkLease(accountId: string, requestId: unknown, res: Response, next: NextFunction): Promise<boolean> {
    if (currentAccountWorkLease()?.accountId === accountId) {
        next();
        return true;
    }
    const lease = await acquireAccountWorkLease(accountId, `api:${typeof requestId === 'string' || typeof requestId === 'number'
        ? String(requestId)
        : 'request'}:${randomUUID()}`);
    if (!lease)
        return false;
    let settled = false;
    const heartbeat = setInterval(() => {
        void renewAccountWorkLease(lease).catch((error) => {
            logger.error({ err: error, accountId }, 'account request lease renewal failed');
        });
    }, ACCOUNT_WORK_LEASE_HEARTBEAT_MS);
    heartbeat.unref();
    const settle = () => {
        if (settled)
            return;
        settled = true;
        clearInterval(heartbeat);
        void releaseAccountWorkLease(lease).catch((error) => {
            logger.error({ err: error, accountId }, 'account request lease release failed');
        });
    };
    res.once('finish', settle);
    res.once('close', settle);
    runWithAccountWorkLeaseContext(lease, next);
    return true;
}
