/**
 * Cited AI clustering pipeline.
 *
 * Contract:
 *   - Deterministic run identity from account + market + sorted normalized
 *     phrases; identical rerun returns the stored run as a free read.
 *   - Every input phrase MUST resolve to a stored row in `vendor_cache`
 *     (capability='keyword', operation in metrics/overview/related/ideas) OR
 *     the account's `keyword_research_history`. Unresolved phrases → 422.
 *   - Exactly ONE structured AI call (`keyword_clustering` profile). The
 *     15_000-micro `ai_summaries` envelope is enforced pre-dispatch by the
 *     profile's `maxCostMicros` bound — the AI runtime refuses any pass
 *     whose pre-estimated cost exceeds it.
 *   - AI output is zod-validated. Cluster members whose `memberId` does not
 *     match a resolved keyword id are stripped. Clusters that become empty
 *     are dropped. A validated result with zero surviving clusters persists
 *     as an evidence-only completed run.
 *   - Deterministic post-pass: cluster order = summed member searchVolume
 *     desc, then label asc. Confidence from the rule table (member_count ×
 *     intent_homogeneity).
 *   - Immutable Mongo persistence (`KeywordClusterRun`).
 */
import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import mongoose from 'mongoose';
import type { Db } from '../../db/client.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import { AiInvalidInputError, type AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
import { keywordResearchHistory } from '../../db/schema/keyword-research-history.js';
import { vendorCache } from '../../db/schema/vendor-cache.js';
import { normalizeCachePhrase, computeKeywordCacheKey } from './keyword-research.cache.js';
import { KeywordClusterRun, type KeywordClusterRunDocument, } from './keyword-cluster-runs.model.js';
const AI_PROFILE_NAME = 'keyword_clustering' as const;
const AI_PROFILE_VERSION = '1.0.0';
const AI_KEYWORD_ID_PREFIX = 'kw-';
const CACHE_OPS_FOR_RESOLUTION = ['metrics', 'overview', 'related', 'ideas'] as const;
export interface ClusterRunMemberRef {
    keyword: string;
    source: 'vendor_cache' | 'history';
    observedAt: Date;
}
export interface ClusterResult {
    clusterId: string;
    label: string;
    memberKeywords: string[];
    suggestedRoute: 'brief' | 'seo';
    confidence: 'low' | 'medium' | 'high';
    summedSearchVolume: number;
}
export interface ClusterRunSummary {
    runId: string;
    accountId: string;
    market: {
        locationCode: number;
        languageCode: string;
    };
    memberRefs: ClusterRunMemberRef[];
    clusters: ClusterResult[];
    aiProfile: {
        name: string;
        version: string;
    };
    costMicros: number;
    createdAt: Date;
    cached: boolean;
}
export interface ResolvedMember {
    keyword: string;
    source: 'vendor_cache' | 'history';
    observedAt: Date;
    searchVolume: number | null;
    intent: 'informational' | 'commercial' | 'transactional' | 'navigational' | null;
}
export interface RunClusteringInput {
    accountId: string;
    locationCode: number;
    languageCode: string;
    phrases: string[];
    locale: string;
    correlationId?: string;
}
export interface RunClusteringDeps {
    db: Db;
    aiRunner: AiProfileRunner;
    providerOrder: readonly AiGenerationProviderKey[];
    now?: () => Date;
}
/**
 * Case-fold + trim + collapse-whitespace + dedupe + sort lexicographically.
 * Empty-after-normalize inputs are silently dropped BEFORE range checks
 * so the caller can validate against real phrase counts.
 */
export function sortedNormalizedPhrases(phrases: readonly string[]): string[] {
    const set = new Set<string>();
    for (const raw of phrases) {
        const normalized = normalizeCachePhrase(raw);
        if (normalized.length > 0)
            set.add(normalized);
    }
    return Array.from(set).sort();
}
/**
 * Deterministic run identity sha256 over the exact tuple
 * so an identical rerun collapses to a free read; different market or
 * different phrase set yields a different run.
 */
export function computeClusterRunId(input: {
    accountId: string;
    locationCode: number;
    languageCode: string;
    phrases: readonly string[];
}): string {
    const sorted = sortedNormalizedPhrases(input.phrases);
    const material = [
        input.accountId,
        String(input.locationCode),
        input.languageCode.toLowerCase(),
        sorted.join('|'),
    ].join('|');
    return createHash('sha256').update(material).digest('hex');
}
/**
 * Resolve each input phrase against stored data (vendor cache OR history).
 * Cross-user vendor_cache is intentional — vendor rows are shared across
 * accounts by design (see `.claude/rules/drizzle-postgres-scope.md`
 * vendor_cache commentary). Metrics/overview/related/ideas rows all count.
 * History resolution is scoped to the account.
 */
export async function resolvePhrasesToStoredRows(db: Db, input: {
    accountId: string;
    locationCode: number;
    languageCode: string;
    phrases: readonly string[];
}, now: Date): Promise<{
    resolved: Map<string, ResolvedMember>;
    unresolved: string[];
}> {
    const normalized = sortedNormalizedPhrases(input.phrases);
    const resolved = new Map<string, ResolvedMember>();
    if (normalized.length === 0) {
        return { resolved, unresolved: [] };
    }
    // 1. Batch cache probe. Cache key is per (phrase, loc, lang); operation
    // narrows to metrics/overview/related/ideas rows so gap-only or trends-only
    // hits do not spuriously satisfy resolution.
    const keyByPhrase = new Map<string, string>();
    for (const phrase of normalized) {
        keyByPhrase.set(phrase, computeKeywordCacheKey({
            phrase,
            locationCode: input.locationCode,
            languageCode: input.languageCode,
        }));
    }
    // At this point `normalized.length > 0` (checked above) so keyByPhrase
    // (and therefore allKeys) is non-empty — the cache probe always runs.
    const allKeys = Array.from(new Set(keyByPhrase.values()));
    const rows = await db
        .select({
        operation: vendorCache.operation,
        cacheKey: vendorCache.cacheKey,
        payload: vendorCache.payload,
        fetchedAt: vendorCache.fetchedAt,
        expiresAt: vendorCache.expiresAt,
    })
        .from(vendorCache)
        .where(and(eq(vendorCache.capability, 'keyword'), inArray(vendorCache.operation, CACHE_OPS_FOR_RESOLUTION as unknown as string[]), inArray(vendorCache.cacheKey, allKeys)));
    // Best row per phrase — prefer non-expired rows and pick highest signal.
    const keyToBest = new Map<string, typeof rows[number]>();
    for (const row of rows) {
        const existing = keyToBest.get(row.cacheKey);
        if (!existing) {
            keyToBest.set(row.cacheKey, row);
            continue;
        }
        // Prefer non-expired over expired; if tied, most recent fetchedAt.
        const rowActive = row.expiresAt > now;
        const existingActive = existing.expiresAt > now;
        const preferRow = (rowActive && !existingActive)
            || (rowActive === existingActive && row.fetchedAt > existing.fetchedAt);
        if (preferRow)
            keyToBest.set(row.cacheKey, row);
    }
    for (const phrase of normalized) {
        const key = keyByPhrase.get(phrase)!;
        const best = keyToBest.get(key);
        if (!best)
            continue;
        // vendor_cache.payload is a jsonb NOT NULL column (see
        // db/schema/vendor-cache.ts) — always an object at read time.
        const payload = best.payload as Record<string, unknown>;
        const rawVolume = payload.searchVolume;
        const searchVolume = typeof rawVolume === 'number' ? rawVolume : null;
        const intent = normalizeIntent(payload.intent);
        resolved.set(phrase, {
            keyword: phrase,
            source: 'vendor_cache',
            observedAt: best.fetchedAt,
            searchVolume,
            intent,
        });
    }
    // 2. Fill remaining from history (account-scoped).
    const missing = normalized.filter((phrase) => !resolved.has(phrase));
    if (missing.length > 0) {
        const historyRows = await db
            .select({
            phrases: keywordResearchHistory.phrases,
            createdAt: keywordResearchHistory.createdAt,
        })
            .from(keywordResearchHistory)
            .where(eq(keywordResearchHistory.accountId, input.accountId))
            .orderBy(desc(keywordResearchHistory.createdAt))
            .limit(500);
        const phraseFirstSeen = new Map<string, Date>();
        for (const row of historyRows) {
            // history.phrases is a NOT NULL jsonb string[] column — see
            // db/schema/keyword-research-history.ts.
            const phrases = row.phrases as string[];
            for (const raw of phrases) {
                const phrase = normalizeCachePhrase(raw);
                if (!phrase || !missing.includes(phrase))
                    continue;
                const prior = phraseFirstSeen.get(phrase);
                if (!prior || row.createdAt > prior)
                    phraseFirstSeen.set(phrase, row.createdAt);
            }
        }
        for (const phrase of missing) {
            const seen = phraseFirstSeen.get(phrase);
            if (!seen)
                continue;
            resolved.set(phrase, {
                keyword: phrase,
                source: 'history',
                observedAt: seen,
                searchVolume: null,
                intent: null,
            });
        }
    }
    const unresolved = normalized.filter((phrase) => !resolved.has(phrase));
    return { resolved, unresolved };
}
function normalizeIntent(value: unknown): ResolvedMember['intent'] {
    if (value === 'informational' ||
        value === 'commercial' ||
        value === 'transactional' ||
        value === 'navigational')
        return value;
    return null;
}
/**
 * Deterministic confidence rule table.
 * intent_homogeneity is provided by the AI (0..1) but re-clamped here — a
 * caller cannot break the mapping by supplying an out-of-range value.
 */
export function confidenceFor(memberCount: number, intentHomogeneity: number): 'low' | 'medium' | 'high' {
    const clamped = Math.max(0, Math.min(1, intentHomogeneity));
    if (memberCount >= 8 && clamped >= 0.8)
        return 'high';
    if (memberCount >= 8)
        return 'medium';
    if (memberCount >= 4 && clamped >= 0.8)
        return 'medium';
    if (memberCount >= 4)
        return 'low';
    return 'low';
}
function keywordIdFor(phrase: string): string {
    // The AI runner validates citations against source ids in the input, so
    // ids must be stable + canonical-form-friendly. sha256 → 24-char prefix
    // keeps the id under the 128-char citation cap and passes the citation
    // canonicalization regex `[a-z0-9][a-z0-9_-]{0,127}`.
    const digest = createHash('sha256').update(phrase).digest('hex');
    return `${AI_KEYWORD_ID_PREFIX}${digest.slice(0, 24)}`;
}
/**
 * Load an existing run by (account, runId). Returns null if the account
 * does not own that run — cross-account access is a 404 at the router.
 */
export async function findClusterRunForAccount(accountId: string, runId: string): Promise<ClusterRunSummary | null> {
    const doc = await KeywordClusterRun.findOne({ runId, accountId }).lean<KeywordClusterRunDocument | null>().exec();
    if (!doc)
        return null;
    return docToSummary(doc, true);
}
/**
 * Read-only downstream seam for content briefs. Returns the newest stored
 * cluster in the exact account + market that contains the normalized target
 * phrase. It never runs clustering and never calls a provider.
 */
export async function findLatestClusterForPhrase(accountId: string, market: {
    locationCode: number;
    languageCode: string;
}, phrase: string): Promise<ClusterResult | null> {
    const normalized = normalizeCachePhrase(phrase);
    if (!normalized)
        return null;
    const doc = await KeywordClusterRun.findOne({
        accountId,
        'market.locationCode': market.locationCode,
        'market.languageCode': market.languageCode.toLowerCase(),
        'clusters.memberKeywords': normalized,
    })
        .sort({ createdAt: -1, _id: -1 })
        .lean<KeywordClusterRunDocument | null>()
        .exec();
    if (!doc)
        return null;
    const cluster = doc.clusters.find((candidate) => candidate.memberKeywords.some((member) => normalizeCachePhrase(member) === normalized));
    return cluster
        ? {
            clusterId: cluster.clusterId,
            label: cluster.label,
            memberKeywords: [...cluster.memberKeywords],
            suggestedRoute: cluster.suggestedRoute,
            confidence: cluster.confidence,
            summedSearchVolume: cluster.summedSearchVolume,
        }
        : null;
}
export async function listClusterRunsForAccount(accountId: string, options: {
    limit: number;
    cursor?: {
        createdAt: Date;
        id: string;
    } | null;
}): Promise<{
    runs: ClusterRunSummary[];
    nextCursor: {
        createdAt: string;
        id: string;
    } | null;
}> {
    const query: Record<string, unknown> = { accountId };
    if (options.cursor) {
        // Keyset pagination: (createdAt DESC, _id DESC).
        query.$or = [
            { createdAt: { $lt: options.cursor.createdAt } },
            { createdAt: options.cursor.createdAt, _id: { $lt: new mongoose.Types.ObjectId(options.cursor.id) } },
        ];
    }
    const docs = await KeywordClusterRun
        .find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(options.limit + 1)
        .lean<Array<KeywordClusterRunDocument & {
        _id: unknown;
    }>>()
        .exec();
    const trimmed = docs.slice(0, options.limit);
    const runs = trimmed.map((d) => docToSummary(d, true));
    const nextCursor = docs.length > options.limit
        ? {
            createdAt: trimmed[trimmed.length - 1]!.createdAt.toISOString(),
            id: String((trimmed[trimmed.length - 1] as {
                _id: unknown;
            })._id),
        }
        : null;
    return { runs, nextCursor };
}
function docToSummary(doc: KeywordClusterRunDocument, cached: boolean): ClusterRunSummary {
    return {
        runId: doc.runId,
        accountId: doc.accountId,
        market: {
            locationCode: doc.market.locationCode,
            languageCode: doc.market.languageCode,
        },
        memberRefs: doc.memberRefs.map((ref) => ({
            keyword: ref.keyword,
            source: ref.source,
            observedAt: ref.observedAt,
        })),
        clusters: doc.clusters.map((c) => ({
            clusterId: c.clusterId,
            label: c.label,
            memberKeywords: c.memberKeywords,
            suggestedRoute: c.suggestedRoute,
            confidence: c.confidence,
            summedSearchVolume: c.summedSearchVolume,
        })),
        aiProfile: { name: doc.aiProfile.name, version: doc.aiProfile.version },
        costMicros: doc.costMicros,
        createdAt: doc.createdAt,
        cached,
    };
}
/**
 * Main clustering pipeline. Caller MUST short-circuit to
 * `findClusterRunForAccount` first (identity determinism).
 */
export async function runClustering(input: RunClusteringInput, deps: RunClusteringDeps): Promise<ClusterRunSummary> {
    const now = deps.now ?? (() => new Date());
    const runId = computeClusterRunId(input);
    // Resolve phrases to stored rows.
    const normalized = sortedNormalizedPhrases(input.phrases);
    const { resolved, unresolved } = await resolvePhrasesToStoredRows(deps.db, {
        accountId: input.accountId,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
        phrases: normalized,
    }, now());
    if (unresolved.length > 0 || resolved.size === 0) {
        // 422 covers BOTH: any un-resolvable phrases AND the degenerate case
        // where the input is empty after normalization (router zod already
        // rejects wire-empty phrase arrays; this guards direct-service callers).
        throw new HttpError(422, { code: 'KEYWORD_RESEARCH_ERRORS_UNRESOLVED_PHRASES', messageKey: 'keywordResearch.errors.unresolvedPhrases' }, {
            unresolvedPhrases: unresolved,
        });
    }
    const idToMember = new Map<string, ResolvedMember>();
    for (const member of resolved.values()) {
        idToMember.set(keywordIdFor(member.keyword), member);
    }
    const aiInput = {
        market: {
            locationCode: input.locationCode,
            languageCode: input.languageCode.toLowerCase(),
        },
        keywords: Array.from(idToMember.entries()).map(([id, member]) => ({
            id,
            phrase: member.keyword,
            searchVolume: member.searchVolume,
            intent: member.intent,
        })),
    };
    let generation;
    try {
        generation = await deps.aiRunner.run<{
            clusters: Array<{
                label: string;
                memberIds: string[];
                suggestedRoute: 'brief' | 'seo';
                intentHomogeneity: number;
            }>;
            citations: string[];
        }>({
            profile: AI_PROFILE_NAME,
            input: aiInput,
            locale: input.locale,
            correlationId: input.correlationId ?? `kw-cluster-${randomUUID()}`,
            usage: { accountId: input.accountId },
            configuredProviderOrder: deps.providerOrder,
        });
    }
    catch (error) {
        if (error instanceof AiInvalidInputError) {
            throw new HttpError(422, { code: 'KEYWORD_RESEARCH_ERRORS_UNRESOLVED_PHRASES', messageKey: 'keywordResearch.errors.unresolvedPhrases' }, {
                unresolvedPhrases: [],
            });
        }
        throw new HttpError(503, { code: 'KEYWORD_RESEARCH_ERRORS_UPSTREAM_UNAVAILABLE', messageKey: 'keywordResearch.errors.upstreamUnavailable' }, undefined, { cause: error });
    }
    // Citation stripping: cluster members that do not cite a resolved input id
    // are removed; clusters that become empty are dropped.
    const surviving: ClusterResult[] = [];
    const seenLabels = new Set<string>();
    for (const cluster of generation.object.clusters) {
        const uniqueMemberIds = Array.from(new Set(cluster.memberIds));
        const members = uniqueMemberIds
            .map((id) => idToMember.get(id))
            .filter((member): member is ResolvedMember => Boolean(member));
        if (members.length === 0)
            continue;
        const label = cluster.label.trim().slice(0, 120);
        if (label.length === 0)
            continue;
        if (seenLabels.has(label))
            continue;
        seenLabels.add(label);
        const summedSearchVolume = members.reduce((sum, m) => sum + (typeof m.searchVolume === 'number' ? m.searchVolume : 0), 0);
        const confidence = confidenceFor(members.length, cluster.intentHomogeneity);
        const clusterId = createHash('sha256').update(`${runId}|${label}`).digest('hex').slice(0, 32);
        surviving.push({
            clusterId,
            label,
            memberKeywords: members.map((m) => m.keyword),
            suggestedRoute: cluster.suggestedRoute,
            confidence,
            summedSearchVolume,
        });
    }
    // Deterministic order: summed searchVolume desc, then label asc.
    surviving.sort((a, b) => {
        if (b.summedSearchVolume !== a.summedSearchVolume)
            return b.summedSearchVolume - a.summedSearchVolume;
        return a.label.localeCompare(b.label);
    });
    const memberRefs: ClusterRunMemberRef[] = Array.from(resolved.values()).map((m) => ({
        keyword: m.keyword,
        source: m.source,
        observedAt: m.observedAt,
    }));
    const costMicros = Number(generation.provenance.actualOrEstimatedCostMicros);
    const createdAt = now();
    // Persist an immutable document. Racing duplicate inserts (same runId) are
    // caught by the unique index — the loser reads the winner via findOne.
    try {
        await KeywordClusterRun.create({
            runId,
            accountId: input.accountId,
            market: {
                locationCode: input.locationCode,
                languageCode: input.languageCode.toLowerCase(),
            },
            memberRefs,
            clusters: surviving,
            aiProfile: { name: AI_PROFILE_NAME, version: AI_PROFILE_VERSION },
            costMicros: Math.max(0, costMicros),
            createdAt,
        });
    }
    catch (error) {
        // A concurrent insert with the same runId (e.g. two identical requests
        // racing past the identity short-circuit) collides on the unique
        // `runId` index — surface the stored winner as the cached read.
        const existing = await findClusterRunForAccount(input.accountId, runId);
        if (existing)
            return existing;
        throw error;
    }
    return {
        runId,
        accountId: input.accountId,
        market: {
            locationCode: input.locationCode,
            languageCode: input.languageCode.toLowerCase(),
        },
        memberRefs,
        clusters: surviving,
        aiProfile: { name: AI_PROFILE_NAME, version: AI_PROFILE_VERSION },
        costMicros: Math.max(0, costMicros),
        createdAt,
        cached: false,
    };
}
