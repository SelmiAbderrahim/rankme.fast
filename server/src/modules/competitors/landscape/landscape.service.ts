import type { Queue } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../../config/env.js';
import { competitorProfiles, keywords } from '../../../db/schema/index.js';
import { competitorLandscapeJobId, enqueueCompetitorLandscapeJob, } from '../../../shared/queue/index.js';
import { HttpError } from '../../../shared/utils/http-error.js';
import { Site } from '../../sites/index.js';
import { assertSiteNotPaused } from '../../sites/sites.guard.js';
import { sha256CanonicalLandscape } from './landscape.canonical.js';
import { CompetitorLandscapeLegCheckpoint, CompetitorLandscapeRun, LANDSCAPE_RUBRIC_VERSION, LANDSCAPE_SCHEMA_VERSION, LANDSCAPE_TAXONOMY_VERSION, type CompetitorLandscapeRunDocument, } from './landscape.model.js';
import { LANDSCAPE_LEGS, LANDSCAPE_MAX_COMPETITORS, LANDSCAPE_MAX_ROWS, LANDSCAPE_TERMINAL_STATES, landscapePreviewInputSchema, landscapeStartInputSchema, type FrozenCompetitor, type LandscapeMarket, type LandscapePreviewInput, type LandscapeStartInput, type LandscapeState, } from './landscape.schemas.js';
const ACTIVE_STATES: LandscapeState[] = ['queued', 'collecting', 'aggregating'];
const terminalSet = new Set<string>(LANDSCAPE_TERMINAL_STATES);
export interface LandscapeServiceDeps {
    db: ApplicationDb;
    queue: Queue | null;
    enqueueFn?: typeof enqueueCompetitorLandscapeJob;
}
interface ResolvedLandscapeInput {
    siteId: string;
    ownedDomain: string;
    competitors: FrozenCompetitor[];
    market: LandscapeMarket;
}
function compareLandscapeMarkets(left: {
    locationCode: number;
    languageCode: string;
    count: number;
}, right: {
    locationCode: number;
    languageCode: string;
    count: number;
}): number {
    return right.count - left.count ||
        left.locationCode - right.locationCode ||
        left.languageCode.localeCompare(right.languageCode);
}
export async function loadOwnedLandscapeSite(accountId: string, siteId: string, options: {
    allowPaused: boolean;
} = { allowPaused: true }) {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.findOne({
        _id: siteId,
        accountId,
        deletionStartedAt: null,
    });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    if (!options.allowPaused)
        assertSiteNotPaused(site);
    return site;
}
export async function resolveLandscapeMarket(db: ApplicationDb, accountId: string, siteId: string): Promise<LandscapeMarket> {
    const rows = await db
        .select({
        locationCode: keywords.locationCode,
        languageCode: keywords.languageCode,
    })
        .from(keywords)
        .where(and(eq(keywords.accountId, accountId), eq(keywords.siteId, siteId), eq(keywords.active, true), eq(keywords.engine, 'google')));
    if (rows.length === 0) {
        return {
            locationCode: 2840,
            languageCode: 'en',
            source: 'default',
            eligibleTrackedKeywords: 0,
        };
    }
    const counts = new Map<string, {
        locationCode: number;
        languageCode: string;
        count: number;
    }>();
    for (const row of rows) {
        const languageCode = row.languageCode.toLowerCase();
        const key = `${row.locationCode}\u0000${languageCode}`;
        const current = counts.get(key);
        counts.set(key, {
            locationCode: row.locationCode,
            languageCode,
            count: (current?.count ?? 0) + 1,
        });
    }
    const modal = [...counts.values()].sort(compareLandscapeMarkets)[0]!;
    return {
        locationCode: modal.locationCode,
        languageCode: modal.languageCode,
        source: 'tracked_keyword_mode',
        eligibleTrackedKeywords: rows.length,
    };
}
async function resolveLandscapeInput(db: ApplicationDb, accountId: string, siteId: string, profileIds: readonly string[], options: {
    allowPaused: boolean;
}): Promise<ResolvedLandscapeInput> {
    const site = await loadOwnedLandscapeSite(accountId, siteId, options);
    const profiles = await db
        .select({
        id: competitorProfiles.id,
        domain: competitorProfiles.registrableDomain,
    })
        .from(competitorProfiles)
        .where(and(eq(competitorProfiles.accountId, accountId), eq(competitorProfiles.siteId, siteId), eq(competitorProfiles.status, 'active'), inArray(competitorProfiles.id, [...profileIds])));
    if (profiles.length !== profileIds.length) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_COMPETITOR_NOT_FOUND', messageKey: 'competitors.landscape.errors.competitorNotFound' });
    }
    const byId = new Map(profiles.map((profile) => [profile.id, profile.domain]));
    const competitors = profileIds.map((profileId) => ({
        profileId,
        domain: byId.get(profileId)!,
    }));
    const market = await resolveLandscapeMarket(db, accountId, siteId);
    return {
        siteId: String(site._id),
        ownedDomain: site.domain.toLowerCase().replace(/^www\./, ''),
        competitors,
        market,
    };
}
function requestFingerprint(accountId: string, input: ResolvedLandscapeInput, locale: string): string {
    return sha256CanonicalLandscape({
        accountId,
        siteId: input.siteId,
        competitorProfileIds: input.competitors.map((item) => item.profileId).sort(),
        locale,
        market: input.market,
        schemaVersion: LANDSCAPE_SCHEMA_VERSION,
        taxonomyVersion: LANDSCAPE_TAXONOMY_VERSION,
    });
}
function isDuplicateKeyError(error: unknown): boolean {
    return Boolean(error &&
        typeof error === 'object' &&
        ((error as {
            code?: number;
        }).code === 11000 ||
            (error as {
                name?: string;
            }).name === 'MongoServerError'));
}
export interface LandscapePreview {
    deploymentMode: 'community';
    capacityEnforced: false;
    competitorCount: number;
    competitors: FrozenCompetitor[];
    /** Canonical aliases used by the site-scoped shell. */
    selected: FrozenCompetitor[];
    competitorLimit: number;
    market: LandscapeMarket;
    /** Vendor comparison calls one run makes (one per competitor). */
    unitsRequired: number;
    maxRows: number;
    enabled: boolean;
    startAllowed: boolean;
}
export async function previewLandscape(rawInput: LandscapePreviewInput | unknown, context: {
    accountId: string;
    siteId: string;
}, deps: Pick<LandscapeServiceDeps, 'db'>): Promise<LandscapePreview> {
    const parsed = landscapePreviewInputSchema.parse(rawInput);
    const resolved = await resolveLandscapeInput(deps.db, context.accountId, context.siteId, parsed.competitorProfileIds, { allowPaused: true });
    return {
        deploymentMode: 'community',
        capacityEnforced: false,
        competitorCount: resolved.competitors.length,
        competitors: resolved.competitors,
        selected: resolved.competitors,
        competitorLimit: LANDSCAPE_MAX_COMPETITORS,
        market: resolved.market,
        unitsRequired: resolved.competitors.length,
        maxRows: resolved.competitors.length * LANDSCAPE_LEGS.length * 100,
        enabled: env.COMPETITOR_INTELLIGENCE_ENABLED,
        startAllowed: env.COMPETITOR_INTELLIGENCE_ENABLED,
    };
}
export interface StartedLandscape {
    runId: string;
    state: LandscapeState;
    duplicate: boolean;
}
function started(doc: CompetitorLandscapeRunDocument & {
    _id: unknown;
}, duplicate: boolean) {
    return {
        runId: String(doc._id),
        state: doc.state as LandscapeState,
        duplicate,
    };
}
async function markEnqueueFailure(doc: CompetitorLandscapeRunDocument & {
    _id: unknown;
}): Promise<void> {
    await CompetitorLandscapeRun.updateOne({ _id: doc._id, state: 'queued' }, {
        $set: {
            state: 'failed',
            'progress.stage': 'failed',
            safeFailureCode: 'ENQUEUE_FAILED',
            completedAt: new Date(),
        },
    });
}
export async function startLandscape(rawInput: LandscapeStartInput | unknown, context: {
    accountId: string;
    requestedByUserId: string;
    siteId: string;
}, deps: LandscapeServiceDeps): Promise<StartedLandscape> {
    const parsed = landscapeStartInputSchema.parse(rawInput);
    const resolved = await resolveLandscapeInput(deps.db, context.accountId, context.siteId, parsed.competitorProfileIds, { allowPaused: false });
    const fingerprint = requestFingerprint(context.accountId, resolved, parsed.locale);
    const existing = await CompetitorLandscapeRun.findOne({
        accountId: context.accountId,
        siteId: resolved.siteId,
        idempotencyKey: parsed.idempotencyKey,
    });
    if (existing)
        return started(existing, true);
    const equivalent = await CompetitorLandscapeRun.findOne({
        accountId: context.accountId,
        siteId: resolved.siteId,
        requestFingerprint: fingerprint,
        state: { $in: ACTIVE_STATES },
    });
    if (equivalent)
        return started(equivalent, true);
    if (!env.COMPETITOR_INTELLIGENCE_ENABLED) {
        throw new HttpError(503, { code: 'COMPETITORS_LANDSCAPE_ERRORS_UNAVAILABLE', messageKey: 'competitors.landscape.errors.unavailable' });
    }
    if (!deps.queue) {
        throw new HttpError(503, { code: 'COMPETITORS_LANDSCAPE_ERRORS_QUEUE_UNAVAILABLE', messageKey: 'competitors.landscape.errors.queueUnavailable' });
    }
    const units = resolved.competitors.length;
    let doc;
    try {
        const id = new Types.ObjectId();
        doc = await CompetitorLandscapeRun.create({
            _id: id,
            accountId: context.accountId,
            siteId: resolved.siteId,
            requestedByUserId: context.requestedByUserId,
            ownedDomain: resolved.ownedDomain,
            locale: parsed.locale,
            state: 'queued',
            progress: {
                completedLegs: 0,
                totalLegs: units * LANDSCAPE_LEGS.length,
                stage: 'queued',
            },
            market: resolved.market,
            competitors: resolved.competitors,
            idempotencyKey: parsed.idempotencyKey,
            requestFingerprint: fingerprint,
            queueJobId: competitorLandscapeJobId(String(id)),
            cancelRequestedAt: null,
            firstProviderDispatchAt: null,
            stageSummary: resolved.competitors.flatMap((competitor) => LANDSCAPE_LEGS.map((leg) => ({
                competitorProfileId: competitor.profileId,
                leg,
                state: 'pending',
                returnedRows: 0,
            }))),
            reportManifest: null,
            contentHash: null,
            safeFailureCode: null,
            reportVersion: 1,
            schemaVersion: LANDSCAPE_SCHEMA_VERSION,
            taxonomyVersion: LANDSCAPE_TAXONOMY_VERSION,
            suggestionRubricVersion: LANDSCAPE_RUBRIC_VERSION,
            opportunityRubricVersion: LANDSCAPE_RUBRIC_VERSION,
            startedAt: null,
            completedAt: null,
            expiresAt: null,
        });
    }
    catch (error) {
        if (isDuplicateKeyError(error)) {
            const winner = await CompetitorLandscapeRun.findOne({
                accountId: context.accountId,
                siteId: resolved.siteId,
                $or: [
                    { idempotencyKey: parsed.idempotencyKey },
                    { requestFingerprint: fingerprint, state: { $in: ACTIVE_STATES } },
                ],
            });
            if (winner)
                return started(winner, true);
        }
        throw error;
    }
    try {
        await CompetitorLandscapeLegCheckpoint.insertMany(resolved.competitors.flatMap((competitor) => LANDSCAPE_LEGS.map((leg) => ({
            accountId: context.accountId,
            siteId: resolved.siteId,
            runId: doc._id,
            competitorProfileId: competitor.profileId,
            leg,
            state: 'pending',
            attempt: 0,
            cache: 'miss',
            dispatchMarkedAt: null,
            safeErrorCode: null,
            provenance: null,
            rows: [],
            expiresAt: null,
        }))));
        await (deps.enqueueFn ?? enqueueCompetitorLandscapeJob)(deps.queue, {
            runId: String(doc._id),
        });
    }
    catch (error) {
        await markEnqueueFailure(doc);
        throw new HttpError(503, { code: 'COMPETITORS_LANDSCAPE_ERRORS_QUEUE_UNAVAILABLE', messageKey: 'competitors.landscape.errors.queueUnavailable' }, undefined, { cause: error });
    }
    return started(doc, false);
}
export async function cancelLandscape(input: {
    accountId: string;
    siteId: string;
    runId: string;
}, deps: {
    findWinnerFn?: (runId: string) => Promise<(CompetitorLandscapeRunDocument & {
        _id: unknown;
    }) | null>;
    beforeCancelWrite?: () => Promise<void>;
} = {}): Promise<StartedLandscape> {
    if (!Types.ObjectId.isValid(input.runId)) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_NOT_FOUND', messageKey: 'competitors.landscape.errors.notFound' });
    }
    const existing = await CompetitorLandscapeRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
        siteId: input.siteId,
    });
    if (!existing)
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_NOT_FOUND', messageKey: 'competitors.landscape.errors.notFound' });
    if (terminalSet.has(existing.state))
        return started(existing, true);
    const now = new Date();
    await deps.beforeCancelWrite?.();
    const cancelled = await CompetitorLandscapeRun.findOneAndUpdate({
        _id: existing._id,
        accountId: input.accountId,
        siteId: input.siteId,
        state: { $in: ACTIVE_STATES },
    }, {
        $set: {
            state: 'cancelled',
            'progress.stage': 'cancelled',
            cancelRequestedAt: now,
            completedAt: now,
        },
    }, { new: true });
    const winner = cancelled ??
        (await (deps.findWinnerFn ??
            (async (runId) => CompetitorLandscapeRun.findById(runId)))(String(existing._id)));
    if (!winner)
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_NOT_FOUND', messageKey: 'competitors.landscape.errors.notFound' });
    return started(winner, cancelled === null);
}
export const LANDSCAPE_DOMAIN_MAX_ROWS = LANDSCAPE_MAX_ROWS;
export const landscapeServiceTestables = Object.freeze({
    compareLandscapeMarkets,
    isDuplicateKeyError,
});
