import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./internal-links.service.js', () => ({ getInternalLinkRun: mocked.run }));

import { createInternalLinksReportExportAdapter } from './report-export.adapter.js';

const accountId = 'links-export-account';
const actorUserId = 'links-export-user';
const siteId = '507f1f77bcf86cd799439011';
const runId = '507f1f77bcf86cd799439012';
const requestedAt = '2026-08-10T09:00:00.000Z';
const completedAt = '2026-08-10T10:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function suggestion(input: Record<string, unknown> = {}) {
  return {
    id: 'link-0123456789abcdefabcd', sourceUrl: 'https://example.test/source',
    sourceSection: 'Introduction', sourceWordCount: 500,
    targetUrl: 'https://example.test/target', targetFlag: 'orphan', targetInboundCount: 0,
    confidence: 'high', sharedQueries: ['seo audit'], headingMatches: ['SEO audit'],
    anchorText: 'SEO audit guide', inventoryDate: requestedAt, rank: 1,
    rankingSource: 'deterministic',
    ...input,
  };
}

function run(input: Record<string, unknown> = {}) {
  return {
    id: runId, siteId, status: 'completed', aiStatus: 'applied', inventoryDate: requestedAt,
    gscSnapshotDate: requestedAt, candidateRulesVersion: 'v1', suggestionCount: 2,
    requestedAt, startedAt: requestedAt, completedAt, error: null,
    suggestions: [
      suggestion(),
      suggestion({
        id: 'link-abcdefabcdefabcdefab', targetFlag: 'weakly_linked', confidence: 'low',
        rankingSource: 'ai', rank: 2,
      }),
    ],
    ...input,
  };
}

function access(scope: 'site_resource' | 'site' = 'site_resource') {
  return {
    accountId,
    actorUserId,
    purpose: 'create' as const,
    target: scope === 'site_resource'
      ? { scope: 'site_resource' as const, siteId, resourceId: runId }
      : { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function compose(selection: Record<string, unknown>, format: 'pdf' | 'csv' | 'json' = 'json') {
  return { ...access(), selection, format, branding };
}

beforeEach(() => {
  mocked.run.mockReset().mockResolvedValue(run());
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'Link Site',
    paused: false, pausedAt: null, createdAt: requestedAt, updatedAt: completedAt,
  });
});

describe('internal-links report export adapter', () => {
  it('validates filters and enforces resource/site ownership', async () => {
    const adapter = createInternalLinksReportExportAdapter();
    expect(adapter.selectionSchema.parse({})).toEqual({});
    expect(adapter.selectionSchema.safeParse({ rankingSource: ['unknown'] }).success).toBe(false);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access('site'))).rejects.toMatchObject({ status: 404 });
    mocked.run.mockResolvedValueOnce(run({ siteId: 'foreign-site' }));
    await expect(adapter.assertAccess(access())).rejects.toMatchObject({ status: 404 });
  });

  it('exports deterministic and generated suggestions and renders every format', async () => {
    const adapter = createInternalLinksReportExportAdapter();
    const result = await adapter.compose(compose({}));
    expect(result.document.subject[0]?.value).toBe('Link Site');
    expect(result.document.completeness.selectedItems).toBe(3);
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: completedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('applies each filter and supports an empty result', async () => {
    const adapter = createInternalLinksReportExportAdapter();
    let result = await adapter.compose(compose({
      targetFlag: ['orphan'], confidence: ['high'], rankingSource: ['deterministic'],
    }));
    expect(result.document.completeness.selectedItems).toBe(2);
    for (const selection of [
      { targetFlag: ['weakly_linked'], confidence: ['high'] },
      { targetFlag: ['orphan'], confidence: ['low'] },
      { targetFlag: ['orphan'], confidence: ['high'], rankingSource: ['ai'] },
    ]) {
      result = await adapter.compose(compose(selection));
      expect(result.document.completeness.selectedItems).toBe(1);
    }
  });

  it('uses requested time and the site domain as fallbacks', async () => {
    mocked.run.mockResolvedValue(run({ completedAt: null }));
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: requestedAt, updatedAt: requestedAt,
    });
    const adapter = createInternalLinksReportExportAdapter();
    const result = await adapter.compose(compose({}));
    expect(result.document.subject[0]?.value).toBe('example.test');
    expect(result.document.sourceDates[0]?.observedAt).toBe(requestedAt);
  });
});
