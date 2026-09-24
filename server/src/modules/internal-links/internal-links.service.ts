import type { SpendPreview } from '../../shared/safety/operation-preview.js';
/**
 * Internal-link suggestion HTTP lifecycle.
 *
 * Create order: parsed controller input → owner-scoped site → flag → completed
 * inventory freshness → stored GSC snapshot pin → run record → enqueue.
 * Stored list/detail/CSV reads never enqueue.
 */
import type { Queue } from 'bullmq';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { enqueueInternalLinkJob, type InternalLinkJob, } from '../../shared/queue/index.js';
import { toCsv } from '../../shared/utils/csv.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { loadCompletedInventorySnapshot, loadGscQueryPageEvidence, type CompletedInventorySnapshot, } from '../content-intelligence/index.js';
import { Site } from '../sites/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { InternalLinkRun } from './internal-links.model.js';
import { INTERNAL_LINK_CANDIDATE_RULES_VERSION, INTERNAL_LINK_INVENTORY_FRESHNESS_DAYS, internalLinkSuggestionSetSchema, type InternalLinkAiStatus, type InternalLinkErrorCategory, type InternalLinkRunStatus, type InternalLinkSuggestion, } from './internal-links.schemas.js';
const NOT_FOUND_KEY = 'internalLinks.errors.notFound';
const UNAVAILABLE_KEY = 'internalLinks.errors.productUnavailable';
const INVENTORY_MISSING_KEY = 'internalLinks.errors.inventoryMissing';
const INVENTORY_STALE_KEY = 'internalLinks.errors.inventoryStale';
const QUEUE_FAILED_KEY = 'internalLinks.errors.queueFailed';
export type InternalLinkInventoryReadiness = 'ready' | 'missing' | 'stale';
export interface InternalLinkPreviewDto {
    ready: boolean;
    reason: Exclude<InternalLinkInventoryReadiness, 'ready'> | null;
    inventoryDate: string | null;
    freshnessDays: number;
    spend: SpendPreview | null;
}
export interface InternalLinkRunErrorDto {
    category: InternalLinkErrorCategory;
    messageKey: string;
}
export interface InternalLinkRunSummaryDto {
    id: string;
    siteId: string;
    status: InternalLinkRunStatus;
    aiStatus: InternalLinkAiStatus;
    inventoryDate: string;
    gscSnapshotDate: string | null;
    candidateRulesVersion: string;
    suggestionCount: number;
    requestedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    error: InternalLinkRunErrorDto | null;
}
export interface InternalLinkRunDetailDto extends InternalLinkRunSummaryDto {
    suggestions: InternalLinkSuggestion[];
}
interface StoredRunShape {
    _id: unknown;
    siteId: unknown;
    status: InternalLinkRunStatus;
    aiStatus: InternalLinkAiStatus;
    inventoryDate: Date;
    gscSnapshotDate?: string | null;
    candidateRulesVersion: string;
    suggestions: Array<Omit<InternalLinkSuggestion, 'inventoryDate'> & {
        inventoryDate: Date;
    }>;
    requestedAt: Date;
    startedAt?: Date | null;
    completedAt?: Date | null;
    error?: InternalLinkRunErrorDto | null;
}
function isoOrNull(value: Date | null | undefined): string | null {
    return value ? new Date(value).toISOString() : null;
}
function toSummary(doc: StoredRunShape): InternalLinkRunSummaryDto {
    return {
        id: String(doc._id),
        siteId: String(doc.siteId),
        status: doc.status,
        aiStatus: doc.aiStatus,
        inventoryDate: new Date(doc.inventoryDate).toISOString(),
        gscSnapshotDate: doc.gscSnapshotDate ?? null,
        candidateRulesVersion: doc.candidateRulesVersion,
        suggestionCount: doc.suggestions.length,
        requestedAt: new Date(doc.requestedAt).toISOString(),
        startedAt: isoOrNull(doc.startedAt),
        completedAt: isoOrNull(doc.completedAt),
        error: doc.error
            ? { category: doc.error.category, messageKey: doc.error.messageKey }
            : null,
    };
}
function toDetail(doc: StoredRunShape): InternalLinkRunDetailDto {
    const suggestions = internalLinkSuggestionSetSchema.parse(doc.suggestions.map((suggestion) => ({
        ...suggestion,
        inventoryDate: new Date(suggestion.inventoryDate).toISOString(),
    })));
    return { ...toSummary(doc), suggestions };
}
function requireEnabled(): void {
    if (!env.INTERNAL_LINKING_ENABLED)
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
}
async function requireOwnedSite(accountId: string, siteId: string) {
    const site = await Site.findOne({
        _id: siteId,
        accountId,
        deletionStartedAt: null,
    }).select({ _id: 1, paused: 1 });
    if (!site)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return site;
}
export function inventoryReadiness(snapshot: CompletedInventorySnapshot | null, now: Date): InternalLinkInventoryReadiness {
    if (!snapshot)
        return 'missing';
    const age = now.getTime() - snapshot.completedAt.getTime();
    const maximum = INTERNAL_LINK_INVENTORY_FRESHNESS_DAYS * 86400000;
    return age < 0 || age > maximum ? 'stale' : 'ready';
}
export interface InternalLinksServiceDeps {
    db: ApplicationDb;
    queue: Queue | null;
    now?: () => Date;
    loadSnapshotFn?: typeof loadCompletedInventorySnapshot;
    loadGscFn?: typeof loadGscQueryPageEvidence;
    enqueueFn?: (queue: Queue, payload: InternalLinkJob) => Promise<unknown>;
}
async function readSnapshot(accountId: string, siteId: string, deps: InternalLinksServiceDeps): Promise<{
    snapshot: CompletedInventorySnapshot | null;
    readiness: InternalLinkInventoryReadiness;
}> {
    const snapshot = await (deps.loadSnapshotFn ?? loadCompletedInventorySnapshot)({
        accountId,
        siteId,
    });
    return {
        snapshot,
        readiness: inventoryReadiness(snapshot, (deps.now ?? (() => new Date()))()),
    };
}
export async function previewInternalLinkRun(input: {
    accountId: string;
    siteId: string;
}, deps: InternalLinksServiceDeps): Promise<InternalLinkPreviewDto> {
    await requireOwnedSite(input.accountId, input.siteId);
    requireEnabled();
    const { snapshot, readiness } = await readSnapshot(input.accountId, input.siteId, deps);
    const inventoryDate = snapshot?.completedAt.toISOString() ?? null;
    if (readiness !== 'ready') {
        return {
            ready: false,
            reason: readiness,
            inventoryDate,
            freshnessDays: INTERNAL_LINK_INVENTORY_FRESHNESS_DAYS,
            spend: null,
        };
    }
    return {
        ready: true,
        reason: null,
        inventoryDate,
        freshnessDays: INTERNAL_LINK_INVENTORY_FRESHNESS_DAYS,
        spend: { deploymentMode: 'community', capacityEnforced: false },
    };
}
export async function startInternalLinkRun(input: {
    accountId: string;
    siteId: string;
    locale: string;
}, deps: InternalLinksServiceDeps): Promise<InternalLinkRunDetailDto> {
    const site = await requireOwnedSite(input.accountId, input.siteId);
    assertSiteNotPaused(site);
    requireEnabled();
    if (!deps.queue)
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
    const { snapshot, readiness } = await readSnapshot(input.accountId, input.siteId, deps);
    if (readiness === 'missing' || !snapshot) {
        throw new HttpError(409, { code: 'INVENTORY_MISSING', messageKey: INVENTORY_MISSING_KEY });
    }
    if (readiness === 'stale')
        throw new HttpError(409, { code: 'INVENTORY_STALE', messageKey: INVENTORY_STALE_KEY });
    const gsc = await (deps.loadGscFn ?? loadGscQueryPageEvidence)(deps.db, {
        siteId: input.siteId,
    });
    const runId = new Types.ObjectId();
    const now = (deps.now ?? (() => new Date()))();
    const created = await InternalLinkRun.create({
        _id: runId,
        accountId: new Types.ObjectId(input.accountId),
        siteId: new Types.ObjectId(input.siteId),
        inventoryRunId: new Types.ObjectId(snapshot.runId),
        inventoryDate: snapshot.completedAt,
        gscSnapshotDate: gsc.snapshotDate,
        candidateRulesVersion: INTERNAL_LINK_CANDIDATE_RULES_VERSION,
        locale: input.locale,
        status: 'queued',
        aiStatus: 'pending',
        suggestions: [],
        requestedAt: now,
    });
    try {
        await (deps.enqueueFn ?? enqueueInternalLinkJob)(deps.queue, {
            accountId: input.accountId,
            siteId: input.siteId,
            runId: String(runId),
        });
    }
    catch {
        await InternalLinkRun.updateOne({ _id: runId, accountId: input.accountId }, {
            $set: {
                status: 'failed',
                completedAt: (deps.now ?? (() => new Date()))(),
                error: { category: 'queue_failed', messageKey: QUEUE_FAILED_KEY },
            },
        });
        throw new HttpError(503, { code: 'QUEUE_FAILED', messageKey: QUEUE_FAILED_KEY });
    }
    return toDetail(created.toObject() as unknown as StoredRunShape);
}
export async function listInternalLinkRuns(input: {
    accountId: string;
    siteId: string;
    limit: number;
}): Promise<{
    items: InternalLinkRunSummaryDto[];
}> {
    await requireOwnedSite(input.accountId, input.siteId);
    const docs = await InternalLinkRun.find({
        accountId: input.accountId,
        siteId: input.siteId,
    })
        .sort({ requestedAt: -1, _id: -1 })
        .limit(input.limit)
        .lean();
    return { items: (docs as unknown as StoredRunShape[]).map(toSummary) };
}
export async function getInternalLinkRun(input: {
    accountId: string;
    runId: string;
}): Promise<InternalLinkRunDetailDto> {
    const doc = await InternalLinkRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
    }).lean();
    if (!doc)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return toDetail(doc as unknown as StoredRunShape);
}
export async function resolveOwnedInternalLinkRunSiteId(accountId: string, runId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(runId))
        return null;
    const run = await InternalLinkRun.findOne({ _id: runId, accountId }, { siteId: 1 }).lean();
    return run ? String(run.siteId) : null;
}
export function internalLinkRunCsv(run: InternalLinkRunDetailDto): string {
    const rows = run.suggestions.map((suggestion) => ({
        sourceUrl: suggestion.sourceUrl,
        targetUrl: suggestion.targetUrl,
        anchorText: suggestion.anchorText,
        targetFlag: suggestion.targetFlag,
        inboundCount: suggestion.targetInboundCount,
        confidence: suggestion.confidence,
        sharedQueries: suggestion.sharedQueries.join(' | '),
        headingMatches: suggestion.headingMatches.join(' | '),
        inventoryDate: suggestion.inventoryDate,
        rank: suggestion.rank ?? '',
    }));
    return toCsv(rows, [
        { key: 'sourceUrl', header: 'source_url' },
        { key: 'targetUrl', header: 'target_url' },
        { key: 'anchorText', header: 'anchor_text' },
        { key: 'targetFlag', header: 'target_flag' },
        { key: 'inboundCount', header: 'inbound_count' },
        { key: 'confidence', header: 'confidence' },
        { key: 'sharedQueries', header: 'shared_queries' },
        { key: 'headingMatches', header: 'heading_matches' },
        { key: 'inventoryDate', header: 'inventory_date' },
        { key: 'rank', header: 'rank' },
    ]);
}
