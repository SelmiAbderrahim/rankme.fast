import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db as database } from '../../db/client.js';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({
  createService: vi.fn(),
  detail: vi.fn(),
  list: vi.fn(),
}));

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./pages.service.js', () => ({ createPagesService: mocked.createService }));

import { createPagesReportExportAdapter } from './report-export.adapter.js';

const accountId = 'pages-export-account';
const actorUserId = 'pages-export-user';
const siteId = '507f1f77bcf86cd799439011';
const pageOneId = 'A'.repeat(43);
const pageTwoId = 'B'.repeat(43);
const observedAt = '2026-08-10T10:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function metrics(input: Record<string, unknown> = {}) {
  return {
    clicks: 10, impressions: 100, ctr: 0.1,
    averagePosition: 4, bestPosition: null, keywordCount: 2,
    searchVolume: 100, difficulty: 20, estimatedTraffic: 10,
    associatedQueryCount: 2,
    ...input,
  };
}

function page(input: Record<string, unknown> = {}) {
  return {
    pageId: pageOneId,
    url: 'https://example.test/a',
    displayUrl: 'example.test/a',
    title: null,
    performanceSource: 'gsc',
    isIndexable: true,
    nonIndexableReason: null,
    onPageScore: 90,
    metrics: metrics(),
    deltas: { positionChange: 2, clickChangePct: 0.1 },
    insights: ['winning'],
    ...input,
  };
}

function envelope(range: '7d' | '28d' | '90d', input: Record<string, unknown> = {}) {
  return {
    source: 'gsc', status: 'ready', fallbackReason: null,
    observedAt, staleAt: null, range, rangeSemantics: 'rolling_window',
    comparison: { label: 'since_previous_sync', previousObservedAt: null },
    market: null,
    coverage: {
      reportingLagDays: 3, sampled: false, sourceRowsFetched: 2,
      sourceRowsAccepted: 2, sourceRowsDropped: 0,
      dropped: { malformedUrl: 0, offsiteUrl: 0, duplicateUrl: 0, invalidMetric: 0 },
      sourceLimit: 100, sourceTruncated: false, auditRowsFetched: 2,
      auditRowsAccepted: 2, auditRowsDropped: 0, auditTruncated: false,
      inventoryPages: 2, measuredPages: 1, unmeasuredPages: 1,
    },
    ...input,
  };
}

function listResponse(
  range: '7d' | '28d' | '90d',
  input: { items?: unknown[]; nextCursor?: string | null; observedAt?: string | null } = {},
) {
  return {
    envelope: envelope(range, input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
    summary: metrics(),
    items: input.items ?? [
      page(),
      page({
        pageId: pageTwoId,
        url: 'https://example.test/b', displayUrl: 'example.test/b', title: 'Page B',
        performanceSource: null, isIndexable: false,
        metrics: metrics({ averagePosition: null, bestPosition: 12 }),
        insights: ['unmeasured', 'non_indexable_visibility'],
      }),
    ],
    pageInfo: {
      limit: 100, hasNext: input.nextCursor !== null,
      nextCursor: input.nextCursor ?? null,
      totalFiltered: 2, totalInventory: 2, totalMeasured: 1,
    },
  };
}

function access(scope: 'site' | 'site_resource' = 'site') {
  return {
    accountId,
    actorUserId,
    purpose: 'create' as const,
    target: scope === 'site'
      ? { scope: 'site' as const, siteId }
      : { scope: 'site_resource' as const, siteId, resourceId: pageOneId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

interface PagesSelection {
  range: '7d' | '28d' | '90d';
  pageIds?: string[];
  insight?: Array<
    | 'striking_distance'
    | 'low_ctr'
    | 'declining'
    | 'winning'
    | 'non_indexable_visibility'
    | 'unmeasured'
  >;
  indexability?: 'indexable' | 'non_indexable';
  visibility?: 'measured' | 'unmeasured';
}

function compose(selection: PagesSelection, format: 'pdf' | 'csv' | 'json' = 'json') {
  return { ...access(), selection, format, branding };
}

beforeEach(() => {
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'Example Pages',
    paused: false, pausedAt: null, createdAt: observedAt, updatedAt: observedAt,
  });
  mocked.detail.mockReset().mockResolvedValue({ page: page(), associated: { kind: 'queries', rows: [], total: 0, truncated: false }, trend: [] });
  mocked.list.mockReset().mockImplementation(async (_accountId, _siteId, query) =>
    listResponse(query.range, {
      items: query.cursor ? [page({ pageId: 'C'.repeat(43) })] : undefined,
      nextCursor: query.range === '7d' && !query.cursor ? 'next-page' : null,
    }));
  mocked.createService.mockReset().mockReturnValue({ list: mocked.list, detail: mocked.detail });
});

describe('Pages report export adapter', () => {
  it('validates selection, reads all ranges with pagination, and refuses resource scope', async () => {
    const adapter = createPagesReportExportAdapter(database);
    expect(adapter.selectionSchema.parse({})).toEqual({ range: '28d' });
    expect(adapter.selectionSchema.safeParse({ pageIds: ['unsafe'] }).success).toBe(false);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    expect(mocked.list).toHaveBeenCalledTimes(4);
    expect(mocked.list).toHaveBeenCalledWith(accountId, siteId, expect.objectContaining({
      range: '7d', cursor: 'next-page',
    }));
    await expect(adapter.assertAccess(access('site_resource'))).rejects.toMatchObject({ status: 404 });

    const config = mocked.createService.mock.calls[0]![0];
    await expect(config.fallbackRefresh.refresh()).rejects.toThrow('cannot refresh page data');

    mocked.list.mockResolvedValueOnce({
      ...listResponse('7d', { items: [], nextCursor: null }),
      envelope: null,
      summary: null,
    });
    await expect(adapter.assertAccess(access())).rejects.toThrow('no envelope');
  });

  it('exports measured and unmeasured page truth states and renders every format', async () => {
    const adapter = createPagesReportExportAdapter(database);
    const result = await adapter.compose(compose({ range: '28d' }));
    expect(result.document.subject[0]?.value).toBe('Example Pages');
    expect(result.document.completeness.selectedItems).toBe(2);
    expect(mocked.detail).not.toHaveBeenCalled();
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: observedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('loads details for explicit ids and applies every filter polarity', async () => {
    const adapter = createPagesReportExportAdapter(database);
    let result = await adapter.compose(compose({
      range: '28d', pageIds: [pageOneId], insight: ['winning'],
      indexability: 'indexable', visibility: 'measured',
    }));
    expect(result.document.completeness.selectedItems).toBe(1);
    expect(mocked.detail).toHaveBeenCalledWith(accountId, siteId, pageOneId, '28d');

    result = await adapter.compose(compose({
      range: '28d', insight: ['unmeasured'],
      indexability: 'non_indexable', visibility: 'unmeasured',
    }));
    expect(result.document.completeness.selectedItems).toBe(1);

    result = await adapter.compose(compose({
      range: '28d', insight: ['declining'],
      indexability: 'indexable', visibility: 'measured',
    }));
    expect(result.document.completeness.selectedItems).toBe(0);
  });

  it('uses domain and epoch fallbacks and stops pagination at the export bound', async () => {
    const many = Array.from({ length: 1_001 }, (_, index) => page({
      pageId: `${String(index).padStart(43, '0')}`,
    }));
    mocked.list.mockImplementation(async (_accountId, _siteId, query) =>
      listResponse(query.range, {
        items: query.range === '7d' ? many : [],
        nextCursor: query.range === '7d' ? 'bounded-stop' : null,
        observedAt: null,
      }));
    const adapter = createPagesReportExportAdapter(database);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    expect(mocked.list).toHaveBeenCalledTimes(3);

    mocked.list.mockImplementation(async (_accountId, _siteId, query) =>
      listResponse(query.range, { items: [], nextCursor: null, observedAt: null }));
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: observedAt, updatedAt: observedAt,
    });
    const result = await adapter.compose(compose({ range: '28d' }));
    expect(result.document.subject[0]?.value).toBe('example.test');
    expect(result.document.sourceDates[0]?.observedAt).toBe(new Date(0).toISOString());
  });
});
