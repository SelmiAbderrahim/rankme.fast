import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../db/client.js';
import { backlinkSnapshots, vendorResponses } from '../../db/schema/index.js';
import {
  renderReportPdf,
  type ReportBrandingSnapshot,
  type ReportJsonValue,
} from '../../shared/report-exports/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { getSite, type PublicSite } from '../sites/index.js';
import { getBacklinkDeepRun } from './backlink-deep.service.js';
import { getLinkGapRun } from './link-gap.service.js';
import {
  backlinkReportExportTestables as internals,
  createBacklinkReportExportAdapters,
} from './report-export.adapters.js';
import { buildToxicityDisavow, getToxicityReview } from './toxicity-review.service.js';
import { classifyToxicity } from './toxicity-rubric.js';

vi.mock('../sites/index.js', () => ({ getSite: vi.fn() }));
vi.mock('./backlink-deep.service.js', () => ({ getBacklinkDeepRun: vi.fn() }));
vi.mock('./link-gap.service.js', () => ({ getLinkGapRun: vi.fn() }));
vi.mock('./toxicity-review.service.js', () => ({
  getToxicityReview: vi.fn(),
  buildToxicityDisavow: vi.fn(),
}));

const accountId = 'backlink-report-account';
const actorUserId = 'backlink-report-user';
const siteId = '507f1f77bcf86cd799439011';
const runId = '507f1f77bcf86cd799439012';
const observedAt = new Date('2026-08-08T12:00:00.000Z');
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
  updatedAt: observedAt.toISOString(),
};

/** PGlite and postgres-js share Drizzle's query surface; this is the test-driver boundary. */
function database(): Db {
  return getTestDb() as unknown as Db;
}

beforeAll(async () => {
  await startTestPostgres();
});

afterAll(async () => {
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
  vi.mocked(getSite).mockReset();
  vi.mocked(getBacklinkDeepRun).mockReset();
  vi.mocked(getLinkGapRun).mockReset();
  vi.mocked(getToxicityReview).mockReset();
  vi.mocked(buildToxicityDisavow).mockReset();
  vi.mocked(getSite).mockResolvedValue(site);
});

function siteAccess(purpose: 'create' | 'persist' = 'create') {
  return {
    accountId,
    actorUserId,
    purpose,
    target: { scope: 'site' as const, siteId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function runAccess(purpose: 'create' | 'persist' = 'create') {
  return {
    accountId,
    actorUserId,
    purpose,
    target: { scope: 'site_resource' as const, siteId, resourceId: runId },
    format: 'json' as const,
    locale: 'en' as const,
  };
}

function siteCompose(selection: Record<string, ReportJsonValue> = {}) {
  return { ...siteAccess(), selection, branding };
}

function runCompose(selection: Record<string, ReportJsonValue> = {}) {
  return { ...runAccess(), selection, branding };
}

function deepRun(input: {
  site?: string;
  type?: 'refDomains' | 'anchors' | 'history' | 'bulkRanks';
  result?: Awaited<ReturnType<typeof getBacklinkDeepRun>>['result'];
  completedAt?: string | null;
}) {
  return {
    runId,
    siteId: input.site ?? siteId,
    type: input.type ?? 'refDomains',
    domain: 'example.test',
    inputs: { limit: 10, domains: [] },
    status: 'succeeded' as const,
    retainedCount: input.result?.rows.length ?? 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    completedAt: input.completedAt === undefined ? '2026-08-08T00:00:00.000Z' : input.completedAt,
    result: input.result ?? null,
  } satisfies Awaited<ReturnType<typeof getBacklinkDeepRun>>;
}

function gapRun(input: { site?: string; completedAt?: string | null } = {}) {
  return {
    runId,
    siteId: input.site ?? siteId,
    ownDomain: 'example.test',
    competitors: ['beta.test', 'alpha.test'],
    status: 'succeeded' as const,
    perLegOutcomes: [
      { competitor: 'beta.test', status: 'failed' as const, retainedCount: 0 },
      { competitor: 'alpha.test', status: 'ok' as const, retainedCount: 1 },
    ],
    createdAt: '2026-08-01T00:00:00.000Z',
    completedAt: input.completedAt === undefined ? '2026-08-08T00:00:00.000Z' : input.completedAt,
    legs: [
      { competitor: 'beta.test', status: 'failed' as const, retainedCount: 0, result: null },
      {
        competitor: 'alpha.test', status: 'ok' as const, retainedCount: 1,
        result: {
          rows: [{ domain: 'link.test', intersections: 3, rank: 40, firstSeen: null }],
          overlap: { totalUnique: 1, exclusiveToCompetitor: 1, exclusivePct: 100 },
          observation: { capturedAt: observedAt.toISOString(), source: 'provider_observation' as const },
        },
      },
    ],
  } satisfies Awaited<ReturnType<typeof getLinkGapRun>>;
}

function toxicityRun(input: { site?: string; completedAt?: string | null; rows?: Awaited<ReturnType<typeof getToxicityReview>>['rows'] } = {}) {
  return {
    runId,
    siteId: input.site ?? siteId,
    domain: 'example.test',
    status: 'succeeded' as const,
    rubricVersion: 'toxicity-rubric-v1',
    sourceKind: 'provider_observation' as const,
    retainedCount: input.rows?.length ?? 0,
    bulkDomainCount: 1,
    providerStatus: 'succeeded' as const,
    aiStatus: 'succeeded' as const,
    failureKind: null,
    estimatedCostMicros: 100,
    createdAt: '2026-08-01T00:00:00.000Z',
    completedAt: input.completedAt === undefined ? '2026-08-08T00:00:00.000Z' : input.completedAt,
    rows: input.rows ?? [],
  } satisfies Awaited<ReturnType<typeof getToxicityReview>>;
}

function toxicityRow(input: {
  domain: string;
  url: string;
  spamScore: number;
  rationale?: string | null;
  lastSeen?: string | null;
  dofollow?: boolean | null;
  isBroken?: boolean | null;
}) {
  const dofollow = input.dofollow ?? true;
  const isBroken = input.isBroken ?? false;
  const rubric = classifyToxicity({ spamScore: input.spamScore, dofollow, isBroken });
  return {
    id: randomUUID(),
    url: input.url,
    domain: input.domain,
    spamScore: input.spamScore,
    band: rubric.band,
    signals: rubric.signals,
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: input.lastSeen ?? null,
    dofollow,
    isBroken,
    capturedAt: observedAt.toISOString(),
    rubricVersion: rubric.rubricVersion,
    sourceKind: 'provider_observation' as const,
    rationale: {
      status: input.rationale ? 'annotated' as const : 'not_requested' as const,
      text: input.rationale ?? null,
      citedRowId: input.rationale ? 'cited-row' : null,
      rubricVersion: rubric.rubricVersion,
      sourceKind: 'provider_observation' as const,
    },
  };
}

describe('backlink report-export helpers', () => {
  it('normalizes defensive values and validates source target shapes', () => {
    expect(internals.record({ a: 1 })).toEqual({ a: 1 });
    expect(internals.record(null)).toBeNull();
    expect(internals.record([])).toBeNull();
    expect(internals.record('bad')).toBeNull();
    expect(internals.textValue('text')).toBe('text');
    expect(internals.textValue(1)).toBeNull();
    expect(internals.boolValue(true)).toBe(true);
    expect(internals.boolValue('true')).toBeNull();
    expect(() => internals.assertSiteTarget({ scope: 'account_resource', resourceId: runId })).toThrow();
    expect(() => internals.assertSiteTarget({ scope: 'site', siteId })).not.toThrow();
    expect(() => internals.assertRunTarget({ scope: 'site', siteId })).toThrow();
    expect(() => internals.assertRunTarget({ scope: 'site_resource', siteId, resourceId: runId })).not.toThrow();
  });

  it('bounds, sorts, and serializes selection labels', () => {
    const values = internals.selectionItems('en', {
      zeta: undefined,
      alpha: ['a', 'b'],
      hugeArray: Array.from({ length: 500 }, () => 'long'),
      hugeScalar: 'x'.repeat(901),
    });
    expect(values.map((item) => item.label)).toHaveLength(4);
    expect(values[0]?.value).toContain('a');
    expect(values[1]?.value).toMatch(/^500; selection:/u);
    expect(values[2]?.value).toMatch(/^1; selection:/u);
    expect(internals.tableColumns('en')).toHaveLength(8);
    const row = (capturedAt: string, urlFrom: string, urlTo: string, archiveIndex: number) => ({ capturedAt, urlFrom, urlTo, archiveIndex });
    expect(internals.compareInventoryRows(row('1', 'a', 'a', 0), row('2', 'a', 'a', 0))).toBeLessThan(0);
    expect(internals.compareInventoryRows(row('1', 'a', 'a', 0), row('1', 'b', 'a', 0))).toBeLessThan(0);
    expect(internals.compareInventoryRows(row('1', 'a', 'a', 0), row('1', 'a', 'b', 0))).toBeLessThan(0);
    expect(internals.compareInventoryRows(row('1', 'a', 'a', 0), row('1', 'a', 'a', 1))).toBeLessThan(0);
  });

  it('builds default and overridden canonical documents', () => {
    const input = {
      kind: 'backlinks.summary' as const,
      stem: 'backlinksSummary',
      locale: 'en' as const,
      branding,
      subject: site.domain,
      selection: {},
      sourceDates: [],
      rows: [],
      notes: [],
    };
    expect(internals.baseDocument(input)).toMatchObject({ blocks: [{ type: 'table' }], artifacts: [] });
    expect(internals.baseDocument({ ...input, blocks: [], artifacts: [] })).toMatchObject({ blocks: [], artifacts: [] });
  });
});

describe('backlink summary report adapter', () => {
  it('loads the latest owned summary and handles missing and changed sources', async () => {
    const [adapter] = createBacklinkReportExportAdapters(database());
    await expect(internals.latestSummary(database(), accountId, siteId)).rejects.toMatchObject({ status: 404 });
    await getTestDb().insert(backlinkSnapshots).values([
      { accountId, siteId, domainRating: 10, backlinks: 1, referringDomains: 1, brokenBacklinks: 0, fetchedAt: new Date('2026-08-07T00:00:00Z') },
      { accountId, siteId, domainRating: null, backlinks: 20, referringDomains: 5, brokenBacklinks: 2, fetchedAt: observedAt },
      { accountId: 'foreign', siteId, backlinks: 99, referringDomains: 99, brokenBacklinks: 99, fetchedAt: new Date('2026-08-09T00:00:00Z') },
    ]);
    expect((await internals.latestSummary(database(), accountId, siteId)).backlinks).toBe(20);
    await expect(adapter?.assertAccess({ ...siteAccess('persist'), sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter?.assertAccess(siteAccess())).resolves.toBeUndefined();
    await expect(adapter?.assertAccess({ ...siteAccess(), target: { scope: 'account_resource' as const, resourceId: runId } })).rejects.toMatchObject({ status: 404 });
  });

  it('composes and renders null-safe summary metrics', async () => {
    const [adapter] = createBacklinkReportExportAdapters(database());
    await getTestDb().insert(backlinkSnapshots).values({ accountId, siteId, domainRating: null, backlinks: 20, referringDomains: 5, brokenBacklinks: 2, fetchedAt: observedAt });
    vi.mocked(getSite).mockResolvedValue({ ...site, displayName: '' });
    const result = await adapter?.compose(siteCompose());
    expect(result?.document.completeness.selectedItems).toBe(4);
    expect(result?.document.subject[0]?.value).toBe(site.domain);
    if (!adapter || !result) throw new Error('summary adapter unavailable');
    for (const format of adapter.supportedFormats) await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: observedAt.toISOString() })).resolves.toMatchObject({ format });
    expect(adapter.selectionSchema.safeParse({ extra: true }).success).toBe(false);
  });
});

describe('backlink inventory report adapter', () => {
  async function addArchive(input: { params: unknown; payload: unknown; fetchedAt: Date }) {
    await getTestDb().insert(vendorResponses).values({
      capability: 'backlink', operation: 'list-page', cacheKey: randomUUID(),
      params: input.params, payload: input.payload, fetchedAt: input.fetchedAt,
    });
  }

  it('filters archive ownership, windows, row flags, and malformed payloads', async () => {
    await addArchive({ params: {}, payload: {}, fetchedAt: observedAt });
    await addArchive({ params: { domain: 'foreign.test' }, payload: { rows: [] }, fetchedAt: observedAt });
    await addArchive({ params: { domain: 'EXAMPLE.TEST' }, payload: { rows: 'bad' }, fetchedAt: observedAt });
    await addArchive({ params: { domain: 'example.test' }, payload: { rows: [null, { domainFrom: 'alpha.test', urlFrom: 'https://alpha.test/b', urlTo: 'https://example.test/b', dofollow: true, isBroken: false }, { domainFrom: 'beta.test', urlFrom: 'https://beta.test/a', urlTo: 'https://example.test/a', dofollow: false, isBroken: true }] }, fetchedAt: observedAt });
    await addArchive({ params: { domain: 'example.test' }, payload: { rows: [{ domainFrom: 'alpha.test', urlFrom: 'https://alpha.test/a', urlTo: 'https://example.test/a', dofollow: true, isBroken: false }] }, fetchedAt: new Date('2026-08-07T00:00:00Z') });
    await addArchive({ params: { domain: 'example.test' }, payload: { rows: [] }, fetchedAt: new Date('2026-08-09T00:00:00Z') });

    expect(await internals.inventoryArchive(database(), site.domain, { from: '2026-08-07T12:00:00.000Z', to: '2026-08-08T12:00:00.000Z', domain: 'alpha.test', dofollow: true, broken: false })).toHaveLength(1);
    expect(await internals.inventoryArchive(database(), site.domain, { domain: 'missing.test' })).toEqual([]);
    expect(await internals.inventoryArchive(database(), site.domain, { dofollow: false, broken: false })).toEqual([]);
  });

  it('composes populated and empty archives, source conflicts, and all formats', async () => {
    const [, adapter] = createBacklinkReportExportAdapters(database());
    await addArchive({ params: { domain: 'example.test' }, payload: { rows: [{ domainFrom: null, urlFrom: null, urlTo: null, anchor: null, dofollow: null, isBroken: null, backlinkSpamScore: null, urlToSpamScore: null, firstSeen: null, lastSeen: null }] }, fetchedAt: observedAt });
    await expect(adapter?.assertAccess({ ...siteAccess('persist'), sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter?.assertAccess(siteAccess())).resolves.toBeUndefined();
    const result = await adapter?.compose(siteCompose({ domain: 'none.test' }));
    expect(result?.document.completeness.selectedItems).toBe(0);
    const populated = await adapter?.compose(siteCompose());
    expect(populated?.document.completeness.selectedItems).toBe(1);
    if (!adapter || !populated) throw new Error('inventory adapter unavailable');
    for (const format of adapter.supportedFormats) await expect(adapter.render({ document: populated.document, format, snapshotCreatedAt: observedAt.toISOString() })).resolves.toMatchObject({ format });
    vi.mocked(getSite).mockResolvedValue({ ...site, displayName: '' });
    expect((await adapter.compose(siteCompose())).document.subject[0]?.value).toBe(site.domain);
    expect(adapter.selectionSchema.safeParse({ from: '2026-08-09T00:00:00.000Z', to: '2026-08-08T00:00:00.000Z' }).success).toBe(false);
    expect(adapter.selectionSchema.safeParse({ from: '2026-08-08T00:00:00.000Z', to: '2026-08-09T00:00:00.000Z' }).success).toBe(true);
  });
});

describe('deep backlink report adapter', () => {
  it('shapes every deep result kind and empty results', () => {
    expect(internals.deepRows(deepRun({}))).toEqual([]);
    const captured = { capturedAt: observedAt.toISOString(), source: 'provider_observation' as const };
    expect(internals.deepRows(deepRun({ type: 'refDomains', result: { rows: [{ domain: 'ref.test', backlinks: 5, domainRank: 20, firstSeen: observedAt.toISOString(), lastSeen: null }], observation: captured } }))[0]?.values).toContain('ref.test');
    expect(internals.deepRows(deepRun({ type: 'anchors', result: { rows: [{ anchor: 'anchor', backlinks: 4, referringDomains: 2 }], observation: captured } }))[0]?.values).toContain('anchor');
    expect(internals.deepRows(deepRun({ type: 'history', result: { rows: [{ year: 2026, month: 8, backlinks: 3, referringDomains: 2 }], observation: captured } }))[0]?.values).toContain('2026-08');
    expect(internals.deepRows(deepRun({ type: 'bulkRanks', result: { rows: [{ domain: 'bulk.test', rank: 55 }], observation: captured } }))[0]?.values).toContain('55');
    expect(internals.deepRows(deepRun({ type: 'bulkRanks', result: { rows: [{ domain: 'bulk.test', rank: null }], observation: captured } }))[0]?.values).toContain('');
  });

  it('enforces run/site/operation/source and composes date fallbacks', async () => {
    const [, , adapter] = createBacklinkReportExportAdapters(database());
    const run = deepRun({ completedAt: null });
    vi.mocked(getBacklinkDeepRun).mockResolvedValue(run);
    await expect(adapter?.assertAccess({ ...runAccess(), target: { scope: 'site' as const, siteId } })).rejects.toMatchObject({ status: 404 });
    await expect(adapter?.assertAccess({ ...runAccess(), target: { scope: 'site_resource' as const, siteId: 'foreign', resourceId: runId } })).rejects.toMatchObject({ status: 404 });
    await expect(adapter?.assertAccess({ ...runAccess('persist'), sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter?.assertAccess(runAccess())).resolves.toBeUndefined();
    await expect(adapter?.compose(runCompose({ operation: 'anchors' }))).rejects.toMatchObject({ status: 404 });
    vi.mocked(getBacklinkDeepRun).mockResolvedValue(deepRun({ site: 'foreign' }));
    await expect(adapter?.compose(runCompose())).rejects.toMatchObject({ status: 404 });
    vi.mocked(getBacklinkDeepRun).mockResolvedValue(run);
    vi.mocked(getSite).mockResolvedValue({ ...site, displayName: '' });
    const result = await adapter?.compose(runCompose());
    expect(result?.document.sourceDates[0]).toMatchObject({ observedAt: '2026-08-01T00:00:00.000Z' });
    if (!adapter || !result) throw new Error('deep adapter unavailable');
    for (const format of adapter.supportedFormats) await expect(adapter.render({ document: result.document, format, snapshotCreatedAt: observedAt.toISOString() })).resolves.toMatchObject({ format });
  });
});

describe('link gap report adapter', () => {
  it('enforces source/site and represents retained plus unavailable legs', async () => {
    const [, , , adapter] = createBacklinkReportExportAdapters(database());
    vi.mocked(getLinkGapRun).mockResolvedValue(gapRun());
    await expect(adapter?.assertAccess({ ...runAccess(), target: { scope: 'site_resource' as const, siteId: 'foreign', resourceId: runId } })).rejects.toMatchObject({ status: 404 });
    await expect(adapter?.assertAccess({ ...runAccess('persist'), sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter?.assertAccess(runAccess())).resolves.toBeUndefined();
    vi.mocked(getLinkGapRun).mockResolvedValue(gapRun({ site: 'foreign' }));
    await expect(adapter?.compose(runCompose())).rejects.toMatchObject({ status: 404 });
    vi.mocked(getLinkGapRun).mockResolvedValue(gapRun());
    vi.mocked(getSite).mockResolvedValue({ ...site, displayName: '' });
    const all = await adapter?.compose(runCompose());
    expect(all?.document.completeness.selectedItems).toBe(2);
    expect(JSON.stringify(all?.document.blocks[0])).toContain('gap-unavailable');
    expect((await adapter?.compose(runCompose({ competitor: 'alpha.test', legStatus: 'ok' })))?.document.completeness.selectedItems).toBe(1);
    expect((await adapter?.compose(runCompose({ competitor: 'missing.test' })))?.document.completeness.selectedItems).toBe(0);
    if (!adapter || !all) throw new Error('gap adapter unavailable');
    await renderReportPdf({ document: all.document, snapshotCreatedAt: observedAt.toISOString() });
    for (const format of adapter.supportedFormats) await expect(adapter.render({ document: all.document, format, snapshotCreatedAt: observedAt.toISOString() }), `gap ${format}`).resolves.toMatchObject({ format });
  });

  it('falls back from completed to created dates when every leg is unavailable', async () => {
    const [, , , adapter] = createBacklinkReportExportAdapters(database());
    const run = gapRun({ completedAt: null });
    run.legs = run.legs.filter((leg) => leg.result === null);
    vi.mocked(getLinkGapRun).mockResolvedValue(run);
    const result = await adapter?.compose(runCompose());
    expect(result?.document.sourceDates.map((date) => date.observedAt)).toEqual(['2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z']);
  });
});

describe('toxicity and disavow report adapters', () => {
  it('filters toxicity rows, covers rationale/date/sort fallbacks, and versions the full run', async () => {
    const [, , , , adapter] = createBacklinkReportExportAdapters(database());
    const rows = [
      toxicityRow({ domain: 'same.test', url: 'https://same.test/b', spamScore: 80, rationale: 'Generated explanation', lastSeen: observedAt.toISOString(), dofollow: true, isBroken: false }),
      toxicityRow({ domain: 'same.test', url: 'https://same.test/a', spamScore: 80, rationale: null, dofollow: false, isBroken: true }),
      toxicityRow({ domain: 'low.test', url: 'https://low.test/a', spamScore: 10, rationale: null }),
    ];
    const full = toxicityRun({ rows });
    const banded = toxicityRun({ rows: rows.filter((row) => row.band === 'toxic') });
    vi.mocked(getToxicityReview).mockImplementation(async (_account, _run, query) => query.band ? banded : full);
    await expect(adapter?.assertAccess({ ...runAccess('persist'), sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter?.assertAccess(runAccess())).resolves.toBeUndefined();
    const result = await adapter?.compose(runCompose({ band: 'toxic', signal: 'spam_toxic', dofollow: true, broken: false }));
    expect(result?.document.completeness.selectedItems).toBe(1);
    expect(vi.mocked(getToxicityReview)).toHaveBeenCalledTimes(4);
    const all = await adapter?.compose(runCompose());
    expect(all?.document.completeness.selectedItems).toBe(3);
    if (!adapter || !all) throw new Error('toxicity adapter unavailable');
    for (const format of adapter.supportedFormats) await expect(adapter.render({ document: all.document, format, snapshotCreatedAt: observedAt.toISOString() }), `toxicity ${format}`).resolves.toMatchObject({ format });
    vi.mocked(getSite).mockResolvedValue({ ...site, displayName: '' });
    expect((await adapter.compose(runCompose())).document.subject[0]?.value).toBe(site.domain);
  });

  it('enforces toxicity site ownership and empty created-date fallbacks', async () => {
    const [, , , , adapter] = createBacklinkReportExportAdapters(database());
    vi.mocked(getToxicityReview).mockResolvedValue(toxicityRun({ site: 'foreign', completedAt: null }));
    await expect(adapter?.assertAccess(runAccess())).rejects.toMatchObject({ status: 404 });
    vi.mocked(getToxicityReview).mockResolvedValue(toxicityRun({ completedAt: null }));
    const result = await adapter?.compose(runCompose({ signal: 'spam_toxic', dofollow: false, broken: true }));
    expect(result?.document.sourceDates.map((date) => date.observedAt)).toEqual(['2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z']);
  });

  it('composes and deterministically renders a native disavow artifact', async () => {
    const [, , , , , adapter] = createBacklinkReportExportAdapters(database());
    const rowId = randomUUID();
    vi.mocked(getToxicityReview).mockResolvedValue(toxicityRun({ rows: [toxicityRow({ domain: 'toxic.test', url: 'https://toxic.test/a', spamScore: 90 })] }));
    vi.mocked(buildToxicityDisavow).mockResolvedValue({ text: '# generated\ndomain:toxic.test', filename: 'rankme-disavow-2026-08-08.txt' });
    await expect(adapter?.assertAccess({ ...runAccess('persist'), sourceVersion: 'stale' })).rejects.toMatchObject({ status: 409 });
    await expect(adapter?.assertAccess(runAccess())).resolves.toBeUndefined();
    const result = await adapter?.compose(runCompose({ entries: [{ rowId, kind: 'domain' }] }));
    expect(result?.document.artifacts[0]).toMatchObject({ format: 'txt', validation: 'valid' });
    if (!adapter || !result) throw new Error('disavow adapter unavailable');
    const rendered = await adapter.render({ document: result.document, format: 'txt', snapshotCreatedAt: observedAt.toISOString() });
    expect(Buffer.from(rendered.bytes).toString('utf8')).toBe('# generated\ndomain:toxic.test');
    vi.mocked(getToxicityReview).mockResolvedValue(toxicityRun({ completedAt: null }));
    vi.mocked(getSite).mockResolvedValue({ ...site, displayName: '' });
    expect((await adapter.compose(runCompose({ entries: [] }))).document.subject[0]?.value).toBe(site.domain);
    expect(adapter.selectionSchema.safeParse({ entries: [{ rowId: 'invalid', kind: 'domain' }] }).success).toBe(false);
  });

  it('rejects missing and malformed canonical disavow lines', async () => {
    const [, , , , , adapter] = createBacklinkReportExportAdapters(database());
    vi.mocked(getToxicityReview).mockResolvedValue(toxicityRun());
    vi.mocked(buildToxicityDisavow).mockResolvedValue({ text: 'domain:toxic.test', filename: 'disavow.txt' });
    const result = await adapter?.compose(runCompose({ entries: [] }));
    if (!adapter || !result) throw new Error('disavow adapter unavailable');
    await expect(adapter.render({ document: { ...result.document, blocks: [] }, format: 'txt', snapshotCreatedAt: observedAt.toISOString() })).rejects.toThrow('report output failed validation');
    const table = result.document.blocks.find((block) => block.type === 'table');
    if (!table || table.type !== 'table') throw new Error('disavow table unavailable');
    const malformed = { ...table, rows: [{ ...table.rows[0]!, cells: [] }] };
    await expect(adapter.render({ document: { ...result.document, blocks: [malformed, ...result.document.blocks.filter((block) => block !== table)] }, format: 'txt', snapshotCreatedAt: observedAt.toISOString() })).rejects.toThrow('report output failed validation');
  });
});
