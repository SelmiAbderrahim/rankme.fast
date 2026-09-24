/**
 * Feature-truth manifest.
 *
 * One literal record per evidence-first-roadmap feature: which public docs
 * slugs document it, which Express mount prefixes serve it, which
 * module-exported state machine it runs, and which rollout flags gate it.
 *
 * The values are literals ON PURPOSE. This file imports nothing from
 * `server/src/modules/**` (shared → modules layering rule); instead,
 * `feature-truth.test.ts` pins every literal to the code that owns it:
 * state lists to the module-exported enums, docs slugs to the docs-integrity catalog, the
 * client/server/generator slug lists to each other, and flags to
 * `FEATURE_FLAG_KEYS` ∪ the env schema keys.
 */
export interface FeatureTruthEntry {
    /** Public /docs slugs that document the feature. */
    readonly docsSlugs: readonly string[];
    /** Express mount prefixes (as mounted in app.ts) serving the feature. */
    readonly routePrefixes: readonly string[];
    /** Module-exported state list; empty when the feature has no state machine. */
    readonly states: readonly string[];
    /** Rollout flags: superadmin kill-switch keys or env-schema boolean keys. */
    readonly flags: readonly string[];
}
export const FEATURE_TRUTH = {
    audienceResearch: {
        docsSlugs: ['audience-research'],
        routePrefixes: ['/api/sites'],
        // AUDIENCE_RESEARCH_STATES (modules/audience-research/audience-research.state.ts)
        states: [
            'queued',
            'discovering',
            'selecting',
            'collecting',
            'clustering',
            'completed',
            'partial',
            'failed',
        ],
        flags: [],
    },
    keywordIntelligence: {
        docsSlugs: ['keyword-intelligence', 'keyword-research'],
        routePrefixes: ['/api/keyword-research'],
        // KEYWORD_CLUSTER_DECISION_KINDS (db/schema/keyword-cluster-decision-events.ts)
        states: ['accepted', 'dismissed'],
        flags: [],
    },
    nextActions: {
        docsSlugs: ['next-actions'],
        routePrefixes: ['/api/sites'],
        // Retest delegates to startAuditForSite, which reserves one audit.
        // ACTION_STATES (db/schema/action-events.ts)
        states: ['open', 'planned', 'dismissed', 'completed'],
        flags: [],
    },
    confirmedRankAlerts: {
        docsSlugs: ['confirmed-rank-alerts'],
        routePrefixes: ['/api/sites', '/api/keywords'],
        // The single confirmation observation reserves one serp_checks unit.
        // RANK_DROP_CONFIRMATION_STATES (db/schema/rank-drop-confirmations.ts)
        states: ['confirmed', 'volatile', 'unconfirmed'],
        flags: [],
    },
    aiVisibilityCitations: {
        docsSlugs: ['ai-visibility-citations', 'ai-visibility'],
        routePrefixes: ['/api/sites'],
        // No module-exported run-state enum; snapshots are immutable rows.
        states: [],
        flags: [],
    },
    weeklyPulse: {
        docsSlugs: ['weekly-pulse'],
        routePrefixes: ['/api/sites'],
        // WEEKLY_PULSE_RUN_STATUSES (db/schema/weekly-pulse.ts)
        states: [
            'queued',
            'collecting',
            'completed',
            'partial',
            'blocked_capacity',
            'unsupported',
            'failed',
        ],
        flags: [],
    },
    contentIntelligence: {
        docsSlugs: ['content-intelligence'],
        routePrefixes: ['/api/sites', '/api/content-analyses'],
        // CONTENT_ANALYSIS_STATUSES (modules/content-intelligence/content-analysis.model.ts)
        states: [
            'queued',
            'collecting_owned',
            'collecting_serp',
            'collecting_competitors',
            'scoring',
            'generating_brief',
            'generating_draft',
            'completed',
            'partial',
            'failed',
            'cancelled',
        ],
        flags: [
            'CONTENT_INTELLIGENCE_ENABLED',
            'CONTENT_INVENTORY_ENABLED',
            'COMPETITOR_CONTENT_INTELLIGENCE_ENABLED',
            'CONTENT_MONITORING_ENABLED',
            'content_intelligence_pipeline',
            'firecrawl_change_monitoring',
            'ai_recommendations',
        ],
    },
    contentInventory: {
        docsSlugs: ['content-intelligence'],
        routePrefixes: ['/api/sites'],
        // CONTENT_INVENTORY_STATUSES (modules/content-intelligence/inventory.model.ts)
        states: [
            'queued',
            'crawling',
            'analyzing',
            'completed',
            'partial',
            'failed',
            'cancelled',
        ],
        flags: ['CONTENT_INVENTORY_ENABLED'],
    },
    competitorContent: {
        docsSlugs: ['content-intelligence'],
        routePrefixes: ['/api/sites'],
        // COMPETITOR_CONTENT_STATUSES (modules/competitor-content/competitor-content.model.ts)
        states: [
            'queued',
            'collecting',
            'comparing',
            'completed',
            'partial',
            'failed',
            'cancelled',
        ],
        flags: ['COMPETITOR_CONTENT_INTELLIGENCE_ENABLED'],
    },
    competitorIntelligence: {
        docsSlugs: ['backlinks-competitors'],
        routePrefixes: ['/api/sites'],
        // LANDSCAPE_STATES (modules/competitors/landscape/landscape.schemas.ts)
        states: [
            'queued',
            'collecting',
            'aggregating',
            'completed',
            'partial',
            'failed',
            'cancelled',
        ],
        flags: ['COMPETITOR_INTELLIGENCE_ENABLED'],
    },
    contentMonitoring: {
        docsSlugs: ['content-intelligence'],
        routePrefixes: ['/api/sites', '/api/firecrawl/webhook'],
        // CONTENT_MONITOR_STATUSES (modules/content-monitoring/monitor.model.ts)
        states: ['active', 'paused', 'error'],
        flags: ['CONTENT_MONITORING_ENABLED', 'firecrawl_change_monitoring'],
    },
    linkIntelligence: {
        docsSlugs: ['link-intelligence'],
        routePrefixes: ['/api/backlinks'],
        // LINK_INTELLIGENCE_RUN_STATUSES (modules/backlinks/backlink-runs.model.ts)
        states: ['queued', 'running', 'succeeded', 'failed'],
        flags: ['LINK_INTELLIGENCE_ENABLED'],
    },
    trafficInsights: {
        docsSlugs: ['traffic-insights'],
        routePrefixes: ['/api/competitors'],
        // TRAFFIC_SNAPSHOT_RUN_STATUSES (modules/competitors/traffic-snapshots.model.ts)
        states: ['queued', 'running', 'succeeded', 'partial', 'failed'],
        flags: ['TRAFFIC_INSIGHTS_ENABLED'],
    },
    keywordTrends: {
        docsSlugs: ['keyword-trends'],
        routePrefixes: ['/api/keyword-research'],
        // TRENDS_EXPLORATION_STATUSES (modules/keyword-research/trends-explorations.model.ts)
        states: ['queued', 'running', 'succeeded', 'failed'],
        flags: ['KEYWORD_TRENDS_ENABLED'],
    },
    reviewIntelligence: {
        docsSlugs: ['review-intelligence'],
        routePrefixes: ['/api/local-seo'],
        // REVIEW_SYNC_RUN_STATUSES (modules/local-seo/review-sync.model.ts)
        states: ['queued', 'running', 'succeeded', 'partial', 'failed'],
        flags: ['REVIEW_INTELLIGENCE_ENABLED'],
    },
    brandRadar: {
        docsSlugs: ['brand-radar'],
        // Two mounts: site-nested create/preview/list
        // under `/api/sites/:siteId/brand-radar`, scan-scoped stored reads under
        // `/api/brand-radar/scans/:id`.
        routePrefixes: ['/api/sites', '/api/brand-radar'],
        // BRAND_RADAR_SCAN_STATUSES (modules/brand-radar/brand-radar.model.ts)
        states: [
            'queued',
            'running',
            'completed',
            'completed_empty',
            'completed_partial',
            'failed',
        ],
        flags: ['BRAND_RADAR_ENABLED'],
    },
    appSeo: {
        docsSlugs: ['app-seo'],
        // App profiles and every nested ASO surface share the site-scoped mount.
        routePrefixes: ['/api/sites'],
        // The workspace combines several independent run types, so it has no
        // single feature-wide state machine.
        states: [],
        flags: [
            'APP_SEO_ENABLED',
            'APP_KEYWORD_TRACKING_ENABLED',
            'APP_LISTING_AUDITS_ENABLED',
            'APP_CHART_TRACKING_ENABLED',
            'APP_RESEARCH_ENABLED',
            'APP_REVIEWS_ENABLED',
        ],
    },
    serpFeatureTracking: {
        docsSlugs: ['serp-features'],
        routePrefixes: ['/api/sites', '/api/keywords'],
        // Zero-cost byproduct of an existing SERP check.
        // No run-state enum; SERP observations are immutable rows.
        states: [],
        flags: ['SERP_FEATURE_TRACKING_ENABLED'],
    },
    keywordClustering: {
        docsSlugs: ['keyword-clustering'],
        routePrefixes: ['/api/sites', '/api/keyword-cluster-runs'],
        // KEYWORD_CLUSTER_RUN_STATUSES (modules/keyword-clusters/keyword-clusters.schemas.ts)
        states: ['queued', 'processing', 'completed', 'failed'],
        flags: ['KEYWORD_CLUSTERING_ENABLED'],
    },
    altEngineTracking: {
        docsSlugs: ['alt-engine-tracking', 'rank-tracking'],
        routePrefixes: ['/api/sites', '/api/keywords'],
        // No run-state enum; engine-tagged checks reuse the rank pipeline.
        states: [],
        flags: ['ALT_ENGINE_TRACKING_ENABLED'],
    },
    cannibalization: {
        docsSlugs: ['cannibalization'],
        routePrefixes: ['/api/sites', '/api/cannibalization-reports'],
        // No run-state enum; reports are computed from stored GSC rows.
        states: [],
        flags: ['CANNIBALIZATION_ENABLED'],
    },
    toxicLinks: {
        docsSlugs: ['toxic-links'],
        routePrefixes: ['/api/backlinks'],
        // TOXICITY_REVIEW_STATUSES (modules/backlinks/toxicity-review.model.ts)
        states: ['queued', 'running', 'succeeded', 'failed'],
        flags: ['TOXIC_LINKS_ENABLED'],
    },
    alerts: {
        docsSlugs: ['alerts'],
        routePrefixes: ['/api/alerts'],
        // ALERT_DELIVERY_STATUSES (db/schema/alert-deliveries.ts)
        states: ['pending', 'sent', 'failed', 'suppressed'],
        flags: ['ALERTS_ENABLED'],
    },
    internalLinking: {
        docsSlugs: ['internal-linking'],
        routePrefixes: ['/api/sites', '/api/internal-link-runs'],
        // INTERNAL_LINK_RUN_STATUSES (modules/internal-links/internal-links.schemas.ts)
        states: ['queued', 'processing', 'completed', 'failed'],
        flags: ['INTERNAL_LINKING_ENABLED'],
    },
    contentBriefs: {
        docsSlugs: ['content-briefs'],
        // The shipped router mounts under '/api/sites' only (app.ts:322),
        // not '/api/content-briefs'. Code is the authority here.
        routePrefixes: ['/api/sites'],
        // CONTENT_BRIEF_STATUSES (modules/content-briefs/content-brief.model.ts)
        states: [
            'queued',
            'running',
            'completed',
            'completed_empty',
            'completed_partial',
            'failed',
        ],
        flags: ['CONTENT_BRIEFS_ENABLED'],
    },
    geogrid: {
        docsSlugs: ['geogrid', 'local-seo'],
        routePrefixes: ['/api/sites'],
        // GEOGRID_SCAN_STATUSES (db/schema/geogrid.ts)
        states: ['queued', 'running', 'completed', 'completed_partial', 'failed'],
        flags: ['GEOGRID_ENABLED'],
    },
    schemaMarkup: {
        docsSlugs: ['schema-markup'],
        routePrefixes: ['/api/schema-generator'],
        // SCHEMA_GENERATION_STATUSES (modules/schema-generator/schema-generation.model.ts)
        states: ['complete', 'failed'],
        flags: ['SCHEMA_GENERATOR_ENABLED'],
    },
    clientReports: {
        docsSlugs: ['client-reports'],
        routePrefixes: ['/api/client-reports', '/api/client-portal'],
        // CLIENT_REPORT_DELIVERY_STATUSES (db/schema/client-reports.ts)
        states: ['pending', 'sent', 'failed', 'suppressed'],
        flags: ['CLIENT_REPORTS_ENABLED'],
    },
    publicExports: {
        docsSlugs: ['public-api', 'looker-studio'],
        routePrefixes: ['/api/v1'],
        states: [],
        flags: ['PUBLIC_EXPORTS_ENABLED'],
    },
    mcp: {
        docsSlugs: ['rankmefast-mcp'],
        routePrefixes: ['/api/mcp', '/api/mcp-permissions'],
        // The start_audit tool reserves one audit; every other tool is a read.
        states: [],
        flags: ['MCP_ENABLED'],
    },
    assistant: {
        docsSlugs: ['ai-assistant'],
        routePrefixes: ['/api/chat'],
        states: [],
        flags: ['CHAT_ENABLED'],
    },
} as const satisfies Record<string, FeatureTruthEntry>;
export type FeatureTruthKey = keyof typeof FEATURE_TRUTH;
