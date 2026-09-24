import { createHash } from 'node:crypto';
import type { Db } from '../../db/client.js';
import type { SiteKeywordCandidate, SiteKeywordProvider } from '../../shared/providers/index.js';
import { getCachedSiteKeywordCandidates, SITE_RANKED_KEYWORD_LIMIT, type CachedSiteKeywordCandidatesResult, } from '../ranks/index.js';
import { createPagesRepository, type NormalizedPagePerformanceKeyword, type PagePerformanceCoverageWrite, type PagesRepository, type WrittenPagePerformanceSnapshot, } from './pages.repository.js';
import { resolvePagesFallbackMarket, type PagesFallbackMarket, } from './market-resolver.js';
import { canonicalizePageUrl } from './url-normalizer.js';
export type PagesKeywordProviderSelection = 'fake' | 'dataforseo';
export type PagesFallbackSource = 'demo' | 'dataforseo';
export interface NormalizedFallbackPayload {
    keywords: NormalizedPagePerformanceKeyword[];
    coverage: PagePerformanceCoverageWrite;
}
export interface PagesFallbackRefreshInput {
    accountId: string;
    siteId: string;
    domain: string;
    siteUrl: string;
}
interface PagesFallbackRefreshBase {
    source: PagesFallbackSource;
    market: PagesFallbackMarket;
}
export type PagesFallbackRefreshResult = (PagesFallbackRefreshBase & {
    ok: true;
    outcome: 'refreshed' | 'empty';
    cache: 'hit' | 'miss';
    observedAt: Date;
    cacheFetchedAt: Date;
    coverage: PagePerformanceCoverageWrite;
    persisted: WrittenPagePerformanceSnapshot;
}) | (PagesFallbackRefreshBase & {
    ok: false;
    failure: 'provider_unavailable' | 'persistence_failed';
    lastGood: Awaited<ReturnType<PagesRepository['readLatest']>>;
});
export interface PagesFallbackRefreshService {
    refresh(input: PagesFallbackRefreshInput): Promise<PagesFallbackRefreshResult>;
}
export interface PagesFallbackRefreshDeps {
    db: Db;
    provider: SiteKeywordProvider;
    providerSelection: PagesKeywordProviderSelection;
    repository?: PagesRepository;
    now?: () => Date;
    resolveMarket?: typeof resolvePagesFallbackMarket;
    readRankedCandidates?: (input: {
        domain: string;
        locationCode: number;
        languageCode: string;
    }, deps: {
        db: Db;
        provider: SiteKeywordProvider;
        now?: () => Date;
    }) => Promise<CachedSiteKeywordCandidatesResult>;
}
export function pagesFallbackSourceForProvider(selection: PagesKeywordProviderSelection): PagesFallbackSource {
    return selection === 'fake' ? 'demo' : 'dataforseo';
}
function validNullableInteger(value: number | null): boolean {
    return value === null || (Number.isInteger(value) && value >= 0);
}
function validNullableFinite(value: number | null, max = Number.POSITIVE_INFINITY): boolean {
    return value === null || (Number.isFinite(value) && value >= 0 && value <= max);
}
function validCandidateMetrics(candidate: SiteKeywordCandidate): boolean {
    return (candidate.keyword.trim().length > 0 &&
        Buffer.byteLength(candidate.keyword.trim(), 'utf8') <= 700 &&
        candidate.currentPosition !== null &&
        Number.isFinite(candidate.currentPosition) &&
        candidate.currentPosition > 0 &&
        validNullableInteger(candidate.searchVolume) &&
        validNullableFinite(candidate.difficulty, 100) &&
        validNullableFinite(candidate.estimatedTraffic));
}
/** Normalize a complete provider result before any persistence begins. */
export function normalizeFallbackCandidates(candidates: readonly SiteKeywordCandidate[], siteUrl: string): NormalizedFallbackPayload {
    const keywords: NormalizedPagePerformanceKeyword[] = [];
    const seen = new Set<string>();
    let malformedUrlCount = 0;
    let offsiteUrlCount = 0;
    let duplicateUrlCount = 0;
    let invalidMetricCount = 0;
    for (const candidate of candidates) {
        if (candidate.rankingUrl === null) {
            malformedUrlCount += 1;
            continue;
        }
        const page = canonicalizePageUrl(candidate.rankingUrl, siteUrl);
        if (!page.ok) {
            if (page.reason === 'malformed_url')
                malformedUrlCount += 1;
            else
                offsiteUrlCount += 1;
            continue;
        }
        if (!validCandidateMetrics(candidate)) {
            invalidMetricCount += 1;
            continue;
        }
        const keyword = candidate.keyword.trim();
        const duplicateKey = `${page.value.pageHash}\u0000${keyword.toLowerCase()}`;
        if (seen.has(duplicateKey)) {
            duplicateUrlCount += 1;
            continue;
        }
        seen.add(duplicateKey);
        keywords.push({
            ...page.value,
            keyword,
            position: candidate.currentPosition!,
            searchVolume: candidate.searchVolume,
            difficulty: candidate.difficulty,
            estimatedTraffic: candidate.estimatedTraffic,
        });
    }
    keywords.sort((left, right) => left.pageHash.localeCompare(right.pageHash) ||
        left.keyword.localeCompare(right.keyword) ||
        left.position - right.position);
    const droppedCount = malformedUrlCount + offsiteUrlCount + duplicateUrlCount + invalidMetricCount;
    return {
        keywords,
        coverage: {
            sourceRowsFetched: candidates.length,
            acceptedCount: keywords.length,
            droppedCount,
            malformedUrlCount,
            offsiteUrlCount,
            duplicateUrlCount,
            invalidMetricCount,
            sourceTruncated: candidates.length === SITE_RANKED_KEYWORD_LIMIT,
        },
    };
}
export function fingerprintFallbackPayload(input: {
    source: PagesFallbackSource;
    market: PagesFallbackMarket;
    observedAt: Date;
    normalized: NormalizedFallbackPayload;
}): string {
    const serializable = {
        source: input.source,
        locationCode: input.market.locationCode,
        languageCode: input.market.languageCode,
        observedAt: input.observedAt.toISOString(),
        coverage: input.normalized.coverage,
        keywords: input.normalized.keywords,
    };
    return createHash('sha256').update(JSON.stringify(serializable), 'utf8').digest('hex');
}
export function createPagesFallbackRefreshService(deps: PagesFallbackRefreshDeps): PagesFallbackRefreshService {
    const repository = deps.repository ?? createPagesRepository(deps.db, { now: deps.now });
    const resolveMarket = deps.resolveMarket ?? resolvePagesFallbackMarket;
    const readRankedCandidates = deps.readRankedCandidates ?? getCachedSiteKeywordCandidates;
    const source = pagesFallbackSourceForProvider(deps.providerSelection);
    return {
        async refresh(input) {
            const market = await resolveMarket(deps.db, input.accountId, input.siteId);
            let cached: CachedSiteKeywordCandidatesResult;
            try {
                cached = await readRankedCandidates({
                    domain: input.domain,
                    locationCode: market.locationCode,
                    languageCode: market.languageCode,
                }, {
                    db: deps.db,
                    provider: deps.provider,
                    ...(deps.now ? { now: deps.now } : {}),
                });
            }
            catch {
                return {
                    ok: false,
                    failure: 'provider_unavailable',
                    source,
                    market,
                    lastGood: await repository.readLatest({
                        accountId: input.accountId,
                        siteId: input.siteId,
                        source,
                        locationCode: market.locationCode,
                        languageCode: market.languageCode,
                    }),
                };
            }
            const normalized = normalizeFallbackCandidates(cached.candidates, input.siteUrl);
            const observedAt = cached.fetchedAt;
            try {
                const persisted = await repository.writeSuccessfulSnapshot({
                    accountId: input.accountId,
                    siteId: input.siteId,
                    source,
                    locationCode: market.locationCode,
                    languageCode: market.languageCode,
                    observedAt,
                    cacheFetchedAt: cached.fetchedAt,
                    cacheStatus: cached.cached ? 'hit' : 'miss',
                    payloadFingerprint: fingerprintFallbackPayload({
                        source,
                        market,
                        observedAt,
                        normalized,
                    }),
                    ...normalized.coverage,
                    keywords: normalized.keywords,
                });
                return {
                    ok: true,
                    outcome: normalized.keywords.length === 0 ? 'empty' : 'refreshed',
                    source,
                    market,
                    cache: cached.cached ? 'hit' : 'miss',
                    observedAt,
                    cacheFetchedAt: cached.fetchedAt,
                    coverage: normalized.coverage,
                    persisted,
                };
            }
            catch {
                return {
                    ok: false,
                    failure: 'persistence_failed',
                    source,
                    market,
                    lastGood: await repository.readLatest({
                        accountId: input.accountId,
                        siteId: input.siteId,
                        source,
                        locationCode: market.locationCode,
                        languageCode: market.languageCode,
                    }),
                };
            }
        },
    };
}
