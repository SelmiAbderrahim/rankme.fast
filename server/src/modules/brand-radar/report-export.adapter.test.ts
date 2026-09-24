import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({
  mentions: vi.fn(),
  scan: vi.fn(),
  serialize: vi.fn((value: unknown) => value),
}));

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock(import('./brand-radar.rows.model.js'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, readMentionRows: mocked.mentions };
});
vi.mock('./brand-radar.service.js', () => ({
  getScan: mocked.scan,
  serializeMentionRow: mocked.serialize,
}));

import { createBrandRadarReportExportAdapter } from './report-export.adapter.js';

const accountId = 'brand-export-account';
const actorUserId = 'brand-export-user';
const siteId = '507f1f77bcf86cd799439011';
const scanId = '507f1f77bcf86cd799439012';
const observedAt = '2026-08-10T10:00:00.000Z';
const updatedAt = '2026-08-10T12:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function scan(input: Record<string, unknown> = {}) {
  return {
    id: scanId, siteId, brandQuery: 'RankMeFast', language: 'en',
    outputLocale: 'de',
    countryCode: 'US', locationCode: 2840, status: 'succeeded',
    digestState: 'succeeded', mentionCount: 2,
    sentimentDistribution: { positive: 1, neutral: 0, negative: 1 },
    topDomains: [{ domain: 'news.test', count: 1 }], trend: [], priorScanId: null,
    halt: null, createdAt: '2026-08-10T09:00:00.000Z', terminalAt: updatedAt,
    updatedAt, digestSentences: [
      { text: 'Coverage was mostly favorable.', citedRowIds: ['mention-1'] },
    ],
    ...input,
  };
}

function mention(input: Record<string, unknown> = {}) {
  return {
    id: 'mention-1', url: 'https://news.test/rankmefast', domain: 'news.test',
    title: 'RankMeFast review', snippet: 'A useful audit platform.',
    polarity: 'positive', confidence: 0.9, language: 'en', observedAt,
    ...input,
  };
}

function access(scope: 'site_resource' | 'site' = 'site_resource') {
  return {
    accountId,
    actorUserId,
    purpose: 'create' as const,
    target: scope === 'site_resource'
      ? { scope: 'site_resource' as const, siteId, resourceId: scanId }
      : { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function compose(selection: Record<string, unknown>, format: 'pdf' | 'csv' | 'json' = 'json') {
  return { ...access(), selection, format, branding };
}

beforeEach(() => {
  mocked.scan.mockReset().mockResolvedValue(scan());
  mocked.mentions.mockReset().mockResolvedValue([
    mention(),
    mention({
      id: 'mention-2', domain: 'other.test', title: '', polarity: 'negative',
      confidence: 0.4, observedAt: null,
    }),
  ]);
  mocked.serialize.mockClear();
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'Example Brand',
    paused: false, pausedAt: null, createdAt: observedAt, updatedAt,
  });
});

describe('Brand Radar report export adapter', () => {
  it('validates time windows and enforces resource/site ownership', async () => {
    const adapter = createBrandRadarReportExportAdapter();
    expect(adapter.selectionSchema.parse({})).toEqual({});
    expect(adapter.selectionSchema.safeParse({ from: '2026-08-11', to: '2026-08-10' }).success)
      .toBe(false);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    expect(mocked.mentions).toHaveBeenCalledWith({ accountId, scanId, limit: 1_000 });
    await expect(adapter.assertAccess(access('site'))).rejects.toMatchObject({ status: 404 });

    mocked.scan.mockResolvedValueOnce(scan({ siteId: 'foreign-site' }));
    await expect(adapter.assertAccess(access())).rejects.toThrow('site mismatch');
  });

  it('exports scan, mention, and cited digest evidence and renders every format', async () => {
    const adapter = createBrandRadarReportExportAdapter();
    const result = await adapter.compose(compose({}));
    expect(result.document.subject[0]?.value).toBe('Example Brand');
    expect(result.document.completeness.selectedItems).toBe(2);
    expect(result.document.sourceDates[0]?.observedAt).toBe(observedAt);
    expect(mocked.serialize).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result.document)).toContain('outputLocale');
    expect(JSON.stringify(result.document)).toContain('de');
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: updatedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('applies sentiment, domain, and inclusive date filters including null observations', async () => {
    const adapter = createBrandRadarReportExportAdapter();
    let result = await adapter.compose(compose({
      sentiment: ['positive'], domain: ['news.test'],
      from: '2026-08-10', to: '2026-08-10',
    }));
    expect(result.document.completeness.selectedItems).toBe(1);

    result = await adapter.compose(compose({ sentiment: ['neutral'] }));
    expect(result.document.completeness.selectedItems).toBe(0);
    result = await adapter.compose(compose({ domain: ['missing.test'] }));
    expect(result.document.completeness.selectedItems).toBe(0);
    result = await adapter.compose(compose({ from: '2026-08-11' }));
    expect(result.document.completeness.selectedItems).toBe(0);
    result = await adapter.compose(compose({ to: '2026-08-09' }));
    expect(result.document.completeness.selectedItems).toBe(0);
  });

  it('uses terminal and updated timestamps plus the domain/title fallbacks', async () => {
    mocked.mentions.mockResolvedValue([]);
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: observedAt, updatedAt,
    });
    const adapter = createBrandRadarReportExportAdapter();
    let result = await adapter.compose(compose({}));
    expect(result.document.subject[0]?.value).toBe('example.test');
    expect(result.document.sourceDates[0]?.observedAt).toBe(updatedAt);

    mocked.scan.mockResolvedValueOnce(scan({ terminalAt: null }));
    result = await adapter.compose(compose({}));
    expect(result.document.sourceDates[0]?.observedAt).toBe(updatedAt);

    mocked.mentions.mockResolvedValueOnce([
      mention({ title: '', domain: 'fallback.test' }),
    ]);
    result = await adapter.compose(compose({}));
    expect(result.document.completeness.selectedItems).toBe(1);
  });
});
