import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { linkGapSnapshots, parseLinkGapSnapshotPayload, } from '../../db/schema/index.js';
import { enqueueBacklinkDeepJob } from '../../shared/queue/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/sites.model.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { backlinkDeepDomainSchema } from './backlink-deep.schema.js';
import { LINK_INTEL_UNAVAILABLE_KEY } from './backlink-deep.service.js';
import { LinkGapRun, type LinkGapRunHydrated, } from './backlink-runs.model.js';
import type { LinkGapBody } from './link-gap.schema.js';
export interface LinkGapServiceDeps {
    queue: Queue | null;
    now?: () => Date;
}
export interface StartLinkGapInput {
    accountId: string;
    siteId: string;
    competitors: LinkGapBody['competitors'];
}
export interface LinkGapOverlap {
    totalUnique: number;
    exclusiveToCompetitor: number;
    exclusivePct: number;
}
/**
 * Gap snapshots contain only the normalized domains that survived the
 * owned-domain exclusion. The overlap summary is therefore derived from the
 * retained, de-duplicated provider rows and never recomputed by the client.
 */
export function computeLinkGapOverlap(rows: ReadonlyArray<{
    domain: string;
}>): LinkGapOverlap {
    const totalUnique = new Set(rows.map((row) => row.domain.trim().toLowerCase())).size;
    const exclusiveToCompetitor = totalUnique;
    return {
        totalUnique,
        exclusiveToCompetitor,
        exclusivePct: totalUnique === 0 ? 0 : 100,
    };
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
export function normalizeGapCompetitors(competitors: readonly string[], ownDomain: string): string[] {
    const normalizedOwn = backlinkDeepDomainSchema.parse(ownDomain);
    const normalized = [
        ...new Set(competitors.map((competitor) => backlinkDeepDomainSchema.parse(competitor))),
    ];
    if (normalized.includes(normalizedOwn)) {
        throw HttpError.badRequest({ code: 'BACKLINKS_ERRORS_GAP_DOMAIN_CONFLICT', messageKey: 'backlinks.errors.gapDomainConflict' });
    }
    return normalized;
}
/**
 * A run whose job never reached the queue is settled as failed on every leg,
 * exactly once: the claim only matches a run with no settled legs yet.
 */
async function failUnstartedRunOnce(run: LinkGapRunHydrated, deps: LinkGapServiceDeps): Promise<boolean> {
    const outcomes = run.competitors.map((competitor) => ({
        competitor,
        status: 'failed' as const,
        retainedCount: 0,
    }));
    const claimed = await LinkGapRun.findOneAndUpdate({
        _id: run._id,
        accountId: run.accountId,
        perLegOutcomes: { $size: 0 },
    }, {
        $set: {
            status: 'failed',
            perLegOutcomes: outcomes,
            completedAt: (deps.now ?? (() => new Date()))(),
        },
    }, { new: true });
    return claimed !== null;
}
/** Controller parsing precedes this ownership → normalize → run → enqueue path. */
export async function startLinkGapRun(input: StartLinkGapInput, deps: LinkGapServiceDeps) {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    assertSiteNotPaused(site);
    const competitors = normalizeGapCompetitors(input.competitors, site.domain);
    if (!env.LINK_INTELLIGENCE_ENABLED || !deps.queue) {
        throw new HttpError(503, { code: 'LINK_INTEL_UNAVAILABLE', messageKey: LINK_INTEL_UNAVAILABLE_KEY });
    }
    const run: LinkGapRunHydrated = await LinkGapRun.create({
        accountId: input.accountId,
        siteId: input.siteId,
        ownDomain: backlinkDeepDomainSchema.parse(site.domain),
        competitors,
        status: 'queued',
        perLegOutcomes: [],
        completedAt: null,
    });
    try {
        await enqueueBacklinkDeepJob(deps.queue, {
            accountId: input.accountId,
            siteId: input.siteId,
            runId: String(run._id),
            operation: 'link_gap',
        });
    }
    catch (error) {
        await failUnstartedRunOnce(run, deps);
        throw new HttpError(503, { code: 'LINK_INTEL_UNAVAILABLE', messageKey: LINK_INTEL_UNAVAILABLE_KEY }, undefined, { cause: error });
    }
    return {
        runId: String(run._id),
        siteId: input.siteId,
        ownDomain: run.ownDomain,
        competitors,
        status: 'queued' as const,
    };
}
function serializeGapRun(run: LinkGapRunHydrated) {
    return {
        runId: String(run._id),
        siteId: String(run.siteId),
        ownDomain: run.ownDomain,
        competitors: [...run.competitors],
        status: run.status,
        perLegOutcomes: run.perLegOutcomes.map((outcome) => ({
            competitor: outcome.competitor,
            status: outcome.status,
            retainedCount: outcome.retainedCount,
        })),
        createdAt: run.createdAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
    };
}
export async function getLinkGapRun(accountId: string, runId: string, db: Db) {
    const run = await LinkGapRun.findOne({ _id: runId, accountId });
    if (!run)
        throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' });
    const snapshots = await db
        .select()
        .from(linkGapSnapshots)
        .where(and(eq(linkGapSnapshots.accountId, accountId), eq(linkGapSnapshots.runId, runId)));
    const byCompetitor = new Map(snapshots.map((row) => [row.competitor, row]));
    return {
        ...serializeGapRun(run),
        legs: run.perLegOutcomes.map((outcome) => {
            const snapshot = byCompetitor.get(outcome.competitor);
            if (!snapshot) {
                return {
                    competitor: outcome.competitor,
                    status: outcome.status,
                    retainedCount: outcome.retainedCount,
                    result: null,
                };
            }
            const rows = parseLinkGapSnapshotPayload(snapshot.payload);
            return {
                competitor: outcome.competitor,
                status: outcome.status,
                retainedCount: outcome.retainedCount,
                result: {
                    rows,
                    overlap: computeLinkGapOverlap(rows),
                    observation: {
                        capturedAt: snapshot.retainedAt.toISOString(),
                        source: 'provider_observation' as const,
                    },
                },
            };
        }),
    };
}
export async function resolveOwnedLinkGapRunSiteId(accountId: string, runId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(runId))
        return null;
    const run = await LinkGapRun.findOne({ _id: runId, accountId }, { siteId: 1 }).lean();
    return run ? String(run.siteId) : null;
}
export { failUnstartedRunOnce };
