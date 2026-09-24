import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  domainStates,
  keywords,
  rankings,
  serpObservations,
  type RankCheckFailureReason,
  type SerpTopResult,
} from '../../db/schema/index.js';
import type {
  ReportBrandingSnapshot,
  ReportJsonValue,
} from '../../shared/report-exports/index.js';
import type { SerpFeatureSnapshot } from '../../shared/providers/types.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { getSite, type PublicSite } from '../sites/index.js';
import {
  createRankReportExportAdapters,
  rankReportExportTestables as internals,
} from './report-export.adapters.js';

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));

const accountId = 'rank-report-account';
const actorUserId = 'rank-report-user';
const siteId = '507f1f77bcf86cd799439011';
const updatedAt = '2026-08-08T12:00:00.000Z';
const observedAt = new Date(updatedAt);
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast',
  companyName: 'RankMeFast',
  accentColor: '#b5321e',
  logo: null,
};
const site: PublicSite = {
  id: siteId,
  url: 'https://example.test',
  domain: 'example.test',
  displayName: 'Example',
  paused: false,
  pausedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt,
};

beforeAll(async () => {
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
  vi.mocked(getSite).mockReset();
  vi.mocked(getSite).mockImplementation(async (requestedAccount, requestedSite) => {
    if (requestedAccount !== accountId || requestedSite !== siteId) {
      throw Object.assign(new Error('not found'), { status: 404 });
    }
    return site;
  });
});

function access(purpose: 'create' | 'persist' = 'create') {
  return {
    accountId,
    actorUserId,
    purpose,
    target: { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function compose(selection: Record<string, ReportJsonValue>) {
  return {
    accountId,
    actorUserId,
    target: { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
    selection,
    branding,
  };
}

async function insertKeyword(input: {
  phrase: string;
  account?: string;
  site?: string;
  engine?: 'google' | 'bing' | 'youtube' | 'amazon';
  engineTarget?: string | null;
  device?: 'desktop' | 'mobile';
  active?: boolean;
  lastFailedCheckAt?: Date | null;
  lastFailedReason?: RankCheckFailureReason | null;
  updatedAt?: Date;
}) {
  const [row] = await getTestDb().insert(keywords).values({
    accountId: input.account ?? accountId,
    siteId: input.site ?? siteId,
    phrase: input.phrase,
    locationCode: 2840,
    languageCode: 'en',
    device: input.device ?? 'desktop',
    engine: input.engine ?? 'google',
    engineTarget: input.engineTarget ?? null,
    active: input.active ?? true,
    lastFailedCheckAt: input.lastFailedCheckAt ?? null,
    lastFailedReason: input.lastFailedReason ?? null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: input.updatedAt ?? observedAt,
  }).returning();
  if (!row) throw new Error('keyword seed failed');
  return row;
}

async function insertRanking(input: {
  keywordId: string;
  checkedAt: Date;
  position: number | null;
  rankAbsolute?: number | null;
  source?: 'fresh' | 'cache';
  foundUrl?: string | null;
  aiOverviewPresent?: boolean | null;
  aiCited?: boolean | null;
  aiCitedUrl?: string | null;
}) {
  await getTestDb().insert(rankings).values({
    keywordId: input.keywordId,
    checkedAt: input.checkedAt,
    position: input.position,
    rankAbsolute: input.rankAbsolute ?? input.position,
    source: input.source ?? 'fresh',
    foundUrl: input.foundUrl ?? null,
    aiOverviewPresent: input.aiOverviewPresent ?? null,
    aiCited: input.aiCited ?? null,
    aiCitedUrl: input.aiCitedUrl ?? null,
  });
}

async function insertSerp(input: {
  keywordId: string;
  checkedAt: Date;
  source?: 'fresh' | 'cache';
  features?: SerpFeatureSnapshot;
  topResults?: SerpTopResult[];
}) {
  await getTestDb().insert(serpObservations).values({
    accountId,
    siteId,
    keywordId: input.keywordId,
    checkedAt: input.checkedAt,
    source: input.source ?? 'fresh',
    features: input.features ?? { features: [], featuredSnippet: null, paa: [] },
    topResults: input.topResults ?? [],
  });
}

describe('rank report-export helpers and access', () => {
  it('localizes every persisted failure reason without inventing a null cause', () => {
    expect(internals.failureReasonCopy('en', null)).toBeNull();
    for (const reason of ['vendor_auth', 'vendor_quota', 'vendor_timeout', 'vendor_unavailable', 'vendor_malformed', 'vendor_error'] as const) {
      expect(internals.failureReasonCopy('en', reason)).toEqual(expect.any(String));
    }
  });

  it('builds observed and fallback source dates and site labels', () => {
    expect(internals.rankSourceDates('en', [], updatedAt)[0]).toMatchObject({ id: 'rank-state', freshness: 'unknown' });
    expect(internals.rankSourceDates('en', ['2026-08-09T00:00:00.000Z', '2026-08-08T00:00:00.000Z'], updatedAt)[0]).toMatchObject({
      id: 'rank-observation',
      from: '2026-08-08T00:00:00.000Z',
      to: '2026-08-09T00:00:00.000Z',
    });
    const input = {
      kind: 'ranks.current' as const,
      catalogStem: 'ranksCurrent' as const,
      locale: 'en' as const,
      site: { ...site, displayName: '' },
      branding,
      selection: [],
      sourceDates: [],
      representedItems: 0,
      blocks: [],
    };
    expect(internals.baseRankDocument(input).subject[0]?.value).toBe(site.domain);
    expect(internals.baseRankDocument({ ...input, site }).subject[0]?.value).toBe(site.displayName);
  });

  it('versions empty and populated stores and enforces access/source immutability', async () => {
    const emptyVersion = await internals.rankSiteVersion(getTestDb(), accountId, siteId);
    expect(emptyVersion).toMatch(/^ranks:[a-f0-9]{64}$/u);
    const keyword = await insertKeyword({ phrase: 'alpha' });
    await insertRanking({ keywordId: keyword.id, checkedAt: observedAt, position: 5 });
    await insertSerp({ keywordId: keyword.id, checkedAt: observedAt });
    expect(await internals.rankSiteVersion(getTestDb(), accountId, siteId)).not.toBe(emptyVersion);

    await expect(internals.assertRankAccess(getTestDb(), { ...access(), target: { scope: 'account_resource' as const, resourceId: keyword.id } })).rejects.toMatchObject({ status: 404 });
    await expect(internals.assertRankAccess(getTestDb(), { ...access('persist'), sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(internals.assertRankAccess(getTestDb(), access())).resolves.toBeUndefined();
  });
});

describe('current rank report adapter', () => {
  it('filters rows and keeps only two latest observations per keyword', async () => {
    const [adapter] = createRankReportExportAdapters(getTestDb());
    await getTestDb().insert(domainStates).values({ siteId, cadence: 'daily' });
    const alpha = await insertKeyword({ phrase: 'alpha', engine: 'youtube', engineTarget: 'channel', device: 'mobile' });
    const beta = await insertKeyword({ phrase: 'beta', lastFailedCheckAt: observedAt, lastFailedReason: 'vendor_timeout' });
    await insertKeyword({ phrase: 'inactive', active: false });
    await insertKeyword({ phrase: 'foreign', account: 'foreign', site: 'foreign-site' });
    await insertRanking({ keywordId: alpha.id, checkedAt: new Date('2026-08-06T00:00:00Z'), position: 12 });
    await insertRanking({ keywordId: alpha.id, checkedAt: new Date('2026-08-07T00:00:00Z'), position: 9 });
    await insertRanking({ keywordId: alpha.id, checkedAt: observedAt, position: 5, foundUrl: 'https://youtube.test/watch', aiOverviewPresent: true, aiCited: true, aiCitedUrl: 'https://example.test/cited' });
    await insertRanking({ keywordId: beta.id, checkedAt: observedAt, position: null, source: 'cache' });

    const direct = await internals.readCurrentRows(getTestDb(), accountId, siteId, { active: true });
    expect(direct.find((row) => row.id === alpha.id)?.observations).toHaveLength(2);
    expect(await internals.readCurrentRows(getTestDb(), accountId, siteId, { active: true, engine: 'youtube', device: 'mobile', locationCode: 2840, languageCode: 'en' })).toHaveLength(1);
    expect(await internals.readCurrentRows(getTestDb(), accountId, 'empty-site', { active: true })).toEqual([]);

    const result = await adapter?.compose(compose({ active: true }));
    expect(result?.document.completeness.selectedItems).toBe(2);
    const table = result?.document.blocks[0];
    expect(table).toMatchObject({ type: 'table' });
    const renderedTable = JSON.stringify(result?.document.blocks).toLowerCase();
    expect(renderedTable).toContain('did not arrive in time');
    expect(renderedTable).toContain('observed');
    expect(renderedTable).toContain('not ranked');
  });

  it('represents unavailable keywords, selection fallbacks, rendering, and invalid scope', async () => {
    const [adapter] = createRankReportExportAdapters(getTestDb());
    await insertKeyword({ phrase: 'never-observed', lastFailedCheckAt: observedAt, lastFailedReason: null });
    const result = await adapter?.compose(compose({ active: true }));
    expect(JSON.stringify(result?.document.blocks[0]).toLowerCase()).toContain('unavailable');
    if (!adapter || !result) throw new Error('current adapter unavailable');
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: updatedAt })).resolves.toMatchObject({ format });
    }
    await expect(adapter.render({ document: result.document, format: 'txt', snapshotCreatedAt: updatedAt })).rejects.toThrow('report output failed validation');
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    const noRows = await adapter.compose(compose({ active: false }));
    expect(noRows.document.completeness.selectedItems).toBe(0);
    await expect(internals.renderCurrentRankDocument({
      document: { ...result.document, blocks: [] },
      format: 'pdf',
      snapshotCreatedAt: updatedAt,
    })).resolves.toMatchObject({ format: 'pdf' });
    await expect(adapter.compose({ ...compose({ active: true }), target: { scope: 'account_resource' as const, resourceId: randomUUID() } })).rejects.toMatchObject({ status: 404 });
    expect(adapter.selectionSchema.parse({})).toEqual({ active: true });
    expect(adapter.selectionSchema.safeParse({ engine: 'invalid' }).success).toBe(false);
  });

  it('rejects a source mutation during composition', async () => {
    const [adapter] = createRankReportExportAdapters(getTestDb());
    const keyword = await insertKeyword({ phrase: 'changing' });
    let calls = 0;
    vi.mocked(getSite).mockImplementation(async () => {
      calls += 1;
      if (calls === 2) {
        await getTestDb().update(keywords).set({ updatedAt: new Date(observedAt.getTime() + 1_000) }).where(eq(keywords.id, keyword.id));
      }
      return site;
    });
    await expect(adapter?.compose(compose({ active: true }))).rejects.toMatchObject({ status: 409 });
  });
});

describe('rank history report adapter', () => {
  it('checks keyword ownership before engine filters', async () => {
    const [, adapter] = createRankReportExportAdapters(getTestDb());
    const owned = await insertKeyword({ phrase: 'owned', engine: 'google' });
    const foreign = await insertKeyword({ phrase: 'foreign', account: 'foreign', site: 'foreign-site' });
    await expect(internals.readHistoryRows(getTestDb(), accountId, siteId, { keywordIds: [owned.id, foreign.id] })).rejects.toMatchObject({ status: 404 });
    await expect(internals.readHistoryRows(getTestDb(), accountId, siteId, { keywordIds: [owned.id], engine: 'bing' })).resolves.toEqual({ keywords: [], rows: [] });
    await expect(adapter?.compose({ ...compose({ keywordIds: [owned.id] }), target: { scope: 'account_resource' as const, resourceId: owned.id } })).rejects.toMatchObject({ status: 404 });
  });

  it('composes bounded ranked and not-ranked history rows', async () => {
    const [, adapter] = createRankReportExportAdapters(getTestDb());
    const alpha = await insertKeyword({ phrase: 'alpha' });
    const beta = await insertKeyword({ phrase: 'beta', device: 'mobile' });
    await insertRanking({ keywordId: alpha.id, checkedAt: new Date('2026-08-07T00:00:00Z'), position: 7, rankAbsolute: 8, foundUrl: 'https://example.test/a' });
    await insertRanking({ keywordId: beta.id, checkedAt: observedAt, position: null, rankAbsolute: null });
    await insertRanking({ keywordId: alpha.id, checkedAt: new Date('2026-08-09T00:00:00Z'), position: 3 });
    expect((await internals.readHistoryRows(getTestDb(), accountId, siteId, { keywordIds: [alpha.id, beta.id] })).rows).toHaveLength(3);
    const result = await adapter?.compose(compose({
      keywordIds: [alpha.id, beta.id],
      from: '2026-08-07T00:00:00.000Z',
      to: '2026-08-08T12:00:00.000Z',
      engine: 'google',
    }));
    expect(result?.document.completeness.selectedItems).toBe(2);
    expect(JSON.stringify(result?.document.blocks[0]).toLowerCase()).toContain('not ranked');
    expect(result?.document.sourceDates[0]?.id).toBe('rank-observation');
  });

  it('represents an empty retained window and validates date order', async () => {
    const [, adapter] = createRankReportExportAdapters(getTestDb());
    const keyword = await insertKeyword({ phrase: 'empty' });
    const result = await adapter?.compose(compose({ keywordIds: [keyword.id], from: updatedAt }));
    expect(result?.document.blocks[0]).toMatchObject({ type: 'state', state: 'empty' });
    expect(result?.document.sourceDates[0]?.id).toBe('rank-state');
    if (!adapter || !result) throw new Error('history adapter unavailable');
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: updatedAt })).resolves.toMatchObject({ format });
    }
    await expect(adapter.render({ document: result.document, format: 'txt', snapshotCreatedAt: updatedAt })).rejects.toThrow('report output failed validation');
    const withoutWindow = await adapter.compose(compose({ keywordIds: [keyword.id] }));
    expect(withoutWindow.document.selection).toEqual(expect.any(Array));
    expect(adapter?.selectionSchema.safeParse({ keywordIds: [keyword.id], from: '2026-08-09T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z' }).success).toBe(false);
    expect(adapter?.selectionSchema.safeParse({ keywordIds: [keyword.id], from: '2026-08-08T00:00:00.000Z', to: '2026-08-09T00:00:00.000Z' }).success).toBe(true);
  });

  it('rejects a source mutation during history composition', async () => {
    const [, adapter] = createRankReportExportAdapters(getTestDb());
    const keyword = await insertKeyword({ phrase: 'changing-history' });
    let calls = 0;
    vi.mocked(getSite).mockImplementation(async () => {
      calls += 1;
      if (calls === 2) await getTestDb().update(keywords).set({ updatedAt: new Date(observedAt.getTime() + 1_000) }).where(eq(keywords.id, keyword.id));
      return site;
    });
    await expect(adapter?.compose(compose({ keywordIds: [keyword.id] }))).rejects.toMatchObject({ status: 409 });
  });
});

describe('SERP feature report adapter', () => {
  it('enforces explicit keyword ownership and handles no matching keywords', async () => {
    const [, , adapter] = createRankReportExportAdapters(getTestDb());
    const owned = await insertKeyword({ phrase: 'owned' });
    const foreign = await insertKeyword({ phrase: 'foreign', account: 'foreign', site: 'foreign-site' });
    await expect(internals.readSerpRows(getTestDb(), accountId, siteId, { keywordIds: [owned.id, foreign.id], latest: true })).rejects.toMatchObject({ status: 404 });
    await expect(internals.readSerpRows(getTestDb(), accountId, 'empty-site', { latest: true })).resolves.toEqual({ keywords: [], observations: [] });
    await expect(adapter?.compose({ ...compose({ latest: true }), target: { scope: 'account_resource' as const, resourceId: owned.id } })).rejects.toMatchObject({ status: 404 });
  });

  it('composes latest observations plus PAA and top-result evidence', async () => {
    const [, , adapter] = createRankReportExportAdapters(getTestDb());
    const alpha = await insertKeyword({ phrase: 'alpha' });
    const beta = await insertKeyword({ phrase: 'beta', device: 'mobile' });
    await insertKeyword({ phrase: 'inactive', active: false });
    await insertSerp({ keywordId: alpha.id, checkedAt: new Date('2026-08-07T00:00:00Z') });
    await insertSerp({
      keywordId: alpha.id,
      checkedAt: observedAt,
      features: {
        features: [{ type: 'people_also_ask', rankAbsolute: 2 }, { type: 'featured_snippet', rankAbsolute: 1 }],
        featuredSnippet: { domain: 'answer.test', url: 'https://answer.test/a', title: 'Answer' },
        paa: [
          { question: 'Zulu?', answerDomain: null, answerUrl: null },
          { question: 'Alpha?', answerDomain: 'answer.test', answerUrl: 'https://answer.test/a' },
        ],
      },
      topResults: [
        { domain: 'b.test', url: 'https://b.test/z', rankGroup: 1, rankAbsolute: 2 },
        { domain: 'a.test', url: 'https://a.test/b', rankGroup: 1, rankAbsolute: 1 },
        { domain: 'a.test', url: 'https://a.test/a', rankGroup: 1, rankAbsolute: 1 },
      ],
    });
    const result = await adapter?.compose(compose({ latest: true }));
    expect(result?.document.completeness.selectedItems).toBe(7);
    expect(result?.document.blocks.map((block) => block.id)).toEqual(['serp-observations', 'serp-paa', 'serp-top-results', 'serp-source-note']);
    expect(JSON.stringify(result?.document.blocks[0])).toContain(beta.phrase);
    if (!adapter || !result) throw new Error('SERP adapter unavailable');
    await expect(adapter.assertAccess(access())).resolves.toBeUndefined();
    for (const format of adapter.supportedFormats) {
      await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: updatedAt })).resolves.toMatchObject({ format });
    }
    const table = result.document.blocks.find((block) => block.type === 'table');
    if (!table || table.type !== 'table' || !table.rows[0]) throw new Error('SERP table unavailable');
    const { id: originalRowId, ...rowWithoutId } = table.rows[0];
    expect(originalRowId).toBeTruthy();
    const fallbackCsv = await internals.renderSerpRankDocument({
      document: {
        ...result.document,
        blocks: [{ ...table, rows: [rowWithoutId] }],
      },
      format: 'csv',
      snapshotCreatedAt: updatedAt,
    });
    expect(Buffer.from(fallbackCsv.bytes).toString('utf8')).toContain(`${table.id}-row-1`);
    await expect(adapter.render({ document: result.document, format: 'txt', snapshotCreatedAt: updatedAt })).rejects.toThrow('report output failed validation');
  });

  it('composes all bounded observations and every optional filter', async () => {
    const [, , adapter] = createRankReportExportAdapters(getTestDb());
    const alpha = await insertKeyword({ phrase: 'alpha' });
    await insertSerp({ keywordId: alpha.id, checkedAt: new Date('2026-08-07T00:00:00Z') });
    await insertSerp({ keywordId: alpha.id, checkedAt: observedAt, source: 'cache' });
    const direct = await internals.readSerpRows(getTestDb(), accountId, siteId, {
      keywordIds: [alpha.id], latest: false, engine: 'google', device: 'desktop',
      from: '2026-08-07T00:00:00.000Z', to: updatedAt,
    });
    expect(direct.observations).toHaveLength(2);
    expect((await internals.readSerpRows(getTestDb(), accountId, siteId, { latest: false })).observations).toHaveLength(2);
    const result = await adapter?.compose(compose({ keywordIds: [alpha.id], latest: false, from: '2026-08-07T00:00:00.000Z', to: updatedAt, engine: 'google', device: 'desktop' }));
    expect(result?.document.completeness.selectedItems).toBe(2);
    expect(result?.document.blocks).toHaveLength(2);
    const withoutWindow = await adapter?.compose(compose({ latest: false }));
    expect(withoutWindow?.document.completeness.selectedItems).toBe(2);
  });

  it('validates selections, renders empty state, and rejects a source mutation', async () => {
    const [, , adapter] = createRankReportExportAdapters(getTestDb());
    const keyword = await insertKeyword({ phrase: 'empty' });
    const result = await adapter?.compose(compose({ keywordIds: [keyword.id], latest: true }));
    expect(result?.document.completeness.selectedItems).toBe(1);
    expect(adapter?.selectionSchema.parse({})).toEqual({ latest: true });
    expect(adapter?.selectionSchema.safeParse({ latest: true, from: '2026-08-09T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z' }).success).toBe(false);
    expect(adapter?.selectionSchema.safeParse({ latest: true, from: '2026-08-08T00:00:00.000Z', to: '2026-08-09T00:00:00.000Z' }).success).toBe(true);

    expect(internals.compareSerpObservationRows(
      { keyword: { phrase: 'same' }, observation: null },
      { keyword: { phrase: 'same' }, observation: { checkedAt: observedAt } },
    )).toBeLessThan(0);
    expect(internals.compareSerpObservationRows(
      { keyword: { phrase: 'same' }, observation: { checkedAt: observedAt } },
      { keyword: { phrase: 'same' }, observation: null },
    )).toBeGreaterThan(0);

    let calls = 0;
    vi.mocked(getSite).mockImplementation(async () => {
      calls += 1;
      if (calls === 2) await getTestDb().update(keywords).set({ updatedAt: new Date(observedAt.getTime() + 1_000) }).where(eq(keywords.id, keyword.id));
      return site;
    });
    await expect(adapter?.compose(compose({ latest: true }))).rejects.toMatchObject({ status: 409 });
  });
});
