import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { and, eq, sql } from 'drizzle-orm';
import { HttpError } from '../../shared/utils/http-error.js';
import type { TranslationKey } from '../../shared/i18n/errors.js';
import { env } from '../../config/env.js';
import { validateSiteUrl, type SiteUrlRejectReason, } from '../../shared/validation/site-url.js';
import { Site, type SiteHydrated } from './sites.model.js';
import { getSitesDb } from './sites.holder.js';
import { AuditRun } from '../audits/audit-run.model.js';
import { getRanksQueue } from '../ranks/ranks.queue-holder.js';
import { getSiteCadence } from '../ranks/cadence.js';
import { removeRankSchedule, upsertRankSchedule } from '../../shared/queue/schedulers.js';
import { getPulseQueue } from '../weekly-pulse/pulse.queue-holder.js';
// Leaf imports on purpose (never the weekly-pulse / content-monitoring
// barrels): both barrels transitively reach files that import the sites
// barrel back, which would close a module cycle through this file.
import { removePulseScheduler, upsertPulseScheduler, } from '../weekly-pulse/scheduler.js';
import { deleteMonitorsForSite, pauseMonitorsForSite, resumeMonitorsForSite, } from '../content-monitoring/monitoring.site-pause.js';
import { sitePulseSettings } from '../../db/schema/weekly-pulse.js';
import { loadOwnedSite } from './sites.guard.js';
import { keywords } from '../../db/schema/keywords.js';
import { assertSiteDeletionAttempt, claimSiteDeletionAttempt, runWithRenewingSiteDeletionAttempt, type SiteDeletionAttempt, } from './site-lifecycle.js';
import { installSiteDeletionBarrier, purgeSitePostgresData, } from './site-postgres-cascade.js';
import { collectSiteMongoResources, purgeSiteMongoData, } from './site-mongo-cascade.js';
import { collectSiteQueueResourceIds, persistSiteQueueResourceIds, purgeSiteQueueData, SiteQueueBusyError, } from './site-queue-cascade.js';
import { getSiteLifecycleQueues } from './site-lifecycle-queues.holder.js';
import { recordAuditOnce } from '../audit/index.js';
import { assertCurrentAccountWorkLease, currentAccountWorkLease, tryRunWithTargetAccountWorkLease, } from '../legal/account-lifecycle.js';
import { denyReportExportsForSite } from '../report-exports/index.js';
export interface DeleteSiteOptions {
    ip?: string;
    actorUserId?: string;
    auditSource?: string;
}
interface DeleteSiteBoundaryDeps {
    /** Deterministic race seam: invoked under the account advisory lock. */
    afterTransactionLock?: () => Promise<void>;
}
export interface PublicSite {
    id: string;
    url: string;
    domain: string;
    displayName: string;
    paused: boolean;
    pausedAt: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface SiteListPage {
    sites: PublicSite[];
    nextCursor: string | null;
}
/**
 * Shared URL-reject → localized-key map used by `createSite` — the parity
 * test in shared/i18n asserts every value here exists in all seven locales.
 */
export const SITE_URL_REJECT_KEYS: Record<SiteUrlRejectReason, TranslationKey> = {
    required: 'sites.errors.urlRequired',
    tooLong: 'sites.errors.urlTooLong',
    invalid: 'sites.errors.urlInvalid',
    scheme: 'sites.errors.urlScheme',
    userinfo: 'sites.errors.urlUserinfo',
    ipLiteral: 'sites.errors.urlIpLiteral',
    noTld: 'sites.errors.urlNoTld',
};
export function toPublicSite(site: SiteHydrated): PublicSite {
    return {
        id: site._id.toString(),
        url: site.url,
        domain: site.domain,
        displayName: site.displayName ?? '',
        // `=== true` / ternary coerce legacy docs that predate the pause fields.
        paused: site.paused === true,
        pausedAt: site.pausedAt ? site.pausedAt.toISOString() : null,
        createdAt: site.createdAt.toISOString(),
        updatedAt: site.updatedAt.toISOString(),
    };
}
export async function createSite(accountId: string, input: {
    url: string;
    displayName?: string;
}): Promise<PublicSite> {
    const result = validateSiteUrl(input.url, {
        allowLocalhost: env.NODE_ENV === 'test',
    });
    if (!result.ok) {
        throw HttpError.badRequest({ code: 'BAD_REQUEST', messageKey: SITE_URL_REJECT_KEYS[result.reason] });
    }
    // Re-adding an existing domain is a 409. This pre-check stays OUTSIDE the
    // advisory-lock transaction so a duplicate 409 is returned fast without
    // touching the Postgres lock table.
    const existing = await Site.findOne({ accountId, domain: result.domain });
    if (existing) {
        throw HttpError.conflict({ code: 'SITES_ERRORS_DUPLICATE', messageKey: 'sites.errors.duplicate' });
    }
    // Site creation is serialized per account with the Postgres
    // transaction-scoped advisory lock (hashtext(accountId)) that the account
    // deletion barrier also takes. The lock is released when the tx
    // commits/rolls back — no manual unlock needed.
    const db = getSitesDb();
    try {
        return await db.transaction(async (tx) => {
            await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${accountId}))`);
            const site = await Site.create({
                accountId,
                url: result.url,
                domain: result.domain,
                displayName: input.displayName ?? '',
            });
            return toPublicSite(site);
        });
    }
    catch (err) {
        // Unique-index race: two concurrent adds of the same domain — the loser
        // gets the same localized conflict as the pre-checked path above.
        if (err instanceof Error && (err as {
            code?: unknown;
        }).code === 11000) {
            throw HttpError.conflict({ code: 'SITES_ERRORS_DUPLICATE', messageKey: 'sites.errors.duplicate' });
        }
        throw err;
    }
}
export async function listSites(accountId: string, query: {
    cursor?: string;
    limit: number;
}, access: {
    allowedSiteIds?: readonly string[] | null;
} = {}): Promise<SiteListPage> {
    const filter: Record<string, unknown> = { accountId, deletionStartedAt: null };
    const allowedSiteIds = access.allowedSiteIds;
    if (allowedSiteIds !== undefined && allowedSiteIds !== null) {
        filter._id = { $in: allowedSiteIds };
    }
    if (query.cursor !== undefined) {
        if (!Types.ObjectId.isValid(query.cursor)) {
            throw HttpError.badRequest({ code: 'ERRORS_BAD_REQUEST', messageKey: 'errors.badRequest' });
        }
        // Newest-first pagination: everything strictly older than the cursor.
        filter._id = {
            ...(allowedSiteIds !== undefined && allowedSiteIds !== null
                ? { $in: allowedSiteIds }
                : {}),
            $lt: new Types.ObjectId(query.cursor),
        };
    }
    const docs = await Site.find(filter)
        .sort({ _id: -1 })
        .limit(query.limit + 1);
    const page = docs.slice(0, query.limit);
    const hasMore = docs.length > query.limit;
    const nextCursor = hasMore ? page[page.length - 1]!._id.toString() : null;
    return { sites: page.map(toPublicSite), nextCursor };
}
export async function getSite(accountId: string, siteId: string): Promise<PublicSite> {
    // Malformed ids and other accounts' sites are indistinguishable: 404.
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    return toPublicSite(site);
}
export async function updateSite(accountId: string, siteId: string, input: {
    displayName: string;
}): Promise<PublicSite> {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.findOneAndUpdate({ _id: siteId, accountId, deletionStartedAt: null }, { $set: { displayName: input.displayName } }, { new: true });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    return toPublicSite(site);
}
/**
 * Pauses a site: nothing runs for it until resume — no audits, rank checks,
 * weekly pulse, monitor checks, alerts, or auto-reruns. Stored data stays
 * readable. In-flight jobs finish to their terminal state (kill-switch
 * precedent); only NEW work is blocked.
 *
 * The flag is saved FIRST: even if a scheduler teardown fails mid-way, the
 * entry-point guards, sweep filters, and processor checks still gate on
 * `site.paused`. Every teardown step is idempotent.
 */
export async function pauseSite(accountId: string, siteId: string): Promise<PublicSite> {
    const site = await loadOwnedSite(accountId, siteId, { allowPaused: true });
    if (site.paused)
        throw HttpError.conflict({ code: 'SITES_ERRORS_ALREADY_PAUSED', messageKey: 'sites.errors.alreadyPaused' });
    site.paused = true;
    site.pausedAt = new Date();
    await site.save();
    const ranksQueue = getRanksQueue();
    if (ranksQueue) {
        await removeRankSchedule(ranksQueue, siteId);
    }
    const pulseQueue = getPulseQueue();
    if (pulseQueue) {
        await removePulseScheduler(pulseQueue, siteId);
    }
    // Vendor-side stop: active Firecrawl monitors keep crawling (and billing)
    // unless paused at the provider too. Best-effort per monitor.
    await pauseMonitorsForSite(siteId);
    return toPublicSite(site);
}
/**
 * Resumes a paused site, restoring only the schedules its state still
 * warrants: the rank schedule when at least one active keyword exists
 * (cadence from `domain_states`), the weekly-pulse scheduler when the site's
 * pulse settings are enabled, and the monitors the pause cascade itself
 * paused (`pausedBy: 'site'` — a user-paused monitor stays paused).
 */
export async function resumeSite(accountId: string, siteId: string): Promise<PublicSite> {
    const site = await loadOwnedSite(accountId, siteId, { allowPaused: true });
    if (!site.paused)
        throw HttpError.conflict({ code: 'SITES_ERRORS_NOT_PAUSED', messageKey: 'sites.errors.notPaused' });
    site.paused = false;
    site.pausedAt = null;
    await site.save();
    const db = getSitesDb();
    const ranksQueue = getRanksQueue();
    if (ranksQueue) {
        const activeKeywords = await db
            .select({ id: keywords.id })
            .from(keywords)
            .where(and(eq(keywords.siteId, siteId), eq(keywords.active, true)))
            .limit(1);
        if (activeKeywords.length > 0) {
            const cadence = await getSiteCadence(db, siteId);
            await upsertRankSchedule(ranksQueue, {
                accountId,
                siteId,
                cadence,
                altEnginesEnabled: env.ALT_ENGINE_TRACKING_ENABLED,
            });
        }
    }
    const pulseQueue = getPulseQueue();
    if (pulseQueue) {
        const pulseRows = await db
            .select({ enabled: sitePulseSettings.enabled })
            .from(sitePulseSettings)
            .where(and(eq(sitePulseSettings.accountId, accountId), eq(sitePulseSettings.siteId, siteId)))
            .limit(1);
        if (pulseRows[0]?.enabled) {
            await upsertPulseScheduler(pulseQueue, { accountId, siteId });
        }
    }
    await resumeMonitorsForSite(siteId);
    return toPublicSite(site);
}
/**
 * Removes a site and cascades every store that references it.
 *
 * Ordering guarantee: durable Mongo claim/pause → committed Postgres write
 * barrier → queue/scheduler + provider teardown → Postgres transaction →
 * Mongo ref cascade → final queue convergence → Site doc last. Every cleanup
 * step is idempotent; a failure leaves the claim in place and a retry resumes.
 *
 * The deletion claim is taken under the same per-account lock as site
 * creation. Audit evidence is replay-safe and committed before the final Site
 * document delete.
 */
async function deleteSiteWithAccountBoundary(accountId: string, siteId: string, options: DeleteSiteOptions = {}, attemptId: string = randomUUID(), deps: DeleteSiteBoundaryDeps = {}): Promise<void> {
    // 1. Ownership check FIRST — never touch any downstream store until we
    //    know the caller owns this siteId. Cross-account → 404 (no leak).
    const site = await Site.findOne({ _id: siteId, accountId });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    const auditActorUserId = options.actorUserId ?? String(site.deletionActorUserId ?? accountId);
    const auditSource = options.auditSource ?? site.deletionAuditSource ?? undefined;
    // 2. Preserve the established 409 contract before the FIRST claim. A retry
    //    of an already-claimed deletion skips this guard: a job that raced the
    //    claim is permanently gated and its run is part of the cascade.
    if (!site.deletionStartedAt) {
        const inflight = await AuditRun.exists({
            siteId,
            status: { $in: ['queued', 'running'] },
        });
        if (inflight)
            throw HttpError.conflict({ code: 'SITES_ERRORS_DELETE_WHILE_RUNNING', messageKey: 'sites.errors.deleteWhileRunning' });
    }
    const db = getSitesDb();
    // 3. Serialize with site creation for the account, then atomically stop
    //    new work.
    const claim = await db.transaction(async (tx) => {
        await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${accountId}))`);
        await deps.afterTransactionLock?.();
        const latest = await Site.findOne({ _id: siteId, accountId });
        if (!latest)
            return { status: 'missing' as const };
        if (latest.deletionStartedAt) {
            return claimSiteDeletionAttempt({ accountId, siteId }, attemptId, new Date(), {
                actorUserId: auditActorUserId,
                auditSource,
            });
        }
        return claimSiteDeletionAttempt({ accountId, siteId }, attemptId, new Date(), {
            actorUserId: auditActorUserId,
            auditSource,
        });
    });
    if (claim.status === 'missing')
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    if (claim.status === 'busy') {
        throw HttpError.conflict({ code: 'SITES_ERRORS_DELETE_WHILE_RUNNING', messageKey: 'sites.errors.deleteWhileRunning' });
    }
    const assertDeletionBoundary = async (attempt: SiteDeletionAttempt): Promise<void> => {
        // Global lock order is always account then site/attempt.
        await assertCurrentAccountWorkLease();
        await assertSiteDeletionAttempt(attempt);
    };
    await runWithRenewingSiteDeletionAttempt(claim.attempt, async () => {
        // 4. Commit the Postgres advisory-lock/tombstone barrier before any purge.
        //    A site-scoped writer either completed before this barrier (and the
        //    cascade below sees it) or its trigger rejects the write.
        await assertDeletionBoundary(claim.attempt);
        await installSiteDeletionBarrier(db, siteId, claim.startedAt);
        await denyReportExportsForSite(siteId, claim.startedAt);
        // 5. Freeze the id inventory before deleting provider-backed monitor docs;
        //    indirect queue payloads carry run/schedule/rule ids rather than siteId.
        const mongoInventory = await collectSiteMongoResources(siteId);
        const queueResources = await persistSiteQueueResourceIds(accountId, siteId, await collectSiteQueueResourceIds(db, siteId, mongoInventory));
        const queues = getSiteLifecycleQueues();
        const purgeQueues = async (): Promise<void> => {
            if (queues) {
                await purgeSiteQueueData(queues, siteId, queueResources);
                return;
            }
            // Redis-disabled deployments have no product jobs to inventory, but the
            // narrow legacy holders may still be present during a rolling boot/test.
            // Remove their deterministic schedulers so teardown never regresses to
            // leaving a rank/pulse producer behind.
            const ranksQueue = getRanksQueue();
            if (ranksQueue)
                await removeRankSchedule(ranksQueue, siteId);
            const pulseQueue = getPulseQueue();
            if (pulseQueue)
                await removePulseScheduler(pulseQueue, siteId);
        };
        try {
            await assertDeletionBoundary(claim.attempt);
            await purgeQueues();
        }
        catch (error) {
            if (error instanceof SiteQueueBusyError) {
                throw HttpError.conflict({ code: 'SITES_ERRORS_DELETE_WHILE_RUNNING', messageKey: 'sites.errors.deleteWhileRunning' });
            }
            throw error;
        }
        // Firecrawl monitors are external billable resources. Confirmation comes
        // before local encrypted ids disappear; any failure aborts and retries.
        await assertDeletionBoundary(claim.attempt);
        await deleteMonitorsForSite(siteId);
        // 6. All current Postgres site tables share one transaction. Mongo walks
        //    typed refs to delete descendants before parents and converges boundedly.
        await assertDeletionBoundary(claim.attempt);
        await purgeSitePostgresData(db, accountId, siteId, mongoInventory);
        await purgeSiteMongoData(siteId);
        // A producer that passed its API ownership check just before the claim may
        // have enqueued while the first sweep ran. Converge once more after durable
        // rows are gone; lifecycle-gated consumers cannot turn that job into data.
        await assertDeletionBoundary(claim.attempt);
        await purgeQueues();
        // Do not cross the durable audit/refund/final-delete boundary under an
        // expired target-account lease. Account-purge deletion-owner contexts are
        // intentionally accepted by this assertion.
        await assertDeletionBoundary(claim.attempt);
        // 7. Durable finalization precedes the only irreversible local delete.
        //    Both writes are idempotent, so any failure leaves a hidden claimed Site
        //    document that can resume without duplicate audit evidence.
        await recordAuditOnce(`site-delete:${siteId}`, {
            actorUserId: auditActorUserId,
            action: 'site.delete',
            targetType: 'site',
            targetId: siteId,
            ip: options.ip,
            metadata: {
                domain: site.domain,
                ...(auditSource ? { source: auditSource } : {}),
            },
        });
        // Site doc LAST. There is deliberately no fallible work after this point.
        await assertDeletionBoundary(claim.attempt);
        await Site.deleteOne({ _id: siteId, accountId, deletionStartedAt: { $ne: null } });
    });
}
/**
 * Acquire account ownership before the site lifecycle claim. Cross-account
 * operational callers (notably superadmin bulk deletion) otherwise inherit
 * the actor's ALS context and can race the target account purge. A normal
 * owner request reuses its authenticated account lease; account purge reuses
 * its exclusive deletion-owner context.
 */
export async function deleteSite(accountId: string, siteId: string, options: DeleteSiteOptions = {}): Promise<void> {
    // Preserve the public no-leak/no-mutation contract before touching the
    // target User lease document. The owned-site check is repeated inside the
    // lifecycle boundary to close a delete/ownership race.
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    if (!(await Site.exists({ _id: siteId, accountId }))) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const current = currentAccountWorkLease();
    if (current?.accountId === accountId) {
        return deleteSiteWithAccountBoundary(accountId, siteId, options);
    }
    const result = await tryRunWithTargetAccountWorkLease(accountId, `site-delete:${siteId}`, () => deleteSiteWithAccountBoundary(accountId, siteId, options), 
    // deleteSiteWithAccountBoundary performs its authoritative lease-health
    // check immediately before audit/refund/Site.deleteOne. Nothing after the
    // irreversible final delete may turn success into a retry.
    { assertAfterWork: false });
    if (!result.acquired)
        throw HttpError.conflict({ code: 'SITES_ERRORS_DELETE_WHILE_RUNNING', messageKey: 'sites.errors.deleteWhileRunning' });
}
export const sitesServiceTestables = Object.freeze({
    deleteSiteWithAccountBoundary,
});
