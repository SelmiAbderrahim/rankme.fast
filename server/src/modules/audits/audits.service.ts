/**
 * Audits module HTTP-side service.
 *
 * Orchestrates the "start an audit" flow the API exposes: ownership check,
 * concurrency guard, page-cap policy, run creation, enqueue. The processor
 * (audit.processor.ts) owns everything after the job leaves the queue.
 */
import type { Queue } from 'bullmq';
import { Types } from 'mongoose';
import { HttpError } from '../../shared/utils/http-error.js';
import { enqueueAuditJob } from '../../shared/queue/index.js';
import type { AuditResult } from '../../shared/providers/index.js';
import { Site, acquireSiteWorkLease, releaseSiteWorkLease, runWithSiteWorkLeaseContext, } from '../sites/index.js';
import { randomUUID } from 'node:crypto';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { AuditRun, type AuditRunHydrated, type AuditRunStatus } from './audit-run.model.js';
import { AuditedPage, type AuditedPageHydrated } from './audited-page.model.js';
import { AUDIT_PAGE_CAP_MAX } from './audits.schema.js';
const CONCURRENT_STATUSES: AuditRunStatus[] = ['queued', 'running'];
/**
 * Per-audit page ceiling (max_crawl_pages — the vendor's cost basis).
 * `min(AUDIT_PAGE_CAP_MAX, requested?)`; a caller who omits `requested`
 * takes the structural maximum.
 */
export function resolveAuditPageCap(requested?: number): number {
    if (typeof requested !== 'number' || requested <= 0)
        return AUDIT_PAGE_CAP_MAX;
    return Math.min(AUDIT_PAGE_CAP_MAX, requested);
}
export interface PublicAuditRun {
    id: string;
    siteId: string;
    status: AuditRunStatus;
    pageCap: number;
    pagesCrawled: number;
    vendorTaskId: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface AuditRunListPage {
    runs: PublicAuditRun[];
    nextCursor: string | null;
}
export function toPublicAuditRun(run: AuditRunHydrated, pagesCrawled = 0): PublicAuditRun {
    return {
        id: run.id as string,
        siteId: run.siteId.toString(),
        status: run.status,
        pageCap: run.pageCap,
        pagesCrawled,
        vendorTaskId: run.vendorTaskId ?? null,
        startedAt: run.startedAt ? run.startedAt.toISOString() : null,
        finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
        error: run.error ?? null,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
    };
}
export interface StartAuditForSiteInput {
    accountId: string;
    siteId: string;
    requestedPageCap?: number;
}
export interface StartAuditDeps {
    /** BullMQ audits queue. `null` = queueing not configured — 503. */
    auditsQueue: Queue | null;
}
/**
 * Start a run: ownership → concurrency guard → page cap → create run → enqueue.
 */
export async function startAuditForSite(input: StartAuditForSiteInput, deps: StartAuditDeps): Promise<PublicAuditRun> {
    const auditsQueue = deps.auditsQueue;
    if (!auditsQueue) {
        throw new HttpError(503, { code: 'AUDITS_ERRORS_QUEUE_UNAVAILABLE', messageKey: 'audits.errors.queueUnavailable' });
    }
    if (!Types.ObjectId.isValid(input.siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    // This service is also called directly by MCP/chat, outside Express route
    // middleware. Own the Site lease here so every entry point shares the same
    // deletion boundary through the Mongo insert and Redis enqueue.
    const lease = await acquireSiteWorkLease({ accountId: input.accountId, siteId: input.siteId }, `audit-start:${randomUUID()}`);
    if (!lease)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    try {
        return await runWithSiteWorkLeaseContext(lease, async () => {
            const site = await Site.findOne({
                _id: input.siteId,
                accountId: input.accountId,
                deletionStartedAt: null,
            });
            if (!site)
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            assertSiteNotPaused(site);
            // Cheap 409 fast-path: skip the insert when a run is already
            // queued/running. The authoritative concurrency guard is the partial-unique
            // `activeKey` index below — two concurrent requests that both pass this
            // exists() will one-lose to E11000 on create.
            const inFlight = await AuditRun.exists({
                siteId: site._id,
                status: { $in: CONCURRENT_STATUSES },
            });
            if (inFlight) {
                throw HttpError.conflict({ code: 'AUDITS_ERRORS_RUN_IN_PROGRESS', messageKey: 'audits.errors.runInProgress' });
            }
            const pageCap = resolveAuditPageCap(input.requestedPageCap);
            let run: AuditRunHydrated;
            try {
                run = await AuditRun.create({
                    accountId: input.accountId,
                    siteId: site._id,
                    status: 'queued',
                    pageCap,
                    activeKey: (site._id as Types.ObjectId).toString(),
                });
            }
            catch (err) {
                if (err instanceof Error && (err as {
                    code?: unknown;
                }).code === 11000) {
                    throw HttpError.conflict({ code: 'AUDITS_ERRORS_RUN_IN_PROGRESS', messageKey: 'audits.errors.runInProgress' });
                }
                /* c8 ignore next 2 -- non-duplicate create failures propagate to the 500 handler; not deterministically reachable in tests. */
                throw err;
            }
            try {
                await enqueueAuditJob(auditsQueue, {
                    accountId: input.accountId,
                    siteId: site.id as string,
                    runId: run.id as string,
                    pageCap,
                });
            }
            catch (err) {
                // Enqueue failure AFTER the run was created: transition the run to
                // `failed` so it can never be revived from `queued`. English `error`
                // string is operator-facing only (the UI localizes from `status`).
                run.status = 'failed';
                run.error = 'enqueue failed';
                run.finishedAt = new Date();
                run.activeKey = null;
                await run.save();
                throw new HttpError(503, { code: 'AUDITS_ERRORS_QUEUE_UNAVAILABLE', messageKey: 'audits.errors.queueUnavailable' }, undefined, {
                    cause: err instanceof Error ? err : undefined,
                });
            }
            return toPublicAuditRun(run);
        });
    }
    finally {
        await releaseSiteWorkLease(lease);
    }
}
export interface ListAuditRunsInput {
    accountId: string;
    siteId: string;
    cursor?: string;
    limit: number;
}
export async function listAuditRuns(input: ListAuditRunsInput): Promise<AuditRunListPage> {
    if (!Types.ObjectId.isValid(input.siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.findOne({
        _id: input.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    const filter: Record<string, unknown> = { siteId: site._id, accountId: input.accountId };
    if (input.cursor !== undefined) {
        if (!Types.ObjectId.isValid(input.cursor)) {
            throw HttpError.badRequest({ code: 'ERRORS_BAD_REQUEST', messageKey: 'errors.badRequest' });
        }
        filter._id = { $lt: new Types.ObjectId(input.cursor) };
    }
    // The list surface never uses `result`; drop the
    // field over the wire so a page of runs stays a small doc.
    const docs = await AuditRun.find(filter)
        .select('-result')
        .sort({ _id: -1 })
        .limit(input.limit + 1);
    const page = docs.slice(0, input.limit);
    const hasMore = docs.length > input.limit;
    const last = page.at(-1);
    /* c8 ignore next -- `page` is non-empty whenever hasMore (limit ≥ 1); the `?? null` satisfies noUncheckedIndexedAccess. */
    const nextCursor = hasMore ? (last?._id.toString() ?? null) : null;
    const pageCounts = await AuditedPage.aggregate<{
        _id: Types.ObjectId;
        count: number;
    }>([
        { $match: { runId: { $in: page.map((r) => r._id) } } },
        { $group: { _id: '$runId', count: { $sum: 1 } } },
    ]);
    const countsByRun = new Map(pageCounts.map((row) => [row._id.toString(), row.count]));
    return {
        runs: page.map((r) => toPublicAuditRun(r, countsByRun.get(r.id as string) ?? 0)),
        nextCursor,
    };
}
export interface GetAuditRunInput {
    accountId: string;
    runId: string;
}
export interface GetAuditRunResult {
    run: PublicAuditRun;
    /** Domain-checks + page count summary. Full page list is a separate paged endpoint. */
    summary: {
        domainChecks: AuditResult['domainChecks'] | null;
        pagesCrawled: number;
    };
}
export async function getAuditRun(input: GetAuditRunInput): Promise<GetAuditRunResult> {
    if (!Types.ObjectId.isValid(input.runId)) {
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    }
    const run = await AuditRun.findOne({ _id: input.runId, accountId: input.accountId });
    if (!run)
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    const liveSite = await Site.exists({
        _id: run.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    });
    if (!liveSite)
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    const pagesCrawled = await AuditedPage.countDocuments({ runId: run._id });
    const result = run.result as AuditResult | null | undefined;
    return {
        run: toPublicAuditRun(run, pagesCrawled),
        summary: {
            domainChecks: result?.domainChecks ?? null,
            pagesCrawled,
        },
    };
}
/** Resolve a run-scoped URL to its live Site without exposing foreign ids. */
export async function resolveOwnedAuditRunSiteId(accountId: string, runId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(runId))
        return null;
    const run = await AuditRun.findOne({ _id: runId, accountId }, { siteId: 1 }).lean();
    return run ? String(run.siteId) : null;
}
/**
 * Idempotent per-run page write: drop any pages already persisted for this
 * run, then insert the fresh set. A retried job replaces prior partial data
 * atomically-enough for our story (worker retries are rare and site content
 * changes little between them).
 */
export async function replaceAuditedPages(runId: string, pages: AuditResult['pages']): Promise<AuditedPageHydrated[]> {
    await AuditedPage.deleteMany({ runId });
    if (pages.length === 0)
        return [];
    const created = await AuditedPage.insertMany(pages.map((page) => ({ runId, ...page })));
    return created as unknown as AuditedPageHydrated[];
}
