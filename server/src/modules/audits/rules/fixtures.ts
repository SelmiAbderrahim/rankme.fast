/**
 * Test-only fixture builder for rule engine tests.
 *
 * Rules are pure functions over `AuditResult`; every test states only the
 * deltas it cares about. Keeping this helper in the same folder (not
 * `src/shared/testing/`) makes it clear these fixtures are shaped for the
 * rule engine's contract and should not be reused as a "generic" AuditResult
 * factory elsewhere.
 */
import type { AuditPage, AuditResult, GscUrlInspection, } from '../../../shared/providers/index.js';
import type { GscSearchEvaluationInput, GscSitemapsEvaluationInput, IndexStatusEvaluationInput, IndexStatusSample, PageSpeedEvaluationInput, PageSpeedSample, } from './rule.types.js';
export function makeAuditPage(overrides: Partial<AuditPage> = {}): AuditPage {
    return {
        url: 'https://example.com/',
        statusCode: 200,
        title: 'Example — Buy widgets online',
        metaDescription: 'Everything you need to know about buying widgets.',
        h1: ['Widgets, explained'],
        h2: ['How to pick one'],
        canonical: 'https://example.com/',
        hasStructuredData: true,
        structuredDataErrors: [],
        isIndexable: true,
        brokenLinks: [],
        onPageScore: 90,
        wordCount: 800,
        hasFaqSignals: true,
        ...overrides,
    };
}
export interface MakeAuditResultInput {
    pages?: Partial<AuditPage>[];
    domainChecks?: Partial<AuditResult['domainChecks']>;
}
/**
 * Build a green-across-the-board `AuditResult`. Callers pass only the deltas
 * (e.g. one page with `title: null`) — every other rule stays passed.
 */
export function makeAuditResult(input: MakeAuditResultInput = {}): AuditResult {
    const pagesInput = input.pages === undefined ? [{}] : input.pages;
    return {
        domainChecks: {
            robotsTxtFound: true,
            sitemapFound: true,
            httpsEnforced: true,
            canonicalizationOk: true,
            sitemapReferencedInRobots: true,
            httpsRedirect: true,
            llmsTxtFound: true,
            ...input.domainChecks,
        },
        pages: pagesInput.map((p) => makeAuditPage(p)),
    };
}
// ---------------------------------------------------------------------------
// PageSpeed fixture builders.
// ---------------------------------------------------------------------------
export function makePageSpeedSample(overrides: Partial<PageSpeedSample> = {}): PageSpeedSample {
    return {
        url: 'https://example.com/',
        strategy: 'mobile',
        labScores: { performance: 92, accessibility: 90, bestPractices: 96, seo: 100 },
        coreWebVitals: { lcpMs: 1800, inp: 120, cls: 0.05, category: 'good' },
        mobileFriendly: true,
        fieldDataLevel: 'url',
        ...overrides,
    };
}
export interface MakePageSpeedInput {
    status?: PageSpeedEvaluationInput['status'];
    samples?: Partial<PageSpeedSample>[];
}
export function makePageSpeedInput(input: MakePageSpeedInput = {}): PageSpeedEvaluationInput {
    const samplesInput = input.samples === undefined ? [{}] : input.samples;
    return {
        status: input.status ?? 'ok',
        samples: samplesInput.map((s) => makePageSpeedSample(s)),
    };
}
// ---------------------------------------------------------------------------
// Index-status fixture builders.
// ---------------------------------------------------------------------------
export function makeGscInspection(overrides: Partial<GscUrlInspection> = {}): GscUrlInspection {
    return {
        indexVerdict: 'PASS',
        coverageState: 'Submitted and indexed',
        robotsTxtState: 'ALLOWED',
        pageFetchState: 'SUCCESSFUL',
        googleCanonical: 'https://example.com/',
        lastCrawlTime: new Date('2026-01-01T00:00:00.000Z'),
        richResults: { verdict: 'PASS', items: [] },
        ...overrides,
    };
}
export interface MakeIndexStatusSampleInput {
    url?: string;
    inspection?: Partial<GscUrlInspection>;
}
export function makeIndexStatusSample(input: MakeIndexStatusSampleInput = {}): IndexStatusSample {
    return {
        url: input.url ?? 'https://example.com/',
        inspection: makeGscInspection(input.inspection),
    };
}
export interface MakeIndexStatusInput {
    status?: IndexStatusEvaluationInput['status'];
    samples?: MakeIndexStatusSampleInput[];
}
export function makeIndexStatusInput(input: MakeIndexStatusInput = {}): IndexStatusEvaluationInput {
    const samplesInput = input.samples === undefined ? [{}] : input.samples;
    return {
        status: input.status ?? 'ok',
        samples: samplesInput.map((s) => makeIndexStatusSample(s)),
    };
}
// ---------------------------------------------------------------------------
// GSC Search Analytics + Sitemaps fixture builders.
// ---------------------------------------------------------------------------
export type MakeGscTopQuery = GscSearchEvaluationInput['topQueries'][number];
/** Healthy default: one well-clicked query (CTR far above the 1% threshold). */
export function makeGscTopQuery(overrides: Partial<MakeGscTopQuery> = {}): MakeGscTopQuery {
    return {
        query: 'seo audit tool',
        clicks: 180,
        impressions: 5400,
        ctr: 180 / 5400,
        position: 4.2,
        ...overrides,
    };
}
export function makeGscSearchInput(overrides: Partial<GscSearchEvaluationInput> = {}): GscSearchEvaluationInput {
    return {
        status: 'ok',
        totalClicks: 180,
        totalImpressions: 5400,
        averageCtr: 180 / 5400,
        averagePosition: 4.2,
        topQueries: [makeGscTopQuery()],
        topPages: [
            {
                url: 'https://example.com/',
                clicks: 180,
                impressions: 5400,
                ctr: 180 / 5400,
                position: 4.2,
            },
        ],
        delta: { clicks: null, impressions: null },
        ...overrides,
    };
}
export type MakeGscSitemapEntry = GscSitemapsEvaluationInput['sitemaps'][number];
export function makeGscSitemapEntry(overrides: Partial<MakeGscSitemapEntry> = {}): MakeGscSitemapEntry {
    return {
        path: 'https://example.com/sitemap.xml',
        errors: 0,
        warnings: 0,
        processed: 128,
        lastDownloaded: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
    };
}
export function makeGscSitemapsInput(overrides: Partial<GscSitemapsEvaluationInput> = {}): GscSitemapsEvaluationInput {
    return {
        status: 'ok',
        sitemaps: [makeGscSitemapEntry()],
        ...overrides,
    };
}
