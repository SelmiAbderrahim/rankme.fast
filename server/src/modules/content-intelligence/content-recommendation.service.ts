import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { contentRecommendationEvents, type ContentRecommendationEventKind, type ContentRecommendationState, } from '../../db/schema/index.js';
import { makeIdempotencyKey, stripQueryOperators, } from '../../shared/security/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { ContentAnalysis, type ContentAnalysisHydrated, } from './content-analysis.model.js';
import { ownedPageFactsSchema, recommendationSchema, SCHEMA_VERSION, } from './content-analysis.schemas.js';
export type RecommendationAction = 'accept' | 'dismiss' | 'apply' | 'undo';
const TARGET_STATE: Readonly<Record<RecommendationAction, ContentRecommendationState>> = {
    accept: 'accepted',
    dismiss: 'dismissed',
    apply: 'applied',
    undo: 'accepted',
};
const EVENT_KIND: Readonly<Record<RecommendationAction, ContentRecommendationEventKind>> = {
    accept: 'accepted',
    dismiss: 'dismissed',
    apply: 'applied',
    undo: 'undo_applied',
};
const ALLOWED_TRANSITIONS = new Set([
    'suggested:accepted',
    'suggested:dismissed',
    'dismissed:accepted',
    'accepted:applied',
    'accepted:dismissed',
    'applied:accepted',
]);
export interface RecommendationMutationInput {
    accountId: string;
    actorUserId: string;
    analysisId: string;
    recommendationId: string;
    analysisVersion: string;
    expectedVersion: number;
    clientKey: string;
    note?: string;
    confirm?: true;
    action: RecommendationAction;
}
export interface PublicRecommendationState {
    recommendationId: string;
    analysisVersion: string;
    state: ContentRecommendationState;
    version: number;
    actorUserId: string | null;
    stateChangedAt: string | null;
    appliedAt: string | null;
    baselineAnchorAt: string | null;
    contentHash: string | null;
    analysisContentHash: string | null;
    hashStatus: 'same' | 'changed' | 'unavailable';
}
function implicitState(recommendationId: string): PublicRecommendationState {
    return {
        recommendationId,
        analysisVersion: SCHEMA_VERSION,
        state: 'suggested',
        version: 0,
        actorUserId: null,
        stateChangedAt: null,
        appliedAt: null,
        baselineAnchorAt: null,
        contentHash: null,
        analysisContentHash: null,
        hashStatus: 'unavailable',
    };
}
function iso(value: Date | null | undefined): string | null {
    return value instanceof Date ? value.toISOString() : null;
}
function publicState(state: ContentAnalysisHydrated['recommendationStates'][number]): PublicRecommendationState {
    const contentHash = state.contentHash ?? null;
    const analysisContentHash = state.analysisContentHash ?? null;
    return {
        recommendationId: state.recommendationId,
        analysisVersion: state.analysisVersion,
        state: state.state,
        version: state.version,
        actorUserId: String(state.actorUserId),
        stateChangedAt: iso(state.stateChangedAt),
        appliedAt: iso(state.appliedAt),
        baselineAnchorAt: iso(state.baselineAnchorAt),
        contentHash,
        analysisContentHash,
        hashStatus: contentHash === null || analysisContentHash === null
            ? 'unavailable'
            : contentHash === analysisContentHash
                ? 'same'
                : 'changed',
    };
}
function findState(doc: ContentAnalysisHydrated, recommendationId: string): PublicRecommendationState {
    const current = doc.recommendationStates.find((entry) => entry.recommendationId === recommendationId);
    return current ? publicState(current) : implicitState(recommendationId);
}
async function loadOwnedAnalysis(accountId: string, analysisId: string): Promise<ContentAnalysisHydrated> {
    if (!Types.ObjectId.isValid(analysisId)) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    }
    const filter = stripQueryOperators({ _id: analysisId, accountId }) as {
        _id: string;
        accountId: string;
    };
    const doc = await ContentAnalysis.findOne(filter);
    if (!doc)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    const site = await Site.exists({
        _id: doc.siteId,
        accountId,
        deletionStartedAt: null,
    });
    if (!site)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
    if (doc.status !== 'completed' && doc.status !== 'partial') {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_ANALYSIS_UNAVAILABLE', messageKey: 'contentIntelligence.recommendations.errors.analysisUnavailable' });
    }
    return doc;
}
function assertRecommendation(doc: ContentAnalysisHydrated, recommendationId: string): void {
    const exists = doc.recommendations.some((value) => {
        const parsed = recommendationSchema.safeParse(value);
        return parsed.success && parsed.data.id === recommendationId;
    });
    if (!exists) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.recommendations.errors.notFound' });
    }
}
function idempotencyKey(input: RecommendationMutationInput): string {
    const scope = createHash('sha256')
        .update(`content-recommendation:${input.analysisId}:${input.recommendationId}:${input.action}`)
        .digest('hex');
    return makeIdempotencyKey(input.accountId, scope, input.clientKey);
}
async function readRecentOwnedHash(doc: ContentAnalysisHydrated, now: Date): Promise<{
    currentHash: string;
    analysisHash: string;
} | null> {
    const analysisFacts = ownedPageFactsSchema.safeParse(doc.owned);
    if (!analysisFacts.success)
        return null;
    const freshSince = new Date(now.getTime() - env.CONTENT_ANALYSIS_SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000);
    const latest = await ContentAnalysis.findOne({
        accountId: doc.accountId,
        siteId: doc.siteId,
        ownedUrl: doc.ownedUrl,
        status: { $in: ['completed', 'partial'] },
        completedAt: { $gte: freshSince },
    }).sort({ completedAt: -1 });
    const currentFacts = ownedPageFactsSchema.safeParse(latest?.owned);
    if (!currentFacts.success)
        return null;
    return {
        currentHash: currentFacts.data.contentHash,
        analysisHash: analysisFacts.data.contentHash,
    };
}
export async function mutateRecommendation(db: ApplicationDb, input: RecommendationMutationInput, now: Date = new Date()): Promise<PublicRecommendationState> {
    const doc = await loadOwnedAnalysis(input.accountId, input.analysisId);
    assertRecommendation(doc, input.recommendationId);
    if (input.analysisVersion !== SCHEMA_VERSION) {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_STALE_ANALYSIS', messageKey: 'contentIntelligence.recommendations.errors.staleAnalysis' });
    }
    const scopedKey = idempotencyKey(input);
    const replay = await db
        .select({ stateVersion: contentRecommendationEvents.stateVersion })
        .from(contentRecommendationEvents)
        .where(and(eq(contentRecommendationEvents.accountId, input.accountId), eq(contentRecommendationEvents.idempotencyKey, scopedKey)))
        .limit(1);
    if (replay.length > 0)
        return findState(doc, input.recommendationId);
    const current = findState(doc, input.recommendationId);
    if (current.version !== input.expectedVersion) {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_VERSION_CONFLICT', messageKey: 'contentIntelligence.recommendations.errors.versionConflict' }, {
            current,
        });
    }
    const nextState = TARGET_STATE[input.action];
    if (!ALLOWED_TRANSITIONS.has(`${current.state}:${nextState}`)) {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_INVALID_TRANSITION', messageKey: 'contentIntelligence.recommendations.errors.invalidTransition' });
    }
    if (current.state === 'applied' && input.action !== 'undo') {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_INVALID_TRANSITION', messageKey: 'contentIntelligence.recommendations.errors.invalidTransition' });
    }
    if (input.action === 'undo' && current.state !== 'applied') {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_INVALID_TRANSITION', messageKey: 'contentIntelligence.recommendations.errors.invalidTransition' });
    }
    if (input.action === 'apply' && input.confirm !== true) {
        throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_CONFIRM_REQUIRED', messageKey: 'contentIntelligence.recommendations.errors.confirmRequired' });
    }
    let contentHash: string | null = null;
    let analysisContentHash: string | null = null;
    let appliedAt: Date | null = null;
    let baselineAnchorAt: Date | null = null;
    if (input.action === 'apply') {
        const hashes = await readRecentOwnedHash(doc, now);
        if (!hashes) {
            throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_HASH_UNAVAILABLE', messageKey: 'contentIntelligence.recommendations.errors.hashUnavailable' });
        }
        contentHash = hashes.currentHash;
        analysisContentHash = hashes.analysisHash;
        if (contentHash === analysisContentHash && !input.note) {
            throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_UNCHANGED_HASH_NOTE_REQUIRED', messageKey: 'contentIntelligence.recommendations.errors.unchangedHashNoteRequired' });
        }
        appliedAt = now;
        baselineAnchorAt = now;
    }
    else if (input.action === 'undo') {
        contentHash = current.contentHash;
        analysisContentHash = current.analysisContentHash;
    }
    const nextVersion = current.version + 1;
    const nextEntry = {
        recommendationId: input.recommendationId,
        analysisVersion: SCHEMA_VERSION,
        state: nextState,
        version: nextVersion,
        actorUserId: new Types.ObjectId(input.actorUserId),
        stateChangedAt: now,
        appliedAt,
        baselineAnchorAt,
        contentHash: input.action === 'undo' ? null : contentHash,
        analysisContentHash: input.action === 'undo' ? null : analysisContentHash,
    };
    const nextEntries: Array<{
        recommendationId: string;
        analysisVersion: string;
        state: ContentRecommendationState;
        version: number;
        actorUserId: Types.ObjectId;
        stateChangedAt: Date;
        appliedAt: Date | null;
        baselineAnchorAt: Date | null;
        contentHash: string | null;
        analysisContentHash: string | null;
    }> = doc.recommendationStates
        .filter((entry) => entry.recommendationId !== input.recommendationId)
        .map((entry) => ({
        recommendationId: entry.recommendationId,
        analysisVersion: entry.analysisVersion,
        state: entry.state,
        version: entry.version,
        actorUserId: entry.actorUserId,
        stateChangedAt: entry.stateChangedAt,
        appliedAt: entry.appliedAt ?? null,
        baselineAnchorAt: entry.baselineAnchorAt ?? null,
        contentHash: entry.contentHash ?? null,
        analysisContentHash: entry.analysisContentHash ?? null,
    }));
    nextEntries.push(nextEntry);
    const documentVersion = (doc as unknown as {
        __v: number;
    }).__v;
    const priorEntries = nextEntries.filter((entry) => entry.recommendationId !== input.recommendationId);
    const previous = doc.recommendationStates.find((entry) => entry.recommendationId === input.recommendationId);
    if (previous) {
        priorEntries.push({
            recommendationId: previous.recommendationId,
            analysisVersion: previous.analysisVersion,
            state: previous.state,
            version: previous.version,
            actorUserId: previous.actorUserId,
            stateChangedAt: previous.stateChangedAt,
            appliedAt: previous.appliedAt ?? null,
            baselineAnchorAt: previous.baselineAnchorAt ?? null,
            contentHash: previous.contentHash ?? null,
            analysisContentHash: previous.analysisContentHash ?? null,
        });
    }
    const event = {
        accountId: input.accountId,
        siteId: String(doc.siteId),
        analysisId: input.analysisId,
        recommendationId: input.recommendationId,
        analysisVersion: SCHEMA_VERSION,
        eventKind: EVENT_KIND[input.action],
        priorState: current.state,
        newState: nextState,
        stateVersion: nextVersion,
        actorUserId: input.actorUserId,
        note: input.note ?? null,
        contentHash,
        analysisContentHash,
        appliedAt,
        baselineAnchorAt,
        idempotencyKey: scopedKey,
        recordedAt: now,
    } satisfies typeof contentRecommendationEvents.$inferInsert;
    let updated: ContentAnalysisHydrated | null = null;
    let transactionResult: {
        kind: 'replay';
    } | {
        kind: 'updated';
        projection: ContentAnalysisHydrated;
    };
    try {
        transactionResult = await db.transaction(async (tx) => {
            // Event first: the unique state-version index serializes two clients
            // racing from the same projection. The SQL transaction stays open
            // until the Mongo compare-and-swap succeeds, so a lost CAS rolls the
            // append back instead of leaving an orphan history row.
            const inserted = await tx
                .insert(contentRecommendationEvents)
                .values(event)
                // Ignore either uniqueness guard here. We distinguish a replay of
                // this account-scoped idempotency key from a different client racing
                // the same stateVersion immediately below, so neither database
                // constraint can escape as an unlocalized 500.
                .onConflictDoNothing()
                .returning({ id: contentRecommendationEvents.id });
            if (inserted.length === 0) {
                const matchingKey = await tx
                    .select({ id: contentRecommendationEvents.id })
                    .from(contentRecommendationEvents)
                    .where(and(eq(contentRecommendationEvents.accountId, input.accountId), eq(contentRecommendationEvents.idempotencyKey, scopedKey)))
                    .limit(1);
                if (matchingKey.length > 0) {
                    return { kind: 'replay' as const };
                }
                throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_VERSION_CONFLICT', messageKey: 'contentIntelligence.recommendations.errors.versionConflict' });
            }
            updated = await ContentAnalysis.findOneAndUpdate({ _id: doc._id, accountId: doc.accountId, __v: documentVersion }, { $set: { recommendationStates: nextEntries }, $inc: { __v: 1 } }, { new: true, runValidators: true });
            if (!updated) {
                throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_VERSION_CONFLICT', messageKey: 'contentIntelligence.recommendations.errors.versionConflict' });
            }
            return { kind: 'updated' as const, projection: updated };
        });
    }
    catch (error) {
        if (updated) {
            // A database/commit failure after the Mongo CAS is rare but must not
            // strand an unaudited projection. Compensate only if no later writer
            // has advanced the document version; otherwise surface the conflict
            // and preserve the newer projection.
            await ContentAnalysis.findOneAndUpdate({
                _id: doc._id,
                accountId: doc.accountId,
                __v: documentVersion + 1,
                recommendationStates: {
                    $elemMatch: {
                        recommendationId: input.recommendationId,
                        version: nextVersion,
                    },
                },
            }, { $set: { recommendationStates: priorEntries }, $inc: { __v: 1 } }, { runValidators: true });
        }
        throw error;
    }
    if (transactionResult.kind === 'replay') {
        // The account-scoped idempotency row already existed. Reload the
        // projection after the winning transaction committed rather than
        // returning the stale document loaded before the transaction.
        const replayed = await loadOwnedAnalysis(input.accountId, input.analysisId);
        return findState(replayed, input.recommendationId);
    }
    return findState(transactionResult.projection, input.recommendationId);
}
export interface RecommendationApplicationCheck {
    available: boolean;
    hashStatus: 'same' | 'changed' | 'unavailable';
    contentHash: string | null;
    analysisContentHash: string | null;
    noteRequired: boolean;
    freshnessDays: number;
}
/**
 * Read-only apply precheck. It deliberately reuses recent, already-authorized
 * analysis evidence and never invokes ContentSourceProvider.
 */
export async function getRecommendationApplicationCheck(input: {
    accountId: string;
    analysisId: string;
    recommendationId: string;
}, now: Date = new Date()): Promise<RecommendationApplicationCheck> {
    const doc = await loadOwnedAnalysis(input.accountId, input.analysisId);
    assertRecommendation(doc, input.recommendationId);
    const hashes = await readRecentOwnedHash(doc, now);
    if (!hashes) {
        return {
            available: false,
            hashStatus: 'unavailable',
            contentHash: null,
            analysisContentHash: null,
            noteRequired: false,
            freshnessDays: env.CONTENT_ANALYSIS_SNAPSHOT_TTL_DAYS,
        };
    }
    const same = hashes.currentHash === hashes.analysisHash;
    return {
        available: true,
        hashStatus: same ? 'same' : 'changed',
        contentHash: hashes.currentHash,
        analysisContentHash: hashes.analysisHash,
        noteRequired: same,
        freshnessDays: env.CONTENT_ANALYSIS_SNAPSHOT_TTL_DAYS,
    };
}
export interface PublicRecommendationEvent {
    id: string;
    eventKind: ContentRecommendationEventKind;
    priorState: ContentRecommendationState;
    newState: ContentRecommendationState;
    stateVersion: number;
    actorUserId: string;
    note: string | null;
    contentHash: string | null;
    analysisContentHash: string | null;
    hashStatus: 'same' | 'changed' | 'unavailable';
    appliedAt: string | null;
    recordedAt: string;
}
export async function listRecommendationHistory(db: ApplicationDb, input: {
    accountId: string;
    analysisId: string;
    recommendationId: string;
}): Promise<PublicRecommendationEvent[]> {
    const doc = await loadOwnedAnalysis(input.accountId, input.analysisId);
    assertRecommendation(doc, input.recommendationId);
    const rows = await db
        .select()
        .from(contentRecommendationEvents)
        .where(and(eq(contentRecommendationEvents.accountId, input.accountId), eq(contentRecommendationEvents.analysisId, input.analysisId), eq(contentRecommendationEvents.recommendationId, input.recommendationId)))
        .orderBy(asc(contentRecommendationEvents.recordedAt), asc(contentRecommendationEvents.id));
    return rows.map((row) => ({
        id: row.id,
        eventKind: row.eventKind,
        priorState: row.priorState,
        newState: row.newState,
        stateVersion: row.stateVersion,
        actorUserId: row.actorUserId,
        note: row.note,
        contentHash: row.contentHash,
        analysisContentHash: row.analysisContentHash,
        hashStatus: row.contentHash === null || row.analysisContentHash === null
            ? 'unavailable'
            : row.contentHash === row.analysisContentHash
                ? 'same'
                : 'changed',
        appliedAt: row.appliedAt?.toISOString() ?? null,
        recordedAt: row.recordedAt.toISOString(),
    }));
}
export function recommendationStatesForAnalysis(doc: ContentAnalysisHydrated): PublicRecommendationState[] {
    return doc.recommendations.flatMap((value) => {
        const recommendation = recommendationSchema.safeParse(value);
        return recommendation.success ? [findState(doc, recommendation.data.id)] : [];
    });
}
// ---------------------------------------------------------------------------
// Cross-module public API: create ONE Content Intelligence
// recommendation for an accepted keyword-cluster decision.
//
// The keyword-research module never writes an action-event, never adds a new
// action source type, and never opens a second store. It calls this public
// API on the accepted path. The returned recommendation id is:
//   - deterministic — a stable sha256 of (accountId | siteId | runId |
//     clusterId), so two accepted decisions for the same cluster resolve to
//     the same id (exactly-one contract) and callers can look it up without
//     coordinating state,
//   - namespaced — the `keyword-cluster:` prefix keeps the id disjoint from
//     content-analysis recommendation ids (uuid-shaped) so downstream
//     consumers can tell them apart if needed,
//   - self-citing — inputs `runId`, `clusterId`, `memberKeywords`,
//     `suggestedRoute`, and the versioned `aiProfile` fully describe the
//     recommendation; the append-only decision-events row is the
//     authoritative record.
// The shipped Next Actions content adapter continues to surface Content
// Intelligence recommendations exactly as before — no new source type, no
// per-callsite storage.
// ---------------------------------------------------------------------------
export const KEYWORD_CLUSTER_RECOMMENDATION_PREFIX = 'keyword-cluster:';
// ---------------------------------------------------------------------------
// Audience-research → Content Intelligence delegation.
//
// The `content` and `comparison_page` acceptance destinations of an audience
// research signal call this factory. It mirrors the keyword-cluster helper:
// deterministic id derived from (account, site, run, signal, destination) so
// same-input replays are collapsed by the caller's ON-CONFLICT idempotency
// guard. No full-text of the source is copied — the workspace renders
// evidence from the immutable audience-research run/result on read.
// ---------------------------------------------------------------------------
export const AUDIENCE_RESEARCH_RECOMMENDATION_PREFIX = 'audience-research:';
// ---------------------------------------------------------------------------
// Citation-gap seam — citation-gap opportunities accepted into Content
// Intelligence use this recommendationId namespace. The Next Actions content
// adapter surfaces prefix-matched recommendation states as public
// `citation_gap` actions while this module remains their state/history
// authority (no `action_events` double-write). The acceptance path that mints
// these ids lives with the citation-gap feature; the namespace is fixed here
// so both sides agree byte-for-byte.
// ---------------------------------------------------------------------------
export const CITATION_GAP_RECOMMENDATION_PREFIX = 'citation-gap:';
export interface CreateAudienceResearchRecommendationInput {
    accountId: string;
    siteId: string;
    runId: string;
    signalId: string;
    destination: 'content' | 'comparison_page';
    citedSourceIds: readonly string[];
    operationKey: string;
}
export interface AudienceResearchRecommendationResult {
    recommendationId: string;
    deepLinkPath: string;
}
export function createRecommendationForAudienceResearchSignal(input: CreateAudienceResearchRecommendationInput): AudienceResearchRecommendationResult {
    const digest = createHash('sha256')
        .update(input.accountId)
        .update('|')
        .update(input.siteId)
        .update('|')
        .update(input.runId)
        .update('|')
        .update(input.signalId)
        .update('|')
        .update(input.destination)
        .update('|')
        .update(input.operationKey)
        .digest('hex');
    const recommendationId = `${AUDIENCE_RESEARCH_RECOMMENDATION_PREFIX}${digest.slice(0, 32)}`;
    return {
        recommendationId,
        // `content` is the shipped SITE_TABS value for the Content Intelligence
        // panel — `content-intelligence` would normalize to the overview tab.
        deepLinkPath: `/sites/${encodeURIComponent(input.siteId)}?tab=content&recommendation=${encodeURIComponent(recommendationId)}`,
    };
}
export interface CreateKeywordClusterRecommendationInput {
    accountId: string;
    siteId: string;
    runId: string;
    clusterId: string;
    memberKeywords: readonly string[];
    suggestedRoute: 'brief' | 'seo';
    aiProfile: {
        name: string;
        version: string;
    };
}
export interface KeywordClusterRecommendationResult {
    recommendationId: string;
}
export function createRecommendationForKeywordCluster(input: CreateKeywordClusterRecommendationInput): KeywordClusterRecommendationResult {
    const digest = createHash('sha256')
        .update(input.accountId)
        .update('|')
        .update(input.siteId)
        .update('|')
        .update(input.runId)
        .update('|')
        .update(input.clusterId)
        .digest('hex');
    return {
        recommendationId: `${KEYWORD_CLUSTER_RECOMMENDATION_PREFIX}${digest.slice(0, 32)}`,
    };
}
