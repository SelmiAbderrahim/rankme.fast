/**
 * Deterministic in-memory fakes — one per provider interface.
 *
 * Downstream feature tests and Playwright suites run against
 * THESE, never against live vendors. Each factory accepts canned results
 * (deep-merged over deterministic defaults) plus failure injection: when
 * `failure` is set, every method rejects with that taxonomy error.
 */
import { VendorMalformedError, VendorQuotaError, VendorTimeoutError, VendorUnavailableError, type ProviderError, } from './errors.js';
import { normalizeDomainComparisonResult } from './domain-comparison.js';
import { FAKE_BRAND_DIGEST_FABRICATE_MARKER } from './ai-generation-fake.js';
import { buildObservationMeta, marketFromDataForSeo, observationMetaSchema, } from '../observations/observations.js';
import { appBulkMetricsInputSchema, appChartInputSchema, appInfoInputSchema, appIntersectionInputSchema, appReviewsInputSchema, appRowsInputSchema, appSearchInputSchema, type AppDataProvider, type AppInfo, type AppRankingMetrics, type AppStoreKind, type AppSummary, } from './app-data.js';
// Pure, vendor-agnostic helpers that happen to live beside the DataForSEO
// alt-engine adapter — the same arrangement `rank.processor.ts` already uses
// for provider-neutral SERP host normalization.
import { buildAltEngineObservationMeta, matchHostInRows, matchTokenInRows, } from './dataforseo/alt-engines.js';
import { normalizeSerpDomain } from './serp-normalization.js';
import type { PublicPageDiscoveryInput, PublicPageDiscoveryResult, PublicPageDiscoveryRow, PublicPageSourceHint, } from './types.js';
import type { AiAnswerInput, AiAnswerRow, AiKeywordVolume, AiMentionCheckInput, AiMentionRow, AiVisibilityProvider, AuditProvider, AuditResult, AuditStatus, ContentAnalysisMentionQuery, ContentAnalysisMentionRow, ContentAnalysisMentionSummary, ContentAnalysisProvider, ReviewRow, ReviewsInput, ReviewsProvider, ReviewsResult, ReviewsSource, BacklinkAnchorRow, BacklinkBulkRankRow, BacklinkCompetitorRow, BacklinkHistoryPoint, BacklinkListPage, BacklinkProvider, BacklinkReferringDomainRow, BacklinkSpamScoreRow, BacklinkSummary, BusinessListingRow, CompetitorEntry, CompetitorProvider, DomainComparisonResult, DomainComparisonRow, DomainIntersectionRow, DomainRankOverviewRow, HistoricalRankOverviewResult, TrafficEstimationCountry, TrafficEstimationRow, TechStackEntry, Ga4Property, Ga4Provider, Ga4RunReportInput, Ga4RunReportResult, Ga4WebDataStream, GscProperty, GscSearchAnalyticsResult, GscSitemapEntry, GscUrlInspection, AltEngineRankInput, AltEngineRankResult, AltEngineRankRow, AltRankEngine, IntentResult, KeywordHistoricalVolume, KeywordMetrics, KeywordOverview, KeywordProvider, LocalListingsProvider, LocalPackCoordinate, LocalPackResult, PageSpeedProvider, PageSpeedResult, ProviderMarket, QaSummary, RankCheckResult, RankProvider, ReviewsSummary, SerpFeatureSnapshot, SiteKeywordCandidate, SiteKeywordProvider, TrendsExploreInput, TrendsExploreResult, TrendsMonthlyPoint, TrendsProvider, TrendsRelatedQuery, TrendsSeries, } from './types.js';
import type { GoogleGscProvider } from './google/gsc.js';
/** Fixed instant so fake output is bit-for-bit reproducible across runs. */
export const FAKE_CLOCK = new Date('2026-01-01T00:00:00.000Z');
export const FAKE_SEO_MARKETS: ProviderMarket[] = [
    { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
    { countryCode: 'GB', locationCode: 2826, languageCodes: ['en'] },
    { countryCode: 'DE', locationCode: 2276, languageCodes: ['de'] },
    { countryCode: 'FR', locationCode: 2250, languageCodes: ['fr'] },
    { countryCode: 'SA', locationCode: 2682, languageCodes: ['ar'] },
];
const cloneMarkets = (markets: readonly ProviderMarket[]): ProviderMarket[] => markets.map((market) => ({ ...market, languageCodes: [...market.languageCodes] }));
export interface FakeProviderOptions {
    /** When set, EVERY method of the fake rejects with this error. */
    failure?: ProviderError;
}
function maybeFail(failure: ProviderError | undefined): void {
    if (failure)
        throw failure;
}
// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export interface FakeAuditProviderOptions extends FakeProviderOptions {
    vendorTaskId?: string;
    status?: AuditStatus;
    result?: AuditResult;
}
export const FAKE_AUDIT_RESULT: AuditResult = {
    domainChecks: {
        robotsTxtFound: true,
        sitemapFound: true,
        httpsEnforced: true,
        canonicalizationOk: false,
    },
    pages: [
        {
            url: 'https://example.com/',
            statusCode: 200,
            title: 'Example Domain',
            metaDescription: 'An example page.',
            h1: ['Example Domain'],
            h2: ['More information'],
            canonical: 'https://example.com/',
            hasStructuredData: true,
            structuredDataErrors: [],
            isIndexable: true,
            brokenLinks: [],
            onPageScore: 87.5,
            timing: { fetchMs: 120 },
        },
        {
            url: 'https://example.com/hidden',
            statusCode: 200,
            title: null,
            metaDescription: null,
            h1: [],
            h2: [],
            canonical: null,
            hasStructuredData: false,
            structuredDataErrors: ['missing required field "name"'],
            isIndexable: false,
            nonIndexableReason: 'noindex meta tag',
            brokenLinks: ['https://example.com/404'],
            onPageScore: 41.2,
        },
    ],
};
export function createFakeAuditProvider(opts: FakeAuditProviderOptions = {}): AuditProvider {
    const vendorTaskId = opts.vendorTaskId ?? 'fake-audit-task-1';
    const status = opts.status ?? { state: 'finished', pagesCrawled: 2 };
    const result = opts.result ?? FAKE_AUDIT_RESULT;
    return {
        async startAudit() {
            maybeFail(opts.failure);
            return { vendorTaskId };
        },
        async getAuditStatus() {
            maybeFail(opts.failure);
            return status;
        },
        async getAuditResult() {
            maybeFail(opts.failure);
            return result;
        },
    };
}
// ---------------------------------------------------------------------------
// Rank
// ---------------------------------------------------------------------------
export interface FakeRankProviderOptions extends FakeProviderOptions {
    result?: RankCheckResult;
    localPackResult?: LocalPackResult;
    /** Pin an exact alt-engine outcome. */
    altEngineResult?: AltEngineRankResult;
}
export const FAKE_RANK_RESULT: RankCheckResult = {
    position: 3,
    foundUrl: 'https://example.com/pricing',
    serpTopUrls: [
        'https://a.example/',
        'https://b.example/',
        'https://example.com/pricing',
        ...Array.from({ length: 17 }, (_, index) => `https://result-${index + 4}.example.test/page`),
    ],
    checkedAt: FAKE_CLOCK,
};
export const FAKE_LOCAL_PACK_RESULT: LocalPackResult = {
    position: 2,
    totalPackSize: 3,
    checkedAt: FAKE_CLOCK,
};
// ---------------------------------------------------------------------------
// Geogrid per-coordinate map-pack fake
// ---------------------------------------------------------------------------
/**
 * A keyword containing this marker makes every cell whose deterministic
 * bucket is `FAKE_GEOGRID_FAILING_BUCKET` raise `VendorUnavailableError`, so
 * the partial-failure journey is reproducible without touching the network.
 */
export const FAKE_GEOGRID_PARTIAL_MARKER = 'gridfail';
/** Superset marker: EVERY cell fails, so the all-fail refund path is testable. */
export const FAKE_GEOGRID_ALL_FAIL_MARKER = 'gridfail-all';
/** Bucket index (0..6) the partial marker knocks out. */
export const FAKE_GEOGRID_FAILING_BUCKET = 3;
/** Pack size every fake coordinate answer reports. */
export const FAKE_GEOGRID_PACK_SIZE = 5;
/**
 * Deterministic 0..6 bucket for a coordinate. Buckets 0..4 map to map-pack
 * positions 1..5, buckets 5 and 6 map to "not in the pack" — so a grid always
 * renders a stable mixture of ranked and unranked cells with no clock and no
 * randomness.
 */
export function fakeCoordinateBucket(coordinate: LocalPackCoordinate): number {
    const lat = Math.round(coordinate.lat * 1e5);
    const lng = Math.round(coordinate.lng * 1e5);
    return ((lat + lng * 7919) % 7 + 7) % 7;
}
export function fakeLocalPackForCoordinate(keyword: string, coordinate: LocalPackCoordinate): LocalPackResult {
    const phrase = keyword.toLowerCase();
    const bucket = fakeCoordinateBucket(coordinate);
    if (phrase.includes(FAKE_GEOGRID_ALL_FAIL_MARKER) ||
        (phrase.includes(FAKE_GEOGRID_PARTIAL_MARKER) &&
            bucket === FAKE_GEOGRID_FAILING_BUCKET)) {
        throw new VendorUnavailableError('fake geogrid cell failure', {
            provider: 'fake',
            operation: 'serp-google-maps-live-advanced',
        });
    }
    return {
        position: bucket < 5 ? bucket + 1 : null,
        totalPackSize: FAKE_GEOGRID_PACK_SIZE,
        checkedAt: FAKE_CLOCK,
    };
}
/**
 * Deterministic alt-engine scenarios.
 *
 * A phrase containing `unranked` yields a checked-but-not-found result
 * (`position: null`) so the "checked, not in depth" state is reachable
 * without a vendor; every other phrase places the tracked target at a fixed
 * ordinal per engine. Rows are built from the caller's own domain/target so a
 * fake check is honest about WHAT it matched.
 */
export const FAKE_ALT_ENGINE_MISS_MARKER = 'unranked';
/** Fixed ordinal the tracked target lands on, per engine. */
export const FAKE_ALT_ENGINE_POSITIONS: Record<AltRankEngine, number> = {
    bing: 3,
    youtube: 2,
    amazon: 5,
};
function fakeAltEngineRows(input: AltEngineRankInput): AltEngineRankRow[] {
    const hitAt = FAKE_ALT_ENGINE_POSITIONS[input.engine];
    const miss = input.keyword.toLowerCase().includes(FAKE_ALT_ENGINE_MISS_MARKER);
    const rows: AltEngineRankRow[] = [];
    for (let rank = 1; rank <= 8; rank += 1) {
        const isHit = !miss && rank === hitAt;
        if (input.engine === 'bing') {
            const domain = isHit
                ? normalizeSerpDomain(input.domain)
                : `bing-result-${rank}.example.test`;
            rows.push({
                domain,
                url: `https://${domain}/page-${rank}`,
                rankGroup: rank,
                rankAbsolute: rank,
                matchToken: null,
            });
            continue;
        }
        if (input.engine === 'youtube') {
            rows.push({
                domain: 'youtube.com',
                url: `https://www.youtube.com/watch?v=fake-video-${rank}`,
                rankGroup: rank,
                rankAbsolute: rank,
                matchToken: isHit && input.engineTarget !== null
                    ? input.engineTarget
                    : `fakechannel${rank}`,
            });
            continue;
        }
        rows.push({
            domain: 'amazon.com',
            url: `https://www.amazon.com/dp/FAKEASIN${rank}0`,
            rankGroup: rank,
            rankAbsolute: rank,
            matchToken: isHit && input.engineTarget !== null ? input.engineTarget : `FAKEASIN${rank}0`,
        });
    }
    return rows;
}
/**
 * Deterministic Google AI Overview signal keyed off the keyword so demos and
 * E2E runs exercise every badge state without vendor keys:
 *   keyword contains "ai"       → overview shown, domain cited
 *   keyword contains "overview" → overview shown, domain NOT cited
 *   anything else               → no AI Overview on the SERP
 */
export function fakeAiOverviewFor(keyword: string, domain: string): NonNullable<RankCheckResult['aiOverview']> {
    const phrase = keyword.toLowerCase();
    if (phrase.includes('ai')) {
        return { present: true, cited: true, citedUrl: `https://${domain}/ai` };
    }
    if (phrase.includes('overview')) {
        return { present: true, cited: false };
    }
    return { present: false, cited: false };
}
/**
 * Deterministic SERP-feature snapshot keyed off the keyword so demos, E2E,
 * and cap journeys exercise every chip/ownership state without a vendor
 * key. Domain-independent by contract — the site's domain is
 * only used to SIMULATE ownership, exactly as `fakeAiOverviewFor` does:
 *
 *   keyword contains "snippet"  → featured snippet + PAA, BOTH owned by the site
 *   keyword contains "feature"  → PAA + video + images, owned by third parties
 *   anything else               → checked, nothing observed (empty snapshot)
 */
export function fakeSerpFeaturesFor(keyword: string, domain: string): SerpFeatureSnapshot {
    const phrase = keyword.toLowerCase();
    if (phrase.includes('snippet')) {
        return {
            features: [
                { type: 'featured_snippet', rankAbsolute: 1 },
                { type: 'people_also_ask', rankAbsolute: 4 },
            ],
            featuredSnippet: {
                domain,
                url: `https://${domain}/guides/snippet`,
                title: 'How the audit scores your page',
            },
            paa: [
                {
                    question: 'How do I win a featured snippet?',
                    answerDomain: domain,
                    answerUrl: `https://${domain}/guides/snippet`,
                },
                {
                    question: 'What is a People Also Ask box?',
                    answerDomain: 'rival-one.example',
                    answerUrl: 'https://rival-one.example/paa',
                },
            ],
        };
    }
    if (phrase.includes('feature')) {
        return {
            features: [
                { type: 'people_also_ask', rankAbsolute: 3 },
                { type: 'video', rankAbsolute: 6 },
                { type: 'images', rankAbsolute: 8 },
            ],
            featuredSnippet: null,
            paa: [
                {
                    question: 'Which SERP features can I track?',
                    answerDomain: 'rival-one.example',
                    answerUrl: 'https://rival-one.example/serp-features',
                },
            ],
        };
    }
    return { features: [], featuredSnippet: null, paa: [] };
}
/**
 * Deterministic pool used to seed `searchPublicPages` output. Mix of forum /
 * review / comparison / question / other source types so the source-type
 * classifier and diversity round-robin exercised in the feature layer see
 * every branch. Fixed order — tests lock this list.
 */
export const FAKE_PUBLIC_PAGE_POOL: ReadonlyArray<{
    canonicalUrl: string;
    title: string;
    sourceTypeHint: PublicPageSourceHint;
    observedAt: string | null;
}> = Object.freeze([
    {
        canonicalUrl: 'https://reddit.com/r/seo/comments/audit-tool-experiences',
        title: 'What is your favorite SEO audit tool?',
        sourceTypeHint: 'forum',
        observedAt: '2025-11-04T00:00:00.000Z',
    },
    {
        canonicalUrl: 'https://g2.com/products/rankme-fast/reviews',
        title: 'RankMeFast reviews — pros, cons, pricing',
        sourceTypeHint: 'review',
        observedAt: '2025-12-14T00:00:00.000Z',
    },
    {
        canonicalUrl: 'https://example.com/compare/rankme-vs-competitor',
        title: 'RankMeFast vs Competitor — pricing and features compared',
        sourceTypeHint: 'comparison',
        // `null` = vendor did not expose datetime. The spec requires ≥1 such row.
        observedAt: null,
    },
    {
        canonicalUrl: 'https://quora.com/why-does-my-audit-report-flag-h1-issues',
        title: 'Why does my audit report flag H1 issues?',
        sourceTypeHint: 'question',
        observedAt: '2025-10-01T00:00:00.000Z',
    },
    {
        canonicalUrl: 'https://stackoverflow.com/questions/12345/rankme-integration',
        title: 'RankMeFast integration with Next.js',
        sourceTypeHint: 'forum',
        observedAt: '2026-01-20T00:00:00.000Z',
    },
    {
        canonicalUrl: 'https://capterra.com/p/rankme-fast/alternatives',
        title: 'RankMeFast alternatives — top competitors on Capterra',
        sourceTypeHint: 'comparison',
        observedAt: '2025-09-15T00:00:00.000Z',
    },
    {
        canonicalUrl: 'https://trustpilot.com/review/rankme.fast',
        title: 'RankMeFast Trustpilot reviews',
        sourceTypeHint: 'review',
        observedAt: '2025-08-11T00:00:00.000Z',
    },
    {
        canonicalUrl: 'https://forum.example.com/topics/audit-tool-problems',
        title: 'Audit tool problems and workarounds',
        sourceTypeHint: 'forum',
        observedAt: '2025-07-22T00:00:00.000Z',
    },
    {
        canonicalUrl: 'https://example.com/blog/best-seo-tools-2026',
        title: 'The best SEO audit tools in 2026',
        sourceTypeHint: 'other',
        observedAt: '2025-06-05T00:00:00.000Z',
    },
    {
        canonicalUrl: 'https://stackexchange.com/webmasters/questions/54321',
        title: 'Question about audit findings',
        sourceTypeHint: 'question',
        observedAt: '2025-05-10T00:00:00.000Z',
    },
] as const);
/**
 * djb2-style 32-bit hash used to pick a deterministic pool offset per query.
 * Seeded on `(queryId, queryText, country, language)` so identical input
 * always produces identical rows across runs, machines, and locales.
 */
export function fakeDiscoverySeed(seed: string): number {
    let h = 5381;
    for (let i = 0; i < seed.length; i += 1) {
        h = ((h << 5) + h + seed.charCodeAt(i)) | 0;
    }
    return h & 0x7fffffff;
}
/**
 * Read a fake-force env probe. Test suites and Playwright specs flip these
 * to exercise the pipeline's failure branches without vendor keys. Names
 * are locked.
 */
export type FakeDiscoveryForcedFailure = 'timeout' | 'malformed' | 'empty' | null;
export function readFakeDiscoveryForcedFailure(env: NodeJS.ProcessEnv = process.env): FakeDiscoveryForcedFailure {
    if (env['__FAKE_FORCE_TIMEOUT'] === '1' || env['__FAKE_FORCE_TIMEOUT'] === 'true')
        return 'timeout';
    if (env['__FAKE_FORCE_MALFORMED'] === '1' || env['__FAKE_FORCE_MALFORMED'] === 'true')
        return 'malformed';
    if (env['__FAKE_FORCE_EMPTY'] === '1' || env['__FAKE_FORCE_EMPTY'] === 'true')
        return 'empty';
    return null;
}
export interface FakeDiscoveryOptions {
    /** Override the env-probe helper (test seam). */
    env?: NodeJS.ProcessEnv;
    /**
     * Explicit forced-failure override that takes precedence over env probes.
     * Feature tests use this to exercise the pipeline's failure branches
     * without touching env or importing anything from `process`.
     */
    forcedFailure?: FakeDiscoveryForcedFailure;
}
/**
 * Deterministic `searchPublicPages` implementation for the fake provider.
 * The pool is seeded from `(queryId, queryText, country, language)` and
 * offset by query index so a re-run of the pipeline produces identical
 * rows. At least one row lands with `observedAt=null` and one canonical
 * URL surfaces on two queries (dedupe fixture used by the selection tests).
 */
export function fakeSearchPublicPages(input: PublicPageDiscoveryInput, opts: FakeDiscoveryOptions = {}): PublicPageDiscoveryResult {
    const forced = opts.forcedFailure ?? readFakeDiscoveryForcedFailure(opts.env);
    if (forced === 'timeout') {
        throw new VendorTimeoutError('search-public-pages: forced timeout (fake)', {
            provider: 'fake',
            operation: 'search-public-pages',
        });
    }
    if (forced === 'malformed') {
        throw new VendorMalformedError('search-public-pages: forced malformed (fake)', {
            provider: 'fake',
            operation: 'search-public-pages',
        });
    }
    if (forced === 'empty') {
        return { rows: [] };
    }
    if (!Array.isArray(input.queries) || input.queries.length === 0) {
        throw new VendorMalformedError('search-public-pages: queries must be non-empty', {
            provider: 'fake',
            operation: 'search-public-pages',
        });
    }
    const perQueryLimit = Math.max(1, Math.min(10, input.perQueryLimit | 0));
    const nowIso = FAKE_CLOCK.toISOString();
    const rows: PublicPageDiscoveryRow[] = [];
    const country = input.siteMarket.country.toUpperCase();
    const language = input.siteMarket.language.toLowerCase();
    for (let q = 0; q < input.queries.length; q += 1) {
        const query = input.queries[q]!;
        const seed = fakeDiscoverySeed(`${query.id}|${query.text}|${country}|${language}`);
        for (let i = 0; i < perQueryLimit; i += 1) {
            // Round-robin offset ensures the second query re-hits an entry the
            // first one already surfaced (canonical dedupe fixture).
            const idx = (seed + q * 3 + i) % FAKE_PUBLIC_PAGE_POOL.length;
            const template = FAKE_PUBLIC_PAGE_POOL[idx]!;
            rows.push({
                queryId: query.id,
                canonicalUrl: template.canonicalUrl,
                title: template.title,
                organicPosition: i + 1,
                observedAt: template.observedAt,
                sourceTypeHint: template.sourceTypeHint,
                observationMeta: buildObservationMeta({
                    sourceKind: 'provider_observation',
                    sourceLabel: 'dataforseo',
                    observedAt: template.observedAt ?? nowIso,
                    market: input.siteMarket,
                    sampleCount: 1,
                    ...(template.observedAt === null
                        ? { coverageNoteKey: 'observations.coverage.partialResult' as const }
                        : {}),
                    now: FAKE_CLOCK,
                }),
            });
        }
    }
    return { rows };
}
export function createFakeRankProvider(opts: FakeRankProviderOptions & FakeDiscoveryOptions = {}): RankProvider {
    return {
        async checkRank(input) {
            maybeFail(opts.failure);
            if (opts.result)
                return opts.result;
            return {
                ...FAKE_RANK_RESULT,
                aiOverview: fakeAiOverviewFor(input.keyword, input.domain),
                serpFeatures: fakeSerpFeaturesFor(input.keyword, input.domain),
            };
        },
        async checkLocalPackRank(input) {
            maybeFail(opts.failure);
            if (opts.localPackResult)
                return opts.localPackResult;
            if (input.coordinate) {
                return fakeLocalPackForCoordinate(input.keyword, input.coordinate);
            }
            return FAKE_LOCAL_PACK_RESULT;
        },
        async searchPublicPages(input) {
            maybeFail(opts.failure);
            return fakeSearchPublicPages(input, {
                ...(opts.env !== undefined ? { env: opts.env } : {}),
                ...(opts.forcedFailure !== undefined ? { forcedFailure: opts.forcedFailure } : {}),
            });
        },
        async checkAltEngineRank(input) {
            maybeFail(opts.failure);
            if (opts.altEngineResult)
                return opts.altEngineResult;
            const rows = fakeAltEngineRows(input);
            const matched = input.engine === 'bing'
                ? matchHostInRows(rows, input.domain)
                : matchTokenInRows(rows, input.engineTarget);
            return {
                engine: input.engine,
                position: matched.position,
                foundUrl: matched.foundUrl,
                rows,
                checkedAt: FAKE_CLOCK,
                observationMeta: buildAltEngineObservationMeta(input.engine, FAKE_CLOCK, rows.length),
            };
        },
    };
}
// ---------------------------------------------------------------------------
// Local listings
// ---------------------------------------------------------------------------
export interface FakeLocalListingsProviderOptions extends FakeProviderOptions {
    businessListings?: BusinessListingRow[];
    reviews?: ReviewsSummary;
    questionsAndAnswers?: QaSummary;
}
export const FAKE_BUSINESS_LISTINGS: BusinessListingRow[] = [
    {
        source: 'google',
        name: 'Example Dental Studio',
        address: '100 Main St, Austin, TX 78701',
        phone: '+1 512-555-0100',
        consistent: true,
    },
    {
        source: 'yelp',
        name: 'Example Dental Studio',
        address: '100 Main St, Austin, TX 78701',
        phone: '+1 512-555-0100',
        consistent: true,
    },
    {
        source: 'bing-places',
        name: 'Example Dental',
        address: '100 Main Street, Austin, TX 78701',
        phone: '+1 512-555-9999',
        consistent: false,
    },
];
export const FAKE_REVIEWS_SUMMARY: ReviewsSummary = {
    averageRating: 4.6,
    reviewCount: 128,
    recentReviewCount: 14,
};
export const FAKE_QA_SUMMARY: QaSummary = {
    questionCount: 9,
    unansweredCount: 2,
};
export function createFakeLocalListingsProvider(opts: FakeLocalListingsProviderOptions = {}): LocalListingsProvider {
    const businessListings = opts.businessListings ?? FAKE_BUSINESS_LISTINGS;
    const reviews = opts.reviews ?? FAKE_REVIEWS_SUMMARY;
    const questionsAndAnswers = opts.questionsAndAnswers ?? FAKE_QA_SUMMARY;
    return {
        async getBusinessListings() {
            maybeFail(opts.failure);
            return businessListings;
        },
        async getReviews() {
            maybeFail(opts.failure);
            return reviews;
        },
        async getQuestionsAndAnswers() {
            maybeFail(opts.failure);
            return questionsAndAnswers;
        },
    };
}
// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------
export interface FakeKeywordProviderOptions extends FakeProviderOptions {
    metrics?: KeywordMetrics[];
    related?: KeywordMetrics[];
    intent?: IntentResult[];
    ideas?: KeywordMetrics[];
    longTailSuggestions?: KeywordMetrics[];
    overview?: KeywordOverview[];
    historicalVolume?: KeywordHistoricalVolume[];
    rankedSiteKeywords?: SiteKeywordCandidate[];
    siteKeywordIdeas?: SiteKeywordCandidate[];
}
export const FAKE_KEYWORD_METRICS: KeywordMetrics[] = [
    {
        keyword: 'seo audit tool',
        searchVolume: 5400,
        difficulty: 62,
        cpc: 4.1,
        monthlySearches: [
            { year: 2025, month: 11, searchVolume: 5200 },
            { year: 2025, month: 12, searchVolume: 5400 },
        ],
    },
    {
        keyword: 'rank tracker',
        searchVolume: null,
        difficulty: null,
        cpc: null,
        monthlySearches: [],
    },
];
/** One row of each of the four intents plus one unclassified (`null`) row. */
export const FAKE_INTENT_RESULTS: IntentResult[] = [
    { keyword: 'seo audit tool', intent: 'commercial', confidence: 0.82 },
    { keyword: 'what is an seo audit', intent: 'informational', confidence: 0.91 },
    { keyword: 'buy seo audit report', intent: 'transactional', confidence: 0.77 },
    { keyword: 'rankmefast login', intent: 'navigational', confidence: 0.88 },
    { keyword: 'obscure long-tail phrase', intent: null, confidence: null },
];
/** Distinct from FAKE_KEYWORD_METRICS so tests can prove the ideas endpoint ran. */
export const FAKE_KEYWORD_IDEAS: KeywordMetrics[] = [
    {
        keyword: 'website audit checklist',
        searchVolume: 2900,
        difficulty: 41,
        cpc: 2.35,
        monthlySearches: [
            { year: 2025, month: 11, searchVolume: 2700 },
            { year: 2025, month: 12, searchVolume: 2900 },
        ],
    },
    {
        keyword: 'technical seo scanner',
        searchVolume: 1600,
        difficulty: 55,
        cpc: 3.9,
        monthlySearches: [],
    },
    {
        keyword: 'free site health check',
        searchVolume: 8800,
        difficulty: 34,
        cpc: 1.2,
        monthlySearches: [],
    },
    {
        keyword: 'crawl error finder',
        searchVolume: 720,
        difficulty: 28,
        cpc: null,
        monthlySearches: [],
    },
    {
        keyword: 'meta tag inspector',
        searchVolume: null,
        difficulty: null,
        cpc: null,
        monthlySearches: [],
    },
];
export const FAKE_LONG_TAIL_SUGGESTIONS: KeywordMetrics[] = [
    {
        keyword: 'how to use an seo audit tool',
        searchVolume: 590,
        difficulty: 27,
        cpc: 2.1,
        monthlySearches: [],
    },
    {
        keyword: 'best seo audit tool for small business',
        searchVolume: 320,
        difficulty: 33,
        cpc: 3.4,
        monthlySearches: [],
    },
];
/**
 * Deterministic SERP-feature overview per keyword. Covers each closed-enum
 * `SerpFeatureType` across the fake set so downstream UI/spec tests never
 * need a live vendor to see every feature badge.
 */
export const FAKE_KEYWORD_OVERVIEW: KeywordOverview[] = [
    {
        keyword: 'seo audit tool',
        searchVolume: 5400,
        difficulty: 62,
        cpc: 4.12,
        intent: 'commercial',
        serpFeatures: ['ai_overview', 'featured_snippet', 'people_also_ask'],
        observedAt: FAKE_CLOCK,
        resultsCount: 128000000,
    },
    {
        keyword: 'rank tracker',
        searchVolume: 8100,
        difficulty: 74,
        cpc: 6.45,
        intent: 'transactional',
        serpFeatures: ['video', 'shopping'],
        observedAt: FAKE_CLOCK,
        resultsCount: 41200000,
    },
    {
        keyword: 'obscure long-tail phrase',
        searchVolume: null,
        difficulty: null,
        cpc: null,
        intent: null,
        serpFeatures: [],
        observedAt: null,
        resultsCount: null,
    },
];
/** Deterministic 4-year monthly history for the anchor keyword and a partial-series peer. */
function fakeMonthlySeries(base: number): {
    year: number;
    month: number;
    searchVolume: number;
}[] {
    const out: {
        year: number;
        month: number;
        searchVolume: number;
    }[] = [];
    for (let year = 2022; year <= 2025; year += 1) {
        for (let month = 1; month <= 12; month += 1) {
            // Slow linear growth + a mild seasonal ripple so downstream trend-math
            // (yoy delta, momentum, seasonality) has a real signal to bite on.
            const offset = (year - 2022) * 12 + (month - 1);
            const seasonal = month >= 10 || month <= 2 ? 200 : 0;
            out.push({ year, month, searchVolume: base + offset * 25 + seasonal });
        }
    }
    return out;
}
export const FAKE_KEYWORD_HISTORICAL_VOLUME: KeywordHistoricalVolume[] = [
    { keyword: 'seo audit tool', monthlySearches: fakeMonthlySeries(4800) },
    {
        keyword: 'rank tracker',
        monthlySearches: [
            { year: 2025, month: 10, searchVolume: 7700 },
            { year: 2025, month: 11, searchVolume: 7900 },
            { year: 2025, month: 12, searchVolume: 8100 },
        ],
    },
    { keyword: 'obscure long-tail phrase', monthlySearches: [] },
];
export const FAKE_RANKED_SITE_KEYWORDS: SiteKeywordCandidate[] = [
    {
        keyword: 'seo audit tool',
        searchVolume: 5400,
        difficulty: 62,
        currentPosition: 4,
        estimatedTraffic: 630.5,
        rankingUrl: 'https://example.com/seo-audit',
    },
    {
        keyword: 'website audit checklist',
        searchVolume: 2900,
        difficulty: 41,
        currentPosition: 9,
        estimatedTraffic: 112.2,
        rankingUrl: 'https://example.com/checklist',
    },
];
export const FAKE_SITE_KEYWORD_IDEAS: SiteKeywordCandidate[] = FAKE_KEYWORD_IDEAS.map((row) => ({
    keyword: row.keyword,
    searchVolume: row.searchVolume,
    difficulty: null,
    currentPosition: null,
    estimatedTraffic: null,
    rankingUrl: null,
}));
export function createFakeKeywordProvider(opts: FakeKeywordProviderOptions = {}): KeywordProvider & SiteKeywordProvider {
    const metrics = opts.metrics ?? FAKE_KEYWORD_METRICS;
    const related = opts.related ?? FAKE_KEYWORD_METRICS;
    const intent = opts.intent ?? FAKE_INTENT_RESULTS;
    const ideas = opts.ideas ?? FAKE_KEYWORD_IDEAS;
    const longTailSuggestions = opts.longTailSuggestions ?? FAKE_LONG_TAIL_SUGGESTIONS;
    const overview = opts.overview ?? FAKE_KEYWORD_OVERVIEW;
    const historicalVolume = opts.historicalVolume ?? FAKE_KEYWORD_HISTORICAL_VOLUME;
    const rankedSiteKeywords = opts.rankedSiteKeywords ?? FAKE_RANKED_SITE_KEYWORDS;
    const siteKeywordIdeas = opts.siteKeywordIdeas ?? FAKE_SITE_KEYWORD_IDEAS;
    return {
        async listMarkets() {
            maybeFail(opts.failure);
            return cloneMarkets(FAKE_SEO_MARKETS);
        },
        async getMetrics() {
            maybeFail(opts.failure);
            return metrics;
        },
        async getRelated(_keyword, _location, _language, limit) {
            maybeFail(opts.failure);
            return related.slice(0, limit);
        },
        async classifyIntent() {
            maybeFail(opts.failure);
            return intent;
        },
        async getIdeas(_seed, _location, _language, limit) {
            maybeFail(opts.failure);
            return limit >= ideas.length ? ideas : ideas.slice(0, limit);
        },
        async getLongTailSuggestions(_seed, _location, _language, limit) {
            maybeFail(opts.failure);
            return longTailSuggestions.slice(0, limit);
        },
        async getOverview() {
            maybeFail(opts.failure);
            return overview;
        },
        async getHistoricalVolume() {
            maybeFail(opts.failure);
            return historicalVolume;
        },
        async getRankedKeywordsForSite(_domain, _location, _language, limit) {
            maybeFail(opts.failure);
            return rankedSiteKeywords.slice(0, limit);
        },
        async getKeywordIdeasForSite(_seeds, _location, _language, limit) {
            maybeFail(opts.failure);
            return siteKeywordIdeas.slice(0, limit);
        },
    };
}
// ---------------------------------------------------------------------------
// Backlinks
// ---------------------------------------------------------------------------
export type FakeBacklinkDeepScenario = 'full' | 'partial' | 'empty' | 'malformed' | 'quota' | 'timeout';
export type FakeBacklinkDeepOp = 'referring-domains' | 'anchors' | 'history' | 'bulk-ranks' | 'bulk-spam-scores' | 'competitors';
/** Sentinel prefix a domain/keyword must carry to force a scenario override. */
export const BACKLINK_DEEP_SCENARIO_PREFIX = '__scenario:';
/**
 * DNS-valid sentinel used by composed-stack/browser tests that must cross the
 * real domain validation boundary. Example: `scenario-timeout.test`.
 * This is interpreted only by the fake provider; live adapters receive it as
 * an ordinary domain and therefore cannot activate test behavior.
 */
export const BACKLINK_DEEP_DNS_SCENARIO_SUFFIX = '.test';
export interface FakeBacklinkProviderOptions extends FakeProviderOptions {
    summary?: BacklinkSummary;
    page?: BacklinkListPage;
    /**
     * Per-op scenario override. If unset, the scenario is resolved from the
     * first input token's `__scenario:<name>` sentinel; otherwise `full`.
     */
    scenarios?: Partial<Record<FakeBacklinkDeepOp, FakeBacklinkDeepScenario>>;
}
export const FAKE_BACKLINK_SUMMARY: BacklinkSummary = {
    domainRank: 412,
    backlinks: 1543,
    referringDomains: 208,
    brokenBacklinks: 12,
    firstSeen: FAKE_CLOCK,
};
export const FAKE_BACKLINK_PAGE: BacklinkListPage = {
    rows: [
        {
            domainFrom: 'blog.example.net',
            urlFrom: 'https://blog.example.net/best-tools',
            urlTo: 'https://example.com/',
            anchor: 'example tool',
            dofollow: true,
            isBroken: false,
            firstSeen: FAKE_CLOCK,
            lastSeen: FAKE_CLOCK,
            backlinkSpamScore: 70,
            urlToSpamScore: 2,
        },
        {
            domainFrom: 'watch.example.org',
            urlFrom: 'https://watch.example.org/resources/rankme',
            urlTo: 'https://example.com/resources',
            anchor: 'resources',
            dofollow: true,
            isBroken: false,
            firstSeen: FAKE_CLOCK,
            lastSeen: FAKE_CLOCK,
            backlinkSpamScore: 45,
            urlToSpamScore: 2,
        },
        {
            domainFrom: 'clean.example.co',
            urlFrom: 'https://clean.example.co/partners',
            urlTo: 'https://example.com/',
            anchor: null,
            dofollow: false,
            isBroken: false,
            firstSeen: FAKE_CLOCK,
            lastSeen: FAKE_CLOCK,
            backlinkSpamScore: 10,
            urlToSpamScore: 2,
        },
    ],
    nextCursor: 'fake-cursor-2',
};
/**
 * Full deterministic row bank per deep op. `partial` slices the first two
 * rows; `empty` returns []; `malformed`/`quota`/`timeout` reject via the
 * shared taxonomy before any row is inspected.
 */
export const FAKE_REFERRING_DOMAINS: BacklinkReferringDomainRow[] = [
    {
        domain: 'blog.example.net',
        backlinks: 82,
        domainRank: 71,
        firstSeen: FAKE_CLOCK,
        lastSeen: FAKE_CLOCK,
    },
    {
        domain: 'partners.example.org',
        backlinks: 34,
        domainRank: 48,
        firstSeen: FAKE_CLOCK,
        lastSeen: FAKE_CLOCK,
    },
    {
        domain: 'news.example.co',
        backlinks: 17,
        domainRank: null,
        firstSeen: null,
        lastSeen: null,
    },
];
export const FAKE_BACKLINK_ANCHORS: BacklinkAnchorRow[] = [
    { anchor: 'example tool', backlinks: 210, referringDomains: 84 },
    { anchor: 'rank tracker', backlinks: 121, referringDomains: 63 },
    { anchor: 'seo audit', backlinks: 44, referringDomains: 21 },
];
export const FAKE_BACKLINK_HISTORY: BacklinkHistoryPoint[] = [
    { year: 2024, month: 10, backlinks: 1200, referringDomains: 150 },
    { year: 2024, month: 11, backlinks: 1350, referringDomains: 172 },
    { year: 2024, month: 12, backlinks: 1543, referringDomains: 208 },
];
export const FAKE_BACKLINK_BULK_RANKS: BacklinkBulkRankRow[] = [
    { domain: 'example.com', rank: 64 },
    { domain: 'rival-one.example', rank: 55 },
    { domain: 'no-rank.example', rank: null },
];
export const FAKE_BACKLINK_SPAM_SCORES: BacklinkSpamScoreRow[] = [
    { target: 'blog.example.net', spamScore: 70 },
    { target: 'watch.example.org', spamScore: 45 },
    { target: 'clean.example.co', spamScore: 10 },
];
export const FAKE_BACKLINK_COMPETITORS: BacklinkCompetitorRow[] = [
    { domain: 'rival-one.example', intersections: 118, rank: 55 },
    { domain: 'rival-two.example', intersections: 63, rank: 41 },
    { domain: 'niche-three.example', intersections: 22, rank: null },
];
const BACKLINK_DEEP_SCENARIOS: readonly FakeBacklinkDeepScenario[] = [
    'full',
    'partial',
    'empty',
    'malformed',
    'quota',
    'timeout',
];
/**
 * Resolve a scenario from the first token's sentinel prefix. Unknown labels
 * fall back to `undefined` so the factory can choose `full`.
 */
export function resolveBacklinkDeepScenarioFromInput(first: string | undefined): FakeBacklinkDeepScenario | undefined {
    if (typeof first !== 'string')
        return undefined;
    const normalized = first.trim().toLowerCase();
    const label = normalized.startsWith(BACKLINK_DEEP_SCENARIO_PREFIX)
        ? normalized.slice(BACKLINK_DEEP_SCENARIO_PREFIX.length)
        : normalized.startsWith('scenario-') &&
            normalized.endsWith(BACKLINK_DEEP_DNS_SCENARIO_SUFFIX)
            ? normalized.slice('scenario-'.length, -BACKLINK_DEEP_DNS_SCENARIO_SUFFIX.length)
            : '';
    if (!label)
        return undefined;
    return (BACKLINK_DEEP_SCENARIOS as readonly string[]).includes(label)
        ? (label as FakeBacklinkDeepScenario)
        : undefined;
}
function backlinkDeepScenarioError(scenario: FakeBacklinkDeepScenario | undefined, op: FakeBacklinkDeepOp): ProviderError | undefined {
    const ctx = { provider: 'fake', operation: `backlinks-${op}` };
    if (scenario === 'malformed')
        return new VendorMalformedError(`fake backlinks ${op} scenario: malformed`, ctx);
    if (scenario === 'timeout')
        return new VendorTimeoutError(`fake backlinks ${op} scenario: timeout`, ctx);
    if (scenario === 'quota')
        return new VendorQuotaError(`fake backlinks ${op} scenario: quota`, ctx);
    return undefined;
}
function shapeDeepRows<T>(scenario: FakeBacklinkDeepScenario, full: readonly T[]): T[] {
    if (scenario === 'empty')
        return [];
    if (scenario === 'partial')
        return full.slice(0, 2);
    return full.slice();
}
export function createFakeBacklinkProvider(opts: FakeBacklinkProviderOptions = {}): Required<BacklinkProvider> {
    const summary = opts.summary ?? FAKE_BACKLINK_SUMMARY;
    const page = opts.page ?? FAKE_BACKLINK_PAGE;
    function scenarioFor(op: FakeBacklinkDeepOp, first: string | undefined): FakeBacklinkDeepScenario {
        return (opts.scenarios?.[op] ??
            resolveBacklinkDeepScenarioFromInput(first) ??
            'full');
    }
    return {
        async getSummary() {
            maybeFail(opts.failure);
            return summary;
        },
        async listBacklinks(domain) {
            maybeFail(opts.failure);
            const scenario = resolveBacklinkDeepScenarioFromInput(domain);
            if (scenario && ['malformed', 'quota', 'timeout'].includes(scenario)) {
                const normalized = domain.toLowerCase();
                return {
                    rows: [
                        {
                            domainFrom: normalized,
                            urlFrom: `https://${normalized}/source`,
                            urlTo: 'https://example.com/',
                            anchor: null,
                            dofollow: true,
                            isBroken: false,
                            firstSeen: FAKE_CLOCK,
                            lastSeen: FAKE_CLOCK,
                            backlinkSpamScore: null,
                            urlToSpamScore: 0,
                        },
                    ],
                };
            }
            return page;
        },
        async getReferringDomains(domain, opsInput) {
            const scenario = scenarioFor('referring-domains', domain);
            maybeFail(opts.failure ?? backlinkDeepScenarioError(scenario, 'referring-domains'));
            return shapeDeepRows(scenario, FAKE_REFERRING_DOMAINS).slice(0, opsInput.limit);
        },
        async getAnchors(domain, opsInput) {
            const scenario = scenarioFor('anchors', domain);
            maybeFail(opts.failure ?? backlinkDeepScenarioError(scenario, 'anchors'));
            return shapeDeepRows(scenario, FAKE_BACKLINK_ANCHORS).slice(0, opsInput.limit);
        },
        async getHistory(domain, opsInput) {
            const scenario = scenarioFor('history', domain);
            maybeFail(opts.failure ?? backlinkDeepScenarioError(scenario, 'history'));
            // History caps to the NEWEST `limit` points — trim from the tail.
            return shapeDeepRows(scenario, FAKE_BACKLINK_HISTORY).slice(-opsInput.limit);
        },
        async getBulkRanks(domains) {
            const scenario = scenarioFor('bulk-ranks', domains[0]);
            maybeFail(opts.failure ?? backlinkDeepScenarioError(scenario, 'bulk-ranks'));
            return shapeDeepRows(scenario, FAKE_BACKLINK_BULK_RANKS);
        },
        async getBulkSpamScores(targets) {
            const scenario = scenarioFor('bulk-spam-scores', targets[0]);
            maybeFail(opts.failure ?? backlinkDeepScenarioError(scenario, 'bulk-spam-scores'));
            if (scenario === 'empty')
                return [];
            const scores = [70, 45, 10] as const;
            const seededScores = new Map(FAKE_BACKLINK_SPAM_SCORES.map((row) => [row.target, row.spamScore]));
            const rows = targets.map((target, index) => {
                const normalized = target.toLowerCase();
                return {
                    target: normalized,
                    spamScore: seededScores.get(normalized) ?? scores[index % scores.length]!,
                };
            });
            return scenario === 'partial' ? rows.slice(0, 2) : rows;
        },
        async getBacklinkCompetitors(domain, opsInput) {
            const scenario = scenarioFor('competitors', domain);
            maybeFail(opts.failure ?? backlinkDeepScenarioError(scenario, 'competitors'));
            return shapeDeepRows(scenario, FAKE_BACKLINK_COMPETITORS).slice(0, opsInput.limit);
        },
    };
}
// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------
/**
 * Traffic-op scenarios. Full = deterministic bank,
 * empty = [], the three error scenarios reject via the shared taxonomy
 * before any row is inspected.
 */
export type FakeCompetitorTrafficScenario = 'full' | 'empty' | 'malformed' | 'quota' | 'timeout';
/** Op key for the additive traffic trio. */
export type FakeCompetitorTrafficOp = 'traffic-estimation' | 'domain-rank-overview' | 'historical-rank-overview';
/** Sentinel prefix — SAME string as the backlink deep scenario resolver. */
export const COMPETITOR_TRAFFIC_SCENARIO_PREFIX = BACKLINK_DEEP_SCENARIO_PREFIX;
export interface FakeCompetitorProviderOptions extends FakeProviderOptions {
    competitors?: CompetitorEntry[];
    serpCompetitors?: CompetitorEntry[];
    /**
     * Failure scoped to `getSerpCompetitors` only — lets tests simulate
     * "primary list ok / keyword fallback fails" without touching the other
     * methods. Falls back to the provider-wide `failure` when unset.
     */
    serpFailure?: ProviderError;
    /** Failure scoped to the exact three-leg comparison method. */
    comparisonFailure?: ProviderError;
    intersection?: DomainIntersectionRow[];
    /** Canned comparison rows; duplicate keys are normalized before return. */
    comparison?: DomainComparisonResult;
    techStack?: TechStackEntry[];
    /**
     * Deterministic override banks — omitted → the shipped `FAKE_*` constants
     * are used.
     */
    trafficEstimation?: TrafficEstimationRow[];
    domainRankOverview?: DomainRankOverviewRow;
    historicalRankOverview?: HistoricalRankOverviewResult;
    /**
     * Per-op scenario override for the additive traffic trio. Unset → the
     * scenario is resolved from the first input token's `__scenario:<name>`
     * sentinel; otherwise `full`.
     */
    trafficScenarios?: Partial<Record<FakeCompetitorTrafficOp, FakeCompetitorTrafficScenario>>;
}
export const FAKE_COMPETITORS: CompetitorEntry[] = [
    { domain: 'example.org', avgPosition: 4.2, intersections: 118, estimatedTraffic: 20500 },
    { domain: 'example.net', avgPosition: null, intersections: 34, estimatedTraffic: null },
];
/**
 * Distinct domains from `FAKE_COMPETITORS` so tests can tell which source
 * (domain-derived vs tracked-keyword-derived) produced a result set.
 */
export const FAKE_SERP_COMPETITORS: CompetitorEntry[] = [
    { domain: 'iana.org', avgPosition: 1, intersections: 3, estimatedTraffic: 231.04 },
    { domain: 'w3.org', avgPosition: 8, intersections: 1, estimatedTraffic: null },
];
export const FAKE_INTERSECTION: DomainIntersectionRow[] = [
    { keyword: 'seo audit tool', target1Position: null, target2Position: 7, searchVolume: 5400 },
    { keyword: 'rank tracker', target1Position: null, target2Position: 2, searchVolume: null },
];
const FAKE_COMPARISON_META = buildObservationMeta({
    sourceKind: 'provider_observation',
    sourceLabel: 'dataforseo',
    observedAt: FAKE_CLOCK,
    market: marketFromDataForSeo({ locationCode: 2840, languageCode: 'en' }),
    sampleCount: 1,
    now: FAKE_CLOCK,
});
function fakeComparisonRow(row: Omit<DomainComparisonRow, 'normalizedKeyword' | 'observationMeta'>): DomainComparisonRow {
    return {
        ...row,
        normalizedKeyword: '',
        observationMeta: FAKE_COMPARISON_META,
    };
}
const FAKE_DOMAIN_COMPARISON_WITH_DUPLICATES: DomainComparisonResult = {
    shared: [
        fakeComparisonRow({
            keyword: 'SEO Audit Tool',
            ownedPosition: 8,
            competitorPosition: 3,
            ownedRankAbsolute: 9,
            competitorRankAbsolute: 4,
            ownedUrl: 'https://example.com/guides/seo-audit',
            competitorUrl: 'https://rival-one.example/seo-audit',
            searchVolume: 5400,
            keywordDifficulty: 68,
            intent: 'commercial',
        }),
        // Same normalized key; the better owned rank wins as one whole row.
        fakeComparisonRow({
            keyword: ' seo   audit tool ',
            ownedPosition: 2,
            competitorPosition: 3,
            ownedRankAbsolute: 2,
            competitorRankAbsolute: 4,
            ownedUrl: 'https://example.com/seo-audit',
            competitorUrl: 'https://rival-one.example/seo-audit',
            searchVolume: 5400,
            keywordDifficulty: 68,
            intent: 'commercial',
        }),
        fakeComparisonRow({
            keyword: 'rank tracker',
            ownedPosition: 5,
            competitorPosition: 5,
            ownedRankAbsolute: 6,
            competitorRankAbsolute: 6,
            ownedUrl: null,
            competitorUrl: null,
            searchVolume: null,
            keywordDifficulty: null,
            intent: null,
        }),
    ],
    ownedOnly: [
        fakeComparisonRow({
            keyword: 'owned keyword',
            ownedPosition: 4,
            competitorPosition: null,
            ownedRankAbsolute: 5,
            competitorRankAbsolute: null,
            ownedUrl: 'https://example.com/owned-keyword',
            competitorUrl: null,
            searchVolume: 320,
            keywordDifficulty: 31,
            intent: 'informational',
        }),
    ],
    competitorOnly: [
        fakeComparisonRow({
            keyword: 'missing keyword',
            ownedPosition: null,
            competitorPosition: 2,
            ownedRankAbsolute: null,
            competitorRankAbsolute: 3,
            ownedUrl: null,
            competitorUrl: 'https://rival-one.example/missing-keyword',
            searchVolume: 1300,
            keywordDifficulty: 52,
            intent: 'transactional',
        }),
        fakeComparisonRow({
            keyword: 'null url opportunity',
            ownedPosition: null,
            competitorPosition: 7,
            ownedRankAbsolute: null,
            competitorRankAbsolute: 9,
            ownedUrl: null,
            competitorUrl: null,
            searchVolume: null,
            keywordDifficulty: null,
            intent: null,
        }),
    ],
};
export const FAKE_DOMAIN_COMPARISON = normalizeDomainComparisonResult(FAKE_DOMAIN_COMPARISON_WITH_DUPLICATES);
function rebaseFakeComparisonUrl(value: string | null, origin: string): string | null {
    if (value === null)
        return null;
    const source = new URL(value);
    return new URL(`${source.pathname}${source.search}${source.hash}`, origin).toString();
}
function rebaseFakeComparison(result: DomainComparisonResult, ownedOrigin: string, competitorOrigin: string): DomainComparisonResult {
    const rebase = (row: DomainComparisonRow): DomainComparisonRow => ({
        ...row,
        ownedUrl: rebaseFakeComparisonUrl(row.ownedUrl, ownedOrigin),
        competitorUrl: rebaseFakeComparisonUrl(row.competitorUrl, competitorOrigin),
    });
    return {
        shared: result.shared.map(rebase),
        ownedOnly: result.ownedOnly.map(rebase),
        competitorOnly: result.competitorOnly.map(rebase),
    };
}
/**
 * DNS-valid, fake-only landscape comparison sentinels. They let the composed
 * browser gate prove per-competitor partial isolation through the real queue
 * and worker while every outbound provider remains disabled.
 */
export const FAKE_LANDSCAPE_MALFORMED_DOMAIN = 'example.edu';
export const FAKE_LANDSCAPE_TIMEOUT_DOMAIN = 'one.one.one.one';
/**
 * One entry per `TechStackCategory` so demos/E2E exercise every badge kind.
 * `'other'` here stands in for the runtime normalization of an unrecognized
 * vendor category (see `mapVendorTechCategory`) — the fake surfaces the same
 * shape the live adapter emits after that normalization.
 */
export const FAKE_TECH_STACK: TechStackEntry[] = [
    { category: 'cms', name: 'WordPress' },
    { category: 'analytics', name: 'Google Analytics' },
    { category: 'hosting', name: 'Cloudflare' },
    { category: 'ecommerce', name: 'WooCommerce' },
    { category: 'other', name: 'Intercom' },
];
/** Deterministic top-countries bank shared across the traffic banks. */
const FAKE_TRAFFIC_TOP_COUNTRIES: TrafficEstimationCountry[] = [
    { countryCode: 'US', visits: 8200 },
    { countryCode: 'DE', visits: 2100 },
    { countryCode: 'FR', visits: 900 },
];
export const FAKE_TRAFFIC_ESTIMATION: TrafficEstimationRow[] = [
    {
        domain: 'example.com',
        monthlyOrganicVisits: 12400,
        topCountries: FAKE_TRAFFIC_TOP_COUNTRIES,
    },
    {
        domain: 'rival-one.example',
        monthlyOrganicVisits: 4650,
        topCountries: [
            { countryCode: 'US', visits: 3200 },
            { countryCode: 'GB', visits: 950 },
        ],
    },
    {
        domain: 'niche-three.example',
        monthlyOrganicVisits: 0,
        topCountries: [],
    },
];
export const FAKE_DOMAIN_RANK_OVERVIEW: DomainRankOverviewRow = {
    domain: 'example.com',
    rank: 64,
    keywordsCount: 1820,
    estimatedMonthlyOrganicVisits: 12400,
};
export const FAKE_HISTORICAL_RANK_OVERVIEW: HistoricalRankOverviewResult = {
    domain: 'example.com',
    points: [
        { year: 2024, month: 10, rank: 58, organicKeywords: 1540, organicEtv: 9800 },
        { year: 2024, month: 11, rank: 61, organicKeywords: 1680, organicEtv: 10950 },
        { year: 2024, month: 12, rank: 64, organicKeywords: 1820, organicEtv: 12400 },
    ],
};
const COMPETITOR_TRAFFIC_SCENARIOS: readonly FakeCompetitorTrafficScenario[] = [
    'full',
    'empty',
    'malformed',
    'quota',
    'timeout',
];
/**
 * Resolve a scenario from the first token's sentinel prefix. Unknown labels
 * fall back to `undefined` so the factory can choose `full`.
 */
export function resolveCompetitorTrafficScenarioFromInput(first: string | undefined): FakeCompetitorTrafficScenario | undefined {
    if (typeof first !== 'string')
        return undefined;
    // DNS-valid browser-test aliases. `error.example` is the shipped all-fail
    // scenario (non-retryable malformed responses across all three operations);
    // `timeout.example` exercises the retryable timeout path. Keeping these in
    // the fake adapter means production validation and routing remain active.
    if (first === 'error.example')
        return 'malformed';
    if (first === 'timeout.example')
        return 'timeout';
    if (!first.startsWith(COMPETITOR_TRAFFIC_SCENARIO_PREFIX))
        return undefined;
    const label = first.slice(COMPETITOR_TRAFFIC_SCENARIO_PREFIX.length).trim().toLowerCase();
    return (COMPETITOR_TRAFFIC_SCENARIOS as readonly string[]).includes(label)
        ? (label as FakeCompetitorTrafficScenario)
        : undefined;
}
function competitorTrafficScenarioError(scenario: FakeCompetitorTrafficScenario | undefined, op: FakeCompetitorTrafficOp): ProviderError | undefined {
    const ctx = { provider: 'fake', operation: `labs-competitors-${op}` };
    if (scenario === 'malformed')
        return new VendorMalformedError(`fake competitor ${op} scenario: malformed`, ctx);
    if (scenario === 'timeout')
        return new VendorTimeoutError(`fake competitor ${op} scenario: timeout`, ctx);
    if (scenario === 'quota')
        return new VendorQuotaError(`fake competitor ${op} scenario: quota`, ctx);
    return undefined;
}
export function createFakeCompetitorProvider(opts: FakeCompetitorProviderOptions = {}): Required<CompetitorProvider> {
    const competitors = opts.competitors ?? FAKE_COMPETITORS;
    const serpCompetitors = opts.serpCompetitors ?? FAKE_SERP_COMPETITORS;
    const intersection = opts.intersection ?? FAKE_INTERSECTION;
    const comparison = opts.comparison ?? FAKE_DOMAIN_COMPARISON_WITH_DUPLICATES;
    const rebaseDefaultComparison = opts.comparison === undefined;
    const techStack = opts.techStack ?? FAKE_TECH_STACK;
    const trafficEstimation = opts.trafficEstimation ?? FAKE_TRAFFIC_ESTIMATION;
    const domainRankOverview = opts.domainRankOverview ?? FAKE_DOMAIN_RANK_OVERVIEW;
    const historicalRankOverview = opts.historicalRankOverview ?? FAKE_HISTORICAL_RANK_OVERVIEW;
    function trafficScenarioFor(op: FakeCompetitorTrafficOp, first: string | undefined): FakeCompetitorTrafficScenario {
        return (opts.trafficScenarios?.[op] ??
            resolveCompetitorTrafficScenarioFromInput(first) ??
            'full');
    }
    return {
        async getCompetitors(_domain, _location, _language, limit) {
            maybeFail(opts.failure);
            return competitors.slice(0, limit);
        },
        async getSerpCompetitors(_keywords, _location, _language, limit) {
            maybeFail(opts.serpFailure ?? opts.failure);
            return serpCompetitors.slice(0, limit);
        },
        async getDomainIntersection() {
            maybeFail(opts.failure);
            return intersection;
        },
        async compareDomains(input) {
            if (input.competitorDomain === FAKE_LANDSCAPE_MALFORMED_DOMAIN) {
                throw new VendorMalformedError('fake landscape comparison scenario: malformed', {
                    provider: 'fake',
                    operation: 'domain-comparison',
                });
            }
            if (input.competitorDomain === FAKE_LANDSCAPE_TIMEOUT_DOMAIN) {
                throw new VendorTimeoutError('fake landscape comparison scenario: timeout', {
                    provider: 'fake',
                    operation: 'domain-comparison',
                });
            }
            maybeFail(opts.comparisonFailure ?? opts.failure);
            const normalized = normalizeDomainComparisonResult(comparison);
            return rebaseDefaultComparison
                ? rebaseFakeComparison(normalized, input.ownedOrigin, input.competitorOrigin)
                : normalized;
        },
        async getTechnologies() {
            maybeFail(opts.failure);
            return techStack;
        },
        async getTrafficEstimation(domains) {
            const first = Array.isArray(domains) ? domains[0] : undefined;
            const scenario = trafficScenarioFor('traffic-estimation', first);
            maybeFail(opts.failure ?? competitorTrafficScenarioError(scenario, 'traffic-estimation'));
            if (scenario === 'empty')
                return [];
            return trafficEstimation.slice();
        },
        async getDomainRankOverview(domain) {
            const scenario = trafficScenarioFor('domain-rank-overview', domain);
            maybeFail(opts.failure ?? competitorTrafficScenarioError(scenario, 'domain-rank-overview'));
            if (scenario === 'empty') {
                return {
                    domain: domainRankOverview.domain,
                    rank: null,
                    keywordsCount: 0,
                    estimatedMonthlyOrganicVisits: 0,
                };
            }
            return { ...domainRankOverview };
        },
        async getHistoricalRankOverview(domain, opsInput) {
            const scenario = trafficScenarioFor('historical-rank-overview', domain);
            maybeFail(opts.failure ??
                competitorTrafficScenarioError(scenario, 'historical-rank-overview'));
            if (scenario === 'empty') {
                return { domain: historicalRankOverview.domain, points: [] };
            }
            // Historical caps to the NEWEST `limit` points — trim from the tail.
            const points = historicalRankOverview.points.slice(-opsInput.limit);
            return { domain: historicalRankOverview.domain, points };
        },
    };
}
// ---------------------------------------------------------------------------
// Page speed
// ---------------------------------------------------------------------------
export interface FakePageSpeedProviderOptions extends FakeProviderOptions {
    result?: PageSpeedResult;
}
export const FAKE_PAGESPEED_RESULT: PageSpeedResult & {
    fieldDataLevel: 'url';
} = {
    labScores: { performance: 92, seo: 100, accessibility: 88, bestPractices: 96 },
    coreWebVitals: { lcpMs: 1840, inp: 120, cls: 0.04, category: 'good' },
    mobileFriendly: true,
    fieldDataLevel: 'url',
};
export function createFakePageSpeedProvider(opts: FakePageSpeedProviderOptions = {}): PageSpeedProvider {
    const result = opts.result ?? FAKE_PAGESPEED_RESULT;
    return {
        async analyze() {
            maybeFail(opts.failure);
            return result;
        },
    };
}
// ---------------------------------------------------------------------------
// Google Search Console
// ---------------------------------------------------------------------------
export interface FakeGscProviderOptions extends FakeProviderOptions {
    properties?: GscProperty[];
    inspection?: GscUrlInspection;
    searchAnalytics?: GscSearchAnalyticsResult;
    /**
     * Per-dimension Search Analytics results keyed by the FIRST requested
     * dimension (`date` | `query` | `page` | `country` | `device`). When the
     * requested `input.dimensions[0]` has an entry the mapped result is returned
     * (window + dimensions echoed); otherwise the fake falls back to
     * `searchAnalytics`. Lets the five-dimension sync + the panel breakdowns
     * (timeseries / countries / devices) be asserted without a live vendor.
     */
    searchAnalyticsByDimension?: Record<string, GscSearchAnalyticsResult>;
    sitemaps?: GscSitemapEntry[];
}
export const FAKE_GSC_PROPERTIES: GscProperty[] = [
    { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
    { siteUrl: 'https://example.com/', permissionLevel: 'siteFullUser' },
];
export const FAKE_GSC_INSPECTION: GscUrlInspection = {
    indexVerdict: 'PASS',
    coverageState: 'Submitted and indexed',
    robotsTxtState: 'ALLOWED',
    pageFetchState: 'SUCCESSFUL',
    googleCanonical: 'https://example.com/',
    lastCrawlTime: FAKE_CLOCK,
    richResults: { verdict: 'PASS', items: [{ type: 'FAQ', issues: 0 }] },
};
export const FAKE_GSC_SEARCH_ANALYTICS: GscSearchAnalyticsResult = {
    rows: [
        {
            keys: ['seo audit tool'],
            clicks: 180,
            impressions: 5400,
            ctr: 180 / 5400,
            position: 4.2,
        },
        {
            keys: ['rank tracker'],
            clicks: 42,
            impressions: 6100,
            ctr: 42 / 6100,
            position: 8.9,
        },
        {
            keys: ['website health check'],
            clicks: 12,
            impressions: 800,
            ctr: 12 / 800,
            position: 12.4,
        },
    ],
    sampled: true,
    startDate: '2025-12-01',
    endDate: '2025-12-29',
    dimensions: ['query'],
};
/**
 * Per-dimension Search Analytics fixtures. Distinct row keys per
 * dimension so a test can prove WHICH dimension_set produced WHICH persisted
 * rows, and so the summary breakdowns (timeseries / countries / devices) are
 * asserted end-to-end. Dates are intentionally out of chronological order so
 * the ascending re-sort of the timeseries is exercised.
 */
export const FAKE_GSC_SEARCH_ANALYTICS_DATE: GscSearchAnalyticsResult = {
    rows: [
        { keys: ['2026-06-08'], clicks: 18, impressions: 520, ctr: 18 / 520, position: 5.4 },
        { keys: ['2026-06-07'], clicks: 12, impressions: 400, ctr: 12 / 400, position: 6.1 },
        { keys: ['2026-06-09'], clicks: 9, impressions: 300, ctr: 9 / 300, position: 7.2 },
    ],
    sampled: true,
    startDate: '2026-06-07',
    endDate: '2026-07-04',
    dimensions: ['date'],
};
export const FAKE_GSC_SEARCH_ANALYTICS_COUNTRY: GscSearchAnalyticsResult = {
    rows: [
        { keys: ['usa'], clicks: 140, impressions: 4200, ctr: 140 / 4200, position: 4.8 },
        { keys: ['gbr'], clicks: 40, impressions: 1600, ctr: 40 / 1600, position: 6.0 },
    ],
    sampled: true,
    startDate: '2026-06-07',
    endDate: '2026-07-04',
    dimensions: ['country'],
};
export const FAKE_GSC_SEARCH_ANALYTICS_DEVICE: GscSearchAnalyticsResult = {
    rows: [
        { keys: ['DESKTOP'], clicks: 120, impressions: 3800, ctr: 120 / 3800, position: 4.5 },
        { keys: ['MOBILE'], clicks: 90, impressions: 3400, ctr: 90 / 3400, position: 6.7 },
        { keys: ['TABLET'], clicks: 6, impressions: 240, ctr: 6 / 240, position: 8.9 },
    ],
    sampled: true,
    startDate: '2026-06-07',
    endDate: '2026-07-04',
    dimensions: ['device'],
};
/**
 * `query,page` fixture. Two queries are split across two owned
 * pages each — the shape cannibalization detection exists to surface — and one
 * query sits on a single page so a fake-backed test can prove a non-candidate
 * is NOT reported.
 */
export const FAKE_GSC_SEARCH_ANALYTICS_QUERY_PAGE: GscSearchAnalyticsResult = {
    rows: [
        {
            keys: ['seo audit tool', 'https://example.com/seo-audit'],
            clicks: 120,
            impressions: 3000,
            ctr: 120 / 3000,
            position: 4.1,
        },
        {
            keys: ['seo audit tool', 'https://example.com/blog/seo-audit-guide'],
            clicks: 60,
            impressions: 2400,
            ctr: 60 / 2400,
            position: 9.3,
        },
        {
            keys: ['rank tracker', 'https://example.com/rank-tracker'],
            clicks: 30,
            impressions: 3100,
            ctr: 30 / 3100,
            position: 7.5,
        },
        {
            keys: ['rank tracker', 'https://example.com/blog/rank-tracking-tips'],
            clicks: 12,
            impressions: 3000,
            ctr: 12 / 3000,
            position: 11.2,
        },
        {
            keys: ['website health check', 'https://example.com/health-check'],
            clicks: 12,
            impressions: 800,
            ctr: 12 / 800,
            position: 12.4,
        },
    ],
    sampled: true,
    startDate: '2026-06-07',
    endDate: '2026-07-04',
    dimensions: ['query', 'page'],
};
export const FAKE_GSC_SITEMAPS: GscSitemapEntry[] = [
    {
        path: 'https://example.com/sitemap.xml',
        type: 'sitemap',
        lastSubmitted: FAKE_CLOCK,
        lastDownloaded: FAKE_CLOCK,
        isPending: false,
        isSitemapsIndex: false,
        errors: 0,
        warnings: 0,
        processed: 128,
    },
    {
        path: 'https://example.com/sitemap-broken.xml',
        type: 'sitemap',
        lastSubmitted: FAKE_CLOCK,
        lastDownloaded: null,
        isPending: false,
        isSitemapsIndex: false,
        errors: 2,
        warnings: 1,
        processed: 0,
    },
];
/**
 * Default per-dimension overrides. Only `query,page` needs one: every other
 * dimension set still falls through to the single-key default fixture, so the
 * historical fake behaviour is unchanged. Without this a `['query','page']`
 * request would return one-key rows and the persisted `dimension_key` would
 * carry no separator — the reader would skip every row.
 */
const defaultByDimension: Record<string, GscSearchAnalyticsResult> = {
    'query,page': FAKE_GSC_SEARCH_ANALYTICS_QUERY_PAGE,
};
export function createFakeGscProvider(opts: FakeGscProviderOptions = {}): GoogleGscProvider {
    const properties = opts.properties ?? FAKE_GSC_PROPERTIES;
    const inspection = opts.inspection ?? FAKE_GSC_INSPECTION;
    const searchAnalytics = opts.searchAnalytics ?? FAKE_GSC_SEARCH_ANALYTICS;
    const sitemaps = opts.sitemaps ?? FAKE_GSC_SITEMAPS;
    return {
        async listProperties() {
            maybeFail(opts.failure);
            return properties;
        },
        async inspectUrl() {
            maybeFail(opts.failure);
            return inspection;
        },
        async querySearchAnalytics(_connection, input) {
            maybeFail(opts.failure);
            // Per-dimension override keyed by the WHOLE joined dimension set first
            // (`query,page`), then by the first dimension alone (the historical key),
            // then the single default result. Echo the requested window/dimensions so
            // downstream aggregation sees a coherent result even from the fake.
            // Caller overrides win; the `query,page` default still applies unless
            // the caller supplied its own — a partial map must not silently turn a
            // two-key request back into one-key rows.
            const overrides = {
                ...defaultByDimension,
                ...opts.searchAnalyticsByDimension,
            };
            const base = overrides[input.dimensions.join(',')] ??
                overrides[input.dimensions[0]!] ??
                searchAnalytics;
            return {
                ...base,
                startDate: input.startDate,
                endDate: input.endDate,
                dimensions: input.dimensions,
            };
        },
        async listSitemaps() {
            maybeFail(opts.failure);
            return sitemaps;
        },
        async refreshAccessToken() {
            maybeFail(opts.failure);
            return { accessToken: 'fake-access-token', expiresIn: 3600 };
        },
        async revokeToken() {
            maybeFail(opts.failure);
        },
    };
}
// ---------------------------------------------------------------------------
// GA4 (Analytics Data API runReport + Admin API account summaries)
// ---------------------------------------------------------------------------
export interface FakeGa4ProviderOptions extends FakeProviderOptions {
    properties?: Ga4Property[];
    webDataStreams?: Record<string, Ga4WebDataStream[]>;
    /** Default result when `reportByDimension` has no entry. */
    report?: Ga4RunReportResult;
    /** Per-dimension override keyed by the FIRST requested dimension. */
    reportByDimension?: Record<string, Ga4RunReportResult>;
    runReport?: (input: Ga4RunReportInput) => Promise<Ga4RunReportResult>;
}
export const FAKE_GA4_PROPERTIES: Ga4Property[] = [
    { propertyId: 'properties/100000001', displayName: 'example.com — GA4' },
    { propertyId: 'properties/100000002', displayName: 'Example Staging' },
];
export const FAKE_GA4_WEB_DATA_STREAMS: Record<string, Ga4WebDataStream[]> = {
    'properties/100000001': [
        {
            streamId: 'properties/100000001/dataStreams/200000001',
            displayName: 'example.com',
            defaultUri: 'https://example.com',
        },
    ],
    'properties/100000002': [
        {
            streamId: 'properties/100000002/dataStreams/200000002',
            displayName: 'staging.example.com',
            defaultUri: 'https://staging.example.com',
        },
    ],
};
/** Metric order everywhere: sessions, activeUsers, engagedSessions, keyEvents. */
export const FAKE_GA4_METRICS = [
    'sessions',
    'activeUsers',
    'engagedSessions',
    'keyEvents',
] as const;
function ga4Result(dimension: string, rows: Array<[
    string,
    number,
    number,
    number,
    number
]>): Ga4RunReportResult {
    return {
        rows: rows.map(([key, sessions, activeUsers, engagedSessions, keyEvents]) => ({
            dimensionValues: [key],
            metricValues: [sessions, activeUsers, engagedSessions, keyEvents],
        })),
        rowCount: rows.length,
        startDate: '2025-12-04',
        endDate: '2025-12-31',
        dimensions: [dimension],
        metrics: [...FAKE_GA4_METRICS],
    };
}
/**
 * Per-dimension GA4 fixtures — distinct keys per dimension so tests can prove
 * WHICH dimension produced WHICH persisted rows. Dates intentionally out of
 * chronological order (the snapshot reader re-sorts).
 */
export const FAKE_GA4_REPORT_DATE: Ga4RunReportResult = ga4Result('date', [
    ['20251230', 42, 38, 30, 3],
    ['20251229', 36, 31, 24, 2],
    ['20251231', 51, 44, 39, 5],
]);
export const FAKE_GA4_REPORT_CHANNEL: Ga4RunReportResult = ga4Result('sessionDefaultChannelGroup', [
    ['Organic Search', 74, 66, 58, 6],
    ['Direct', 33, 29, 21, 2],
    ['Referral', 22, 20, 15, 2],
]);
export const FAKE_GA4_REPORT_PAGE: Ga4RunReportResult = ga4Result('pagePath', [
    ['/', 58, 52, 44, 5],
    ['/pricing', 41, 37, 33, 4],
    ['/blog/seo-audit-checklist', 30, 26, 19, 1],
]);
export const FAKE_GA4_REPORT_COUNTRY: Ga4RunReportResult = ga4Result('country', [
    ['United States', 79, 71, 60, 7],
    ['United Kingdom', 31, 27, 22, 2],
]);
export const FAKE_GA4_REPORT_DEVICE: Ga4RunReportResult = ga4Result('deviceCategory', [
    ['desktop', 72, 64, 55, 6],
    ['mobile', 49, 44, 34, 3],
    ['tablet', 8, 7, 4, 1],
]);
export const FAKE_GA4_REPORTS_BY_DIMENSION: Record<string, Ga4RunReportResult> = {
    date: FAKE_GA4_REPORT_DATE,
    sessionDefaultChannelGroup: FAKE_GA4_REPORT_CHANNEL,
    pagePath: FAKE_GA4_REPORT_PAGE,
    country: FAKE_GA4_REPORT_COUNTRY,
    deviceCategory: FAKE_GA4_REPORT_DEVICE,
};
export function createFakeGa4Provider(opts: FakeGa4ProviderOptions = {}): Ga4Provider {
    const properties = opts.properties ?? FAKE_GA4_PROPERTIES;
    const webDataStreams = opts.webDataStreams ?? FAKE_GA4_WEB_DATA_STREAMS;
    const byDimension = opts.reportByDimension ?? FAKE_GA4_REPORTS_BY_DIMENSION;
    return {
        async listProperties() {
            maybeFail(opts.failure);
            return properties;
        },
        async listWebDataStreams(_connection, propertyId) {
            maybeFail(opts.failure);
            return webDataStreams[propertyId] ?? [];
        },
        async runReport(_connection, input) {
            maybeFail(opts.failure);
            if (opts.runReport)
                return opts.runReport(input);
            const base = byDimension[input.dimensions[0]!] ??
                opts.report ??
                FAKE_GA4_REPORT_DATE;
            // Echo the requested window/dimensions/metrics so downstream
            // aggregation sees a coherent result even from the fake.
            return {
                ...base,
                startDate: input.startDate,
                endDate: input.endDate,
                dimensions: input.dimensions,
                metrics: input.metrics,
            };
        },
    };
}
// ---------------------------------------------------------------------------
// AI Visibility (LLM mentions + LLM responses + AI keyword volume)
// ---------------------------------------------------------------------------
export interface FakeAiVisibilityProviderOptions extends FakeProviderOptions {
    mentions?: AiMentionRow[];
    answers?: AiAnswerRow[];
    keywordVolume?: AiKeywordVolume[];
    checkMentions?: (input: AiMentionCheckInput) => Promise<AiMentionRow[]>;
    getAnswers?: (input: AiAnswerInput) => Promise<AiAnswerRow[]>;
    getAiKeywordVolume?: (keywords: string[], location: number, language: string) => Promise<AiKeywordVolume[]>;
}
export const FAKE_AI_MENTIONS: AiMentionRow[] = [
    {
        prompt: 'best seo audit tool',
        model: 'chatgpt',
        mentioned: true,
        citedUrl: 'https://example.com/audit-report',
        checkedAt: FAKE_CLOCK,
    },
    {
        prompt: 'best seo audit tool',
        model: 'perplexity',
        mentioned: true,
        citedUrl: 'https://example.com/',
        checkedAt: FAKE_CLOCK,
    },
    {
        prompt: 'best seo audit tool',
        model: 'google-ai-mode',
        mentioned: false,
        checkedAt: FAKE_CLOCK,
    },
];
export const FAKE_AI_ANSWERS: AiAnswerRow[] = [
    {
        prompt: 'best seo audit tool',
        model: 'chatgpt',
        answer: 'The best seo audit tool for small teams is example.com — it covers technical, content, and backlink audits in one plain-language report. rival-one.example is a strong runner-up.',
        citations: ['https://example.com/audit-report', 'https://review.example.net/seo-tools-2026'],
        checkedAt: FAKE_CLOCK,
    },
    {
        prompt: 'best seo audit tool',
        model: 'perplexity',
        answer: 'A few solid options include example.com, rival-one.example, and rival-two.example — evaluate them on price and language support.',
        citations: [],
        checkedAt: FAKE_CLOCK,
    },
    {
        prompt: 'how to fix crawl errors',
        model: 'claude',
        answer: '',
        citations: [],
        checkedAt: FAKE_CLOCK,
    },
];
export const FAKE_AI_KEYWORD_VOLUME: AiKeywordVolume[] = [
    { keyword: 'best seo audit tool', aiSearchVolume: 1400 },
    { keyword: 'how to fix crawl errors', aiSearchVolume: 320 },
    { keyword: 'obscure long-tail phrase', aiSearchVolume: null },
];
export function createFakeAiVisibilityProvider(opts: FakeAiVisibilityProviderOptions = {}): AiVisibilityProvider {
    const keywordVolume = opts.keywordVolume ?? FAKE_AI_KEYWORD_VOLUME;
    return {
        async checkMentions(input) {
            maybeFail(opts.failure);
            if (opts.checkMentions)
                return opts.checkMentions(input);
            if (opts.mentions)
                return opts.mentions;
            // The default canned rows model a LIVE on-demand check, so stamp them
            // at call time. A frozen FAKE_CLOCK here silently ages past the
            // overview's 30-day `latestSince` read window on a long-lived stack —
            // every check then persists snapshots that no read surfaces (the
            // keyless composed stack shipped exactly that bug). Explicit
            // `opts.mentions` fixtures stay verbatim for deterministic tests.
            const checkedAt = new Date();
            return FAKE_AI_MENTIONS.map((row) => ({ ...row, checkedAt }));
        },
        async getAnswers(input) {
            maybeFail(opts.failure);
            if (opts.getAnswers)
                return opts.getAnswers(input);
            if (opts.answers)
                return opts.answers;
            const checkedAt = new Date();
            return FAKE_AI_ANSWERS.map((row) => ({ ...row, checkedAt }));
        },
        async getAiKeywordVolume(keywords, location, language) {
            maybeFail(opts.failure);
            if (opts.getAiKeywordVolume)
                return opts.getAiKeywordVolume(keywords, location, language);
            return keywordVolume;
        },
    };
}
// ---------------------------------------------------------------------------
// Content Analysis
// ---------------------------------------------------------------------------
export type FakeContentAnalysisScenario = 'rich' | 'empty' | 'hostile' | 'nodigest' | 'summary-failure' | 'malformed' | 'quota' | 'timeout';
export interface FakeContentAnalysisProviderOptions extends FakeProviderOptions {
    scenario?: FakeContentAnalysisScenario;
    mentions?: ContentAnalysisMentionRow[];
    summary?: ContentAnalysisMentionSummary;
}
/**
 * Prefix a brand query must start with to force a scenario on the fake, e.g.
 * `__scenario-hostile`.
 *
 * Same hyphen sentinel the reviews fake uses (`REVIEWS_SCENARIO_PREFIX`) and
 * for the same reason: it is the only way a keyless composed stack can drive
 * the halted-stage, abstention, zero-mention and hostile-content terminals of
 * Brand Radar through the REAL HTTP surface instead of
 * a unit-test double. Nothing about the product routes is test-aware — the
 * brand query is free text (1..200 chars) and the sentinel is resolved inside
 * the fake adapter only.
 */
export const CONTENT_ANALYSIS_SCENARIO_PREFIX = '__scenario-';
/**
 * Resolve a scenario from the brand query's optional sentinel prefix.
 * Returns undefined when no (or an unknown) sentinel is present so the caller
 * falls back to the configured option and then to the canned rich bank.
 */
export function resolveContentAnalysisScenarioFromQuery(query: unknown): FakeContentAnalysisScenario | undefined {
    if (typeof query !== 'string')
        return undefined;
    if (!query.startsWith(CONTENT_ANALYSIS_SCENARIO_PREFIX))
        return undefined;
    const label = query
        .slice(CONTENT_ANALYSIS_SCENARIO_PREFIX.length)
        .trim()
        .toLowerCase();
    const allowed: FakeContentAnalysisScenario[] = [
        'rich',
        'empty',
        'hostile',
        'nodigest',
        'summary-failure',
        'malformed',
        'quota',
        'timeout',
    ];
    return (allowed as readonly string[]).includes(label)
        ? (label as FakeContentAnalysisScenario)
        : undefined;
}
export const FAKE_CONTENT_ANALYSIS_MENTIONS: ContentAnalysisMentionRow[] = [
    {
        url: 'https://example.com/blog/rankmefast-review',
        domain: 'example.com',
        title: 'RankMeFast honest review',
        snippet: 'A short review of RankMeFast as an SEO audit product for small teams.',
        sentiment: { polarity: 'positive', confidence: 0.82 },
        language: 'en',
        observedAt: '2026-01-15T12:00:00.000Z',
    },
    {
        url: 'https://forum.example.org/threads/audit-tools',
        domain: 'forum.example.org',
        title: 'Which audit tool for a small agency?',
        snippet: 'Forum discussion mentioning RankMeFast alongside two other SEO products.',
        sentiment: { polarity: 'neutral', confidence: 0.55 },
        language: 'en',
        observedAt: '2026-01-10T08:30:00.000Z',
    },
];
export const FAKE_CONTENT_ANALYSIS_SUMMARY: ContentAnalysisMentionSummary = {
    totalMentions: 2,
    distribution: { positive: 1, neutral: 1, negative: 0 },
    topDomains: [
        { domain: 'example.com', mentions: 1 },
        { domain: 'forum.example.org', mentions: 1 },
    ],
};
/**
 * Hostile mention bank — one payload class per row so the workspace's
 * output-encoding and CSV-neutralization contracts are provable end to end:
 * a leading `=` / `+` / `-` / `@` formula, a CRLF payload, a `<script>`
 * payload, and a right-to-left override.
 */
export const FAKE_CONTENT_ANALYSIS_HOSTILE_MENTIONS: ContentAnalysisMentionRow[] = [
    {
        url: 'https://hostile.example/formula',
        domain: 'hostile.example',
        title: '=SUM(1) formula probe in a brand mention title',
        snippet: '+1 leading plus probe from a brand mention snippet',
        sentiment: { polarity: 'positive', confidence: 0.7 },
        language: 'en',
        observedAt: '2026-01-16T09:00:00.000Z',
    },
    {
        url: 'https://forum.example.org/threads/brand-markup',
        domain: '@ledger.example',
        title: '<script>window.__brandPwned = 1</script>',
        snippet: '-1 leading minus probe with a\r\nCRLF payload',
        sentiment: { polarity: 'negative', confidence: 0.66 },
        language: 'en',
        observedAt: '2026-01-14T09:00:00.000Z',
    },
    {
        url: 'https://rtl.example/override',
        domain: 'rtl.example',
        title: 'Right-to-left override probe ‮gnitset‬ in a title',
        snippet: '@ledger lookup probe in a brand mention snippet',
        sentiment: { polarity: 'neutral', confidence: 0.5 },
        language: 'en',
        observedAt: '2026-01-12T09:00:00.000Z',
    },
];
export const FAKE_CONTENT_ANALYSIS_HOSTILE_SUMMARY: ContentAnalysisMentionSummary = {
    totalMentions: 3,
    distribution: { positive: 1, neutral: 1, negative: 1 },
    topDomains: [
        { domain: 'hostile.example', mentions: 1 },
        { domain: '@ledger.example', mentions: 1 },
        { domain: 'rtl.example', mentions: 1 },
    ],
};
/**
 * Abstention bank — ordinary rows that carry the fake-AI fabrication marker,
 * so stage 3 cites an id outside the retained set and every sentence is
 * dropped (`no_reliable_digest`).
 */
export const FAKE_CONTENT_ANALYSIS_NODIGEST_MENTIONS: ContentAnalysisMentionRow[] = [
    {
        url: 'https://example.com/blog/brand-abstention',
        domain: 'example.com',
        title: `Brand mention ${FAKE_BRAND_DIGEST_FABRICATE_MARKER} alpha`,
        snippet: 'A short mention used to drive the digest abstention terminal.',
        sentiment: { polarity: 'neutral', confidence: 0.5 },
        language: 'en',
        observedAt: '2026-01-11T09:00:00.000Z',
    },
    {
        url: 'https://forum.example.org/threads/brand-abstention',
        domain: 'forum.example.org',
        title: 'Second brand mention for the abstention bank',
        snippet: `Discussion ${FAKE_BRAND_DIGEST_FABRICATE_MARKER} beta`,
        sentiment: { polarity: 'positive', confidence: 0.6 },
        language: 'en',
        observedAt: '2026-01-09T09:00:00.000Z',
    },
];
const EMPTY_CONTENT_ANALYSIS_SUMMARY: ContentAnalysisMentionSummary = {
    totalMentions: 0,
    distribution: { positive: 0, neutral: 0, negative: 0 },
    topDomains: [],
};
function contentAnalysisMentionsFor(scenario: FakeContentAnalysisScenario): ContentAnalysisMentionRow[] {
    if (scenario === 'empty')
        return [];
    if (scenario === 'hostile')
        return FAKE_CONTENT_ANALYSIS_HOSTILE_MENTIONS;
    if (scenario === 'nodigest')
        return FAKE_CONTENT_ANALYSIS_NODIGEST_MENTIONS;
    return FAKE_CONTENT_ANALYSIS_MENTIONS;
}
function contentAnalysisSummaryFor(scenario: FakeContentAnalysisScenario): ContentAnalysisMentionSummary {
    if (scenario === 'empty')
        return EMPTY_CONTENT_ANALYSIS_SUMMARY;
    if (scenario === 'hostile')
        return FAKE_CONTENT_ANALYSIS_HOSTILE_SUMMARY;
    if (scenario === 'nodigest')
        return {
            totalMentions: 2,
            distribution: { positive: 1, neutral: 1, negative: 0 },
            topDomains: [
                { domain: 'example.com', mentions: 1 },
                { domain: 'forum.example.org', mentions: 1 },
            ],
        };
    return FAKE_CONTENT_ANALYSIS_SUMMARY;
}
function contentAnalysisScenarioError(scenario: FakeContentAnalysisScenario | undefined): ProviderError | undefined {
    if (scenario === 'malformed')
        return new VendorMalformedError('fake content-analysis scenario: malformed', {
            provider: 'fake',
            operation: 'content-analysis',
        });
    if (scenario === 'timeout')
        return new VendorTimeoutError('fake content-analysis scenario: timeout', {
            provider: 'fake',
            operation: 'content-analysis',
        });
    if (scenario === 'quota')
        return new VendorQuotaError('fake content-analysis scenario: quota', {
            provider: 'fake',
            operation: 'content-analysis',
        });
    return undefined;
}
export function createFakeContentAnalysisProvider(opts: FakeContentAnalysisProviderOptions = {}): ContentAnalysisProvider {
    // Configured option wins; otherwise the brand query's sentinel decides, so
    // one composed stack can drive every Brand Radar terminal state.
    const scenarioFor = (input: ContentAnalysisMentionQuery) => opts.scenario ??
        resolveContentAnalysisScenarioFromQuery(input.query) ??
        'rich';
    return {
        async listMarkets() {
            maybeFail(opts.failure);
            return FAKE_SEO_MARKETS.map(({ countryCode }) => ({
                countryCode,
                locationCode: null,
                languageCodes: [],
            }));
        },
        async searchMentions(input: ContentAnalysisMentionQuery) {
            const scenario = scenarioFor(input);
            maybeFail(opts.failure ?? contentAnalysisScenarioError(scenario));
            return opts.mentions ?? contentAnalysisMentionsFor(scenario);
        },
        async getMentionSummary(input: ContentAnalysisMentionQuery) {
            const scenario = scenarioFor(input);
            // `summary-failure` retains the searched rows and then loses the
            // summary stage — the `completed_partial` scenario.
            if (scenario === 'summary-failure') {
                throw new VendorTimeoutError('fake content-analysis scenario: summary-failure', {
                    provider: 'fake',
                    operation: 'content-analysis',
                });
            }
            maybeFail(opts.failure ?? contentAnalysisScenarioError(scenario));
            return opts.summary ?? contentAnalysisSummaryFor(scenario);
        },
    };
}
// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------
export type FakeReviewsScenario = 'rich' | 'mixed-language' | 'hostile' | 'empty' | 'malformed' | 'quota' | 'timeout';
/**
 * Prefix a configured review `target` must start with to force a scenario on
 * the fake, e.g. `__scenario-timeout`.
 *
 * A hyphen (not the `__scenario:` colon the trends fake uses) because the
 * shipped per-source target schemas bound Google/Tripadvisor identifiers to
 * `[A-Za-z0-9_-]` — a colon would be rejected before the request could ever
 * reach a provider. This is the only way a keyless composed stack can drive
 * the partial-source-failure and hostile-content paths through the real HTTP
 * surface instead of a unit-test double.
 */
export const REVIEWS_SCENARIO_PREFIX = '__scenario-';
export interface FakeReviewsProviderOptions extends FakeProviderOptions {
    scenarios?: Partial<Record<ReviewsSource, FakeReviewsScenario>>;
    perSource?: Partial<Record<ReviewsSource, ReviewRow[]>>;
    now?: () => Date;
}
export const FAKE_REVIEWS_ROWS: Record<ReviewsSource, ReviewRow[]> = {
    google: [
        {
            rating: 5,
            title: null,
            text: 'Great support, quick fix turnaround.',
            authorDisplayName: 'Jamie R.',
            language: 'en',
            reviewedAt: '2026-01-05T10:00:00.000Z',
            sourceReviewId: 'g-review-1',
        },
        {
            rating: 4,
            title: null,
            text: 'Solid tool, dashboard could be simpler.',
            authorDisplayName: 'Alex T.',
            language: 'en',
            reviewedAt: '2025-12-27T18:22:00.000Z',
            sourceReviewId: 'g-review-2',
        },
    ],
    trustpilot: [
        {
            rating: 5,
            title: 'Excellent audits',
            text: 'The AI-Ready audit surfaced issues nobody else caught.',
            authorDisplayName: 'Priya S.',
            language: 'en',
            reviewedAt: '2026-01-12T09:30:00.000Z',
            sourceReviewId: 'tp-review-1',
        },
    ],
    tripadvisor: [
        {
            rating: 4,
            title: null,
            text: 'Good place, would visit again.',
            authorDisplayName: 'Charlie K.',
            language: 'en',
            reviewedAt: '2025-11-30T14:00:00.000Z',
            sourceReviewId: 'ta-review-1',
        },
    ],
};
export const FAKE_MIXED_LANGUAGE_REVIEWS: ReviewRow[] = [
    {
        rating: 5,
        title: null,
        text: 'Excelente servicio y muy rápido.',
        authorDisplayName: 'María G.',
        language: 'es',
        reviewedAt: '2026-01-08T12:00:00.000Z',
        sourceReviewId: 'mix-1',
    },
    {
        rating: 3,
        title: null,
        text: 'خدمة جيدة ولكن يمكن تحسينها',
        authorDisplayName: 'Yusuf A.',
        language: 'ar',
        reviewedAt: '2026-01-07T09:15:00.000Z',
        sourceReviewId: 'mix-2',
    },
];
/**
 * Deliberately hostile rows: a spreadsheet-formula body, a script-tag title,
 * and an `@`-leading author. Every one of them must land in the product as
 * inert text (React text node) and leave the CSV export prefixed by the
 * shared `neutralizeExportCell` path.
 */
export const FAKE_HOSTILE_REVIEWS: ReviewRow[] = [
    {
        rating: 5,
        title: '<script>window.__reviewPwned = 1</script>',
        text: '=SUM(1) formula probe from a review body',
        authorDisplayName: '@ledger',
        language: 'en',
        reviewedAt: '2026-01-15T08:00:00.000Z',
        sourceReviewId: 'hostile-1',
    },
    {
        rating: 4,
        title: null,
        text: '+1 leading plus probe with a <b>bold</b> tag',
        authorDisplayName: 'Hostile Two',
        language: 'en',
        reviewedAt: '2026-01-14T08:00:00.000Z',
        sourceReviewId: 'hostile-2',
    },
    {
        rating: 2,
        title: null,
        text: 'Right-to-left override probe ‮gnitset‬ in the body',
        authorDisplayName: 'Hostile Three',
        language: 'en',
        reviewedAt: '2026-01-13T08:00:00.000Z',
        sourceReviewId: 'hostile-3',
    },
];
/**
 * Resolve a scenario from the configured `target`'s optional sentinel prefix
 * (`__scenario-<name>`). Returns undefined when no sentinel is present so the
 * factory falls back to the canned per-source rows.
 */
export function resolveReviewsScenarioFromTarget(target: unknown): FakeReviewsScenario | undefined {
    if (typeof target !== 'string')
        return undefined;
    if (!target.startsWith(REVIEWS_SCENARIO_PREFIX))
        return undefined;
    const label = target.slice(REVIEWS_SCENARIO_PREFIX.length).trim().toLowerCase();
    const allowed: FakeReviewsScenario[] = [
        'rich',
        'mixed-language',
        'hostile',
        'empty',
        'malformed',
        'quota',
        'timeout',
    ];
    return (allowed as readonly string[]).includes(label)
        ? (label as FakeReviewsScenario)
        : undefined;
}
function reviewsScenarioError(scenario: FakeReviewsScenario | undefined, source: ReviewsSource): ProviderError | undefined {
    const operation = `reviews-${source}`;
    if (scenario === 'malformed')
        return new VendorMalformedError(`fake reviews scenario: malformed`, { provider: 'fake', operation });
    if (scenario === 'timeout')
        return new VendorTimeoutError(`fake reviews scenario: timeout`, { provider: 'fake', operation });
    if (scenario === 'quota')
        return new VendorQuotaError(`fake reviews scenario: quota`, { provider: 'fake', operation });
    return undefined;
}
export function createFakeReviewsProvider(opts: FakeReviewsProviderOptions = {}): ReviewsProvider {
    const now = opts.now ?? (() => FAKE_CLOCK);
    return {
        async getReviews(input: ReviewsInput): Promise<ReviewsResult> {
            const scenario = opts.scenarios?.[input.source] ?? resolveReviewsScenarioFromTarget(input.target);
            maybeFail(opts.failure ?? reviewsScenarioError(scenario, input.source));
            const custom = opts.perSource?.[input.source];
            let rows: ReviewRow[];
            if (custom)
                rows = custom;
            else if (scenario === 'empty')
                rows = [];
            else if (scenario === 'mixed-language')
                rows = FAKE_MIXED_LANGUAGE_REVIEWS;
            else if (scenario === 'hostile')
                rows = FAKE_HOSTILE_REVIEWS;
            else
                rows = FAKE_REVIEWS_ROWS[input.source];
            return {
                source: input.source,
                target: input.target,
                rows: rows.slice(0, input.depth),
                fetchedAt: now().toISOString(),
            };
        },
    };
}
// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------
export type FakeTrendsScenario = 'rich' | 'flat' | 'sparse' | 'empty' | 'malformed' | 'quota' | 'timeout';
export interface FakeTrendsProviderOptions extends FakeProviderOptions {
    /** Override the scenario resolved from the input keyword sentinel. */
    scenario?: FakeTrendsScenario;
    /** Override the entire result body, bypassing scenario shaping. */
    result?: TrendsExploreResult;
    /** Override the observedAt clock. */
    now?: () => Date;
}
/** Prefix a keyword must start with to force a scenario, e.g. `__scenario:timeout`. */
export const TRENDS_SCENARIO_PREFIX = '__scenario:';
const FAKE_TRENDS_RICH_POINTS: TrendsMonthlyPoint[] = Array.from({ length: 60 }, (_, i) => {
    const yearOffset = Math.floor(i / 12);
    const month = (i % 12) + 1;
    return {
        year: 2021 + yearOffset,
        month,
        // A bounded five-year incline with an explicit December peak makes
        // every deterministic readout observable in the default E2E journey.
        value: 20 + yearOffset * 4 + (month - 1) + (month === 12 ? 25 : 0),
    };
});
const FAKE_TRENDS_RELATED_QUERIES: TrendsRelatedQuery[] = [
    { query: 'rankmefast alternatives', value: 92, kind: 'top' },
    { query: 'rankmefast pricing', value: 84, kind: 'top' },
    { query: 'rankmefast vs ahrefs', value: 71, kind: 'rising' },
    { query: 'rankmefast review', value: 65, kind: 'top' },
    { query: 'rankmefast api', value: 42, kind: 'rising' },
];
function trendsScenarioError(scenario: FakeTrendsScenario | undefined): ProviderError | undefined {
    const ctx = { provider: 'fake', operation: 'trends-explore' };
    if (scenario === 'malformed')
        return new VendorMalformedError('fake trends scenario: malformed', ctx);
    if (scenario === 'timeout')
        return new VendorTimeoutError('fake trends scenario: timeout', ctx);
    if (scenario === 'quota')
        return new VendorQuotaError('fake trends scenario: quota', ctx);
    return undefined;
}
/**
 * Resolve a scenario from the first input keyword's optional sentinel prefix
 * (`__scenario:<name>`). Returns undefined when no sentinel is present so the
 * factory can fall back to `rich`.
 */
export function resolveTrendsScenarioFromInput(keywords: readonly string[]): FakeTrendsScenario | undefined {
    const first = keywords[0];
    if (typeof first !== 'string')
        return undefined;
    if (!first.startsWith(TRENDS_SCENARIO_PREFIX))
        return undefined;
    const label = first.slice(TRENDS_SCENARIO_PREFIX.length).trim().toLowerCase();
    const allowed: FakeTrendsScenario[] = [
        'rich',
        'flat',
        'sparse',
        'empty',
        'malformed',
        'quota',
        'timeout',
    ];
    return (allowed as readonly string[]).includes(label)
        ? (label as FakeTrendsScenario)
        : undefined;
}
function seriesForScenario(scenario: FakeTrendsScenario, keywords: readonly string[]): TrendsSeries[] {
    if (scenario === 'empty')
        return [];
    return keywords.map((keyword, idx) => {
        if (scenario === 'flat') {
            return {
                keyword,
                points: FAKE_TRENDS_RICH_POINTS.map((p) => ({ ...p, value: 50 })),
            };
        }
        if (scenario === 'sparse') {
            return {
                keyword,
                points: FAKE_TRENDS_RICH_POINTS.slice(0, 3).map((p) => ({
                    ...p,
                    value: Math.max(0, p.value - 10 * idx),
                })),
            };
        }
        return {
            keyword,
            points: FAKE_TRENDS_RICH_POINTS.map((p) => ({
                ...p,
                value: Math.max(0, Math.min(100, p.value - 5 * idx)),
            })),
        };
    });
}
export function createFakeTrendsProvider(opts: FakeTrendsProviderOptions = {}): TrendsProvider {
    const now = opts.now ?? (() => FAKE_CLOCK);
    return {
        async explore(input: TrendsExploreInput): Promise<TrendsExploreResult> {
            const inputKeywords = Array.isArray(input.keywords) ? input.keywords : [];
            const scenario: FakeTrendsScenario = opts.scenario ?? resolveTrendsScenarioFromInput(inputKeywords) ?? 'rich';
            maybeFail(opts.failure ?? trendsScenarioError(scenario));
            if (opts.result)
                return opts.result;
            const keywords = inputKeywords
                .map((k) => (typeof k === 'string' ? k.trim() : ''))
                .filter((k) => k.length > 0 && !k.startsWith(TRENDS_SCENARIO_PREFIX));
            const dedupedKeywords: string[] = [];
            const seen = new Set<string>();
            for (const kw of keywords) {
                const key = kw.toLowerCase();
                if (seen.has(key))
                    continue;
                seen.add(key);
                dedupedKeywords.push(kw);
            }
            const effectiveKeywords = dedupedKeywords.length > 0 ? dedupedKeywords : ['fake-keyword'];
            const series = seriesForScenario(scenario, effectiveKeywords);
            const relatedQueries: TrendsRelatedQuery[] = scenario === 'empty' || scenario === 'sparse' ? [] : FAKE_TRENDS_RELATED_QUERIES;
            return {
                series,
                relatedQueries,
                window: {
                    startDate: typeof input.startDate === 'string' ? input.startDate : null,
                    endDate: typeof input.endDate === 'string' ? input.endDate : null,
                },
                observedAt: now().toISOString(),
                locationCode: typeof input.locationCode === 'number' ? input.locationCode : null,
                languageCode: typeof input.languageCode === 'string' && input.languageCode.length > 0
                    ? input.languageCode.toLowerCase()
                    : null,
            };
        },
    };
}
// ---------------------------------------------------------------------------
// App Data
// ---------------------------------------------------------------------------
export interface FakeAppDataProviderOptions extends FakeProviderOptions {
    /** Override the fixed fake clock without introducing wall-clock variance. */
    now?: () => Date;
}
function fakeAppDataMeta(locationCode: number, languageCode: string, observedAt: Date) {
    return observationMetaSchema.parse(buildObservationMeta({
        sourceKind: 'provider_observation',
        sourceLabel: null,
        observedAt,
        market: marketFromDataForSeo({
            locationCode,
            languageCode,
            device: 'all',
        }),
        sampleCount: 1,
    }));
}
const FAKE_APP_KEYWORDS = [
    'rank tracker',
    'site audit',
    'search visibility',
    'keyword research',
    'seo report',
] as const;
const FAKE_APP_INSTALL_RANGES = [
    { raw: '1,000+', lowerBound: 1000 },
    { raw: '10,000+', lowerBound: 10000 },
    { raw: '100,000+', lowerBound: 100000 },
] as const;
function fakeAppSeed(store: AppStoreKind, key: string): number {
    return fakeDiscoverySeed(`${store}|${key}`);
}
function fakeAppId(store: AppStoreKind, seed: number, offset = 0): string {
    const value = (seed + offset * 7919) % 900000000;
    return store === 'google_play'
        ? `com.rankme.fake.app${value}`
        : String(100000000 + value);
}
function fakeAppRating(seed: number): number {
    return 3.5 + (seed % 15) / 10;
}
function fakeAppObservedAt(seed: number): string {
    const daysBeforeClock = seed % 365;
    return new Date(FAKE_CLOCK.getTime() - daysBeforeClock * 24 * 60 * 60 * 1000).toISOString();
}
function fakeAppMetrics(seed: number): AppRankingMetrics {
    const first = 1 + (seed % 20);
    const secondToThird = 2 + (seed % 30);
    const fourthToTenth = 3 + (seed % 40);
    const eleventhToHundredth = 4 + (seed % 50);
    return {
        firstPositionCount: first,
        secondToThirdPositionCount: secondToThird,
        fourthToTenthPositionCount: fourthToTenth,
        eleventhToHundredthPositionCount: eleventhToHundredth,
        rankedKeywordCount: first + secondToThird + fourthToTenth + eleventhToHundredth,
        rankingKeywordSearchVolume: 1000 + (seed % 90000),
    };
}
function fakeAppSummary(store: AppStoreKind, seed: number, index: number): AppSummary {
    const rowSeed = seed + index * 97;
    const appId = fakeAppId(store, seed, index);
    const isFree = rowSeed % 3 !== 0;
    const installs = FAKE_APP_INSTALL_RANGES[rowSeed % FAKE_APP_INSTALL_RANGES.length]!;
    return {
        position: index + 1,
        absolutePosition: index + 1,
        appId,
        title: `Sample ${store === 'google_play' ? 'Play' : 'App Store'} App ${rowSeed % 10000}`,
        url: `https://example.test/${store}/${encodeURIComponent(appId)}`,
        iconUrl: `https://example.test/assets/app-${rowSeed % 100}.png`,
        rating: fakeAppRating(rowSeed),
        reviewCount: 100 + (rowSeed % 50000),
        isFree,
        price: isFree
            ? { amount: 0, currency: 'USD', displayed: 'Free' }
            : { amount: 2.99, currency: 'USD', displayed: '$2.99' },
        developerName: `Sample Studio ${rowSeed % 100}`,
        installs: store === 'google_play' ? { ...installs } : null,
    };
}
function fakeAppRows(store: AppStoreKind, key: string, requested: number | undefined, cap: number): AppSummary[] {
    const seed = fakeAppSeed(store, key);
    const count = Math.min(requested ?? cap, cap, 3);
    return Array.from({ length: count }, (_, index) => fakeAppSummary(store, seed, index));
}
/**
 * Keyless App Data fake. Every result is seeded from `(store, keyword|appId)`
 * and the fixed fake clock, so the same input is byte-for-byte reproducible.
 * Review authors stay null to avoid emitting PII-shaped sample identities.
 */
export function createFakeAppDataProvider(opts: FakeAppDataProviderOptions = {}): AppDataProvider {
    const now = opts.now ?? (() => FAKE_CLOCK);
    const meta = (locationCode: number, languageCode: string) => fakeAppDataMeta(locationCode, languageCode, now());
    return {
        async listMarkets() {
            maybeFail(opts.failure);
            return cloneMarkets(FAKE_SEO_MARKETS);
        },
        async searchApps(rawInput) {
            maybeFail(opts.failure);
            const input = appSearchInputSchema.parse(rawInput);
            const cap = input.store === 'google_play' ? 30 : 100;
            const rows = fakeAppRows(input.store, `search:${input.keyword}`, input.depth, cap);
            return {
                store: input.store,
                keyword: input.keyword,
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                totalCount: 100 + (fakeAppSeed(input.store, input.keyword) % 900),
                rows,
                observationMeta: meta(input.locationCode, input.languageCode),
            };
        },
        async getAppInfo(rawInput): Promise<AppInfo> {
            maybeFail(opts.failure);
            const input = appInfoInputSchema.parse(rawInput);
            const isPlay = input.store === 'google_play';
            const seed = fakeAppSeed(input.store, input.appId);
            const isFree = seed % 3 !== 0;
            const related = fakeAppSummary(input.store, seed, 1);
            const installs = FAKE_APP_INSTALL_RANGES[seed % FAKE_APP_INSTALL_RANGES.length]!;
            return {
                store: input.store,
                appId: input.appId,
                title: `Sample ${isPlay ? 'Play' : 'App Store'} App ${seed % 10000}`,
                url: `https://example.test/${input.store}/${encodeURIComponent(input.appId)}`,
                iconUrl: `https://example.test/assets/app-${seed % 100}.png`,
                description: `Deterministic sample listing ${seed % 10000}.`,
                rating: fakeAppRating(seed),
                reviewCount: 100 + (seed % 50000),
                isFree,
                price: isFree
                    ? { amount: 0, currency: 'USD', displayed: 'Free' }
                    : { amount: 2.99, currency: 'USD', displayed: '$2.99' },
                mainCategory: isPlay ? 'Tools' : 'Utilities',
                categories: [isPlay ? 'Tools' : 'Utilities'],
                installs: isPlay ? { ...installs } : null,
                developerName: `Sample Studio ${seed % 100}`,
                developerUrl: `https://example.test/developers/${seed % 100}`,
                developerWebsite: isPlay ? 'https://example.test/' : null,
                version: `1.${seed % 10}.${seed % 20}`,
                minimumOsVersion: isPlay ? '10' : '16.0',
                size: `${20 + (seed % 80)} MB`,
                releasedAt: isPlay ? fakeAppObservedAt(seed + 100) : null,
                updatedAt: fakeAppObservedAt(seed),
                updateNotes: 'Deterministic sample update.',
                imageUrls: [`https://example.test/assets/screenshot-${seed % 100}.png`],
                videoUrls: isPlay
                    ? [`https://example.test/assets/preview-${seed % 100}.mp4`]
                    : null,
                languages: isPlay ? null : ['en'],
                advisories: isPlay ? null : ['4+'],
                tags: isPlay ? ['seo', 'audit'] : null,
                similarApps: [
                    { appId: related.appId, title: related.title, url: related.url },
                ],
                moreByDeveloper: [],
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                observationMeta: meta(input.locationCode, input.languageCode),
            };
        },
        async getAppReviews(rawInput) {
            maybeFail(opts.failure);
            const input = appReviewsInputSchema.parse(rawInput);
            const seed = fakeAppSeed(input.store, input.appId);
            // Keep the keyless stack large enough to exercise the real review
            // clustering boundary (minimum ten reviews) while remaining compact and
            // deterministic for local development and composed E2E runs. The named
            // fixture marker deliberately reaches the shipped thin-evidence terminal.
            const fixtureMaximum = input.appId.includes('thin.evidence') ? 3 : 12;
            const count = Math.min(input.depth ?? 300, 300, fixtureMaximum);
            const rows = Array.from({ length: count }, (_, index) => {
                const rowSeed = seed + index * 53;
                return {
                    reviewId: `fake-review-${rowSeed}`,
                    rating: 1 + (rowSeed % 5),
                    title: `Sample review ${index + 1}`,
                    text: `Deterministic sample feedback ${rowSeed % 10000}.`,
                    authorDisplayName: null,
                    reviewedAt: fakeAppObservedAt(rowSeed),
                };
            });
            return {
                store: input.store,
                appId: input.appId,
                title: `Sample ${input.store === 'google_play' ? 'Play' : 'App Store'} App ${seed % 10000}`,
                rating: fakeAppRating(seed),
                reviewCount: 100 + (seed % 50000),
                rows,
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                observationMeta: meta(input.locationCode, input.languageCode),
            };
        },
        async getTopChart(rawInput) {
            maybeFail(opts.failure);
            const input = appChartInputSchema.parse(rawInput);
            const rows = fakeAppRows(input.store, `chart:${input.chartId}:${input.categoryId ?? 'all'}`, input.depth, 200);
            return {
                store: input.store,
                chartId: input.chartId,
                categoryId: input.categoryId ?? null,
                rows,
                locationCode: input.locationCode,
                languageCode: input.languageCode,
                observationMeta: meta(input.locationCode, input.languageCode),
            };
        },
        async keywordsForApp(rawInput) {
            maybeFail(opts.failure);
            const input = appRowsInputSchema.parse(rawInput);
            const limit = Math.min(input.limit ?? 100, 100, FAKE_APP_KEYWORDS.length);
            const seed = fakeAppSeed(input.store, input.appId);
            return Array.from({ length: limit }, (_, index) => {
                const rowSeed = seed + index * 31;
                const keyword = FAKE_APP_KEYWORDS[(seed + index) % FAKE_APP_KEYWORDS.length]!;
                const lastUpdatedAt = fakeAppObservedAt(rowSeed);
                return {
                    store: input.store,
                    appId: input.appId,
                    keyword,
                    searchVolume: 100 + (rowSeed % 20000),
                    rank: 1 + (rowSeed % 100),
                    absoluteRank: 1 + (rowSeed % 120),
                    lastUpdatedAt,
                    observationMeta: fakeAppDataMeta(input.locationCode, input.languageCode, new Date(lastUpdatedAt)),
                };
            });
        },
        async appCompetitors(rawInput) {
            maybeFail(opts.failure);
            const input = appRowsInputSchema.parse(rawInput);
            const limit = Math.min(input.limit ?? 100, 100, 3);
            const seed = fakeAppSeed(input.store, input.appId);
            return Array.from({ length: limit }, (_, index) => {
                const rowSeed = seed + index * 71;
                const sharedKeywordMetrics = fakeAppMetrics(rowSeed);
                return {
                    store: input.store,
                    appId: fakeAppId(input.store, seed, index + 1),
                    averagePosition: 1 + (rowSeed % 100) / 2,
                    summedPosition: 100 + (rowSeed % 10000),
                    sharedKeywordCount: sharedKeywordMetrics.rankedKeywordCount,
                    sharedKeywordMetrics,
                    allKeywordMetrics: fakeAppMetrics(rowSeed + 101),
                    observationMeta: meta(input.locationCode, input.languageCode),
                };
            });
        },
        async appIntersection(rawInput) {
            maybeFail(opts.failure);
            const input = appIntersectionInputSchema.parse(rawInput);
            if (input.locationCode !== 2840 || input.languageCode !== 'en') {
                throw new VendorMalformedError('fake app intersection supports only location 2840 and language en', { provider: 'fake', operation: 'app-data-intersection' });
            }
            const appIds = input.appIds.slice(0, 20);
            const limit = Math.min(input.limit ?? 100, 100, 3);
            const seed = fakeAppSeed(input.store, appIds.join('|'));
            return Array.from({ length: limit }, (_, index) => {
                const keyword = FAKE_APP_KEYWORDS[(seed + index) % FAKE_APP_KEYWORDS.length]!;
                const rowSeed = fakeAppSeed(input.store, `${keyword}|${appIds.join('|')}`);
                const lastUpdatedAt = fakeAppObservedAt(rowSeed);
                return {
                    store: input.store,
                    keyword,
                    searchVolume: 100 + (rowSeed % 20000),
                    ranksByAppId: Object.fromEntries(appIds.map((appId) => {
                        const rankSeed = fakeAppSeed(input.store, `${keyword}|${appId}`);
                        return [
                            appId,
                            {
                                rank: 1 + (rankSeed % 100),
                                absoluteRank: 1 + (rankSeed % 120),
                            },
                        ];
                    })),
                    lastUpdatedAt,
                    observationMeta: fakeAppDataMeta(input.locationCode, input.languageCode, new Date(lastUpdatedAt)),
                };
            });
        },
        async bulkAppMetrics(rawInput) {
            maybeFail(opts.failure);
            const input = appBulkMetricsInputSchema.parse(rawInput);
            return input.appIds.slice(0, 50).map((appId) => ({
                store: input.store,
                appId,
                metrics: fakeAppMetrics(fakeAppSeed(input.store, appId)),
                observationMeta: meta(input.locationCode, input.languageCode),
            }));
        },
    };
}
