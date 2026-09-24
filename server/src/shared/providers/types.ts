import type { ObservationMeta, SiteMarket } from '../observations/types.js';
/**
 * Vendor-neutral provider contracts.
 *
 * Every external SEO-data capability sits behind one of these seven
 * interfaces. The UI, rule engine, and job processors depend on THESE shapes
 * — never on DataForSEO / PSI / GSC field names. Each concrete adapter is
 * constructed with config (keys, base URL) and never reads env inside a
 * method. Methods reject only with the taxonomy in
 * `./errors.ts`.
 */
// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------
export interface StartAuditInput {
    domain: string;
    /**
     * Maximum number of pages the crawler may fetch — a vendor spending
     * ceiling (billing is per actually-crawled page; unused headroom is
     * auto-refunded). JS/browser rendering is deliberately NOT supported:
     * it multiplies the per-page price ~10×/34× and the margin model in
     * `shared/billing/vendor-costs.ts` budgets the basic-crawl rate only.
     */
    pageCap: number;
}
export type AuditState = 'queued' | 'crawling' | 'finished' | 'failed';
export interface AuditStatus {
    state: AuditState;
    pagesCrawled?: number;
    /** Vendor-reported failure detail — present only when `state` is `failed`. */
    error?: string;
}
/** Site-wide checks, normalized away from any vendor's naming. */
export interface AuditDomainChecks {
    robotsTxtFound: boolean;
    sitemapFound: boolean;
    httpsEnforced: boolean;
    /** www/non-www + trailing-slash variants resolve to one canonical origin. */
    canonicalizationOk: boolean;
    /**
     * Sitemap URL is declared inside `robots.txt`. Absent = vendor did not
     * report this signal — rule engine treats absent as "insufficient data".
     */
    sitemapReferencedInRobots?: boolean;
    /** http:// requests permanently redirect to https://. Absent = unknown. */
    httpsRedirect?: boolean;
    /**
     * `/llms.txt` is served (emerging AI-crawler convention). Absent = the
     * check was not run for this audit — treated as insufficient data.
     */
    llmsTxtFound?: boolean;
}
export interface AuditPageTiming {
    timeToInteractiveMs?: number;
    fetchMs?: number;
}
export interface AuditPage {
    url: string;
    statusCode: number;
    title: string | null;
    metaDescription: string | null;
    h1: string[];
    h2: string[];
    canonical: string | null;
    hasStructuredData: boolean;
    structuredDataErrors: string[];
    isIndexable: boolean;
    nonIndexableReason?: string;
    brokenLinks: string[];
    /** 0–100 vendor-normalized on-page quality score. */
    onPageScore: number;
    /**
     * Approximate word count of the main content. Absent = the vendor did not
     * expose a word-count field — the rule engine treats absent as
     * insufficient data, never as "thin".
     */
    wordCount?: number;
    /**
     * Page exposes FAQ / Q&A signals (schema.org FAQPage micromarkup or
     * question-style headings). Absent = not evaluated.
     */
    hasFaqSignals?: boolean;
    timing?: AuditPageTiming;
}
export interface AuditResult {
    domainChecks: AuditDomainChecks;
    pages: AuditPage[];
}
export interface AuditProvider {
    startAudit(input: StartAuditInput): Promise<{
        vendorTaskId: string;
    }>;
    getAuditStatus(vendorTaskId: string): Promise<AuditStatus>;
    getAuditResult(vendorTaskId: string): Promise<AuditResult>;
}
// ---------------------------------------------------------------------------
// Rank tracking
// ---------------------------------------------------------------------------
export type SerpDevice = 'desktop' | 'mobile';
export interface RankCheckInput {
    keyword: string;
    domain: string;
    locationCode: number;
    languageCode: string;
    device: SerpDevice;
}
export interface RankCheckResult {
    /** `null` = the domain is not in the vendor's top-N results. */
    position: number | null;
    foundUrl?: string;
    serpTopUrls?: string[];
    checkedAt: Date;
    /**
     * Google AI Overview signal for the checked domain. `undefined`/`null` =
     * signal unavailable (old cache row / provider without the capability) —
     * DISTINCT from `{ present: false }` (SERP fetched, no AI Overview shown)
     * and `{ present: true, cited: false }` (shown, domain not cited).
     */
    aiOverview?: {
        present: boolean;
        cited: boolean;
        citedUrl?: string;
    } | null;
    /**
     * Normalized SERP features observed on the SAME
     * payload this rank check already fetched. Domain-INDEPENDENT on purpose:
     * ownership ("you hold this snippet") is derived at read time against the
     * site's stored domain, so one recorded SERP serves every user tracking the
     * phrase. `undefined`/`null` = signal unavailable (provider without the
     * capability, or a cache row recorded before the feature) — DISTINCT from a
     * snapshot with an empty `features` array, which means "checked, nothing
     * observed". Same convention `aiOverview` already uses.
     */
    serpFeatures?: SerpFeatureSnapshot | null;
}
/**
 * One observed SERP feature block. `rankAbsolute` is the vendor's absolute
 * position of the FIRST block of this type, or `null` when the vendor did not
 * report one — never a fabricated ordinal.
 */
export interface SerpFeatureObservation {
    type: SerpFeatureType;
    rankAbsolute: number | null;
}
/** One People-Also-Ask entry with the source that answered it, when reported. */
export interface SerpPaaQuestion {
    question: string;
    /** Normalized host of the answering page. `null` = vendor exposed no source. */
    answerDomain: string | null;
    answerUrl: string | null;
}
/** The featured-snippet block's source, when the SERP carried one. */
export interface SerpFeaturedSnippet {
    domain: string | null;
    url: string | null;
    title: string | null;
}
/**
 * Domain-independent SERP-feature snapshot for one check. Only OBSERVED
 * features are listed — there is deliberately no "absent" representation, so
 * no consumer can render a claim about what Google does not show.
 */
export interface SerpFeatureSnapshot {
    features: SerpFeatureObservation[];
    featuredSnippet: SerpFeaturedSnippet | null;
    paa: SerpPaaQuestion[];
}
/**
 * Per-coordinate map-pack target. The vendor
 * accepts `"latitude,longitude,zoom"` with at most seven decimal digits; the
 * adapter formats the string, the caller supplies plain numbers.
 */
export interface LocalPackCoordinate {
    /** -90 .. 90. */
    lat: number;
    /** -180 .. 180. */
    lng: number;
    /** Integer 3 .. 21 (vendor-documented zoom range; product default 17). */
    zoom: number;
}
/**
 * Map-pack check target. Exactly ONE of `locationCode` / `coordinate` is set:
 * `locationCode` is the shipped local-pack tracking path (unchanged), and
 * `coordinate` is the geogrid per-cell path. Supplying both or neither is a
 * caller bug and the adapter rejects it before any HTTP call.
 */
export interface LocalPackCheckInput {
    keyword: string;
    domain: string;
    locationCode?: number;
    languageCode: string;
    coordinate?: LocalPackCoordinate;
}
export interface LocalPackResult {
    /** `null` = the domain is not in the map-pack results for this query. */
    position: number | null;
    totalPackSize: number;
    checkedAt: Date;
}
/**
 * Public-page discovery input. Provider-neutral —
 * no vendor task ids, no DataForSEO location codes; the adapter resolves
 * `SiteMarket` internally through its own market table and fails loudly
 * (`VendorUnavailableError`) for unsupported combinations. Never silently
 * substitutes US/English.
 */
export interface PublicPageDiscoveryInput {
    /** Non-empty, bounded per run (ceiling 40). Text ≤ 700 chars. */
    queries: Array<{
        id: string;
        text: string;
    }>;
    siteMarket: SiteMarket;
    /** Clamped 1..20 by the adapter. */
    perQueryLimit: number;
}
/**
 * Locked enum for the deterministic source-type classifier. The
 * adapter itself does NOT classify — it emits provider-neutral rows and the
 * feature module (`modules/audience-research/source-classifier.ts`) picks a
 * type. The enum lives here so the interface, fake, and fixtures share one
 * vocabulary.
 */
export type PublicPageSourceHint = 'forum' | 'review' | 'comparison' | 'question' | 'other';
/** One discovered organic result, provider-neutral. No raw snippets, no vendor codes. */
export interface PublicPageDiscoveryRow {
    queryId: string;
    /** Canonical (dedupe key) — scheme + host + path; adapter drops non-HTTP schemes. */
    canonicalUrl: string;
    /** Safe display title, ≤160 chars, output-encoded ready. */
    title: string;
    /** 1..perQueryLimit, adapter-clamped. */
    organicPosition: number;
    /** ISO 8601. `null` when the vendor did NOT expose a datetime for this row. */
    observedAt: string | null;
    /** Provider-neutral hint carried through for the classifier. `null` = adapter did not hint. */
    sourceTypeHint: PublicPageSourceHint | null;
    /** Provider provenance (`shared/observations`). Never carries a task id or secret. */
    observationMeta: ObservationMeta;
}
export interface PublicPageDiscoveryResult {
    rows: PublicPageDiscoveryRow[];
}
// ---------------------------------------------------------------------------
// Alternative engines — Bing / YouTube / Amazon
// ---------------------------------------------------------------------------
/**
 * The non-Google engines the rank capability can check. Google is deliberately
 * NOT in this union: it rides the shipped `checkRank` path with the
 * `serp_checks` metric, and nothing about it changes.
 */
export const ALT_RANK_ENGINES = ['bing', 'youtube', 'amazon'] as const;
export type AltRankEngine = (typeof ALT_RANK_ENGINES)[number];
export interface AltEngineRankInput {
    engine: AltRankEngine;
    keyword: string;
    /**
     * Site domain. The match target for `bing` (which returns off-platform web
     * URLs, exactly like Google). Ignored by `youtube` / `amazon`, whose result
     * URLs all live on the engine's own host — those match on `engineTarget`.
     */
    domain: string;
    /**
     * Exact-equality match token: a YouTube channel handle (lower-case, no
     * leading `@`) or an Amazon ASIN. `null` for `bing`, which matches on
     * `domain`. A row the vendor reports without the relevant token can never
     * match, so an unmatched check is `position: null` — never a guess.
     */
    engineTarget: string | null;
    locationCode: number;
    languageCode: string;
    device: SerpDevice;
}
/** One observed alt-engine result row, vendor-neutral. */
export interface AltEngineRankRow {
    domain: string;
    url: string;
    rankGroup: number;
    rankAbsolute: number;
    /** Match token for `youtube` / `amazon`; `null` when the engine matches on host. */
    matchToken: string | null;
}
export interface AltEngineRankResult {
    engine: AltRankEngine;
    /** `null` = the target is not inside the engine's bounded depth. */
    position: number | null;
    foundUrl: string | null;
    rows: AltEngineRankRow[];
    checkedAt: Date;
    /**
     * Provider provenance. Amazon additionally carries the
     * `observations.coverage.providerIndexRanking` note so no consumer can
     * present the ordinal as a live shelf position.
     */
    observationMeta: ObservationMeta;
}
export interface RankProvider {
    checkRank(input: RankCheckInput): Promise<RankCheckResult>;
    checkLocalPackRank(input: LocalPackCheckInput): Promise<LocalPackResult>;
    /**
     * Public-page discovery. ADDITIVE to the existing
     * SERP capability — reuses `PROVIDER_RANK` selection; no new selector.
     */
    searchPublicPages(input: PublicPageDiscoveryInput): Promise<PublicPageDiscoveryResult>;
    /**
     * Bing / YouTube / Amazon rank check. ADDITIVE
     * to the same `PROVIDER_RANK` capability — no new env selector, no new
     * vendor. Metered as `alt_engine_checks`, never `serp_checks`.
     */
    checkAltEngineRank(input: AltEngineRankInput): Promise<AltEngineRankResult>;
}
// ---------------------------------------------------------------------------
// Local SEO — business listings, reviews, Q&A (Business Data API)
// ---------------------------------------------------------------------------
export interface BusinessListingRow {
    /** The directory/source, e.g. 'google', 'yelp', 'bing-places', 'apple-maps'. Vendor-reported string. */
    source: string;
    name: string;
    address: string | null;
    phone: string | null;
    /** True when name/address/phone all match the canonical (Google) listing. */
    consistent: boolean;
}
export interface ReviewsSummary {
    averageRating: number | null;
    reviewCount: number;
    /** `null` = vendor reported no recent-reviews window. */
    recentReviewCount: number | null;
}
export interface QaSummary {
    questionCount: number;
    unansweredCount: number;
}
export interface LocalListingsProvider {
    getBusinessListings(domain: string): Promise<BusinessListingRow[]>;
    getReviews(domain: string): Promise<ReviewsSummary>;
    getQuestionsAndAnswers(domain: string): Promise<QaSummary>;
}
// ---------------------------------------------------------------------------
// Keyword research
// ---------------------------------------------------------------------------
export interface MonthlySearchVolume {
    year: number;
    month: number;
    searchVolume: number;
}
export interface KeywordMetrics {
    keyword: string;
    searchVolume: number | null;
    /** 0–100 vendor-normalized ranking difficulty. */
    difficulty: number | null;
    /** Cost per click, USD. */
    cpc: number | null;
    monthlySearches: MonthlySearchVolume[];
}
/** DataForSEO Labs Search Intent primary label (July 2026 enum). */
export type SearchIntent = 'informational' | 'commercial' | 'transactional' | 'navigational';
export interface IntentResult {
    keyword: string;
    /** `null` = vendor returned no classification for this keyword. */
    intent: SearchIntent | null;
    /** 0–1 vendor confidence, when reported. */
    confidence: number | null;
}
/** Keyword signal discovered from a site's existing footprint or content. */
export interface SiteKeywordCandidate {
    keyword: string;
    searchVolume: number | null;
    /** 0–100 vendor-normalized ranking difficulty, when the source exposes it. */
    difficulty: number | null;
    /** Current organic rank; null for site ideas or an unavailable signal. */
    currentPosition: number | null;
    /** Vendor-estimated organic visits for the ranking. */
    estimatedTraffic: number | null;
    rankingUrl: string | null;
}
/**
 * Closed enum of normalized SERP-feature types. Anything the
 * vendor reports outside this set maps to `'other'` in the adapter and is
 * NEVER dropped — mirrors the `intent: null` "never dropped" convention.
 */
export type SerpFeatureType = 'ai_overview' | 'featured_snippet' | 'people_also_ask' | 'local_pack' | 'video' | 'images' | 'shopping' | 'knowledge_graph' | 'other';
/** Per-keyword SERP-feature overview. One row per deduped input. */
export interface KeywordOverview {
    keyword: string;
    searchVolume: number | null;
    /** 0–100 vendor-normalized ranking difficulty. */
    difficulty: number | null;
    /** Cost per click, USD. */
    cpc: number | null;
    intent: SearchIntent | null;
    /** Normalized SERP features observed for the keyword; deduped, order preserved. */
    serpFeatures: SerpFeatureType[];
    /** SERP-observed timestamp from the vendor when available, else null. */
    observedAt: Date | null;
    /** Vendor-reported SERP results count, when available. */
    resultsCount: number | null;
}
/** Multi-year monthly search-volume history for a keyword. */
export interface KeywordHistoricalVolume {
    keyword: string;
    /** Ascending by (year, month); adapter bounds to ≤48 months. */
    monthlySearches: MonthlySearchVolume[];
}
/** Country-level market exposed by a provider's zero-cost catalog endpoint. */
export interface ProviderMarket {
    /** ISO 3166-1 alpha-2 country code. */
    countryCode: string;
    /** Vendor location identifier when the capability uses one. */
    locationCode: number | null;
    /** ISO 639-1 language codes accepted by the capability. */
    languageCodes: string[];
}
export interface KeywordProvider {
    /** Zero-cost provider catalog. Optional only for legacy test doubles. */
    listMarkets?(): Promise<ProviderMarket[]>;
    getMetrics(keywords: string[], location: number, language: string): Promise<KeywordMetrics[]>;
    getRelated(keyword: string, location: number, language: string, limit: number): Promise<KeywordMetrics[]>;
    /**
     * Classify search intent per keyword (Labs Search Intent). Returns exactly
     * one row per DEDUPED input keyword — a keyword the vendor did not classify
     * is reported as `{ intent: null, confidence: null }`, never dropped.
     */
    classifyIntent(keywords: string[], location: number, language: string): Promise<IntentResult[]>;
    /**
     * Broader keyword-ideas corpus for a seed (Labs Keyword Ideas). Same
     * `KeywordMetrics` shape as `getRelated` but a different, wider endpoint —
     * ideas/suggestions rather than terms strictly related to the exact seed.
     */
    getIdeas(seed: string, location: number, language: string, limit: number): Promise<KeywordMetrics[]>;
    /**
     * Seed-containing long-tail suggestions (Labs Keyword Suggestions).
     * Kept separate from `getIdeas`, whose corpus is intentionally broader.
     */
    getLongTailSuggestions(seed: string, location: number, language: string, limit: number): Promise<KeywordMetrics[]>;
    /**
     * SERP-feature overview per keyword (Labs Keyword Overview). Exactly one row
     * per DEDUPED input keyword — an omitted keyword is reported with every
     * field null / empty and never dropped. Unknown vendor SERP item types
     * normalize to `'other'`.
     */
    getOverview(keywords: string[], location: number, language: string): Promise<KeywordOverview[]>;
    /**
     * Multi-year monthly search-volume history (Labs Historical Search Volume).
     * Exactly one row per DEDUPED input keyword. `monthlySearches` is ascending
     * by (year, month) and bounded to the most recent ≤48 months. An omitted
     * keyword is reported with an empty array.
     */
    getHistoricalVolume(keywords: string[], location: number, language: string): Promise<KeywordHistoricalVolume[]>;
}
/** Optional keyword capability used by the rank-tracking discovery flow. */
export interface SiteKeywordProvider {
    getRankedKeywordsForSite(domain: string, location: number, language: string, limit: number): Promise<SiteKeywordCandidate[]>;
    getKeywordIdeasForSite(seeds: string[], location: number, language: string, limit: number): Promise<SiteKeywordCandidate[]>;
}
// ---------------------------------------------------------------------------
// Backlinks
// ---------------------------------------------------------------------------
export interface BacklinkSummary {
    /** 0–1000 vendor-normalized domain authority. `null` = unknown domain. */
    domainRank: number | null;
    backlinks: number;
    referringDomains: number;
    brokenBacklinks: number;
    firstSeen: Date | null;
}
export interface BacklinkRow {
    /** Normalized referring hostname when the vendor reports it. */
    domainFrom?: string;
    urlFrom: string;
    urlTo: string;
    anchor: string | null;
    dofollow: boolean;
    isBroken: boolean;
    firstSeen: Date | null;
    lastSeen: Date | null;
    /** Source backlink spam observation (0..100); absent on legacy test doubles. */
    backlinkSpamScore?: number | null;
    /** Referenced destination-page spam observation (0..100); not source risk. */
    urlToSpamScore?: number | null;
}
export interface BacklinkListPage {
    rows: BacklinkRow[];
    /** Absent = no more pages. */
    nextCursor?: string;
}
/**
 * One referring domain — the domains that link to a given target. Row-billed
 * at 72 micros/row on top of the fixed task cost.
 */
export interface BacklinkReferringDomainRow {
    /** Normalized referring domain (lowercased, scheme + trailing slash stripped). */
    domain: string;
    /** Live backlinks from this referring domain to the target. */
    backlinks: number;
    /**
     * DataForSEO domain rank on the 0..100 (`one_hundred`) scale. `null` = the
     * vendor did not report a rank for this domain.
     */
    domainRank: number | null;
    firstSeen: Date | null;
    lastSeen: Date | null;
}
/**
 * One anchor text row for a target. `anchor` MUST be treated as untrusted
 * third-party text (SEC-OUT — the crawler surfaces arbitrary link text from
 * the open web). The adapter clamps it to 200 chars at the boundary before
 * it reaches feature code.
 */
export interface BacklinkAnchorRow {
    /** Untrusted anchor text; clamped to 200 chars at the adapter boundary. */
    anchor: string;
    backlinks: number;
    referringDomains: number;
}
/** One (year, month) history point for a domain's backlink profile. */
export interface BacklinkHistoryPoint {
    year: number;
    /** 1..12 (calendar month). */
    month: number;
    backlinks: number;
    referringDomains: number;
}
/** One bulk-rank row — a domain and its 0..100 domain rank (or null). */
export interface BacklinkBulkRankRow {
    /** Normalized domain (lowercased, scheme + `www.` + trailing slash stripped). */
    domain: string;
    rank: number | null;
}
/** One normalized bulk spam-score result from the Backlinks capability. */
export interface BacklinkSpamScoreRow {
    /** Normalized domain/subdomain or absolute HTTP(S) page target. */
    target: string;
    /** Provider observation on the closed 0..100 scale; null = not reported. */
    spamScore: number | null;
}
/**
 * One competitor row keyed to backlink footprint (referring domain overlap),
 * NOT SERP overlap. `intersections` = number of referring domains both the
 * target and the competitor share.
 */
export interface BacklinkCompetitorRow {
    domain: string;
    intersections: number;
    rank: number | null;
}
export interface BacklinkProvider {
    getSummary(domain: string): Promise<BacklinkSummary>;
    listBacklinks(domain: string, opts: {
        limit: number;
        cursor?: string;
    }): Promise<BacklinkListPage>;
    /**
     * Referring domains for a target. `limit` clamped 1..500 at the boundary.
     * Row-billed (72 micros/row) plus fixed task cost.
     *
     * Optional at the interface level so that existing test doubles that stub
     * only `getSummary`/`listBacklinks` remain structurally valid. Every shipped
     * `BacklinkProvider` implementation (fake + DataForSEO adapter) provides
     * this method concretely; callers should check for its presence.
     */
    getReferringDomains?(domain: string, opts: {
        limit: number;
    }): Promise<BacklinkReferringDomainRow[]>;
    /**
     * Anchor text distribution for a target. `limit` clamped 1..500. Anchor
     * text is untrusted third-party text (SEC-OUT); clamped to 200 chars.
     * Row-billed (72 micros/row) plus fixed task cost. See `getReferringDomains`
     * for the optional-at-interface rationale.
     */
    getAnchors?(domain: string, opts: {
        limit: number;
    }): Promise<BacklinkAnchorRow[]>;
    /**
     * Monthly history of backlinks + referring domains. Points ordered ascending
     * by (year, month); adapter caps to the newest 1..24 points as `limit`.
     * Point-billed (400 micros/point) plus fixed task cost.
     */
    getHistory?(domain: string, opts: {
        limit: number;
    }): Promise<BacklinkHistoryPoint[]>;
    /**
     * Bulk domain rank lookup. Input `domains` normalized + deduplicated;
     * accepted range is 1..100 unique entries. Domain-billed (400 micros/domain)
     * plus fixed task cost.
     */
    getBulkRanks?(domains: string[]): Promise<BacklinkBulkRankRow[]>;
    /**
     * Bulk spam-score lookup. The provider boundary accepts at most 1,000
     * unique normalized targets; feature cost ceilings may impose a lower cap.
     */
    getBulkSpamScores?(targets: string[]): Promise<BacklinkSpamScoreRow[]>;
    /**
     * Competitors keyed to referring-domain overlap (backlink footprint), not
     * SERP overlap. `limit` clamped 1..500. Row-billed (400 micros/row) plus
     * fixed task cost.
     */
    getBacklinkCompetitors?(domain: string, opts: {
        limit: number;
    }): Promise<BacklinkCompetitorRow[]>;
}
// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------
export interface CompetitorEntry {
    domain: string;
    avgPosition: number | null;
    /** Count of keywords both domains rank for. */
    intersections: number;
    estimatedTraffic: number | null;
}
/**
 * Normalized technology category. A vendor category string that does not map
 * to one of these buckets normalizes to `'other'` — never dropped, never
 * thrown (Domain Analytics — Domain Technologies signals evolve).
 */
export type TechStackCategory = 'cms' | 'analytics' | 'hosting' | 'ecommerce' | 'other';
export interface TechStackEntry {
    category: TechStackCategory;
    /** Vendor-reported technology name, e.g. 'WordPress', 'Google Analytics', 'Cloudflare'. */
    name: string;
}
export interface DomainIntersectionOptions {
    locationCode: number;
    languageCode: string;
    limit?: number;
}
export interface DomainIntersectionRow {
    keyword: string;
    target1Position: number | null;
    target2Position: number | null;
    searchVolume: number | null;
    /** Additive compatibility evidence for corrected competitor-only gaps. */
    class?: 'missing';
    target1Url?: string | null;
    target2Url?: string | null;
    provenance?: {
        provider: string;
        operation: 'domain_intersection_live';
        leg: 'competitor_only';
        intersections: false;
        targetOrder: 'competitor_owned';
        itemTypes: [
            'organic'
        ];
        limit: 100;
        cache: 'hit' | 'miss';
        status: 'success';
        capturedAt: string | null;
        returnedRows: number;
        truncated: boolean;
    };
}
/**
 * Provider-neutral input for one owned-domain versus competitor-domain
 * organic keyword landscape. Origins are frozen separately from domains so
 * an observed relative ranking path can be resolved without inventing a
 * homepage or guessing a scheme.
 */
export interface DomainComparisonInput {
    ownedDomain: string;
    ownedOrigin: string;
    competitorDomain: string;
    competitorOrigin: string;
    locationCode: number;
    languageCode: string;
}
/** One normalized organic keyword observation in canonical owned orientation. */
export interface DomainComparisonRow {
    keyword: string;
    normalizedKeyword: string;
    ownedPosition: number | null;
    competitorPosition: number | null;
    ownedRankAbsolute: number | null;
    competitorRankAbsolute: number | null;
    ownedUrl: string | null;
    competitorUrl: string | null;
    searchVolume: number | null;
    keywordDifficulty: number | null;
    intent: SearchIntent | null;
    observationMeta: ObservationMeta;
}
/**
 * The exact three bounded organic classes returned by a comparison. The
 * adapter de-duplicates each class and never returns more than 100 rows in
 * any array.
 */
export interface DomainComparisonResult {
    shared: DomainComparisonRow[];
    ownedOnly: DomainComparisonRow[];
    competitorOnly: DomainComparisonRow[];
}
/**
 * One country row inside a traffic-estimation aggregate. `visits` is the
 * vendor's estimated monthly organic visits from that country — NOT observed
 * traffic (downstream `ObservationMeta` MUST label the source as an estimate).
 */
export interface TrafficEstimationCountry {
    /** ISO 3166-1 alpha-2 uppercase (`US`, `DE`, `FR`). */
    countryCode: string;
    /** Non-negative integer monthly organic visits (estimated). */
    visits: number;
}
/**
 * One domain's bulk traffic-estimation row (Labs
 * `/dataforseo_labs/google/bulk_traffic_estimation/live`). Row-billed at
 * 400 micros/domain on top of the fixed task cost. Downstream
 * consumers MUST label `monthlyOrganicVisits` as an ESTIMATE via
 * `ObservationMeta`.
 */
export interface TrafficEstimationRow {
    /** Normalized (lowercased, scheme + trailing slash stripped) target domain. */
    domain: string;
    /** Non-negative integer estimated monthly organic visits. */
    monthlyOrganicVisits: number;
    /** Ordered top country breakdown; adapter caps to 10 rows per domain. */
    topCountries: TrafficEstimationCountry[];
}
/**
 * Aggregate domain-rank overview row (Labs
 * `/dataforseo_labs/google/domain_rank_overview/live`). Task-billed only —
 * price sheet.
 */
export interface DomainRankOverviewRow {
    /** Normalized target domain. */
    domain: string;
    /** DataForSEO 0..100 domain rank; `null` = vendor reported none. */
    rank: number | null;
    /** Non-negative integer count of organic ranked keywords. */
    keywordsCount: number;
    /** Non-negative integer estimated monthly organic visits (ETV). */
    estimatedMonthlyOrganicVisits: number;
}
/** One (year, month) point in a domain's historical rank overview. */
export interface HistoricalRankOverviewPoint {
    year: number;
    /** 1..12 (calendar month). */
    month: number;
    rank: number | null;
    organicKeywords: number;
    organicEtv: number;
}
/**
 * Historical rank overview aggregate for a single domain (Labs
 * `/dataforseo_labs/google/historical_rank_overview/live`). Points ascending
 * by (year, month); adapter caps to the NEWEST 1..24 points as `limit`.
 * Point-billed at 200 micros/point plus fixed task cost.
 */
export interface HistoricalRankOverviewResult {
    /** Normalized target domain. */
    domain: string;
    points: HistoricalRankOverviewPoint[];
}
export interface CompetitorProvider {
    getCompetitors(domain: string, location: number, language: string, limit: number): Promise<CompetitorEntry[]>;
    /**
     * Keyword-driven SERP competitors (Labs serp_competitors) — the domains
     * dominating the SERPs for the given keywords. Fallback source for targets
     * with no ranked-keyword footprint in the Labs index, where
     * `getCompetitors` is structurally empty. Result domains are normalized
     * (scheme / `www.` stripped, lowercased) and de-duplicated;
     * `intersections` = the count of the given keywords the domain ranks for.
     */
    getSerpCompetitors(keywords: string[], location: number, language: string, limit: number): Promise<CompetitorEntry[]>;
    getDomainIntersection(target1: string, target2: string, opts: DomainIntersectionOptions): Promise<DomainIntersectionRow[]>;
    /**
     * Exact three-leg organic landscape: shared, owned-only, and swapped
     * competitor-only. Optional at interface level so legacy consumers and
     * test doubles that implement only the shipped pre-landscape surface stay
     * structurally compatible. Both registry implementations provide it.
     */
    compareDomains?(input: DomainComparisonInput): Promise<DomainComparisonResult>;
    /**
     * Detect the CMS/analytics/hosting/e-commerce technology signals a domain
     * runs (DataForSEO Domain Analytics — Domain Technologies). Unrecognized
     * vendor categories normalize to `'other'`; an empty array = the vendor
     * reported no technologies (a valid state, not an error).
     */
    getTechnologies(domain: string): Promise<TechStackEntry[]>;
    /**
     * Bulk traffic estimation for 1..30 unique domains (Labs
     * `bulk_traffic_estimation`). Row-billed (400 micros/domain) + task cost
     *. Returned visits are ESTIMATES — downstream MUST tag the
     * `ObservationMeta` accordingly and never label the number as observed.
     *
     * Optional at the interface level so that existing test doubles that stub
     * only the shipped `CompetitorProvider` methods remain structurally valid.
     * Every shipped implementation (fake + DataForSEO adapter) provides this
     * method concretely; callers should check for its presence.
     */
    getTrafficEstimation?(domains: string[], opts: {
        locationCode: number;
        languageCode: string;
    }): Promise<TrafficEstimationRow[]>;
    /**
     * Single-domain aggregate rank overview (Labs `domain_rank_overview`).
     * Task-billed only. See `getTrafficEstimation` for the optional-at-
     * interface rationale.
     */
    getDomainRankOverview?(domain: string, opts: {
        locationCode: number;
        languageCode: string;
    }): Promise<DomainRankOverviewRow>;
    /**
     * Historical monthly rank overview (Labs `historical_rank_overview`).
     * Point-billed (200 micros/point) + task cost. `limit` clamped 1..24;
     * ascending order; adapter maps arbitrarily-longer vendor history down to
     * the newest `limit` points.
     */
    getHistoricalRankOverview?(domain: string, opts: {
        locationCode: number;
        languageCode: string;
        limit: number;
    }): Promise<HistoricalRankOverviewResult>;
}
// ---------------------------------------------------------------------------
// Page speed
// ---------------------------------------------------------------------------
export type PageSpeedStrategy = 'mobile' | 'desktop';
export interface PageSpeedInput {
    url: string;
    strategy: PageSpeedStrategy;
}
export type CoreWebVitalsCategory = 'good' | 'needs-improvement' | 'poor';
export interface PageSpeedResult {
    /** Lab (Lighthouse-style) category scores, each 0–100. */
    labScores: {
        performance: number;
        seo: number;
        accessibility: number;
        bestPractices: number;
    };
    /**
     * Field data. ABSENT = the vendor has no real-user data for this URL —
     * an expected state for low-traffic pages, not an error.
     */
    coreWebVitals?: {
        lcpMs: number;
        inp: number;
        cls: number;
        category: CoreWebVitalsCategory;
    };
    mobileFriendly?: boolean;
}
export interface PageSpeedProvider {
    analyze(input: PageSpeedInput): Promise<PageSpeedResult>;
}
// ---------------------------------------------------------------------------
// Google Search Console
// ---------------------------------------------------------------------------
/** OAuth material for a linked Search Console account. */
export interface GscConnection {
    accessToken: string;
    refreshToken?: string;
}
export interface GscProperty {
    siteUrl: string;
    permissionLevel: string;
}
/**
 * Google's four-verdict scale for both the top-level `indexStatusResult` and
 * `richResultsResult`. Verified against `searchconsole.googleapis.com/v1`
 * (July 2026): `PASS | PARTIAL | FAIL | NEUTRAL`. Rules treat NEUTRAL as
 * "insufficient signal", never as "healthy".
 */
export type GscVerdict = 'PASS' | 'PARTIAL' | 'FAIL' | 'NEUTRAL';
export interface GscUrlInspection {
    indexVerdict: GscVerdict;
    coverageState: string;
    robotsTxtState: string;
    pageFetchState: string | null;
    googleCanonical: string | null;
    lastCrawlTime: Date | null;
    richResults: {
        verdict: GscVerdict;
        /** Detected rich-result items — `type` is Google's item name; `issues` is
         * the count of "invalid" entries on that item. */
        items: Array<{
            type: string;
            issues: number;
        }>;
    };
}
/** One Search Analytics result row — `keys` is parallel to the requested
 * `dimensions[]` (same order). */
export interface GscSearchAnalyticsRow {
    keys: string[];
    clicks: number;
    impressions: number;
    /** 0–1 float. */
    ctr: number;
    /** 1.0+ float. */
    position: number;
}
export interface GscSearchAnalyticsResult {
    rows: GscSearchAnalyticsRow[];
    /** Always true — Google samples Search Analytics (~50k row cap); UI copy
     * must say "sampled by Google". */
    sampled: boolean;
    /** ISO date (echoed back from the request). */
    startDate: string;
    endDate: string;
    dimensions: string[];
}
export interface GscSitemapEntry {
    /** The submitted sitemap URL. */
    path: string;
    /** sitemap | sitemapIndex | rss | atom. */
    type: string;
    lastSubmitted: Date | null;
    lastDownloaded: Date | null;
    isPending: boolean;
    isSitemapsIndex: boolean;
    errors: number;
    warnings: number;
    /** Submitted URLs count. */
    processed: number;
}
export interface GscSearchAnalyticsInput {
    siteUrl: string;
    /** YYYY-MM-DD. */
    startDate: string;
    /** YYYY-MM-DD — Search Analytics has a ~3-day lag; callers pass
     * `today - 3` so the window never includes unreliable days. */
    endDate: string;
    /** Subset of query|page|country|device|date|searchAppearance. */
    dimensions: string[];
    /** Default 1000, max 25000. */
    rowLimit?: number;
    /** Default 'web'. */
    type?: 'web' | 'image' | 'video' | 'news' | 'discover';
}
export interface GscProvider {
    listProperties(connection: GscConnection): Promise<GscProperty[]>;
    inspectUrl(connection: GscConnection, input: {
        inspectionUrl: string;
        siteUrl: string;
    }): Promise<GscUrlInspection>;
    querySearchAnalytics(connection: GscConnection, input: GscSearchAnalyticsInput): Promise<GscSearchAnalyticsResult>;
    listSitemaps(connection: GscConnection, input: {
        siteUrl: string;
    }): Promise<GscSitemapEntry[]>;
}
// ---------------------------------------------------------------------------
// GA4 — Google Analytics Data API v1beta + Admin API v1beta (account
// summaries). Shares the SAME Google OAuth connection as GSC (one token,
// one status), so provider calls take a `GscConnection`; token lifecycle
// (refresh/revoke) stays on the GSC provider — GA4 never mints tokens.
// ---------------------------------------------------------------------------
export interface Ga4Property {
    /** GA4 resource name, e.g. `properties/123456789`. */
    propertyId: string;
    displayName: string;
}
/** One GA4 web data stream used only for matching a Site to a property. */
export interface Ga4WebDataStream {
    /** Admin API resource name, e.g. `properties/123/dataStreams/456`. */
    streamId: string;
    displayName: string;
    /** Configured website URL. Empty when Google omits web-stream metadata. */
    defaultUri: string;
}
export interface Ga4RunReportInput {
    /** GA4 resource name, e.g. `properties/123456789`. */
    propertyId: string;
    /** YYYY-MM-DD. GA4 data lags ~24-48h; callers pass `today - 1`. */
    startDate: string;
    endDate: string;
    /** GA4 dimension API names, e.g. `date`, `sessionDefaultChannelGroup`,
     * `pagePath`, `country`, `deviceCategory`. */
    dimensions: string[];
    /** GA4 metric API names, e.g. `sessions`, `activeUsers`,
     * `engagedSessions`, `keyEvents`. */
    metrics: string[];
    /** Default 1000 (Data API max is far higher; we never need it). */
    limit?: number;
}
export interface Ga4ReportRow {
    /** One value per requested dimension, in request order. */
    dimensionValues: string[];
    /** One value per requested metric, in request order (parsed to numbers). */
    metricValues: number[];
}
export interface Ga4RunReportResult {
    rows: Ga4ReportRow[];
    /** Total matching rows reported by the API (may exceed rows.length). */
    rowCount: number;
    /** Echoed back from the request. */
    startDate: string;
    endDate: string;
    dimensions: string[];
    metrics: string[];
}
export interface Ga4Provider {
    /** Flattened property summaries across every accessible GA account. */
    listProperties(connection: GscConnection): Promise<Ga4Property[]>;
    /** Web streams for one accessible property; non-web streams are omitted. */
    listWebDataStreams(connection: GscConnection, propertyId: string): Promise<Ga4WebDataStream[]>;
    runReport(connection: GscConnection, input: Ga4RunReportInput): Promise<Ga4RunReportResult>;
}
/**
 * Rule-engine input for the three GSC index-status rules.
 *
 * `status: 'not-connected'` → user has no google_connection at all.
 * `status: 'needs-reconnect'` → refresh token dead (invalid_grant).
 * `status: 'quota-exceeded'` → daily 2000/property or 600/min limit hit.
 * `status: 'unavailable'` → the vendor call failed for another reason
 *   (5xx/timeout/malformed) — rules land in watch with `insufficientData`.
 * `status: 'ok'` → samples[] carries per-URL verdicts.
 */
export type IndexStatusStatus = 'ok' | 'unavailable' | 'not-connected' | 'needs-reconnect' | 'quota-exceeded';
export interface IndexStatusSample {
    url: string;
    inspection: GscUrlInspection;
}
export interface IndexStatusEvaluationInput {
    status: IndexStatusStatus;
    samples: IndexStatusSample[];
}
/**
 * Rule-engine input for the GSC Search Analytics rule.
 *
 * `status: 'no-data'` → the query succeeded but returned zero rows (new
 * property, or nothing in the 28-day window). Quota hits map onto
 * `unavailable` here — unlike URL Inspection, one Search Analytics call per
 * audit is far inside the 1200/min/property budget, so a 429 is treated as
 * a transient vendor failure, not a distinct state.
 */
export type GscSearchStatus = 'ok' | 'unavailable' | 'not-connected' | 'needs-reconnect' | 'no-data';
export interface GscSearchTopEntry {
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}
export interface GscSearchEvaluationInput {
    status: GscSearchStatus;
    totalClicks: number;
    totalImpressions: number;
    /** Weighted: sum(ctr*impressions)/sum(impressions). */
    averageCtr: number;
    /** Weighted: sum(position*impressions)/sum(impressions). */
    averagePosition: number;
    topQueries: Array<GscSearchTopEntry & {
        query: string;
    }>;
    topPages: Array<GscSearchTopEntry & {
        url: string;
    }>;
    /** Pre-vs-post-period delta in absolute clicks/impressions — null on first run. */
    delta: {
        clicks: number | null;
        impressions: number | null;
    };
}
/**
 * Rule-engine input for the GSC sitemaps rule.
 * `status: 'no-sitemaps'` → connected property has nothing submitted.
 */
export type GscSitemapsStatus = 'ok' | 'unavailable' | 'not-connected' | 'needs-reconnect' | 'no-sitemaps';
export interface GscSitemapsEvaluationInput {
    status: GscSitemapsStatus;
    sitemaps: Array<{
        path: string;
        errors: number;
        warnings: number;
        processed: number;
        lastDownloaded: Date | null;
    }>;
}
// ---------------------------------------------------------------------------
// AI Visibility (LLM mentions + AI-mode keyword volume)
// ---------------------------------------------------------------------------
export interface AiMentionCheckInput {
    domain: string;
    /** Buyer-intent prompts to check, e.g. "best {category} for {use-case}". */
    prompts: string[];
}
export interface AiMentionRow {
    prompt: string;
    /** The model/surface that generated the answer, e.g. 'chatgpt' | 'perplexity' | 'google-ai-mode'. Vendor-reported string, not a closed enum — new surfaces appear without a code change. */
    model: string;
    mentioned: boolean;
    /** The exact URL cited, when the vendor reports one. Absent = not reported. */
    citedUrl?: string;
    checkedAt: Date;
}
export interface AiKeywordVolume {
    keyword: string;
    /** Monthly search volume specifically attributed to AI-mode/AI-Overview surfaces. `null` = vendor has no data for this keyword. */
    aiSearchVolume: number | null;
}
export interface AiAnswerInput {
    /** Buyer-intent prompts to send to the LLM surfaces. */
    prompts: string[];
    /** Vendor-reported surface ids to query, e.g. ['chatgpt', 'perplexity', 'google-ai-mode']. */
    models: string[];
}
export interface AiAnswerRow {
    prompt: string;
    /** The model/surface that generated the answer. Vendor-reported string, not a closed enum. */
    model: string;
    /** The raw answer text the model returned for the prompt. */
    answer: string;
    /** Citation URLs the answer references, in vendor order. Empty array = none reported. */
    citations: string[];
    checkedAt: Date;
}
export interface AiVisibilityProvider {
    checkMentions(input: AiMentionCheckInput): Promise<AiMentionRow[]>;
    /**
     * Raw LLM answers (LLM Responses API) — the source consumers parse for sentiment and
     * competitor share-of-voice. Pricier than checkMentions; called only for tracked prompts.
     */
    getAnswers(input: AiAnswerInput): Promise<AiAnswerRow[]>;
    getAiKeywordVolume(keywords: string[], location: number, language: string): Promise<AiKeywordVolume[]>;
}
// ---------------------------------------------------------------------------
// Content Analysis — DataForSEO Content
// Analysis `search/live` and `summary/live`. Provider seam only; no feature
// module consumes it yet (the Brand Radar pipeline will).
// ---------------------------------------------------------------------------
/**
 * Bounded, single-brand/topic query. `query` is zod-clamped 1..200 chars at the
 * boundary before request shaping (SEC-INJECT). No user text is ever
 * interpolated into log lines.
 */
export interface ContentAnalysisMentionQuery {
    query: string;
    /** ISO-ish language identifier (e.g. `en`, `es`). Optional. */
    language?: string;
    /** Publisher-domain registration country (ISO 3166-1 alpha-2). */
    countryCode?: string;
    /** ISO 8601 calendar date (YYYY-MM-DD). Optional; adapter refuses future dates. */
    publishedFrom?: string;
    /** Rows-per-call ceiling, integer 1..1000; adapter clamps. */
    limit: number;
}
/**
 * One normalized mention row. Vendor-shaped fields (author profile urls, ids,
 * favicons, logos) are DROPPED at normalization. `snippet` is clamped to 300
 * chars (SEC-BOUND); further feature-layer clamping is on top of this bound.
 */
export interface ContentAnalysisMentionRow {
    url: string;
    domain: string;
    title: string;
    snippet: string;
    sentiment: {
        polarity: 'positive' | 'neutral' | 'negative' | null;
        /** 0..1 vendor confidence when reported; else null. */
        confidence: number | null;
    };
    language: string | null;
    /** ISO 8601 datetime when the vendor reports one; else null. */
    observedAt: string | null;
}
export interface ContentAnalysisMentionSummary {
    totalMentions: number;
    distribution: {
        positive: number;
        neutral: number;
        negative: number;
    };
    /** Top domains observed. Bounded to <=50 entries. */
    topDomains: Array<{
        domain: string;
        mentions: number;
    }>;
}
export interface ContentAnalysisProvider {
    /** Zero-cost publisher-country catalog. Optional only for legacy test doubles. */
    listMarkets?(): Promise<ProviderMarket[]>;
    searchMentions(input: ContentAnalysisMentionQuery): Promise<ContentAnalysisMentionRow[]>;
    getMentionSummary(input: ContentAnalysisMentionQuery): Promise<ContentAnalysisMentionSummary>;
}
// ---------------------------------------------------------------------------
// Reviews — DataForSEO Business Data reviews
// for Google, Trustpilot, Tripadvisor. Provider seam only; feature module
// (Review Intelligence) lands. Public business-profile reads
// only — no vendor account linking.
// ---------------------------------------------------------------------------
export type ReviewsSource = 'google' | 'trustpilot' | 'tripadvisor';
export interface ReviewsInput {
    source: ReviewsSource;
    /**
     * Business identifier. Meaning per source (google: place/CID string;
     * trustpilot: business domain; tripadvisor: location id string). Adapter
     * bounds length 1..200 and rejects control chars.
     */
    target: string;
    /** Vendor language passthrough, optional. */
    language?: string;
    /** Reviews depth per source. Integer 1..100. */
    depth: number;
}
export interface ReviewRow {
    /** 0..5, clamped. `null` when the vendor did not report. */
    rating: number | null;
    title: string | null;
    /**
     * Review body. Clamped to 1000 characters at the provider boundary. Emails
     * detected inside the body are replaced with `[email]` at normalization
     * (privacy). Feature-layer excerpts clamp further.
     */
    text: string;
    /**
     * Public author display name only. Reviewer profile URLs, IDs, and any
     * email-like string are DROPPED at normalization.
     */
    authorDisplayName: string | null;
    language: string | null;
    reviewedAt: string | null;
    /** Opaque per-source id; never a vendor task id. */
    sourceReviewId: string;
}
export interface ReviewsResult {
    source: ReviewsSource;
    target: string;
    rows: ReviewRow[];
    /** ISO 8601 when the result was assembled. */
    fetchedAt: string;
}
export interface ReviewsProvider {
    getReviews(input: ReviewsInput): Promise<ReviewsResult>;
}
// ---------------------------------------------------------------------------
// Google Trends — DataForSEO Keywords Data
// `keywords_data/google_trends/explore/live`. Provider seam only; feature
// module (Keyword Trends) consumes it later. Vendor-neutral
// monthly-only series with clamped 0..100 values, ≤60 monthly points per
// series, and ≤50 related queries.
// ---------------------------------------------------------------------------
export interface TrendsExploreInput {
    /**
     * 1..5 keywords, each trimmed to 1..200 characters. Adapter clamps and
     * de-duplicates (SEC-INJECT / SEC-BOUND).
     */
    keywords: string[];
    /** DataForSEO location_code passthrough. Optional; default worldwide. */
    locationCode?: number;
    /** ISO 639-1. Optional. */
    languageCode?: string;
    /** ISO 8601 date (YYYY-MM-DD). Optional. */
    startDate?: string;
    /** ISO 8601 date (YYYY-MM-DD). Optional. Adapter refuses future dates. */
    endDate?: string;
}
export interface TrendsMonthlyPoint {
    year: number;
    month: number;
    /** 0..100 vendor-normalized interest score. */
    value: number;
}
export interface TrendsSeries {
    keyword: string;
    /** Ascending by (year, month); adapter caps to 60 points. */
    points: TrendsMonthlyPoint[];
}
export interface TrendsRelatedQuery {
    /**
     * Related-query text. ≤ 100 chars. Treated as UNTRUSTED third-party text
     * downstream (SEC-OUT) — feature-layer surfaces must output-encode.
     */
    query: string;
    /** 0..100 rising|top score. */
    value: number;
    kind: 'rising' | 'top';
}
export interface TrendsExploreResult {
    series: TrendsSeries[];
    /** Bounded to <= 50 entries. */
    relatedQueries: TrendsRelatedQuery[];
    window: {
        startDate: string | null;
        endDate: string | null;
    };
    /** ISO 8601 datetime the vendor observation was assembled. */
    observedAt: string;
    locationCode: number | null;
    languageCode: string | null;
}
export interface TrendsProvider {
    explore(input: TrendsExploreInput): Promise<TrendsExploreResult>;
}
