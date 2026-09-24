import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../../app.ts', import.meta.url), 'utf8');
const sitesRouterSource = readFileSync(
  new URL('../../modules/sites/sites.routes.ts', import.meta.url),
  'utf8',
);

describe('team site authorization route ratchet', () => {
  it('keeps workspace resolution and the broad site boundary ahead of product routers', () => {
    const workspaceChain = appSource.indexOf('workspaceContext(getTeamDb)');
    const broadBoundary = appSource.indexOf("app.use('/api/sites/:siteId', verified, siteMutationLease)");
    expect(workspaceChain).toBeGreaterThan(-1);
    expect(broadBoundary).toBeGreaterThan(workspaceChain);

    const laterSiteMounts = [...appSource.matchAll(/app\.use\('\/api\/sites(?:'|\/)/gu)]
      .map((match) => match.index)
      .filter((index) => index > broadBoundary);
    expect(laterSiteMounts.length).toBeGreaterThan(10);
    expect(laterSiteMounts.every((index) => index > broadBoundary)).toBe(true);
  });

  it('guards the sole pre-boundary site-param mount explicitly', () => {
    const broadBoundary = appSource.indexOf(
      "app.use('/api/sites/:siteId', verified, siteMutationLease)",
    );
    const prefix = appSource.slice(0, broadBoundary);
    const earlySiteMounts = [...prefix.matchAll(/app\.use\([\s\S]{0,100}'\/api\/sites\/:siteId/gu)];
    expect(earlySiteMounts).toHaveLength(1);
    expect(prefix).toMatch(
      /'\/api\/sites\/:siteId\/pages',[\s\S]{0,160}requireTeamSiteAccess/gu,
    );
  });

  it('keeps every legacy body/query site prefix behind both centralized resolvers', () => {
    for (const prefix of [
      '/api/backlinks',
      '/api/competitors',
      '/api/local-seo',
      '/api/schema-generator',
      '/api/alerts',
      '/api/keyword-research',
      '/api/chat',
    ]) {
      expect(appSource).toContain(`'${prefix}',`);
    }
    expect(appSource).toContain('app.use(prefix, verified, bodySiteMutationLease)');
    expect(appSource).toContain('app.use(prefix, verified, querySiteMutationLease)');
    expect(appSource).not.toContain("app.use('/api/google'");
    expect(appSource).toContain("'/api/sites/:siteId/google',");
  });

  it('ratchets representative resource-derived routes through the resolver boundary', () => {
    expect(appSource).toMatch(
      /const leaseOwnedResource[\s\S]{0,900}requireTeamResourceSiteAccess\(resolve\)[\s\S]{0,300}createSiteMutationLease\(resolve/gu,
    );
    for (const resolver of [
      'resolveOwnedAnalysisSiteId',
      'resolveOwnedAuditRunSiteId',
      'resolveOwnedAlertRuleSiteId',
      'resolveOwnedConversationSiteId',
      'resolveOwnedCannibalizationReportSiteId',
      'resolveOwnedBrandRadarScanSiteId',
      'resolveOwnedInternalLinkRunSiteId',
      'resolveOwnedKeywordClusterRunSiteId',
      'resolveOwnedKeywordSiteId',
    ]) {
      expect(appSource).toMatch(
        new RegExp(`leaseOwnedResource\\([\\s\\S]{0,180}${resolver}`, 'u'),
      );
    }
  });

  it('keeps create/delete/pause/resume site lifecycle routes owner-only', () => {
    expect(sitesRouterSource).toContain("sitesRouter.post('/', requireWorkspaceOwner, create)");
    for (const handler of ['pause', 'resume', 'remove']) {
      expect(sitesRouterSource).toMatch(
        new RegExp(`requireWorkspaceOwner,\\s+${handler}`, 'u'),
      );
    }
  });
});
