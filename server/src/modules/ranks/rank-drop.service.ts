/**
 * Rank-drop detection + notification (wires the existing
 * `deliverRankDropEmail` mailer and the audits auto re-run).
 *
 * The handler NEVER throws — it runs inside the rank job's per-keyword loop
 * and a mail or re-run failure must not fail (or retry) the whole job.
 * Idempotency comes from the caller: the hook only fires when the
 * `rankings` insert actually landed (unique `(keywordId, checkedAt)`), so a
 * BullMQ retry of the same period can never double-send.
 */
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { translate, } from '../../shared/i18n/index.js';
import { deliverRankDropEmail, resolveRecipientLocale } from '../communication/index.js';
import { requestAutoAuditRerun } from '../audits/index.js';
import { findUserById } from '../users/index.js';
/** Falling out of the top bucket is always a drop (`prev ≤ 10 && cur > 10`). */
export const RANK_DROP_TOP_BUCKET = 10;
/** Any fall of at least this many positions is a drop. */
export const RANK_DROP_MIN_DELTA = 5;
/**
 * Drop policy:
 *  - previously unranked (`previous === null`) → never a drop
 *  - fell out of vendor depth (`current === null` while previously ranked) → drop
 *  - fell out of the top 10 → drop
 *  - fell ≥ 5 positions → drop
 *  - rise / small wobble → no drop
 */
export function detectRankDrop(previous: number | null, current: number | null): boolean {
    if (previous === null)
        return false;
    if (current === null)
        return true;
    if (previous <= RANK_DROP_TOP_BUCKET && current > RANK_DROP_TOP_BUCKET)
        return true;
    return current - previous >= RANK_DROP_MIN_DELTA;
}
export interface RankDropEvent {
    accountId: string;
    siteId: string;
    keywordId: string;
    keyword: string;
    /** detectRankDrop guarantees a non-null previous position. */
    previousPosition: number;
    currentPosition: number | null;
    siteUrl: string;
}
export type RankDropHandler = (event: RankDropEvent) => Promise<void>;
export interface RankDropHandlerDeps {
    auditsQueue: Queue | null;
    logger: Logger;
    /** Test seams — default to the real mailer / re-run service. */
    deliverEmail?: typeof deliverRankDropEmail;
    requestRerun?: typeof requestAutoAuditRerun;
    now?: () => Date;
}
export interface RankDropEffects {
    deliverEmail(event: RankDropEvent): Promise<void>;
    requestAutoRerun(event: RankDropEvent): Promise<void>;
}
/**
 * Raw effect pair used behind the durable confirmation gate. These functions
 * intentionally propagate transport/enqueue failures so the confirmation
 * service can record a safe operational category on its evidence row.
 */
export function createRankDropEffects(deps: RankDropHandlerDeps): RankDropEffects {
    const deliverEmail = deps.deliverEmail ?? deliverRankDropEmail;
    const requestRerun = deps.requestRerun ?? requestAutoAuditRerun;
    return {
        async deliverEmail(event) {
            const user = await findUserById(event.accountId);
            if (user) {
                const locale = resolveRecipientLocale({ recipientLocale: user.language });
                await deliverEmail({
                    email: user.email,
                    userId: event.accountId,
                    keyword: event.keyword,
                    previousPosition: String(event.previousPosition),
                    currentPosition: event.currentPosition === null
                        ? translate(locale, 'email.rankDrop.notRanked')
                        : String(event.currentPosition),
                    siteUrl: event.siteUrl,
                    locale,
                });
            }
            else {
                deps.logger.warn({ accountId: event.accountId, keywordId: event.keywordId }, 'rank-drop email skipped — user not found');
            }
        },
        async requestAutoRerun(event) {
            await requestRerun({ accountId: event.accountId, siteId: event.siteId }, {
                auditsQueue: deps.auditsQueue,
                logger: deps.logger,
                ...(deps.now ? { now: deps.now } : {}),
            });
        },
    };
}
export function createRankDropHandler(deps: RankDropHandlerDeps): RankDropHandler {
    const effects = createRankDropEffects(deps);
    return async (event: RankDropEvent): Promise<void> => {
        // Legacy-compatible wrapper: callers without durable confirmation still
        // get isolated effects. Production rank processing now injects the raw
        // pair above into `confirmRankDrop` instead.
        try {
            await effects.deliverEmail(event);
        }
        catch (err) {
            deps.logger.warn({
                accountId: event.accountId,
                keywordId: event.keywordId,
                err: (err as Error).message,
            }, 'rank-drop email failed — job continues');
        }
        try {
            await effects.requestAutoRerun(event);
        }
        catch (err) {
            deps.logger.warn({
                accountId: event.accountId,
                siteId: event.siteId,
                err: (err as Error).message,
            }, 'rank-drop auto re-run failed — job continues');
        }
    };
}
