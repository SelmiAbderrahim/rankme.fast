import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';
import {
  getReport,
  type CandidateDto,
  type CandidatePageDto,
  type ReportDetailDto,
} from './cannibalization.service.js';

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./cannibalization.service.js', () => ({ getReport: vi.fn() }));

import {
  cannibalizationReportExportTestables as internals,
  createCannibalizationReportExportAdapter,
} from './report-export.adapter.js';

const accountId = 'cannibal-export-account';
const actorUserId = 'cannibal-export-user';
const siteId = '507f1f77bcf86cd799439011';
const reportId = '507f1f77bcf86cd799439012';
const snapshotDate = '2026-08-10T00:00:00.000Z';
const generatedAt = '2026-08-10T10:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function page(input: Partial<CandidatePageDto> = {}): CandidatePageDto {
  return {
    url: 'https://example.test/primary', clicks: 10, impressions: 100,
    position: 3, clickShare: 0.8, impressionShare: 0.7, isPrimary: true,
    ...input,
  };
}

function candidate(input: Partial<CandidateDto> = {}): CandidateDto {
  return {
    id: 'candidate-1', query: 'seo audit', confidence: 'high', sourceKind: 'first_party',
    windowDays: 28, snapshotDate,
    observation: {
      sourceKind: 'first_party', sourceLabel: 'Search Console', observedAt: snapshotDate,
      freshUntil: null, freshness: 'fresh', market: null, sampleCount: 2,
      coverageNoteKey: null,
    },
    totalClicks: 12, totalImpressions: 100, primaryUrl: 'https://example.test/primary',
    primaryReason: 'most_clicks',
    pages: [
      page({ url: 'https://example.test/secondary', clicks: 2, impressions: 0, isPrimary: false }),
      page(),
    ],
    ...input,
  };
}

function report(input: Partial<ReportDetailDto> = {}): ReportDetailDto {
  return {
    id: reportId, siteId, windowDays: 28, snapshotDate, generatedAt,
    queriesAnalyzed: 20, candidateCount: 3, pagesInvolved: 6,
    candidates: [
      candidate({ id: 'candidate-2', query: 'rank tracker', confidence: 'medium' }),
      candidate(),
      candidate({ id: 'candidate-0', query: 'seo audit', confidence: 'low' }),
    ],
    ...input,
  };
}

function access(input: {
  scope?: 'site_resource' | 'site';
  purpose?: 'create' | 'persist';
  sourceVersion?: string;
} = {}) {
  return {
    accountId,
    actorUserId,
    purpose: input.purpose ?? 'create',
    target: input.scope === 'site'
      ? { scope: 'site' as const, siteId }
      : { scope: 'site_resource' as const, siteId, resourceId: reportId },
    format: 'json' as const,
    locale: 'en' as const,
    ...(input.sourceVersion === undefined ? {} : { sourceVersion: input.sourceVersion }),
  };
}

function compose(selection: Record<string, unknown>, format: 'pdf' | 'csv' | 'json' = 'json') {
  return { ...access(), selection, format, branding };
}

beforeEach(() => {
  vi.mocked(getReport).mockReset().mockResolvedValue(report());
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'Cannibal Site',
    paused: false, pausedAt: null, createdAt: snapshotDate, updatedAt: generatedAt,
  });
});

describe('cannibalization report export helpers', () => {
  it('validates selection and covers stable candidate/page ordering tie-breakers', () => {
    expect(internals.selectionSchema.parse({})).toEqual({});
    expect(internals.selectionSchema.safeParse({ confidence: 'unknown' }).success).toBe(false);
    expect(internals.compareCandidates(
      candidate({ query: 'alpha' }), candidate({ query: 'beta' }),
    )).toBeLessThan(0);
    expect(internals.compareCandidates(
      candidate({ id: 'a', query: 'same' }), candidate({ id: 'b', query: 'same' }),
    )).toBeLessThan(0);
    expect(internals.comparePages(page(), page({ isPrimary: false }))).toBeLessThan(0);
    expect(internals.comparePages(
      page({ url: 'https://a.test/', isPrimary: false }),
      page({ url: 'https://b.test/', isPrimary: false }),
    )).toBeLessThan(0);
  });
});

describe('cannibalization report export adapter', () => {
  it('enforces resource/site ownership and immutable source versions', async () => {
    const adapter = createCannibalizationReportExportAdapter();
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ scope: 'site' }))).rejects.toMatchObject({ status: 404 });
    vi.mocked(getReport).mockResolvedValueOnce(report({ siteId: 'foreign-site' }));
    await expect(adapter.assertAccess(access())).rejects.toMatchObject({ status: 404 });

    const result = await adapter.compose(compose({}));
    await expect(adapter.assertAccess(access({ purpose: 'persist' }))).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ purpose: 'persist', sourceVersion: result.sourceVersion })))
      .resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ purpose: 'persist', sourceVersion: 'stale' })))
      .rejects.toMatchObject({ status: 409 });
  });

  it('exports both CTR truth states and renders every format', async () => {
    const adapter = createCannibalizationReportExportAdapter();
    const result = await adapter.compose(compose({ confidence: undefined }));
    expect(result.document.subject[0]?.value).toBe('Cannibal Site');
    expect(result.document.completeness.selectedItems).toBe(6);
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: generatedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('filters by confidence and candidate id and supports an empty result', async () => {
    const adapter = createCannibalizationReportExportAdapter();
    let result = await adapter.compose(compose({ confidence: 'high', candidateId: 'candidate-1' }));
    expect(result.document.completeness.selectedItems).toBe(2);
    result = await adapter.compose(compose({ confidence: 'medium', candidateId: 'missing' }));
    expect(result.document.completeness.selectedItems).toBe(0);
  });

  it('uses the site domain when its display name is empty', async () => {
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: snapshotDate, updatedAt: generatedAt,
    });
    const adapter = createCannibalizationReportExportAdapter();
    const result = await adapter.compose(compose({}));
    expect(result.document.subject[0]?.value).toBe('example.test');
  });
});
