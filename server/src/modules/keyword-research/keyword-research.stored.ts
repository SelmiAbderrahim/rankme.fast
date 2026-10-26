/**
 * Zero-spend reads of research the account has already run.
 *
 * `listStoredKeywordCandidates` lists every phrase the account stored for one
 * market (the seeds it searched plus the related / ideas / long-tail rows cached
 * under them); it feeds the cluster picker and the clustering resolver.
 *
 * `readStoredResearchResult` re-opens ONE history row from the shared
 * cross-user `vendor_cache` by the SAME cache keys the lookups wrote. It is
 * strictly read-only: it never calls a provider and never writes a history
 * row. An expired or evicted entry is reported as `expired`/`partial`; the
 * caller then offers an explicit "Search again".
 *
 * The history row is the access gate: `vendor_cache` is account-agnostic, so a
 * phrase is only readable here when THIS account's history proves it ran the
 * lookup. Another account's row reads as unknown (404 at the controller).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keywordResearchHistory, type KeywordResearchHistoryRow, type KeywordResearchKind, } from '../../db/schema/keyword-research-history.js';
import type { SearchIntent } from '../../shared/providers/index.js';
import { computeKeywordCacheKey, createKeywordCacheRepo, expansionMapKey, normalizeCachePhrase, type CachedExpansionRow, type ExpansionOperation, } from './keyword-research.cache.js';
import { cachedRelatedToPayload, type RelatedKeywordPayload } from './keyword-research.service.js';
/** Matches the request schemas' phrase ceiling — longer phrases can never be re-submitted. */
export const STORED_PHRASE_MAX_LENGTH = 80;
/** Most recent history rows scanned when assembling the candidate set. */
export const STORED_HISTORY_SCAN_LIMIT = 500;
export type StoredResearchStatus = 'available' | 'partial' | 'expired' | 'unsupported';
export interface StoredKeywordRow {
    keyword: string;
    searchVolume: number | null;
    difficulty: number | null;
    cpc: string | null;
    monthlySearches: Array<{
        year: number;
        month: number;
        searchVolume: number;
    }>;
    /** null = no stored classification for the phrase (render no badge). */
    intent: SearchIntent | null;
    confidence: number | null;
    /** Always true: every stored read is served from the cache. */
    cached: true;
    fetchedAt: string;
    expiresAt: string;
}
export interface StoredResearchResult {
    id: string;
    kind: KeywordResearchKind;
    lookupId: string | null;
    phrases: string[];
    locationCode: number;
    languageCode: string;
    /**
     * available   every requested phrase / the seed expansion is still stored
     * partial     some, not all, of the requested phrases are stored
     * expired     nothing is stored any more (TTL passed or entry evicted)
     * unsupported the kind has no stored read (gap, overview, trends, clusters)
     */
    status: StoredResearchStatus;
    requestedCount: number;
    storedCount: number;
    /** Seed phrase for related / ideas / long_tail rows; null otherwise. */
    seed: string | null;
    /** metrics + intent rows: stored volume / difficulty / CPC / trend merged with stored intent. */
    keywords: StoredKeywordRow[];
    /** related / ideas / long_tail rows: the stored expansion list. */
    items: RelatedKeywordPayload[];
    /** Oldest fetch time / earliest expiry among the stored entries; null when none. */
    fetchedAt: string | null;
    expiresAt: string | null;
}
const EXPANSION_KINDS: readonly KeywordResearchKind[] = ['related', 'ideas', 'long_tail'];
function statusFor(requested: number, stored: number): StoredResearchStatus {
    if (stored === 0)
        return 'expired';
    return stored < requested ? 'partial' : 'available';
}
function minDate(dates: readonly Date[]): Date | null {
    if (dates.length === 0)
        return null;
    return dates.reduce((best, date) => (date < best ? date : best));
}
export async function readStoredResearchResult(db: Db, row: KeywordResearchHistoryRow, now: Date): Promise<StoredResearchResult> {
    const repo = createKeywordCacheRepo(db);
    const base = {
        id: row.id,
        kind: row.kind,
        lookupId: row.lookupId,
        phrases: row.phrases,
        locationCode: row.locationCode,
        languageCode: row.languageCode,
        seed: null as string | null,
        keywords: [] as StoredKeywordRow[],
        items: [] as RelatedKeywordPayload[],
    };
    if (row.kind === 'metrics' || row.kind === 'intent') {
        const phrases = row.phrases.map(normalizeCachePhrase).filter((p) => p.length > 0);
        const keyByPhrase = phrases.map((phrase) => computeKeywordCacheKey({ phrase, locationCode: row.locationCode, languageCode: row.languageCode }));
        // Both caches are read whichever member of a metrics+intent pair was
        // opened: one Research press wrote both, and they share one TTL.
        const [metricsByKey, intentByKey] = await Promise.all([
            repo.readMetricsMany(keyByPhrase, now),
            repo.readIntentMany(keyByPhrase, now),
        ]);
        const keywords: StoredKeywordRow[] = [];
        const fetched: Date[] = [];
        const expires: Date[] = [];
        phrases.forEach((phrase, index) => {
            const key = keyByPhrase[index]!;
            const metric = metricsByKey.get(key);
            const intent = intentByKey.get(key);
            if (!metric && !intent)
                return;
            const sources = [metric, intent].filter((s): s is NonNullable<typeof s> => s !== undefined);
            const fetchedAt = minDate(sources.map((s) => s.fetchedAt))!;
            const expiresAt = minDate(sources.map((s) => s.expiresAt))!;
            fetched.push(fetchedAt);
            expires.push(expiresAt);
            keywords.push({
                keyword: phrase,
                searchVolume: metric?.searchVolume ?? null,
                difficulty: metric?.difficulty ?? null,
                cpc: metric?.cpc ?? null,
                monthlySearches: metric?.monthlySearches ?? [],
                intent: intent?.intent ?? null,
                confidence: intent?.confidence ?? null,
                cached: true,
                fetchedAt: fetchedAt.toISOString(),
                expiresAt: expiresAt.toISOString(),
            });
        });
        return {
            ...base,
            status: statusFor(phrases.length, keywords.length),
            requestedCount: phrases.length,
            storedCount: keywords.length,
            keywords,
            fetchedAt: minDate(fetched)?.toISOString() ?? null,
            expiresAt: minDate(expires)?.toISOString() ?? null,
        };
    }
    if (EXPANSION_KINDS.includes(row.kind)) {
        const operation = row.kind as ExpansionOperation;
        const seed = normalizeCachePhrase(row.phrases[0]!);
        const cacheKey = computeKeywordCacheKey({ phrase: seed, locationCode: row.locationCode, languageCode: row.languageCode });
        const hits = await repo.readExpansionsMany([cacheKey], now);
        const hit = hits.get(expansionMapKey(operation, cacheKey));
        return {
            ...base,
            seed,
            status: hit ? 'available' : 'expired',
            requestedCount: 1,
            storedCount: hit ? 1 : 0,
            items: hit ? hit.items.filter((item) => normalizeCachePhrase(item.keyword) !== seed).map(cachedRelatedToPayload) : [],
            fetchedAt: hit?.fetchedAt.toISOString() ?? null,
            expiresAt: hit?.expiresAt.toISOString() ?? null,
        };
    }
    // gap / overview / trends / clusters: each has its own tab and stored-run
    // reads; their history row carries no result snapshot to re-open here.
    return {
        ...base,
        status: 'unsupported',
        requestedCount: row.phrases.length,
        storedCount: 0,
        fetchedAt: null,
        expiresAt: null,
    };
}
// ---------------------------------------------------------------------------
// Cluster-candidate set
// ---------------------------------------------------------------------------

export type StoredCandidateSource = 'seed' | 'related' | 'idea' | 'long_tail';

export interface StoredKeywordCandidate {
  phrase: string;
  source: StoredCandidateSource;
  /** Volume stored with the expansion row; null for seeds (their metrics live in the lookup). */
  searchVolume: number | null;
  /** Latest time the phrase was stored (history time for seeds, fetch time for expansions). */
  observedAt: Date;
}

const SEED_KINDS = ['metrics', 'intent', 'related', 'ideas', 'long_tail', 'overview', 'trends'] as const;

const SOURCE_BY_OPERATION: Record<ExpansionOperation, StoredCandidateSource> = {
  related: 'related',
  ideas: 'idea',
  long_tail: 'long_tail',
};

/**
 * Every storable phrase the account has for one market, deduped by normalized
 * phrase. Order is deterministic: seeds (newest lookup first), then expansion
 * phrases by stored volume desc (nulls last) and phrase asc. A phrase that is
 * both a seed and an expansion keeps its `seed` source.
 *
 * Only expansions whose SEED sits in the account's own history are read, so the
 * account-agnostic cache never leaks rows the account did not look up.
 */
export async function collectStoredKeywordCandidates(
  db: Db,
  input: { accountId: string; locationCode: number; languageCode: string; now: Date },
): Promise<StoredKeywordCandidate[]> {
  const historyRows = await db
    .select({
      kind: keywordResearchHistory.kind,
      phrases: keywordResearchHistory.phrases,
      createdAt: keywordResearchHistory.createdAt,
    })
    .from(keywordResearchHistory)
    .where(
      and(
        eq(keywordResearchHistory.accountId, input.accountId),
        eq(keywordResearchHistory.locationCode, input.locationCode),
        eq(keywordResearchHistory.languageCode, input.languageCode.toLowerCase()),
        inArray(keywordResearchHistory.kind, [...SEED_KINDS]),
      ),
    )
    .orderBy(desc(keywordResearchHistory.createdAt), desc(keywordResearchHistory.id))
    .limit(STORED_HISTORY_SCAN_LIMIT);

  const seen = new Set<string>();
  const seeds: StoredKeywordCandidate[] = [];
  const expansionRequests: Array<{ operation: ExpansionOperation; cacheKey: string }> = [];
  const expansionKeys = new Set<string>();

  for (const row of historyRows) {
    for (const raw of row.phrases) {
      const phrase = normalizeCachePhrase(raw);
      if (phrase.length === 0 || phrase.length > STORED_PHRASE_MAX_LENGTH || seen.has(phrase)) continue;
      seen.add(phrase);
      seeds.push({ phrase, source: 'seed', searchVolume: null, observedAt: row.createdAt });
    }
    if (EXPANSION_KINDS.includes(row.kind)) {
      const operation = row.kind as ExpansionOperation;
      const seed = normalizeCachePhrase(row.phrases[0]!);
      const cacheKey = computeKeywordCacheKey({
        phrase: seed,
        locationCode: input.locationCode,
        languageCode: input.languageCode,
      });
      const mapKey = expansionMapKey(operation, cacheKey);
      if (!expansionKeys.has(mapKey)) {
        expansionKeys.add(mapKey);
        expansionRequests.push({ operation, cacheKey });
      }
    }
  }

  const repo = createKeywordCacheRepo(db);
  const hits: Map<string, CachedExpansionRow> = await repo.readExpansionsMany(
    [...new Set(expansionRequests.map((r) => r.cacheKey))],
    input.now,
  );

  const expansions: StoredKeywordCandidate[] = [];
  for (const request of expansionRequests) {
    const hit = hits.get(expansionMapKey(request.operation, request.cacheKey));
    if (!hit) continue;
    for (const item of hit.items) {
      const phrase = normalizeCachePhrase(item.keyword);
      if (phrase.length === 0 || phrase.length > STORED_PHRASE_MAX_LENGTH || seen.has(phrase)) continue;
      seen.add(phrase);
      expansions.push({
        phrase,
        source: SOURCE_BY_OPERATION[request.operation],
        searchVolume: item.searchVolume,
        observedAt: hit.fetchedAt,
      });
    }
  }
  expansions.sort((a, b) => {
    if (a.searchVolume !== b.searchVolume) {
      if (a.searchVolume === null) return 1;
      if (b.searchVolume === null) return -1;
      return b.searchVolume - a.searchVolume;
    }
    // Phrases are deduped above, so two candidates never compare equal.
    return a.phrase < b.phrase ? -1 : 1;
  });

  return [...seeds, ...expansions];
}

export interface StoredKeywordCandidatesPage {
  candidates: StoredKeywordCandidate[];
  /** Candidates matching `q` BEFORE the `limit` cut. */
  total: number;
  truncated: boolean;
}

export async function listStoredKeywordCandidates(
  db: Db,
  input: {
    accountId: string;
    locationCode: number;
    languageCode: string;
    q?: string | undefined;
    limit: number;
    now: Date;
  },
): Promise<StoredKeywordCandidatesPage> {
  const all = await collectStoredKeywordCandidates(db, input);
  const needle = input.q ? normalizeCachePhrase(input.q) : '';
  const matching = needle ? all.filter((c) => c.phrase.includes(needle)) : all;
  return {
    candidates: matching.slice(0, input.limit),
    total: matching.length,
    truncated: matching.length > input.limit,
  };
}
