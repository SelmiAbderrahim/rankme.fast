import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db as database } from '../../db/client.js';
import type { ReportBrandingSnapshot } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';

const mocked = vi.hoisted(() => ({
  history: vi.fn(),
  keywords: vi.fn(),
  profiles: vi.fn(),
  research: vi.fn(),
}));

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./app-seo.service.js', () => ({ listAppProfiles: mocked.profiles }));
vi.mock('./keywords.service.js', () => ({
  getAppKeywordHistory: mocked.history,
  listAppKeywords: mocked.keywords,
}));
vi.mock('./research.service.js', () => ({ readLatestAppResearch: mocked.research }));

import { createAppSeoReportExportAdapters } from './report-export.adapters.js';

const accountId = 'app-seo-export-account';
const actorUserId = 'app-seo-export-user';
const siteId = '507f1f77bcf86cd799439011';
const profileId = '507f1f77bcf86cd799439012';
const keywordOne = '13bea72e-4fc8-495d-bcd7-03841ee099d2';
const keywordTwo = '2c929174-3b7b-4382-8e98-4af38cb2e723';
const absentKeyword = '6951c4eb-d3fd-4b59-b89f-20c2b53823e5';
const createdAt = '2026-07-01T09:00:00.000Z';
const updatedAt = '2026-08-01T10:00:00.000Z';
const fetchedAt = '2026-08-10T11:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};

function profile(input: Record<string, unknown> = {}) {
  return {
    id: profileId,
    siteId,
    playPackageId: 'com.example.app',
    appStoreId: '123456789',
    paired: true,
    createdAt,
    updatedAt,
    ...input,
  };
}

function keyword(input: Record<string, unknown> = {}) {
  return {
    id: keywordOne,
    profileId,
    store: 'google_play',
    phrase: 'seo audit',
    locationCode: 2840,
    languageCode: 'en',
    active: true,
    latestPosition: 3,
    previousPosition: 5,
    delta: 2,
    lastCheckedAt: fetchedAt,
    lastFailedCheckAt: null,
    createdAt,
    ...input,
  };
}

function history(position: number | null, checkedAt: string) {
  return { checkedAt, position, rankAbsolute: position, foundAppId: position === null ? null : 'com.example.app' };
}

function researchResult(input: Record<string, unknown> = {}) {
  return {
    surface: 'keywords',
    profileId,
    store: 'google_play',
    appId: 'com.example.app',
    rows: [
      { keyword: 'seo audit', position: 3, searchVolume: 100, difficulty: 20 },
      { keyword: 'seo tool', position: 8, searchVolume: 80, difficulty: 25 },
    ],
    cursor: 0,
    nextCursor: null,
    totalRows: 2,
    cached: false,
    fetchedAt,
    ...input,
  };
}

function target(input: { resourceId?: string; scope?: 'site' | 'site_resource' } = {}) {
  return input.scope === 'site'
    ? { scope: 'site' as const, siteId }
    : { scope: 'site_resource' as const, siteId, resourceId: input.resourceId ?? profileId };
}

function access(input: {
  resourceId?: string;
  scope?: 'site' | 'site_resource';
  purpose?: 'create' | 'persist';
  sourceVersion?: string;
} = {}) {
  return {
    accountId,
    actorUserId,
    purpose: input.purpose ?? 'create',
    target: target(input),
    format: 'json' as const,
    locale: 'en' as const,
    ...(input.sourceVersion === undefined ? {} : { sourceVersion: input.sourceVersion }),
  };
}

interface KeywordSelection {
  keywordIds?: string[];
  historyLimit: number;
}

interface ResearchSelection {
  surface: 'keywords' | 'gap' | 'competitors';
  store: 'google_play' | 'app_store';
}

function keywordCompose(
  selection: KeywordSelection,
  format: 'pdf' | 'csv' | 'json' = 'json',
) {
  return { ...access(), selection, format, branding };
}

function researchCompose(
  selection: ResearchSelection,
  format: 'pdf' | 'csv' | 'json' = 'json',
) {
  return { ...access(), selection, format, branding };
}

beforeEach(() => {
  mocked.profiles.mockReset().mockResolvedValue([profile()]);
  mocked.keywords.mockReset().mockResolvedValue({
    items: [
      keyword(),
      keyword({
        id: keywordTwo,
        phrase: 'rank tracker',
        latestPosition: null,
        previousPosition: null,
        delta: null,
        lastCheckedAt: null,
      }),
    ],
    slots: { deploymentMode: 'self_host', capacityEnforced: false, used: 2, exhausted: false },
    trackingEnabled: true,
    appSeoAddonActive: true,
  });
  mocked.history.mockReset().mockImplementation(async (input) =>
    input.keywordId === keywordOne
      ? [
          history(8, '2026-07-20T00:00:00.000Z'),
          history(null, '2026-07-27T00:00:00.000Z'),
          history(3, fetchedAt),
        ]
      : []);
  mocked.research.mockReset().mockImplementation(async (input) => ({
    result: input.surface === 'keywords' && input.store === 'google_play'
      ? researchResult()
      : null,
    researchEnabled: true,
    appSeoAddonActive: true,
  }));
  vi.mocked(getSite).mockReset().mockResolvedValue({
    id: siteId,
    url: 'https://example.test',
    domain: 'example.test',
    displayName: 'Example App',
    paused: false,
    pausedAt: null,
    createdAt,
    updatedAt,
  });
});

describe('App SEO keyword export adapter', () => {
  it('validates selection defaults, owner scope, and missing resources', async () => {
    const [adapter] = createAppSeoReportExportAdapters(database);
    if (!adapter) throw new Error('keyword adapter missing');
    expect(adapter.selectionSchema.parse({})).toEqual({ historyLimit: 104 });
    expect(adapter.selectionSchema.safeParse({ historyLimit: 0 }).success).toBe(false);
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    await expect(adapter.assertAccess(access({ scope: 'site' }))).rejects.toMatchObject({ status: 404 });
    mocked.profiles.mockResolvedValueOnce([]);
    await expect(adapter.assertAccess(access())).rejects.toMatchObject({ status: 404 });
  });

  it('exports bounded history plus a truthful unobserved keyword and renders every format', async () => {
    const [adapter] = createAppSeoReportExportAdapters(database);
    if (!adapter) throw new Error('keyword adapter missing');
    const result = await adapter.compose(keywordCompose({ historyLimit: 2 }));
    expect(result.document.subject[0]?.value).toBe('Example App');
    expect(result.document.completeness).toMatchObject({ selectedItems: 3, representedItems: 3 });
    const table = result.document.blocks.find((block) => block.type === 'table');
    expect(table).toMatchObject({ type: 'table', rows: expect.arrayContaining([
      expect.objectContaining({ id: 'stored-row-1' }),
      expect.objectContaining({ id: 'stored-row-3' }),
    ]) });
    expect(mocked.history).toHaveBeenCalledWith(expect.objectContaining({ limit: 104 }), database);
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: fetchedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('supports explicit ids, the domain label fallback, and an empty selection timestamp fallback', async () => {
    vi.mocked(getSite).mockResolvedValue({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt, updatedAt,
    });
    const [adapter] = createAppSeoReportExportAdapters(database);
    if (!adapter) throw new Error('keyword adapter missing');
    const selected = await adapter.compose(keywordCompose({ keywordIds: [keywordTwo], historyLimit: 1 }));
    expect(selected.document.subject[0]?.value).toBe('example.test');
    expect(selected.document.completeness.selectedItems).toBe(1);

    const empty = await adapter.compose(keywordCompose({ keywordIds: [absentKeyword], historyLimit: 1 }));
    expect(empty.document.completeness.selectedItems).toBe(0);
    expect(empty.document.sourceDates[0]?.observedAt).toBe(updatedAt);
  });

  it('labels a previously observed keyword as ranked when its selected history window is empty', async () => {
    mocked.history.mockResolvedValue([]);
    const [adapter] = createAppSeoReportExportAdapters(database);
    if (!adapter) throw new Error('keyword adapter missing');
    const result = await adapter.compose(keywordCompose({ keywordIds: [keywordOne], historyLimit: 1 }));
    expect(result.document.completeness.selectedItems).toBe(1);
    expect(result.document.sourceDates[0]?.observedAt).toBe(fetchedAt);
  });
});

describe('App SEO research export adapter', () => {
  it('validates selection and exports observed rows with uncached state', async () => {
    const [, adapter] = createAppSeoReportExportAdapters(database);
    if (!adapter) throw new Error('research adapter missing');
    expect(adapter.selectionSchema.safeParse({ surface: 'unknown', store: 'google_play' }).success)
      .toBe(false);
    const result = await adapter.compose(researchCompose({ surface: 'keywords', store: 'google_play' }));
    expect(result.document.completeness.selectedItems).toBe(2);
    expect(result.document.sourceDates[0]?.observedAt).toBe(fetchedAt);
    expect(mocked.research).toHaveBeenCalledTimes(6);
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: fetchedAt }))
        .resolves.toMatchObject({ format });
    }
  });

  it('exports unavailable and cached observations and handles one-store profiles', async () => {
    const [, adapter] = createAppSeoReportExportAdapters(database);
    if (!adapter) throw new Error('research adapter missing');
    let result = await adapter.compose(researchCompose({ surface: 'gap', store: 'app_store' }));
    expect(result.document.completeness.selectedItems).toBe(0);

    vi.mocked(getSite).mockResolvedValueOnce({
      id: siteId, url: 'https://example.test', domain: 'example.test', displayName: '',
      paused: false, pausedAt: null, createdAt, updatedAt,
    });

    mocked.research.mockImplementation(async (input) => ({
      result: input.surface === 'keywords' && input.store === 'google_play'
        ? researchResult({ cached: true })
        : null,
      researchEnabled: true,
      appSeoAddonActive: true,
    }));
    result = await adapter.compose(researchCompose({ surface: 'keywords', store: 'google_play' }));
    expect(result.document.completeness.selectedItems).toBe(2);
    expect(result.document.subject[0]?.value).toBe('example.test');

    mocked.profiles.mockResolvedValue([profile({ appStoreId: null, paired: false })]);
    await expect(adapter.compose(researchCompose({ surface: 'keywords', store: 'app_store' })))
      .rejects.toMatchObject({ status: 404 });

    mocked.profiles.mockResolvedValue([profile({ playPackageId: null, paired: false })]);
    await expect(adapter.compose(researchCompose({ surface: 'keywords', store: 'google_play' })))
      .rejects.toMatchObject({ status: 404 });
  });

  it('rejects missing profiles and non-resource targets at access time', async () => {
    const [, adapter] = createAppSeoReportExportAdapters(database);
    if (!adapter) throw new Error('research adapter missing');
    mocked.profiles.mockResolvedValueOnce([]);
    await expect(adapter.assertAccess(access())).rejects.toMatchObject({ status: 404 });
    await expect(adapter.assertAccess(access({ scope: 'site' }))).rejects.toMatchObject({ status: 404 });
  });
});
