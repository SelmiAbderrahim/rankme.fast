import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db as database } from '../../db/client.js';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';
import { readLatestSnapshot } from './local-seo.service.js';
import type * as ReviewSyncModel from './review-sync.model.js';

const mocked = vi.hoisted(() => ({
  findReviews: vi.fn(),
  getReviewRun: vi.fn(),
  getReviewStats: vi.fn(),
  getReviewThemes: vi.fn(),
  loadOwnedProfile: vi.fn(),
  serializeReview: vi.fn(),
}));

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./local-seo.service.js', () => ({ readLatestSnapshot: vi.fn() }));
vi.mock('./review-sync.model.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ReviewSyncModel>();
  return { ...actual, LocalSeoReviewRow: { find: mocked.findReviews } };
});
vi.mock('./review-sync.service.js', () => ({
  escapeRegExp: (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  getReviewRun: mocked.getReviewRun,
  getReviewStats: mocked.getReviewStats,
  loadOwnedProfile: mocked.loadOwnedProfile,
  resolveReviewOutputLocale: (value: { outputLocale?: unknown }) =>
    typeof value.outputLocale === 'string' ? value.outputLocale : 'en',
  serializeReviewRowDoc: mocked.serializeReview,
}));
vi.mock('./review-themes.service.js', () => ({ getReviewThemes: mocked.getReviewThemes }));

import { createLocalSeoReportExportAdapters } from './report-export.adapters.js';

const accountId = 'local-export-account';
const actorUserId = 'local-export-user';
const siteId = '507f1f77bcf86cd799439011';
const runId = '507f1f77bcf86cd799439012';
const fetchedAt = '2026-08-10T10:00:00.000Z';
const reviewedAt = '2026-08-09T10:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function snapshot(input: Record<string, unknown> = {}) {
  return {
    listings: [
      { source: 'google', name: 'Example', address: 'One Way', phone: null, consistent: true },
    ],
    fetchedAt,
    reviews: { averageRating: 4.5, reviewCount: 12, unansweredQuestionCount: 2 },
    reviewsFetchedAt: '2026-08-10T11:00:00.000Z',
    localPack: [
      { keywordId: 'keyword-1', phrase: 'seo agency', position: 2, totalPackSize: 3, checkedAt: '2026-08-10T12:00:00.000Z' },
      { keywordId: 'keyword-2', phrase: 'rank tracker', position: null, totalPackSize: 3, checkedAt: '2026-08-10T13:00:00.000Z' },
    ],
    ...input,
  };
}

function review(input: Record<string, unknown> = {}) {
  return {
    id: 'review-1',
    source: 'google',
    sourceReviewId: 'source-1',
    rating: 5,
    title: 'Useful',
    text: 'Great audit.',
    authorDisplayName: 'Reviewer',
    language: 'en',
    reviewedAt,
    fetchedAt,
    ...input,
  };
}

function run(input: Record<string, unknown> = {}) {
  return {
    id: runId,
    profileId: siteId,
    sources: ['google'],
    depth: 100,
    status: 'succeeded',
    perSourceOutcomes: [{ source: 'google', outcome: 'ok' }],
    retainedCount: 1,
    outputLocale: 'de',
    aiTerminalState: 'themes-ok',
    aiPassStartedAt: fetchedAt,
    aiCompletedAt: fetchedAt,
    aiInputCount: 1,
    aiThemeCount: 1,
    createdAt: '2026-08-10T09:00:00.000Z',
    completedAt: fetchedAt,
    ...input,
  };
}

function access(input: {
  scope?: 'site' | 'site_resource';
  resourceId?: string;
} = {}) {
  return {
    accountId,
    actorUserId,
    purpose: 'create' as const,
    target: input.scope === 'site'
      ? { scope: 'site' as const, siteId }
      : { scope: 'site_resource' as const, siteId, resourceId: input.resourceId ?? siteId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function compose(
  selection: Record<string, unknown>,
  input: { scope?: 'site' | 'site_resource'; format?: 'pdf' | 'csv' | 'json' } = {},
) {
  return { ...access(input), format: input.format ?? 'json', selection, branding };
}

function reviewFindResult(rows: unknown[]) {
  return {
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue(rows),
    }),
  };
}

beforeEach(() => {
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId, url: 'https://example.test', domain: 'example.test', displayName: 'Example Local',
    paused: false, pausedAt: null, createdAt: fetchedAt, updatedAt: fetchedAt,
  });
  vi.mocked(readLatestSnapshot).mockReset().mockResolvedValue(snapshot());
  mocked.findReviews.mockReset().mockReturnValue(reviewFindResult([review()]));
  mocked.getReviewRun.mockReset().mockResolvedValue(run());
  mocked.getReviewStats.mockReset().mockResolvedValue({
    runId, profileId: siteId, totalReviews: 1,
    histogram: [], ratingMix: {}, volumeTrend: [], observation: { observedAt: fetchedAt },
  });
  mocked.getReviewThemes.mockReset().mockResolvedValue({
    runId, profileId: siteId, outputLocale: 'de', themes: [], citations: [],
    observation: { observedAt: fetchedAt },
  });
  mocked.loadOwnedProfile.mockReset().mockResolvedValue(siteId);
  mocked.serializeReview.mockReset().mockImplementation((value) => value);
});

describe('local snapshot report export', () => {
  it('validates selection and owner scope', async () => {
    const [adapter] = createLocalSeoReportExportAdapters(database);
    if (!adapter) throw new Error('snapshot adapter missing');
    expect(adapter.selectionSchema.parse({})).toEqual({});
    expect(adapter.selectionSchema.safeParse({ sections: ['unknown'] }).success).toBe(false);
    await expect(adapter.assertAccess({ ...access({ scope: 'site' }), target: { scope: 'site', siteId } }))
      .resolves.toBeUndefined();
    expect(readLatestSnapshot).toHaveBeenCalledWith({ accountId, siteId }, { db: database });
    await expect(adapter.assertAccess(access())).rejects.toMatchObject({ status: 404 });
  });

  it('exports every evidence family, bounded misses, source dates, and all formats', async () => {
    const [adapter] = createLocalSeoReportExportAdapters(database);
    if (!adapter) throw new Error('snapshot adapter missing');
    const result = await adapter.compose(compose({}, { scope: 'site' }));
    expect(result.document.subject[0]?.value).toBe('Example Local');
    expect(result.document.completeness.selectedItems).toBe(4);
    expect(result.document.sourceDates[0]?.observedAt).toBe('2026-08-10T13:00:00.000Z');
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: fetchedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('filters local-pack keywords and independently selects review and Q&A fields', async () => {
    const [adapter] = createLocalSeoReportExportAdapters(database);
    if (!adapter) throw new Error('snapshot adapter missing');
    const qa = await adapter.compose(compose({
      sections: ['qa', 'localPack'], keyword: ['rank tracker'],
    }, { scope: 'site' }));
    expect(qa.document.completeness.selectedItems).toBe(2);

    const reviews = await adapter.compose(compose({ sections: ['reviews'] }, { scope: 'site' }));
    expect(reviews.document.completeness.selectedItems).toBe(1);

    vi.mocked(readLatestSnapshot).mockResolvedValue(snapshot({
      listings: [], fetchedAt: null, reviews: null, reviewsFetchedAt: null, localPack: [],
    }));
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: fetchedAt, updatedAt: fetchedAt,
    });
    const empty = await adapter.compose(compose({ sections: [] }, { scope: 'site' }));
    expect(empty.document.subject[0]?.value).toBe('example.test');
    expect(empty.document.sourceDates[0]?.observedAt).toBe(new Date(0).toISOString());
  });
});

describe('local review inventory report export', () => {
  it('validates filters, enforces profile/site identity, and escapes query input', async () => {
    const [, adapter] = createLocalSeoReportExportAdapters(database);
    if (!adapter) throw new Error('review adapter missing');
    expect(adapter.selectionSchema.safeParse({ from: '2026-08-11', to: '2026-08-10' }).success)
      .toBe(false);
    await adapter.compose(compose({
      source: ['google'], rating: [5], query: 'great.*',
      from: '2026-08-01', to: '2026-08-12',
    }));
    const filter = mocked.findReviews.mock.calls[0]![0];
    expect(filter).toMatchObject({
      accountId, profileId: siteId,
      source: { $in: ['google'] }, rating: { $in: [5] },
      reviewedAt: {
        $gte: new Date('2026-08-01T00:00:00.000Z'),
        $lte: new Date('2026-08-12T23:59:59.999Z'),
      },
    });
    expect(String(filter.$or[0].text)).toContain('great\\.\\*');

    await adapter.compose(compose({ from: '2026-08-01' }));
    expect(mocked.findReviews.mock.calls[2]![0].reviewedAt).toEqual({
      $gte: new Date('2026-08-01T00:00:00.000Z'),
    });
    await adapter.compose(compose({ to: '2026-08-12' }));
    expect(mocked.findReviews.mock.calls[4]![0].reviewedAt).toEqual({
      $lte: new Date('2026-08-12T23:59:59.999Z'),
    });

    mocked.loadOwnedProfile.mockResolvedValueOnce('foreign-site');
    await expect(adapter.assertAccess(access())).rejects.toMatchObject({ status: 404 });
    await expect(adapter.assertAccess(access({ scope: 'site' }))).rejects.toMatchObject({ status: 404 });
  });

  it('exports the selected run, statistics, themes, and nullable review timestamps', async () => {
    mocked.findReviews
      .mockReturnValueOnce(reviewFindResult([
        review(),
        review({ id: 'review-2', rating: null, reviewedAt: null, fetchedAt: '2026-08-11T10:00:00.000Z' }),
      ]))
      .mockReturnValueOnce(reviewFindResult([review()]));
    const [, adapter] = createLocalSeoReportExportAdapters(database);
    if (!adapter) throw new Error('review adapter missing');
    const result = await adapter.compose(compose({ runId }));
    expect(result.document.completeness).toMatchObject({ selectedItems: 2, representedItems: 2 });
    expect(result.document.sourceDates[0]?.observedAt).toBe('2026-08-11T10:00:00.000Z');
    expect(mocked.getReviewStats).toHaveBeenCalledWith(accountId, runId);
    expect(mocked.getReviewThemes).toHaveBeenCalledWith(accountId, runId);
    expect(JSON.stringify(result.document)).toContain('outputLocale');
    expect(JSON.stringify(result.document)).toContain('de');
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: fetchedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('rejects a run from another profile', async () => {
    mocked.getReviewRun.mockResolvedValueOnce(run({ profileId: 'foreign-site' }));
    const [, adapter] = createLocalSeoReportExportAdapters(database);
    if (!adapter) throw new Error('review adapter missing');
    await expect(adapter.compose(compose({ runId }))).rejects.toMatchObject({ status: 404 });
  });

  it('exports completed legacy generated themes as historically English', async () => {
    mocked.getReviewRun.mockResolvedValueOnce(run({ outputLocale: undefined }));
    mocked.getReviewThemes.mockResolvedValueOnce({
      runId, profileId: siteId, outputLocale: 'en', themes: [], citations: [],
      observation: { observedAt: fetchedAt },
    });
    const [, adapter] = createLocalSeoReportExportAdapters(database);
    if (!adapter) throw new Error('review adapter missing');
    const result = await adapter.compose(compose({ runId }));
    const serialized = JSON.stringify(result.document);
    expect(serialized).toContain('outputLocale');
    expect(serialized).toContain('en');
  });

  it('uses run and epoch fallbacks for empty inventories and supports null observation metadata', async () => {
    mocked.findReviews.mockReturnValue(reviewFindResult([]));
    mocked.getReviewStats.mockResolvedValue({
      runId, profileId: siteId, totalReviews: 0,
      histogram: [], ratingMix: {}, volumeTrend: [], observation: null,
    });
    mocked.getReviewThemes.mockResolvedValue({
      runId, profileId: siteId, themes: [], citations: [], observation: null,
    });
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt: fetchedAt, updatedAt: fetchedAt,
    });
    const [, adapter] = createLocalSeoReportExportAdapters(database);
    if (!adapter) throw new Error('review adapter missing');
    const withRun = await adapter.compose(compose({ runId }));
    expect(withRun.document.subject[0]?.value).toBe('example.test');
    expect(withRun.document.sourceDates[0]?.observedAt).toBe(fetchedAt);

    mocked.getReviewRun.mockResolvedValueOnce(run({ completedAt: null }));
    const withoutCompletion = await adapter.compose(compose({ runId }));
    expect(withoutCompletion.document.sourceDates[0]?.observedAt).toBe(new Date(0).toISOString());

    const withoutRun = await adapter.compose(compose({}));
    expect(withoutRun.document.sourceDates[0]?.observedAt).toBe(new Date(0).toISOString());
  });
});
