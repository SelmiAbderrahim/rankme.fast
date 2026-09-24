/**
 * Provider registry — the composition root.
 *
 * Feature modules receive providers FROM this registry; no module imports a
 * vendor client directly (ESLint `no-restricted-imports` enforces it for
 * `src/modules/**`). Selection is env-driven (`PROVIDER_AUDIT=dataforseo|fake`,
 * …); an unknown value fails startup loudly.
 *
 * Ponytail rule: a vendor name is only wired here when the adapter actually
 * ships. Until then selecting it throws at startup instead of silently
 * degrading. `PROVIDER_AUDIT=dataforseo` is wired for the shipped adapter.
 */
import type { Logger } from 'pino';
import { z } from 'zod';
import { createDataForSeoAiVisibilityProvider } from './dataforseo/ai-visibility.js';
import { createDataForSeoOnPageAuditProvider } from './dataforseo/onpage.js';
import { createDataForSeoBacklinkProvider } from './dataforseo/backlinks.js';
import { createDataForSeoCompetitorProvider } from './dataforseo/labs-competitors.js';
import { createDataForSeoContentAnalysisProvider } from './dataforseo/content-analysis.js';
import { createDataForSeoKeywordProvider } from './dataforseo/keywords.js';
import { createDataForSeoLocalListingsProvider } from './dataforseo/local-listings.js';
import { createDataForSeoRankProvider } from './dataforseo/serp.js';
import { createDataForSeoAltEngineProvider } from './dataforseo/alt-engines.js';
import { createDataForSeoReviewsProvider } from './dataforseo/reviews.js';
import { createDataForSeoTrendsProvider } from './dataforseo/trends.js';
import { createDataForSeoAppDataProvider } from './dataforseo/app-data.js';
import { createDataForSeoPageSpeedProvider } from './dataforseo/pagespeed.js';
import { createFakeContentSourceProvider } from './content-source-fake.js';
import { createFirecrawlContentSourceProvider } from './firecrawl/content-source.js';
import type { ContentSourceProvider } from './content-source.js';
import { createFakeContentMonitorProvider } from './content-monitor-fake.js';
import { createFirecrawlContentMonitorProvider } from './firecrawl/content-monitor.js';
import type { ContentMonitorProvider } from './content-monitor.js';
import { createFakeAiVisibilityProvider, createFakeAuditProvider, createFakeBacklinkProvider, createFakeCompetitorProvider, createFakeContentAnalysisProvider, createFakeGa4Provider, createFakeGscProvider, createFakeKeywordProvider, createFakeLocalListingsProvider, createFakePageSpeedProvider, createFakeRankProvider, createFakeReviewsProvider, createFakeTrendsProvider, createFakeAppDataProvider, } from './fakes.js';
import { createGoogleGa4Provider } from './google/ga4.js';
import { createGoogleGscProvider } from './google/gsc.js';
import type { GoogleGscProvider } from './google/gsc.js';
import { createGooglePageSpeedProvider } from './google/pagespeed.js';
import type { AiGenerationProvider, AiProviderKey } from './ai-generation.js';
import type { RecordAiProfileRun } from '../ai-profiles/index.js';
import { createAnthropicProfileGenerationProvider, createFakeProfileSummaryProvider, createOrderedProfileSummaryProvider, DEFAULT_SUMMARY_MODEL, } from './summary/index.js';
import type { SummaryProvider } from './summary/types.js';
import type { AppDataProvider } from './app-data.js';
import type { AiVisibilityProvider, AuditProvider, BacklinkProvider, CompetitorProvider, ContentAnalysisProvider, Ga4Provider, KeywordProvider, LocalListingsProvider, PageSpeedProvider, RankProvider, ReviewsProvider, SiteKeywordProvider, TrendsProvider, } from './types.js';
export const providerSelectionSchema = z.object({
    audit: z.enum(['dataforseo', 'fake']),
    rank: z.enum(['dataforseo', 'fake']),
    keyword: z.enum(['dataforseo', 'fake']),
    backlink: z.enum(['dataforseo', 'fake']),
    competitor: z.enum(['dataforseo', 'fake']),
    localListings: z.enum(['dataforseo', 'fake']),
    pagespeed: z.enum(['dataforseo', 'google', 'fake']),
    gsc: z.enum(['google', 'fake']),
    ga4: z.enum(['google', 'fake']),
    summary: z.enum(['anthropic', 'ai-sdk', 'fake']),
    aiVisibility: z.enum(['dataforseo', 'fake']),
    contentSource: z.enum(['firecrawl', 'fake']),
    contentAnalysis: z.enum(['dataforseo', 'fake']),
    reviews: z.enum(['dataforseo', 'fake']),
    trends: z.enum(['dataforseo', 'fake']),
    appData: z.enum(['dataforseo', 'fake']),
});
export type ProviderSelection = z.infer<typeof providerSelectionSchema>;
export interface ProviderRegistry {
    audit: AuditProvider;
    rank: RankProvider;
    keyword: KeywordProvider & SiteKeywordProvider;
    backlink: BacklinkProvider;
    competitor: CompetitorProvider;
    localListings: LocalListingsProvider;
    pagespeed: PageSpeedProvider;
    gsc: GoogleGscProvider;
    /** GA4 shares the GSC Google OAuth connection; token lifecycle stays on `gsc`. */
    ga4: Ga4Provider;
    /**
     * `null` = AI summary helper is disabled (`AI_SUMMARY_ENABLED=false` OR
     * legacy `PROVIDER_SUMMARY=anthropic` with no key). Callers must
     * treat null as "feature unavailable" — the audit never depends on it.
     */
    summary: SummaryProvider | null;
    aiVisibility: AiVisibilityProvider;
    contentSource: ContentSourceProvider;
    /**
     * Public-page change monitoring. Shares the `PROVIDER_CONTENT_SOURCE`
     * selection with `contentSource` — the same vendor backs both capabilities.
     */
    contentMonitor: ContentMonitorProvider;
    /** Content Analysis mentions + summary. Seam only in this batch. */
    contentAnalysis: ContentAnalysisProvider;
    /** Reviews across Google/Trustpilot/Tripadvisor. Seam only in this batch. */
    reviews: ReviewsProvider;
    /** Google Trends. Seam only in this batch;
     * feature consumers land (Keyword Trends). */
    trends: TrendsProvider;
    /** Mobile-store App Data + Labs research. */
    appData: AppDataProvider;
}
export interface ProviderSelectionEnv {
    PROVIDER_AUDIT: ProviderSelection['audit'];
    PROVIDER_RANK: ProviderSelection['rank'];
    PROVIDER_KEYWORD: ProviderSelection['keyword'];
    PROVIDER_BACKLINK: ProviderSelection['backlink'];
    PROVIDER_COMPETITOR: ProviderSelection['competitor'];
    PROVIDER_LOCAL_LISTINGS: ProviderSelection['localListings'];
    PROVIDER_PAGESPEED: ProviderSelection['pagespeed'];
    PROVIDER_GSC: ProviderSelection['gsc'];
    PROVIDER_GA4: ProviderSelection['ga4'];
    PROVIDER_SUMMARY: ProviderSelection['summary'];
    PROVIDER_AI_VISIBILITY: ProviderSelection['aiVisibility'];
    PROVIDER_CONTENT_SOURCE: ProviderSelection['contentSource'];
    PROVIDER_CONTENT_ANALYSIS: ProviderSelection['contentAnalysis'];
    PROVIDER_REVIEWS: ProviderSelection['reviews'];
    PROVIDER_TRENDS: ProviderSelection['trends'];
    PROVIDER_APP_DATA: ProviderSelection['appData'];
}
export function providerSelectionFromEnv(env: ProviderSelectionEnv): ProviderSelection {
    return {
        audit: env.PROVIDER_AUDIT,
        rank: env.PROVIDER_RANK,
        keyword: env.PROVIDER_KEYWORD,
        backlink: env.PROVIDER_BACKLINK,
        competitor: env.PROVIDER_COMPETITOR,
        localListings: env.PROVIDER_LOCAL_LISTINGS,
        pagespeed: env.PROVIDER_PAGESPEED,
        gsc: env.PROVIDER_GSC,
        ga4: env.PROVIDER_GA4,
        summary: env.PROVIDER_SUMMARY,
        aiVisibility: env.PROVIDER_AI_VISIBILITY,
        contentSource: env.PROVIDER_CONTENT_SOURCE,
        contentAnalysis: env.PROVIDER_CONTENT_ANALYSIS,
        reviews: env.PROVIDER_REVIEWS,
        trends: env.PROVIDER_TRENDS,
        appData: env.PROVIDER_APP_DATA,
    };
}
export interface ProviderRegistryOptions {
    /** DataForSEO credentials + base URL. Required when any DataForSEO adapter is selected. */
    dataForSeo?: {
        login: string;
        password: string;
        baseUrl: string;
    };
    /**
     * SERP depth for rank checks (env `SERP_DEPTH`). Organic SERPs bill per 10
     * results, so this is a COST knob: the `serp_checks` unit cost in
     * `shared/billing/vendor-costs.ts` budgets depth 100 ($0.006/check) — a
     * larger depth breaks the margin model (the derivation test catches it).
     */
    serpDepth?: number;
    /**
     * Depth for the synchronous live SERP path (env `SERP_LIVE_DEPTH`). Capped
     * small upstream (≤30) so a live check's $0.002/page price stays within the
     * `serp_checks` $0.006 unit-cost bound.
     */
    serpLiveDepth?: number;
    /**
     * Wait budget for DataForSEO's async SERP task queue (env
     * `SERP_TASK_POLL_INTERVAL_MS` / `SERP_TASK_MAX_POLL_ATTEMPTS`). Rank checks
     * take the `task_post` → `task_get` path, so this — not `serpLiveDepth` —
     * governs how long a check waits before failing as unavailable.
     */
    serpTaskPollIntervalMs?: number;
    serpTaskMaxPollAttempts?: number;
    /** Google Cloud API key. Required when `pagespeed` selects `google`. */
    google?: {
        apiKey: string;
    };
    /**
     * Google OAuth client — required when `gsc` selects `google`. Reuses the
     * Better Auth Google credentials so `linkSocial` and the GSC
     * token endpoint share ONE OAuth client — never create a second OAuth
     * client, which would risk duplicate accounts.
     */
    googleOAuth?: {
        clientId: string;
        clientSecret: string;
    };
    /**
     * AI summary helper. `enabled=false` OR missing `apiKey`
     * yields a null `summary` in the registry — the module reports the
     * feature as unavailable rather than crashing.
     */
    anthropic?: {
        enabled: boolean;
        apiKey?: string;
        model?: string;
        inputCostMicrosPerMillion?: number;
        outputCostMicrosPerMillion?: number;
        totalTimeoutMs?: number;
        telemetryEnabled?: boolean;
    };
    aiGeneration?: {
        ordered: AiGenerationProvider;
        providerOrder: readonly AiProviderKey[];
        recordRun?: RecordAiProfileRun;
    };
    firecrawl?: {
        apiKey: string;
        fallbackApiKeys?: readonly string[];
        baseUrl: string;
        timeoutMs: number;
        maxPageCharacters: number;
        maxCrawlPages: number;
        costMicrosPerCredit: number;
        /**
         * Operator attestation that every configured Firecrawl Cloud account has
         * ZDR enabled.
         * Env validation refuses PROVIDER_CONTENT_SOURCE=firecrawl unless this is
         * true; the registry re-asserts it so tests and alternate composition
         * paths cannot bypass the gate.
         */
        zdrEnabled: boolean;
    };
    logger?: Logger;
}
function providerEnvName(kind: string): string {
    return `PROVIDER_${kind.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`;
}
function requireDataForSeo(opts: ProviderRegistryOptions, kind: string): NonNullable<ProviderRegistryOptions['dataForSeo']> {
    const cfg = opts.dataForSeo;
    if (!cfg || !cfg.login || !cfg.password) {
        throw new Error(`${providerEnvName(kind)}=dataforseo requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD.`);
    }
    return cfg;
}
function requireGoogle(opts: ProviderRegistryOptions, kind: string): NonNullable<ProviderRegistryOptions['google']> {
    const cfg = opts.google;
    if (!cfg || !cfg.apiKey) {
        throw new Error(`PROVIDER_${kind.toUpperCase()}=google requires GOOGLE_API_KEY.`);
    }
    return cfg;
}
function requireGoogleOAuth(opts: ProviderRegistryOptions, kind: string): NonNullable<ProviderRegistryOptions['googleOAuth']> {
    const cfg = opts.googleOAuth;
    if (!cfg || !cfg.clientId || !cfg.clientSecret) {
        throw new Error(`PROVIDER_${kind.toUpperCase()}=google requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.`);
    }
    return cfg;
}
function requireFirecrawl(opts: ProviderRegistryOptions): NonNullable<ProviderRegistryOptions['firecrawl']> {
    const cfg = opts.firecrawl;
    if (!cfg?.apiKey) {
        throw new Error('PROVIDER_CONTENT_SOURCE=firecrawl requires FIRECRAWL_API_KEY.');
    }
    if (cfg.zdrEnabled !== true) {
        throw new Error('PROVIDER_CONTENT_SOURCE=firecrawl requires FIRECRAWL_ZDR_ENABLED=true (operator attestation that Firecrawl Cloud Zero Data Retention is enabled on every configured account).');
    }
    return cfg;
}
function selectImpl<T>(_kind: keyof ProviderSelection, value: string, fakeFactory: () => T, realFactory: () => T): T {
    if (value === 'fake')
        return fakeFactory();
    return realFactory();
}
/**
 * Build the registry from a (runtime-validated) selection. Throws on an
 * unknown value or on a vendor whose adapter has not shipped — both are
 * startup-time misconfigurations, never silent fallbacks.
 */
export function createProviderRegistry(selection: ProviderSelection, opts: ProviderRegistryOptions = {}): ProviderRegistry {
    const parsed = providerSelectionSchema.parse(selection);
    return {
        audit: selectImpl('audit', parsed.audit, createFakeAuditProvider, () => {
            const cfg = requireDataForSeo(opts, 'audit');
            return createDataForSeoOnPageAuditProvider({ ...cfg, logger: opts.logger });
        }),
        rank: selectImpl('rank', parsed.rank, createFakeRankProvider, () => {
            const cfg = requireDataForSeo(opts, 'rank');
            return {
                ...createDataForSeoRankProvider({
                    ...cfg,
                    logger: opts.logger,
                    ...(opts.serpDepth !== undefined ? { depth: opts.serpDepth } : {}),
                    ...(opts.serpLiveDepth !== undefined ? { liveDepth: opts.serpLiveDepth } : {}),
                    ...(opts.serpTaskPollIntervalMs !== undefined
                        ? { pollIntervalMs: opts.serpTaskPollIntervalMs }
                        : {}),
                    ...(opts.serpTaskMaxPollAttempts !== undefined
                        ? { maxPollAttempts: opts.serpTaskMaxPollAttempts }
                        : {}),
                }),
                // Bing / YouTube / Amazon ride the SAME
                // `PROVIDER_RANK` capability; no new selector, no new vendor.
                ...createDataForSeoAltEngineProvider({ ...cfg, logger: opts.logger }),
            };
        }),
        keyword: selectImpl('keyword', parsed.keyword, createFakeKeywordProvider, () => {
            const cfg = requireDataForSeo(opts, 'keyword');
            return createDataForSeoKeywordProvider({ ...cfg, logger: opts.logger });
        }),
        backlink: selectImpl('backlink', parsed.backlink, createFakeBacklinkProvider, () => {
            const cfg = requireDataForSeo(opts, 'backlink');
            return createDataForSeoBacklinkProvider({ ...cfg, logger: opts.logger });
        }),
        competitor: selectImpl('competitor', parsed.competitor, createFakeCompetitorProvider, () => {
            const cfg = requireDataForSeo(opts, 'competitor');
            return createDataForSeoCompetitorProvider({ ...cfg, logger: opts.logger });
        }),
        localListings: selectImpl('localListings', parsed.localListings, createFakeLocalListingsProvider, () => {
            const cfg = requireDataForSeo(opts, 'localListings');
            return createDataForSeoLocalListingsProvider({ ...cfg, logger: opts.logger });
        }),
        pagespeed: parsed.pagespeed === 'fake'
            ? createFakePageSpeedProvider()
            : parsed.pagespeed === 'google'
                ? (() => {
                    const cfg = requireGoogle(opts, 'pagespeed');
                    return createGooglePageSpeedProvider({
                        apiKey: cfg.apiKey,
                        ...(opts.logger ? { logger: opts.logger } : {}),
                    });
                })()
                : (() => {
                    const cfg = requireDataForSeo(opts, 'pagespeed');
                    return createDataForSeoPageSpeedProvider({
                        ...cfg,
                        ...(opts.logger ? { logger: opts.logger } : {}),
                    });
                })(),
        gsc: selectImpl('gsc', parsed.gsc, createFakeGscProvider, () => {
            const cfg = requireGoogleOAuth(opts, 'gsc');
            return createGoogleGscProvider({
                clientId: cfg.clientId,
                clientSecret: cfg.clientSecret,
                ...(opts.logger ? { logger: opts.logger } : {}),
            });
        }),
        ga4: selectImpl('ga4', parsed.ga4, createFakeGa4Provider, () => {
            const cfg = requireGoogleOAuth(opts, 'ga4');
            return createGoogleGa4Provider({
                clientId: cfg.clientId,
                clientSecret: cfg.clientSecret,
                ...(opts.logger ? { logger: opts.logger } : {}),
            });
        }),
        summary: buildSummaryProvider(parsed.summary, opts),
        aiVisibility: selectImpl('aiVisibility', parsed.aiVisibility, createFakeAiVisibilityProvider, () => {
            const cfg = requireDataForSeo(opts, 'aiVisibility');
            return createDataForSeoAiVisibilityProvider({ ...cfg, logger: opts.logger });
        }),
        contentSource: selectImpl('contentSource', parsed.contentSource, createFakeContentSourceProvider, () => createFirecrawlContentSourceProvider({ ...requireFirecrawl(opts), logger: opts.logger })),
        contentMonitor: selectImpl('contentSource', parsed.contentSource, createFakeContentMonitorProvider, () => {
            const cfg = requireFirecrawl(opts);
            return createFirecrawlContentMonitorProvider({
                apiKey: cfg.apiKey,
                fallbackApiKeys: cfg.fallbackApiKeys,
                baseUrl: cfg.baseUrl,
                timeoutMs: cfg.timeoutMs,
                zdrEnabled: cfg.zdrEnabled,
                ...(opts.logger ? { logger: opts.logger } : {}),
            });
        }),
        contentAnalysis: selectImpl('contentAnalysis', parsed.contentAnalysis, createFakeContentAnalysisProvider, () => {
            const cfg = requireDataForSeo(opts, 'contentAnalysis');
            return createDataForSeoContentAnalysisProvider({ ...cfg, logger: opts.logger });
        }),
        reviews: selectImpl('reviews', parsed.reviews, createFakeReviewsProvider, () => {
            const cfg = requireDataForSeo(opts, 'reviews');
            return createDataForSeoReviewsProvider({ ...cfg, logger: opts.logger });
        }),
        trends: selectImpl('trends', parsed.trends, createFakeTrendsProvider, () => {
            const cfg = requireDataForSeo(opts, 'trends');
            return createDataForSeoTrendsProvider({ ...cfg, logger: opts.logger });
        }),
        appData: selectImpl('appData', parsed.appData, createFakeAppDataProvider, () => {
            const cfg = requireDataForSeo(opts, 'appData');
            return createDataForSeoAppDataProvider({ ...cfg, logger: opts.logger });
        }),
    };
}
function buildSummaryProvider(kind: ProviderSelection['summary'], opts: ProviderRegistryOptions): SummaryProvider | null {
    const cfg = opts.anthropic;
    if (!cfg || !cfg.enabled)
        return null;
    if (kind === 'fake')
        return createFakeProfileSummaryProvider(opts.aiGeneration?.recordRun);
    if (kind === 'ai-sdk') {
        if (!opts.aiGeneration) {
            throw new Error('PROVIDER_SUMMARY=ai-sdk requires the configured AI generation runtime.');
        }
        return createOrderedProfileSummaryProvider({
            provider: opts.aiGeneration.ordered,
            providerOrder: opts.aiGeneration.providerOrder,
            ...(opts.aiGeneration.recordRun ? { recordRun: opts.aiGeneration.recordRun } : {}),
        });
    }
    if (!cfg.apiKey)
        return null;
    if (cfg.inputCostMicrosPerMillion === undefined ||
        cfg.outputCostMicrosPerMillion === undefined) {
        throw new Error('PROVIDER_SUMMARY=anthropic requires ANTHROPIC_INPUT_COST_MICROS_PER_MILLION and ANTHROPIC_OUTPUT_COST_MICROS_PER_MILLION.');
    }
    const provider = createAnthropicProfileGenerationProvider({
        apiKey: cfg.apiKey,
        model: cfg.model ?? DEFAULT_SUMMARY_MODEL,
        inputCostMicrosPerMillion: cfg.inputCostMicrosPerMillion,
        outputCostMicrosPerMillion: cfg.outputCostMicrosPerMillion,
        totalTimeoutMs: cfg.totalTimeoutMs ?? 60000,
        telemetryEnabled: cfg.telemetryEnabled ?? false,
    });
    return createOrderedProfileSummaryProvider({
        provider,
        providerOrder: ['anthropic'],
        ...(opts.aiGeneration?.recordRun ? { recordRun: opts.aiGeneration.recordRun } : {}),
    });
}
