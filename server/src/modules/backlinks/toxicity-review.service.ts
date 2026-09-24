import type { Queue } from 'bullmq';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { backlinkRowSnapshots, type BacklinkRowSnapshot, } from '../../db/schema/index.js';
import type { SupportedLocale } from '../../shared/i18n/locales.js';
import type { SpendPreview } from '../../shared/safety/operation-preview.js';
import { enqueueBacklinkDeepJob } from '../../shared/queue/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/sites.model.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { serializeDisavow } from './disavow-serializer.js';
import type { DisavowBuildBody, ToxicityDetailQuery, ToxicityRunsQuery, } from './toxicity-review.schema.js';
import { ToxicityReviewRun, type ToxicityReviewRunHydrated, } from './toxicity-review.model.js';
import { classifyToxicity } from './toxicity-rubric.js';
export const TOXICITY_ROW_CLAMP = 1000;
export const TOXICITY_BULK_DOMAIN_CLAMP = 100;
export const TOXICITY_UNAVAILABLE_KEY = 'backlinks.toxicity.errors.unavailable';
export interface ToxicityReviewServiceDeps {
    queue: Queue | null;
    now?: () => Date;
}
async function loadOwnedSite(accountId: string, siteId: string) {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' });
    return site;
}
function ensureCreationAvailable(queue: Queue | null): void {
    if (!env.TOXIC_LINKS_ENABLED || !queue) {
        throw new HttpError(503, { code: 'TOXICITY_UNAVAILABLE', messageKey: TOXICITY_UNAVAILABLE_KEY });
    }
}
/**
 * Read-only preview for one toxicity review. Never mutates, never enqueues,
 * never calls a provider; `startToxicityReview` repeats every check.
 */
export async function previewToxicityReviewSpend(accountId: string, siteId: string, deps: ToxicityReviewServiceDeps): Promise<SpendPreview & {
    rowClamp: number;
    bulkDomainClamp: number;
}> {
    await loadOwnedSite(accountId, siteId);
    ensureCreationAvailable(deps.queue);
    return {
        deploymentMode: 'community',
        capacityEnforced: false,
        feature: 'backlinks',
        operation: 'toxicity_review',
        productUnits: 1,
        estimatedAt: (deps.now ?? (() => new Date()))().toISOString(),
        rowClamp: TOXICITY_ROW_CLAMP,
        bulkDomainClamp: TOXICITY_BULK_DOMAIN_CLAMP,
    };
}
export async function startToxicityReview(input: {
    accountId: string;
    siteId: string;
    locale: SupportedLocale;
}, deps: ToxicityReviewServiceDeps) {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    assertSiteNotPaused(site);
    ensureCreationAvailable(deps.queue);
    const run: ToxicityReviewRunHydrated = await ToxicityReviewRun.create({
        accountId: input.accountId,
        siteId: input.siteId,
        domain: site.domain,
        locale: input.locale,
        status: 'queued',
    });
    try {
        await enqueueBacklinkDeepJob(deps.queue!, {
            accountId: input.accountId,
            siteId: input.siteId,
            runId: String(run._id),
            operation: 'toxicity_review',
        });
    }
    catch (error) {
        await ToxicityReviewRun.updateOne({ _id: run._id, accountId: input.accountId }, {
            $set: {
                status: 'failed',
                providerStatus: 'not_started',
                completedAt: (deps.now ?? (() => new Date()))(),
            },
        });
        throw new HttpError(503, { code: 'TOXICITY_UNAVAILABLE', messageKey: TOXICITY_UNAVAILABLE_KEY }, undefined, { cause: error });
    }
    return {
        runId: String(run._id),
        siteId: input.siteId,
        status: 'queued' as const,
        rowClamp: TOXICITY_ROW_CLAMP,
    };
}
function serializeRun(run: ToxicityReviewRunHydrated) {
    return {
        runId: String(run._id),
        siteId: String(run.siteId),
        domain: run.domain,
        status: run.status,
        rubricVersion: run.rubricVersion,
        sourceKind: 'provider_observation' as const,
        retainedCount: run.retainedCount,
        bulkDomainCount: run.bulkDomainCount,
        providerStatus: run.providerStatus,
        aiStatus: run.aiStatus,
        failureKind: run.failureKind ?? null,
        estimatedCostMicros: run.estimatedCostMicros,
        createdAt: run.createdAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
    };
}
export async function listToxicityReviews(accountId: string, query: ToxicityRunsQuery) {
    await loadOwnedSite(accountId, query.siteId);
    const docs = await ToxicityReviewRun.find({
        accountId,
        siteId: query.siteId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { _id: { $lt: query.cursor } } : {}),
    })
        .sort({ _id: -1 })
        .limit(query.limit + 1);
    const hasMore = docs.length > query.limit;
    const page = hasMore ? docs.slice(0, query.limit) : docs;
    return {
        runs: page.map(serializeRun),
        nextCursor: hasMore && page.length > 0 ? String(page.at(-1)!._id) : null,
    };
}
function serializeRow(row: BacklinkRowSnapshot) {
    const rubric = classifyToxicity({
        spamScore: row.spamScore,
        dofollow: row.dofollow,
        isBroken: row.isBroken,
    });
    return {
        id: row.id,
        url: row.url,
        domain: row.domain,
        spamScore: row.spamScore,
        band: row.rubricBand,
        signals: rubric.signals,
        firstSeen: row.firstSeen?.toISOString() ?? null,
        lastSeen: row.lastSeen?.toISOString() ?? null,
        dofollow: row.dofollow,
        isBroken: row.isBroken,
        capturedAt: row.capturedAt.toISOString(),
        rubricVersion: row.rubricVersion,
        sourceKind: 'provider_observation' as const,
        rationale: {
            status: row.rationaleStatus,
            text: row.rationale,
            citedRowId: row.rationale ? row.id : null,
            rubricVersion: row.rubricVersion,
            sourceKind: 'provider_observation' as const,
        },
    };
}
async function loadOwnedRun(accountId: string, runId: string) {
    const run = await ToxicityReviewRun.findOne({ _id: runId, accountId });
    if (!run)
        throw HttpError.notFound({ code: 'BACKLINKS_TOXICITY_ERRORS_RUN_NOT_FOUND', messageKey: 'backlinks.toxicity.errors.runNotFound' });
    return run;
}
export async function resolveOwnedToxicityReviewSiteId(accountId: string, runId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(runId))
        return null;
    const run = await ToxicityReviewRun.findOne({ _id: runId, accountId }, { siteId: 1 }).lean();
    return run ? String(run.siteId) : null;
}
export async function getToxicityReview(accountId: string, runId: string, query: ToxicityDetailQuery, db: Db) {
    const run = await loadOwnedRun(accountId, runId);
    const conditions = [
        eq(backlinkRowSnapshots.accountId, accountId),
        eq(backlinkRowSnapshots.reviewId, runId),
    ];
    if (query.band)
        conditions.push(eq(backlinkRowSnapshots.rubricBand, query.band));
    const rows = await db
        .select()
        .from(backlinkRowSnapshots)
        .where(and(...conditions))
        .orderBy(desc(backlinkRowSnapshots.spamScore), backlinkRowSnapshots.domain)
        .limit(TOXICITY_ROW_CLAMP);
    return { ...serializeRun(run), rows: rows.map(serializeRow) };
}
export async function buildToxicityDisavow(accountId: string, runId: string, body: DisavowBuildBody, db: Db, generatedOn: Date) {
    const run = await loadOwnedRun(accountId, runId);
    if (run.status !== 'succeeded') {
        throw new HttpError(409, { code: 'BACKLINKS_TOXICITY_ERRORS_RUN_NOT_READY', messageKey: 'backlinks.toxicity.errors.runNotReady' });
    }
    const ids = [...new Set(body.entries.map((entry) => entry.rowId))];
    const rows = ids.length === 0
        ? []
        : await db
            .select({
            id: backlinkRowSnapshots.id,
            domain: backlinkRowSnapshots.domain,
            url: backlinkRowSnapshots.url,
        })
            .from(backlinkRowSnapshots)
            .where(and(eq(backlinkRowSnapshots.accountId, accountId), eq(backlinkRowSnapshots.reviewId, runId), inArray(backlinkRowSnapshots.id, ids)));
    if (rows.length !== ids.length) {
        throw HttpError.notFound({ code: 'BACKLINKS_TOXICITY_ERRORS_RUN_NOT_FOUND', messageKey: 'backlinks.toxicity.errors.runNotFound' });
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    const text = serializeDisavow({
        rubricVersion: run.rubricVersion,
        generatedOn,
        entries: body.entries.map((entry) => {
            const row = byId.get(entry.rowId)!;
            return {
                kind: entry.kind,
                value: entry.kind === 'domain' ? row.domain : row.url,
            };
        }),
    });
    return {
        text,
        filename: `rankme-disavow-${generatedOn.toISOString().slice(0, 10)}.txt`,
    };
}
