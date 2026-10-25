import { routeKey, type InventoryRoute } from './route-inventory.js';

export type CrossAccountCoverage =
    | { kind: 'test'; file: string; proof?: string; authentication?: 'bearer' }
    | { kind: 'public'; file: string; reason: string };

/** Resource routes outside the nested site sweep, with their ownership proofs. */
export const CROSS_ACCOUNT_REGISTRY: Readonly<Record<string, CrossAccountCoverage>> = {
    'DELETE /api/alerts/rules/:ruleId': { kind: 'test', file: 'modules/alerts/alerts.routes.test.ts' },
    'PATCH /api/alerts/rules/:ruleId': { kind: 'test', file: 'modules/alerts/alerts.routes.test.ts' },
    'GET /api/alerts/rules/:ruleId/deliveries': { kind: 'test', file: 'modules/alerts/alerts.routes.test.ts' },
    'DELETE /api/api-keys/:id': { kind: 'test', file: 'modules/api-keys/api-keys.test.ts' },
    'PATCH /api/api-keys/:id/scopes': { kind: 'test', file: 'modules/api-keys/api-keys.test.ts' },
    'GET /api/audits/:runId': { kind: 'test', file: 'modules/audits/audits.routes.test.ts' },
    'GET /api/audits/:runId/report': { kind: 'test', file: 'modules/audits/report.service.test.ts' },
    'GET /api/audits/:runId/findings/:ruleId/urls': { kind: 'test', file: 'modules/audits/audits.report-routes.test.ts' },
    'GET /api/audits/:runId/findings/:ruleId/recheck': { kind: 'test', file: 'modules/audits/audits.dismissals.routes.test.ts' },
    'POST /api/audits/:runId/findings/:ruleId/recheck': { kind: 'test', file: 'modules/audits/audits.dismissals.routes.test.ts' },
    'GET /api/audits/:runId/report.pdf': { kind: 'test', file: 'modules/audits/report.service.test.ts' },
    'GET /api/audits/:runId/summary': { kind: 'test', file: 'modules/audits/summary.routes.test.ts' },
    'POST /api/audits/:runId/summary': { kind: 'test', file: 'modules/audits/summary.routes.test.ts' },
    'GET /api/backlinks/gap/:runId': { kind: 'test', file: 'modules/backlinks/link-gap.routes.test.ts' },
    'GET /api/backlinks/runs/:id': { kind: 'test', file: 'modules/backlinks/backlink-deep.routes.test.ts' },
    'GET /api/backlinks/toxicity/:runId': { kind: 'test', file: 'modules/backlinks/toxicity-review.test.ts' },
    'POST /api/backlinks/toxicity/:runId/disavow': { kind: 'test', file: 'modules/backlinks/toxicity-review.test.ts' },
    'GET /api/brand-radar/scans/:id': { kind: 'test', file: 'modules/brand-radar/brand-radar.routes.test.ts' },
    'GET /api/brand-radar/scans/:id/mentions': { kind: 'test', file: 'modules/brand-radar/brand-radar.controller.mentions.test.ts' },
    'GET /api/cannibalization-reports/:reportId': { kind: 'test', file: 'modules/cannibalization/cannibalization.routes.test.ts' },
    'DELETE /api/chat/conversations/:id': { kind: 'test', file: 'modules/chat/chat.routes.test.ts' },
    'GET /api/chat/conversations/:id': { kind: 'test', file: 'modules/chat/chat.routes.test.ts' },
    'POST /api/chat/conversations/:id/messages': { kind: 'test', file: 'modules/chat/chat.routes.test.ts' },
    'GET /api/client-reports/sites/:siteId': { kind: 'test', file: 'modules/client-reports/client-reports.routes.test.ts' },
    'GET /api/client-reports/sites/:siteId/deliveries': { kind: 'test', file: 'modules/client-reports/client-reports.routes.test.ts' },
    'POST /api/client-reports/sites/:siteId/pdf': { kind: 'test', file: 'modules/client-reports/client-reports.routes.test.ts' },
    'POST /api/client-reports/sites/:siteId/portals': { kind: 'test', file: 'modules/client-reports/client-reports.routes.test.ts' },
    'POST /api/client-reports/sites/:siteId/portals/:portalId/revoke': { kind: 'test', file: 'modules/client-reports/client-reports.routes.test.ts' },
    'POST /api/client-reports/sites/:siteId/schedules': { kind: 'test', file: 'modules/client-reports/client-reports.routes.test.ts' },
    'DELETE /api/client-reports/sites/:siteId/schedules/:scheduleId': { kind: 'test', file: 'modules/client-reports/client-reports.routes.test.ts' },
    'PUT /api/client-reports/sites/:siteId/schedules/:scheduleId': { kind: 'test', file: 'modules/client-reports/client-reports.routes.test.ts' },
    'GET /api/competitors/:siteId/competitors': { kind: 'test', file: 'modules/competitors/competitors.routes.test.ts' },
    'GET /api/competitors/:siteId/competitors/:domain/tech-stack': { kind: 'test', file: 'modules/competitors/competitors.routes.test.ts' },
    'GET /api/competitors/:siteId/competitors/intersection': { kind: 'test', file: 'modules/competitors/competitors.routes.test.ts' },
    'POST /api/competitors/:siteId/competitors/refresh': { kind: 'test', file: 'modules/competitors/competitors.routes.test.ts' },
    'GET /api/competitors/traffic-snapshots/:id': { kind: 'test', file: 'shared/testing/resource-ownership.routes.test.ts', proof: 'GET /api/competitors/traffic-snapshots/:id' },
    'GET /api/content-analyses/:analysisId': { kind: 'test', file: 'modules/content-intelligence/content-intelligence.routes.test.ts' },
    'GET /api/content-analyses/:analysisId/retry': { kind: 'test', file: 'modules/content-intelligence/content-analysis.job-status.routes.test.ts' },
    'POST /api/content-analyses/:analysisId/retry': { kind: 'test', file: 'modules/content-intelligence/content-analysis.job-status.routes.test.ts' },
    'GET /api/content-analyses/:analysisId/status': { kind: 'test', file: 'modules/content-intelligence/content-analysis.job-status.routes.test.ts' },
    'POST /api/content-analyses/:analysisId/brief-versions': { kind: 'test', file: 'modules/content-intelligence/content-intelligence.routes.test.ts' },
    'POST /api/content-analyses/:analysisId/cancel': { kind: 'test', file: 'modules/content-intelligence/content-intelligence.routes.test.ts' },
    'POST /api/content-analyses/:analysisId/draft-versions': { kind: 'test', file: 'modules/content-intelligence/content-intelligence.routes.test.ts' },
    'POST /api/content-analyses/:analysisId/recommendations/:recommendationId/accept': { kind: 'test', file: 'modules/content-intelligence/content-intelligence.routes.test.ts' },
    'GET /api/content-analyses/:analysisId/recommendations/:recommendationId/application-check': { kind: 'test', file: 'modules/content-intelligence/content-intelligence.routes.test.ts' },
    'POST /api/content-analyses/:analysisId/recommendations/:recommendationId/apply': { kind: 'test', file: 'modules/content-intelligence/content-intelligence.routes.test.ts' },
    'POST /api/content-analyses/:analysisId/recommendations/:recommendationId/dismiss': { kind: 'test', file: 'modules/content-intelligence/content-intelligence.routes.test.ts' },
    'GET /api/content-analyses/:analysisId/recommendations/:recommendationId/history': { kind: 'test', file: 'modules/content-intelligence/content-intelligence.routes.test.ts' },
    'GET /api/content-analyses/:analysisId/recommendations/:recommendationId/outcome': { kind: 'test', file: 'modules/content-intelligence/content-intelligence.routes.test.ts' },
    'POST /api/content-analyses/:analysisId/recommendations/:recommendationId/undo': { kind: 'test', file: 'modules/content-intelligence/content-intelligence.routes.test.ts' },
    'POST /api/content-analyses/:analysisId/regenerate': { kind: 'test', file: 'modules/content-intelligence/content-intelligence.routes.test.ts' },
    'GET /api/internal-link-runs/:runId': { kind: 'test', file: 'modules/internal-links/internal-links.routes.test.ts' },
    'GET /api/internal-link-runs/:runId/export.csv': { kind: 'test', file: 'modules/internal-links/internal-links.routes.test.ts' },
    'GET /api/keyword-cluster-runs/:runId': { kind: 'test', file: 'modules/keyword-clusters/keyword-clusters.routes.test.ts' },
    'GET /api/keyword-research/clusters/:runId': { kind: 'test', file: 'modules/keyword-research/keyword-research.clustering.test.ts' },
    'POST /api/keyword-research/clusters/:runId/clusters/:clusterId/decision': { kind: 'test', file: 'modules/keyword-research/keyword-research.decisions.test.ts' },
    'GET /api/keyword-research/history/:id/results': { kind: 'test', file: 'modules/keyword-research/keyword-research.site-history.test.ts' },
    'GET /api/keyword-research/trends/:runId': { kind: 'test', file: 'modules/keyword-research/keyword-research.trends.routes.test.ts' },
    'DELETE /api/keywords/:id': { kind: 'test', file: 'modules/ranks/keywords.routes.test.ts' },
    'POST /api/keywords/:id/check': { kind: 'test', file: 'modules/ranks/keywords.routes.test.ts' },
    'GET /api/keywords/:id/history': { kind: 'test', file: 'modules/ranks/keywords.routes.test.ts' },
    'GET /api/keywords/:id/serp-features': { kind: 'test', file: 'modules/ranks/keywords.routes.test.ts' },
    'GET /api/sites/:siteId/rank-jobs/:jobId': { kind: 'test', file: 'modules/ranks/keywords.routes.test.ts' },
    'GET /api/local-seo/reviews/runs/:id': { kind: 'test', file: 'modules/local-seo/review-sync.routes.test.ts' },
    'DELETE /api/local-seo/reviews/sources/:id': { kind: 'test', file: 'modules/local-seo/review-sync.routes.test.ts' },
    'GET /api/local-seo/reviews/stats/:id': { kind: 'test', file: 'modules/local-seo/review-sync.routes.test.ts' },
    'GET /api/local-seo/reviews/themes/:id': { kind: 'test', file: 'modules/local-seo/review-sync.routes.test.ts' },
    'DELETE /api/report-exports/:snapshotId': { kind: 'test', file: 'modules/report-exports/report-exports.routes.test.ts' },
    'GET /api/report-exports/:snapshotId': { kind: 'test', file: 'modules/report-exports/report-exports.routes.test.ts' },
    'GET /api/report-exports/:snapshotId/download': { kind: 'test', file: 'modules/report-exports/report-exports.routes.test.ts' },
    'GET /api/report-exports/:snapshotId/shares': { kind: 'test', file: 'modules/report-exports/report-exports.routes.test.ts' },
    'POST /api/report-exports/:snapshotId/shares': { kind: 'test', file: 'modules/report-exports/report-exports.routes.test.ts' },
    'POST /api/report-exports/:snapshotId/shares/:shareId/revoke': { kind: 'test', file: 'modules/report-exports/report-exports.routes.test.ts' },
    'GET /api/schema-generator/generations/:generationId': { kind: 'test', file: 'modules/schema-generator/schema-generator.routes.test.ts' },
    'GET /api/schema-generator/generations/:generationId/download': { kind: 'test', file: 'modules/schema-generator/schema-generator.routes.test.ts' },
    'POST /api/schema-generator/generations/:generationId/regenerate': { kind: 'test', file: 'modules/schema-generator/schema-generator.routes.test.ts' },
    'DELETE /api/sites/:id': { kind: 'test', file: 'modules/sites/sites.test.ts' },
    'GET /api/sites/:id': { kind: 'test', file: 'modules/sites/sites.test.ts' },
    'GET /api/sites/:id/market': { kind: 'test', file: 'modules/sites/sites.market.test.ts' },
    'PATCH /api/sites/:id': { kind: 'test', file: 'modules/sites/sites.test.ts' },
    'POST /api/sites/:id/pause': { kind: 'test', file: 'modules/sites/sites.test.ts' },
    'POST /api/sites/:id/resume': { kind: 'test', file: 'modules/sites/sites.test.ts' },
    'GET /api/sites/traffic-snapshots/:id': { kind: 'test', file: 'shared/testing/resource-ownership.routes.test.ts', proof: 'GET /api/sites/traffic-snapshots/:id' },
    'POST /api/team/invitations/:id/accept': { kind: 'test', file: 'modules/team/team.test.ts' },
    'POST /api/team/invitations/:id/reject': { kind: 'test', file: 'modules/team/team.test.ts' },
    'POST /api/team/invite/:id/resend': { kind: 'test', file: 'modules/team/team.test.ts' },
    'DELETE /api/team/members/:id': { kind: 'test', file: 'modules/team/team.test.ts' },
    'PATCH /api/team/members/:id': { kind: 'test', file: 'shared/testing/resource-ownership.routes.test.ts', proof: 'PATCH /api/team/members/:id' },
    'PATCH /api/team/members/:id/role': { kind: 'test', file: 'shared/testing/resource-ownership.routes.test.ts', proof: 'PATCH /api/team/members/:id/role' },
    'GET /api/users/:userId': { kind: 'test', file: 'modules/users/users.test.ts' },
    'GET /api/v1/sites/:siteId/rank-history': { kind: 'test', file: 'modules/public-api/public-api.test.ts', authentication: 'bearer' },
    'GET /api/v1/sites/:siteId/report/latest': { kind: 'test', file: 'modules/public-api/public-api.test.ts', authentication: 'bearer' },
};

/** Account-level endpoints participate in the anonymous sweep and DTO scan. */
export const ACCOUNT_ROUTES: ReadonlySet<string> = new Set([
    'GET /api/dashboard/site-summaries',
    'GET /api/dashboard/site-health',
    'GET /api/alerts/rules', 'POST /api/alerts/rules', 'GET /api/api-keys', 'POST /api/api-keys', 'GET /api/audit',
    'POST /api/backlinks/deep/anchors', 'POST /api/backlinks/deep/bulk-ranks', 'POST /api/backlinks/deep/history',
    'POST /api/backlinks/deep/preview', 'POST /api/backlinks/deep/referring-domains', 'POST /api/backlinks/gap',
    'POST /api/backlinks/gap/preview', 'GET /api/backlinks/runs', 'GET /api/backlinks/toxicity', 'POST /api/backlinks/toxicity', 'POST /api/backlinks/toxicity/preview',
    'GET /api/chat/conversations', 'POST /api/chat/conversations',
    'GET /api/competitors/traffic-snapshots', 'POST /api/competitors/traffic-snapshots', 'GET /api/competitors/traffic-snapshots/compare', 'POST /api/competitors/traffic-snapshots/preview',
    'GET /api/keyword-research/clusters', 'POST /api/keyword-research/clusters', 'POST /api/keyword-research/gap', 'GET /api/keyword-research/history',
    'POST /api/keyword-research/ideas', 'POST /api/keyword-research/intent', 'POST /api/keyword-research/long-tail', 'POST /api/keyword-research/metrics',
    'POST /api/keyword-research/overview', 'POST /api/keyword-research/preview', 'POST /api/keyword-research/related',
    'GET /api/keyword-research/trends', 'POST /api/keyword-research/trends', 'POST /api/keyword-research/trends/explore', 'POST /api/keyword-research/trends/explore/preview',
    'GET /api/legal/account-deletion', 'POST /api/legal/cancel-account-deletion', 'POST /api/legal/delete-account', 'POST /api/legal/export',
    'GET /api/local-seo/reviews/export.csv', 'POST /api/local-seo/reviews/preview', 'GET /api/local-seo/reviews/reviews', 'GET /api/local-seo/reviews/runs',
    'GET /api/local-seo/reviews/sources', 'POST /api/local-seo/reviews/sources', 'POST /api/local-seo/reviews/sync',
    'GET /api/market-catalogs/:surface', 'GET /api/mcp-permissions', 'PUT /api/mcp-permissions',
    'GET /api/report-exports', 'POST /api/report-exports', 'GET /api/report-exports/capabilities', 'GET /api/report-exports/shares',
    'GET /api/schema-generator/generations', 'POST /api/schema-generator/generations', 'POST /api/schema-generator/preview', 'GET /api/schema-generator/sources', 'GET /api/schema-generator/types',
    'GET /api/sites', 'POST /api/sites', 'GET /api/sites/traffic-snapshots', 'POST /api/sites/traffic-snapshots', 'GET /api/sites/traffic-snapshots/compare', 'POST /api/sites/traffic-snapshots/preview',
    'GET /api/team', 'POST /api/team/accept/:token', 'GET /api/team/invitations', 'POST /api/team/invite', 'GET /api/team/workspaces',
    'GET /api/users/branding', 'PUT /api/users/branding', 'GET /api/users/notifications', 'PATCH /api/users/notifications', 'GET /api/users/preferences/language', 'PATCH /api/users/preferences/language', 'GET /api/users/preferences/two-factor-recommendation', 'PUT /api/users/preferences/two-factor-recommendation',
]);

export const PUBLIC_ROUTE_CONTRACTS: Readonly<Record<string, { reason: string; file: string }>> = {
    'GET /api/client-portal/:token': { reason: 'A hashed, revocable portal token supplies authority; cookie sessions are not required.', file: 'modules/client-reports/client-reports.routes.test.ts' },
    'GET /api/report-shares/:token': { reason: 'A hashed share token supplies authority; all rejected tokens receive a constant 404.', file: 'modules/report-exports/report-exports.routes.test.ts' },
    'GET /api/report-shares/:token/files/:format': { reason: 'A hashed share token supplies authority and limits access to one immutable report.', file: 'modules/report-exports/report-exports.routes.test.ts' },
    'GET /api/team/invitations/preview/:token': { reason: 'A capability token permits an invitation preview before the recipient signs in.', file: 'modules/team/team.test.ts' },
    'POST /api/team/reject/:token': { reason: 'A capability token permits invitation rejection without claiming an account.', file: 'modules/team/team.test.ts' },
    'POST /api/firecrawl/webhook': { reason: 'Provider webhook signatures and configured secret bindings replace cookie authentication.', file: 'modules/content-monitoring/webhook.controller.test.ts' },
    'POST /api/communication/contact': { reason: 'The public contact form validates input and applies an IP rate limit before delivery.', file: 'modules/communication/communication.test.ts' },
    'GET /api/health': { reason: 'Public liveness and readiness exposes service health without account data.', file: 'modules/health/health.test.ts' },
    'GET /api/security/csrf-token': { reason: 'The browser needs a public anti-forgery value before sending authenticated mutations.', file: 'shared/middleware/csrf.test.ts' },
    'GET /robots.txt': { reason: 'Public crawler directives contain no account or resource data.', file: 'modules/seo/seo.test.ts' },
    'GET /llms.txt': { reason: 'Public discovery text links only the application public documentation.', file: 'modules/seo/seo.test.ts' },
    'GET /sitemap.xml': { reason: 'The public sitemap index lists only public documentation sitemaps.', file: 'modules/seo/seo.test.ts' },
    'GET /sitemap-docs.xml': { reason: 'The public documentation sitemap contains no authenticated resource URLs.', file: 'modules/seo/seo.test.ts' },
};

export const BEARER_ROUTES: ReadonlySet<string> = new Set([
    'DELETE /api/mcp', 'GET /api/mcp', 'POST /api/mcp',
    'GET /api/v1/backlink-rows', 'GET /api/v1/keywords', 'GET /api/v1/serp-features', 'GET /api/v1/sites',
]);

export type RouteContract = 'cookie' | 'bearer' | 'public' | 'framework';

/** Unknown non-nested routes fail enrollment instead of silently acquiring an exception. */
export function routeContract(route: Pick<InventoryRoute, 'method' | 'path'>): RouteContract | null {
    if (route.path === '/api/auth/*') return 'framework'; // Better Auth owns its dynamic endpoint table.
    if (route.path.startsWith('/api/sites/:siteId/')) return 'cookie';
    const key = routeKey(route);
    if (PUBLIC_ROUTE_CONTRACTS[key]) return 'public';
    if (BEARER_ROUTES.has(key)) return 'bearer';
    const coverage = CROSS_ACCOUNT_REGISTRY[key];
    if (coverage?.kind === 'test') return coverage.authentication ?? 'cookie';
    if (ACCOUNT_ROUTES.has(key)) return 'cookie';
    return null;
}
