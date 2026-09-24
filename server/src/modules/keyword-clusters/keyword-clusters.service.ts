import type { SpendPreview } from '../../shared/safety/operation-preview.js';
/**
 * SERP-overlap clustering HTTP lifecycle.
 *
 * Create order: parsed controller input → owner-scoped site (404) → not paused
 * → kill switch → stored-observation readiness → run record → enqueue. Stored
 * list and detail reads never enqueue. This module issues no provider call.
 */
import type { Queue } from 'bullmq';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { enqueueKeywordClusterJob, type KeywordClusterJob, } from '../../shared/queue/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { SerpClusterRun } from './keyword-clusters.model.js';
import { readKeywordClusterReadiness, type KeywordClusterBlockedKeyword, } from './keyword-clusters.readiness.js';
import { KEYWORD_CLUSTER_MAX_BLOCKED_DISCLOSED, KEYWORD_CLUSTER_MIN_READY_KEYWORDS, KEYWORD_CLUSTER_MIN_SHARED_URLS, KEYWORD_CLUSTER_OBSERVATION_FRESHNESS_DAYS, KEYWORD_CLUSTER_RULES_VERSION, KEYWORD_CLUSTER_TOP_URLS, keywordClusterSetSchema, type KeywordCluster, type KeywordClusterAiStatus, type KeywordClusterErrorCategory, type KeywordClusterRunStatus, } from './keyword-clusters.schemas.js';
const NOT_FOUND_KEY = 'keywordClusters.errors.notFound';
const UNAVAILABLE_KEY = 'keywordClusters.errors.productUnavailable';
const NOT_ENOUGH_KEY = 'keywordClusters.errors.notEnoughKeywords';
const QUEUE_FAILED_KEY = 'keywordClusters.errors.queueFailed';
export type KeywordClusterBlockedDto = KeywordClusterBlockedKeyword;
export interface KeywordClusterPreviewDto {
    ready: boolean;
    reason: 'notEnoughKeywords' | null;
    readyCount: number;
    blocked: KeywordClusterBlockedDto[];
    blockedTotal: number;
    minSharedUrls: number;
    topUrlWindow: number;
    freshnessDays: number;
    minKeywords: number;
    spend: SpendPreview | null;
}
export interface KeywordClusterRunErrorDto {
    category: KeywordClusterErrorCategory;
    messageKey: string;
}
export interface KeywordClusterRunSummaryDto {
    id: string;
    siteId: string;
    status: KeywordClusterRunStatus;
    aiStatus: KeywordClusterAiStatus;
    rulesVersion: string;
    minSharedUrls: number;
    topUrlWindow: number;
    keywordCount: number;
    blockedCount: number;
    clusterCount: number;
    groupedClusterCount: number;
    requestedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    error: KeywordClusterRunErrorDto | null;
}
export interface KeywordClusterRunDetailDto extends KeywordClusterRunSummaryDto {
    clusters: KeywordCluster[];
    blocked: KeywordClusterBlockedDto[];
}
/** Read-only evidence returned to downstream features such as content briefs. */
export interface CompletedKeywordClusterMatch {
    runId: string;
    clusterId: string;
    members: Array<{
        keywordId: string;
        phrase: string;
    }>;
}
interface StoredMemberShape {
    keywordId: string;
    phrase: string;
    observedAt: Date;
    isPivot: boolean;
    sharedUrls: string[];
    sharedUrlCount: number;
}
interface StoredClusterShape {
    id: string;
    size: number;
    pivotKeywordId: string;
    sharedUrls: string[];
    members: StoredMemberShape[];
    label?: string | null;
    labelSource?: 'ai' | null;
}
interface StoredRunShape {
    _id: unknown;
    siteId: unknown;
    status: KeywordClusterRunStatus;
    aiStatus: KeywordClusterAiStatus;
    rulesVersion: string;
    minSharedUrls: number;
    topUrlWindow: number;
    keywordCount: number;
    blockedCount: number;
    blocked: Array<Omit<KeywordClusterBlockedDto, 'observedAt'> & {
        observedAt: Date | null;
    }>;
    clusters: StoredClusterShape[];
    requestedAt: Date;
    startedAt?: Date | null;
    completedAt?: Date | null;
    error?: KeywordClusterRunErrorDto | null;
}
function isoOrNull(value: Date | null | undefined): string | null {
    return value ? new Date(value).toISOString() : null;
}
function toClusters(doc: StoredRunShape): KeywordCluster[] {
    return keywordClusterSetSchema.parse(doc.clusters.map((cluster) => ({
        id: cluster.id,
        size: cluster.size,
        pivotKeywordId: cluster.pivotKeywordId,
        sharedUrls: cluster.sharedUrls,
        members: cluster.members.map((member) => ({
            keywordId: member.keywordId,
            phrase: member.phrase,
            observedAt: new Date(member.observedAt).toISOString(),
            isPivot: member.isPivot,
            sharedUrls: member.sharedUrls,
            sharedUrlCount: member.sharedUrlCount,
        })),
        label: cluster.label ?? null,
        labelSource: cluster.labelSource ?? null,
    })));
}
function toSummary(doc: StoredRunShape): KeywordClusterRunSummaryDto {
    return {
        id: String(doc._id),
        siteId: String(doc.siteId),
        status: doc.status,
        aiStatus: doc.aiStatus,
        rulesVersion: doc.rulesVersion,
        minSharedUrls: doc.minSharedUrls,
        topUrlWindow: doc.topUrlWindow,
        keywordCount: doc.keywordCount,
        blockedCount: doc.blockedCount,
        clusterCount: doc.clusters.length,
        groupedClusterCount: doc.clusters.filter((cluster) => cluster.size > 1).length,
        requestedAt: new Date(doc.requestedAt).toISOString(),
        startedAt: isoOrNull(doc.startedAt),
        completedAt: isoOrNull(doc.completedAt),
        error: doc.error
            ? { category: doc.error.category, messageKey: doc.error.messageKey }
            : null,
    };
}
function toDetail(doc: StoredRunShape): KeywordClusterRunDetailDto {
    return {
        ...toSummary(doc),
        clusters: toClusters(doc),
        blocked: doc.blocked.map((row) => ({
            keywordId: row.keywordId,
            phrase: row.phrase,
            reason: row.reason,
            observedAt: isoOrNull(row.observedAt),
        })),
    };
}
function requireEnabled(): void {
    if (!env.KEYWORD_CLUSTERING_ENABLED)
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
}
async function requireOwnedSite(accountId: string, siteId: string) {
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null }).select({
        _id: 1,
        paused: 1,
    });
    if (!site)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return site;
}
export interface KeywordClustersServiceDeps {
    db: Db;
    queue: Queue | null;
    now?: () => Date;
    readReadinessFn?: typeof readKeywordClusterReadiness;
    enqueueFn?: (queue: Queue, payload: KeywordClusterJob) => Promise<unknown>;
}
export interface KeywordClusterRunRequest {
    accountId: string;
    siteId: string;
    keywordIds?: readonly string[];
    locale: string;
}
async function loadReadiness(input: {
    siteId: string;
    keywordIds?: readonly string[];
}, deps: KeywordClustersServiceDeps) {
    const now = (deps.now ?? (() => new Date()))();
    return (deps.readReadinessFn ?? readKeywordClusterReadiness)(deps.db, {
        siteId: input.siteId,
        keywordIds: input.keywordIds,
        now,
    });
}
export async function previewKeywordClusterRun(input: KeywordClusterRunRequest, deps: KeywordClustersServiceDeps): Promise<KeywordClusterPreviewDto> {
    await requireOwnedSite(input.accountId, input.siteId);
    requireEnabled();
    const { ready, blocked } = await loadReadiness(input, deps);
    const base = {
        readyCount: ready.length,
        blocked: blocked.slice(0, KEYWORD_CLUSTER_MAX_BLOCKED_DISCLOSED),
        blockedTotal: blocked.length,
        minSharedUrls: KEYWORD_CLUSTER_MIN_SHARED_URLS,
        topUrlWindow: KEYWORD_CLUSTER_TOP_URLS,
        freshnessDays: KEYWORD_CLUSTER_OBSERVATION_FRESHNESS_DAYS,
        minKeywords: KEYWORD_CLUSTER_MIN_READY_KEYWORDS,
    };
    if (ready.length < KEYWORD_CLUSTER_MIN_READY_KEYWORDS ||
        blocked.length > 0) {
        return {
            ...base,
            ready: false,
            reason: 'notEnoughKeywords',
            spend: null,
        };
    }
    const spend: SpendPreview = { deploymentMode: 'community', capacityEnforced: false };
    return { ...base, ready: true, reason: null, spend };
}
export async function startKeywordClusterRun(input: KeywordClusterRunRequest, deps: KeywordClustersServiceDeps): Promise<KeywordClusterRunDetailDto> {
    const site = await requireOwnedSite(input.accountId, input.siteId);
    assertSiteNotPaused(site);
    requireEnabled();
    if (!deps.queue)
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
    const { ready, blocked } = await loadReadiness(input, deps);
    // Refused BEFORE a run record exists: a site that cannot produce a cluster
    // never queues work.
    if (ready.length < KEYWORD_CLUSTER_MIN_READY_KEYWORDS ||
        blocked.length > 0) {
        throw new HttpError(409, { code: 'NOT_ENOUGH', messageKey: NOT_ENOUGH_KEY });
    }
    const runId = new Types.ObjectId();
    const now = (deps.now ?? (() => new Date()))();
    const created = await SerpClusterRun.create({
        _id: runId,
        accountId: new Types.ObjectId(input.accountId),
        siteId: new Types.ObjectId(input.siteId),
        locale: input.locale,
        status: 'queued',
        aiStatus: 'pending',
        rulesVersion: KEYWORD_CLUSTER_RULES_VERSION,
        minSharedUrls: KEYWORD_CLUSTER_MIN_SHARED_URLS,
        topUrlWindow: KEYWORD_CLUSTER_TOP_URLS,
        keywordCount: ready.length,
        blockedCount: 0,
        keywordIds: ready.map((keyword) => keyword.keywordId),
        inputs: ready.map((keyword) => ({
            keywordId: keyword.keywordId,
            phrase: keyword.phrase,
            observedAt: new Date(keyword.observedAt),
            topUrls: keyword.topUrls.slice(0, KEYWORD_CLUSTER_TOP_URLS),
        })),
        blocked: [],
        clusters: [],
        requestedAt: now,
    });
    try {
        await (deps.enqueueFn ?? enqueueKeywordClusterJob)(deps.queue, {
            accountId: input.accountId,
            siteId: input.siteId,
            runId: String(runId),
        });
    }
    catch {
        // An operational enqueue failure is a failed run — the shipped
        // internal-links contract.
        await SerpClusterRun.updateOne({ _id: runId, accountId: input.accountId }, {
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
export async function listKeywordClusterRuns(input: {
    accountId: string;
    siteId: string;
    limit: number;
}): Promise<{
    items: KeywordClusterRunSummaryDto[];
}> {
    await requireOwnedSite(input.accountId, input.siteId);
    const docs = await SerpClusterRun.find({
        accountId: input.accountId,
        siteId: input.siteId,
    })
        .sort({ requestedAt: -1, _id: -1 })
        .limit(input.limit)
        .lean();
    return { items: (docs as unknown as StoredRunShape[]).map(toSummary) };
}
export async function getKeywordClusterRun(input: {
    accountId: string;
    runId: string;
}): Promise<KeywordClusterRunDetailDto> {
    const doc = await SerpClusterRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
    }).lean();
    if (!doc)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return toDetail(doc as unknown as StoredRunShape);
}
export async function resolveOwnedKeywordClusterRunSiteId(accountId: string, runId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(runId))
        return null;
    const run = await SerpClusterRun.findOne({ _id: runId, accountId }, { siteId: 1 }).lean();
    return run ? String(run.siteId) : null;
}
function escapeRegexLiteral(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function normalizeClusterPhrase(value: string): string {
    return value.trim().toLocaleLowerCase('en');
}
/**
 * Finds the newest completed cluster containing the tracked keyword.
 *
 * Both account and site are mandatory boundaries. Keyword id is authoritative;
 * normalized phrase matching is retained only for old runs whose tracked-keyword
 * id was replaced. This is a stored read: it never clusters, meters, or calls a
 * provider.
 */
export async function findLatestCompletedKeywordCluster(input: {
    accountId: string;
    siteId: string;
    keywordId: string;
    phrase: string;
}): Promise<CompletedKeywordClusterMatch | null> {
    if (!Types.ObjectId.isValid(input.accountId) ||
        !Types.ObjectId.isValid(input.siteId)) {
        return null;
    }
    const normalizedPhrase = normalizeClusterPhrase(input.phrase);
    if (!normalizedPhrase)
        return null;
    const doc = await SerpClusterRun.findOne({
        accountId: input.accountId,
        siteId: input.siteId,
        status: 'completed',
        $or: [
            { 'clusters.members.keywordId': input.keywordId },
            {
                'clusters.members.phrase': {
                    $regex: `^${escapeRegexLiteral(input.phrase.trim())}$`,
                    $options: 'i',
                },
            },
        ],
    })
        .sort({ completedAt: -1, requestedAt: -1, _id: -1 })
        .lean();
    if (!doc)
        return null;
    const clusterByKeywordId = doc.clusters.find((candidate) => candidate.members.some((member) => member.keywordId === input.keywordId));
    const cluster = clusterByKeywordId ??
        doc.clusters.find((candidate) => candidate.members.some((member) => normalizeClusterPhrase(member.phrase) === normalizedPhrase));
    if (!cluster)
        return null;
    return {
        runId: String(doc._id),
        clusterId: cluster.id,
        members: cluster.members.map((member) => ({
            keywordId: member.keywordId,
            phrase: member.phrase,
        })),
    };
}
