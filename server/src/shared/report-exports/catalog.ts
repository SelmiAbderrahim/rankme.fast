import type { TranslationKey } from '../i18n/errors.js';
export const REPORT_GLOBAL_BOUNDS = Object.freeze({
    canonicalBytes: 10 * 1024 * 1024,
    outputBytes: 25 * 1024 * 1024,
    csvRows: 100000,
    pdfItems: 1000,
});
export const REPORT_FORMATS = ['pdf', 'csv', 'json', 'md', 'jsonld', 'txt'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];
export const REPORT_SOURCE_TARGET_SCOPES = [
    'site',
    'site_resource',
    'account_resource',
] as const;
export type ReportSourceTargetScope = (typeof REPORT_SOURCE_TARGET_SCOPES)[number];
export type ReportClassification = 'report' | 'dataset' | 'native_artifact';
export type ReportBrandingPolicy = 'visual' | 'metadata_only';
export type ReportShareFormat = 'view' | 'pdf' | 'csv';
interface ReportDescriptorInput {
    kind: string;
    slug: string;
    classification: ReportClassification;
    sourceFeature: string;
    targetScope: ReportSourceTargetScope;
    formats: readonly ReportFormat[];
    maxSelectedItems: number;
    maxPdfItems?: number;
    narrowingFields: readonly string[];
    branding: ReportBrandingPolicy;
    legacyFormatEntitlements?: readonly ReportFormat[];
    shareFormats: readonly ReportShareFormat[];
    localizationStem: string;
}
export interface ReportCatalogDescriptor {
    readonly kind: string;
    readonly kindVersion: 1;
    readonly slug: string;
    readonly classification: ReportClassification;
    readonly sourceFeature: string;
    readonly targetScope: ReportSourceTargetScope;
    readonly formats: readonly ReportFormat[];
    readonly bounds: {
        readonly canonicalBytes: number;
        readonly outputBytes: number;
        readonly selectedItems: number;
        readonly csvRows: number | null;
        readonly pdfItems: number | null;
        readonly narrowingFields: readonly string[];
    };
    readonly branding: {
        readonly policy: ReportBrandingPolicy;
        readonly modes: readonly ('rankmefast' | 'white_label')[];
        readonly legacyFormatEntitlements: readonly ReportFormat[];
    };
    readonly share: {
        readonly eligible: boolean;
        readonly formats: readonly ReportShareFormat[];
    };
    readonly localization: {
        readonly titleKey: TranslationKey;
        readonly descriptionKey: TranslationKey;
        readonly boundKey: TranslationKey;
    };
}
function descriptor<const T extends ReportDescriptorInput>(input: T): Omit<ReportCatalogDescriptor, 'kind'> & {
    readonly kind: T['kind'];
} {
    const csvRows = input.formats.includes('csv')
        ? Math.min(input.maxSelectedItems, REPORT_GLOBAL_BOUNDS.csvRows)
        : null;
    const pdfItems = input.formats.includes('pdf')
        ? Math.min(input.maxPdfItems ?? input.maxSelectedItems, REPORT_GLOBAL_BOUNDS.pdfItems)
        : null;
    return Object.freeze({
        kind: input.kind,
        kindVersion: 1 as const,
        slug: input.slug,
        classification: input.classification,
        sourceFeature: input.sourceFeature,
        targetScope: input.targetScope,
        formats: Object.freeze([...input.formats]),
        bounds: Object.freeze({
            ...REPORT_GLOBAL_BOUNDS,
            selectedItems: input.maxSelectedItems,
            csvRows,
            pdfItems,
            narrowingFields: Object.freeze([...input.narrowingFields]),
        }),
        branding: Object.freeze({
            policy: input.branding,
            modes: Object.freeze(input.branding === 'visual'
                ? (['rankmefast', 'white_label'] as const)
                : (['rankmefast'] as const)),
            legacyFormatEntitlements: Object.freeze([
                ...(input.legacyFormatEntitlements ?? []),
            ]),
        }),
        share: Object.freeze({
            eligible: input.shareFormats.length > 0,
            formats: Object.freeze([...input.shareFormats]),
        }),
        localization: Object.freeze({
            titleKey: `reportExports.catalog.${input.localizationStem}.title` as TranslationKey,
            descriptionKey: `reportExports.catalog.${input.localizationStem}.description` as TranslationKey,
            boundKey: `reportExports.catalog.${input.localizationStem}.bound` as TranslationKey,
        }),
    });
}
/**
 * Locked report inventory. Presence here describes the approved contract;
 * runtime availability is derived only from the separate adapter registry.
 */
export const REPORT_CATALOG = Object.freeze([
    descriptor({
        kind: 'audit.run', slug: 'audit', classification: 'report', sourceFeature: 'audits',
        targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 10000,
        maxPdfItems: REPORT_GLOBAL_BOUNDS.pdfItems, narrowingFields: ['buckets', 'sections'], branding: 'visual',
        legacyFormatEntitlements: ['pdf'], shareFormats: ['view', 'pdf'], localizationStem: 'auditRun',
    }),
    descriptor({
        kind: 'ranks.current', slug: 'rankings', classification: 'dataset', sourceFeature: 'ranks',
        targetScope: 'site', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 2000,
        narrowingFields: ['engine', 'device', 'location'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'ranksCurrent',
    }),
    descriptor({
        kind: 'ranks.history', slug: 'rank-history', classification: 'dataset', sourceFeature: 'ranks',
        targetScope: 'site', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 18250,
        narrowingFields: ['keywordIds', 'from', 'to'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'ranksHistory',
    }),
    descriptor({
        kind: 'ranks.serp_features', slug: 'serp-features', classification: 'dataset', sourceFeature: 'ranks',
        targetScope: 'site', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 100000,
        narrowingFields: ['keywordIds', 'from', 'to', 'engine', 'device'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'ranksSerpFeatures',
    }),
    descriptor({
        kind: 'google.gsc_search', slug: 'gsc-search', classification: 'report', sourceFeature: 'google-connections',
        targetScope: 'site', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 4000,
        narrowingFields: ['window', 'dimensions'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'googleGscSearch',
    }),
    descriptor({
        kind: 'google.gsc_sitemaps', slug: 'gsc-sitemaps', classification: 'dataset', sourceFeature: 'google-connections',
        targetScope: 'site', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 100000,
        narrowingFields: ['status'], branding: 'visual', shareFormats: ['view', 'pdf', 'csv'],
        localizationStem: 'googleGscSitemaps',
    }),
    descriptor({
        kind: 'google.gsc_generative_appearance', slug: 'gsc-generative-appearance', classification: 'report',
        sourceFeature: 'google-connections', targetScope: 'site', formats: ['pdf', 'csv', 'json'],
        maxSelectedItems: 1000, narrowingFields: ['window', 'classification'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'googleGscGenerativeAppearance',
    }),
    descriptor({
        kind: 'google.ga4', slug: 'ga4', classification: 'report', sourceFeature: 'google-connections',
        targetScope: 'site', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 5000,
        narrowingFields: ['window', 'dimensions'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'googleGa4',
    }),
    descriptor({
        kind: 'client.composite', slug: 'client-report', classification: 'report', sourceFeature: 'client-reports',
        targetScope: 'site', formats: ['pdf', 'json'], maxSelectedItems: 230, maxPdfItems: 230,
        narrowingFields: ['sections'], branding: 'visual', legacyFormatEntitlements: ['pdf', 'json'],
        shareFormats: ['view', 'pdf'], localizationStem: 'clientComposite',
    }),
    descriptor({
        kind: 'keyword.research_result', slug: 'keyword-research', classification: 'dataset',
        sourceFeature: 'keyword-research', targetScope: 'account_resource', formats: ['pdf', 'csv', 'json'],
        maxSelectedItems: 1000, narrowingFields: ['operation', 'filters'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'keywordResearchResult',
    }),
    descriptor({
        kind: 'keyword.trends_run', slug: 'keyword-trends', classification: 'report', sourceFeature: 'keyword-research',
        targetScope: 'account_resource', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 5000,
        narrowingFields: ['phrases', 'type'], branding: 'visual', shareFormats: ['view', 'pdf', 'csv'],
        localizationStem: 'keywordTrendsRun',
    }),
    descriptor({
        kind: 'keyword.ai_cluster_run', slug: 'keyword-ai-clusters', classification: 'report',
        sourceFeature: 'keyword-research', targetScope: 'account_resource', formats: ['pdf', 'csv', 'json'],
        maxSelectedItems: 200, narrowingFields: ['decision'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'keywordAiClusterRun',
    }),
    descriptor({
        kind: 'keyword.serp_cluster_run', slug: 'keyword-serp-clusters', classification: 'report',
        sourceFeature: 'keyword-clusters', targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'],
        maxSelectedItems: 200, narrowingFields: ['size', 'decision'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'keywordSerpClusterRun',
    }),
    descriptor({
        kind: 'keyword.cannibalization', slug: 'keyword-cannibalization', classification: 'report',
        sourceFeature: 'cannibalization', targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'],
        maxSelectedItems: 4000, narrowingFields: ['confidence', 'candidateId'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'keywordCannibalization',
    }),
    descriptor({
        kind: 'backlinks.summary', slug: 'backlink-summary', classification: 'report', sourceFeature: 'backlinks',
        targetScope: 'site', formats: ['pdf', 'json'], maxSelectedItems: 1,
        narrowingFields: [], branding: 'visual', shareFormats: ['view', 'pdf'], localizationStem: 'backlinksSummary',
    }),
    descriptor({
        kind: 'backlinks.inventory', slug: 'backlinks', classification: 'dataset', sourceFeature: 'backlinks',
        targetScope: 'site', formats: ['csv', 'json'], maxSelectedItems: 100000,
        narrowingFields: ['from', 'to', 'domain', 'flags'], branding: 'metadata_only',
        shareFormats: [], localizationStem: 'backlinksInventory',
    }),
    descriptor({
        kind: 'backlinks.deep_run', slug: 'backlink-intelligence', classification: 'dataset', sourceFeature: 'backlinks',
        targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 500,
        narrowingFields: ['operation'], branding: 'visual', shareFormats: ['view', 'pdf', 'csv'],
        localizationStem: 'backlinksDeepRun',
    }),
    descriptor({
        kind: 'backlinks.gap_run', slug: 'backlink-gap', classification: 'report', sourceFeature: 'backlinks',
        targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 1500,
        narrowingFields: ['competitor', 'legStatus'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'backlinksGapRun',
    }),
    descriptor({
        kind: 'backlinks.toxicity_run', slug: 'backlink-toxicity', classification: 'report', sourceFeature: 'backlinks',
        targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 1000,
        narrowingFields: ['band', 'signal', 'dofollow', 'broken'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'backlinksToxicityRun',
    }),
    descriptor({
        kind: 'backlinks.disavow', slug: 'backlink-disavow', classification: 'native_artifact', sourceFeature: 'backlinks',
        targetScope: 'site_resource', formats: ['txt'], maxSelectedItems: 1000,
        narrowingFields: ['rowIds', 'mode'], branding: 'metadata_only', shareFormats: [],
        localizationStem: 'backlinksDisavow',
    }),
    descriptor({
        kind: 'competitors.organic', slug: 'organic-competitors', classification: 'dataset', sourceFeature: 'competitors',
        targetScope: 'site', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 100000,
        narrowingFields: ['mode', 'domain', 'rowClass'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'competitorsOrganic',
    }),
    descriptor({
        kind: 'competitors.tech_stack', slug: 'competitor-tech-stack', classification: 'report', sourceFeature: 'competitors',
        targetScope: 'site', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 1000,
        narrowingFields: ['domain', 'category'], branding: 'visual', shareFormats: ['view', 'pdf', 'csv'],
        localizationStem: 'competitorsTechStack',
    }),
    descriptor({
        kind: 'competitors.traffic_snapshot', slug: 'traffic-snapshot', classification: 'report', sourceFeature: 'competitors',
        targetScope: 'account_resource', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 35,
        narrowingFields: ['country'], branding: 'visual', shareFormats: ['view', 'pdf', 'csv'],
        localizationStem: 'competitorsTrafficSnapshot',
    }),
    descriptor({
        kind: 'competitors.traffic_comparison', slug: 'traffic-comparison', classification: 'report', sourceFeature: 'competitors',
        targetScope: 'account_resource', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 175,
        narrowingFields: ['snapshotIds', 'country', 'metric'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'competitorsTrafficComparison',
    }),
    descriptor({
        kind: 'competitors.content_run', slug: 'competitor-content', classification: 'report',
        sourceFeature: 'competitor-content', targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'],
        maxSelectedItems: 1000, narrowingFields: ['domains', 'pages', 'opportunities'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'competitorsContentRun',
    }),
    descriptor({
        kind: 'competitors.landscape_run', slug: 'competitor-landscape', classification: 'report',
        sourceFeature: 'competitors', targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'],
        maxSelectedItems: 3000, maxPdfItems: 1000,
        narrowingFields: ['class', 'competitor', 'query', 'opportunity', 'accepted'], branding: 'visual',
        shareFormats: [], localizationStem: 'competitorsLandscapeRun',
    }),
    descriptor({
        kind: 'actions.plan', slug: 'next-actions', classification: 'dataset', sourceFeature: 'actions',
        targetScope: 'site', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 1000,
        narrowingFields: ['source', 'state', 'severity', 'confidence', 'effort'], branding: 'visual',
        shareFormats: [], localizationStem: 'actionsPlan',
    }),
    descriptor({
        kind: 'ai.visibility', slug: 'ai-visibility', classification: 'report', sourceFeature: 'ai-visibility',
        targetScope: 'site', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 100000,
        narrowingFields: ['from', 'to', 'prompt', 'model', 'sentiment'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'aiVisibility',
    }),
    descriptor({
        kind: 'audience.research_run', slug: 'audience-research', classification: 'report',
        sourceFeature: 'audience-research', targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'],
        maxSelectedItems: 40, narrowingFields: ['confidence', 'signal', 'source', 'decision'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'audienceResearchRun',
    }),
    descriptor({
        kind: 'brand.radar_scan', slug: 'brand-radar', classification: 'report', sourceFeature: 'brand-radar',
        targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 1000,
        narrowingFields: ['sentiment', 'from', 'to', 'domain'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'brandRadarScan',
    }),
    descriptor({
        kind: 'content.analysis', slug: 'content-analysis', classification: 'report', sourceFeature: 'content-intelligence',
        targetScope: 'site_resource', formats: ['pdf', 'json', 'md'], maxSelectedItems: 1000,
        narrowingFields: ['sections', 'draftVersion'], branding: 'visual', shareFormats: ['view', 'pdf'],
        localizationStem: 'contentAnalysis',
    }),
    descriptor({
        kind: 'content.recommendation_outcome', slug: 'recommendation-outcome', classification: 'report',
        sourceFeature: 'content-intelligence', targetScope: 'site_resource', formats: ['pdf', 'json'],
        maxSelectedItems: 56, narrowingFields: ['window', 'version'], branding: 'visual',
        shareFormats: [], localizationStem: 'contentRecommendationOutcome',
    }),
    descriptor({
        kind: 'content.inventory_run', slug: 'content-inventory', classification: 'report',
        sourceFeature: 'content-intelligence', targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'],
        maxSelectedItems: 1000, narrowingFields: ['page', 'flag', 'cluster', 'gap'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'contentInventoryRun',
    }),
    descriptor({
        kind: 'content.monitor_feed', slug: 'content-changes', classification: 'dataset',
        sourceFeature: 'content-monitoring', targetScope: 'site_resource', formats: ['csv', 'json'],
        maxSelectedItems: 1000, narrowingFields: ['from', 'to', 'eventKind'], branding: 'metadata_only',
        shareFormats: [], localizationStem: 'contentMonitorFeed',
    }),
    descriptor({
        kind: 'content.brief', slug: 'content-brief', classification: 'report', sourceFeature: 'content-briefs',
        targetScope: 'site_resource', formats: ['pdf', 'json', 'md'], maxSelectedItems: 1000,
        narrowingFields: ['draftVersion', 'sections'], branding: 'visual', shareFormats: ['view', 'pdf'],
        localizationStem: 'contentBrief',
    }),
    descriptor({
        kind: 'internal_links.run', slug: 'internal-links', classification: 'report', sourceFeature: 'internal-links',
        targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 100,
        narrowingFields: ['targetFlag', 'confidence', 'rankingSource'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'internalLinksRun',
    }),
    descriptor({
        kind: 'weekly_pulse.run', slug: 'weekly-pulse', classification: 'report', sourceFeature: 'weekly-pulse',
        targetScope: 'site_resource', formats: ['pdf', 'json'], maxSelectedItems: 1000,
        narrowingFields: ['sections'], branding: 'visual', shareFormats: ['view', 'pdf'],
        localizationStem: 'weeklyPulseRun',
    }),
    descriptor({
        kind: 'local.seo_snapshot', slug: 'local-seo', classification: 'report', sourceFeature: 'local-seo',
        targetScope: 'site', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 1000,
        narrowingFields: ['sections', 'keyword'], branding: 'visual', shareFormats: ['view', 'pdf', 'csv'],
        localizationStem: 'localSeoSnapshot',
    }),
    descriptor({
        kind: 'local.reviews', slug: 'reviews', classification: 'report', sourceFeature: 'local-seo',
        targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 100000,
        narrowingFields: ['runId', 'source', 'rating', 'query', 'from', 'to'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'localReviews',
    }),
    descriptor({
        kind: 'local.geogrid_scan', slug: 'local-geogrid', classification: 'report', sourceFeature: 'geogrid',
        targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 49,
        narrowingFields: ['state'], branding: 'visual', shareFormats: ['view', 'pdf', 'csv'],
        localizationStem: 'localGeogridScan',
    }),
    descriptor({
        kind: 'schema.generation', slug: 'schema', classification: 'native_artifact', sourceFeature: 'schema-generator',
        targetScope: 'site_resource', formats: ['json', 'jsonld'], maxSelectedItems: 20,
        narrowingFields: [], branding: 'metadata_only', shareFormats: [], localizationStem: 'schemaGeneration',
    }),
    descriptor({
        kind: 'pages.performance', slug: 'pages-performance', classification: 'dataset', sourceFeature: 'pages',
        targetScope: 'site', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 1000,
        narrowingFields: ['range', 'pageIds', 'insight', 'indexability', 'visibility'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'pagesPerformance',
    }),
    descriptor({
        kind: 'app.keyword_tracking', slug: 'app-keyword-tracking', classification: 'dataset', sourceFeature: 'app-seo',
        targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 26000,
        maxPdfItems: 1000, narrowingFields: ['keywordIds', 'historyLimit'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'appKeywordTracking',
    }),
    descriptor({
        kind: 'app.research_result', slug: 'app-research', classification: 'dataset', sourceFeature: 'app-seo',
        targetScope: 'site_resource', formats: ['pdf', 'csv', 'json'], maxSelectedItems: 100,
        narrowingFields: ['surface', 'store'], branding: 'visual',
        shareFormats: ['view', 'pdf', 'csv'], localizationStem: 'appResearchResult',
    }),
]);
export type ReportKindId = (typeof REPORT_CATALOG)[number]['kind'];
export const REPORT_KIND_IDS = Object.freeze(REPORT_CATALOG.map((entry) => entry.kind)) as readonly ReportKindId[];
const REPORT_CATALOG_BY_KIND = new Map<string, ReportCatalogDescriptor>(REPORT_CATALOG.map((entry) => [entry.kind, entry]));
export function getReportCatalogDescriptor(kind: string): ReportCatalogDescriptor | undefined {
    return REPORT_CATALOG_BY_KIND.get(kind);
}
