import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { gscSearchAnalytics, gscSyncRuns } from '../../db/schema/gsc.js';
import { pagePerformanceKeywords, pagePerformanceSnapshots } from '../../db/schema/page-performance.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import type { AuditPageInventory } from '../audits/index.js';
import type { PagesFallbackRefreshService } from './fallback-refresh.service.js';
import { createPagesRepository } from './pages.repository.js';
import { PAGES_SORTS } from './pages.schema.js';
import { classifyPageInsights, createPagesService, PagesError, type PagesServiceDeps } from './pages.service.js';
import { canonicalizePageUrl } from './url-normalizer.js';
import type { PageRow } from './pages.types.js';

const NOW = new Date('2026-08-09T12:00:00.000Z');
const ACCOUNT = '507f1f77bcf86cd799439011';
const SITE = '507f1f77bcf86cd799439012';
const BINDING_GENERATION_ID = 'legacy';
const SITE_SHAPE = { id: SITE, url: 'https://example.com/', domain: 'example.com' };
const CURSOR_SECRET = 'test-master-key-with-at-least-thirty-two-characters';

beforeAll(startTestPostgres);
afterAll(stopTestPostgres);
beforeEach(truncateAllTables);

function page(url: string) {
  const result = canonicalizePageUrl(url, SITE_SHAPE.url);
  if (!result.ok) throw new Error('test page must canonicalize');
  return result.value;
}

function emptyAudit(rows: AuditPageInventory['rows'] = [], runId = 'audit-1'): AuditPageInventory {
  return { runId, rows, fetchedCount: rows.length, truncated: false };
}

function fallbackService(overrides: Record<string, unknown> = {}) {
  const refresh = vi.fn().mockResolvedValue({
      ok: true,
      outcome: 'refreshed',
      source: 'dataforseo',
      market: { locationCode: 2840, languageCode: 'en', selection: 'default' },
      cache: 'miss',
      observedAt: NOW,
      cacheFetchedAt: NOW,
      coverage: { sourceRowsFetched: 1, acceptedCount: 1, droppedCount: 0 },
      persisted: {},
      ...overrides,
    });
  return { refresh } as unknown as PagesFallbackRefreshService & { refresh: typeof refresh };
}

function makeService(input: {
  source?: 'fallback' | 'gsc';
  audit?: AuditPageInventory;
  fallback?: ReturnType<typeof fallbackService>;
  now?: Date;
  syncGsc?: PagesServiceDeps['syncGsc'];
  telemetry?: PagesServiceDeps['telemetry'];
  providerSelection?: 'fake' | 'dataforseo';
  repository?: PagesServiceDeps['repository'];
  legacyBinding?: boolean;
} = {}) {
  return createPagesService({
    db: getTestDb() as never,
    cursorSecret: CURSOR_SECRET,
    providerSelection: input.providerSelection ?? 'dataforseo',
    fallbackRefresh: input.fallback ?? fallbackService(),
    now: () => input.now ?? NOW,
    loadSite: vi.fn().mockResolvedValue(SITE_SHAPE),
    resolveGscState: vi.fn().mockResolvedValue(
      input.source === 'gsc'
        ? { usable: true, propertyUrl: 'sc-domain:example.com', propertyUrlHash: 'a'.repeat(64), bindingGenerationId: input.legacyBinding ? undefined : BINDING_GENERATION_ID, fallbackReason: null }
        : { usable: false, propertyUrl: null, propertyUrlHash: null, bindingGenerationId: null, fallbackReason: 'gsc_not_connected' },
    ),
    readAudit: vi.fn().mockResolvedValue(input.audit ?? emptyAudit()),
    ...(input.repository ? { repository: input.repository } : {}),
    ...(input.syncGsc ? { syncGsc: input.syncGsc } : {}),
    ...(input.telemetry ? { telemetry: input.telemetry } : {}),
  });
}

async function seedFallback(observedAt: Date, sequence: number, rows: Array<{
  url: string;
  keyword: string;
  position: number;
  searchVolume: number | null;
  difficulty: number | null;
  estimatedTraffic: number | null;
}>, source: 'demo' | 'dataforseo' = 'dataforseo') {
  const repository = createPagesRepository(getTestDb() as never, { now: () => NOW });
  return repository.writeSuccessfulSnapshot({
    accountId: ACCOUNT,
    siteId: SITE,
    source,
    locationCode: 2840,
    languageCode: 'en',
    observedAt,
    cacheFetchedAt: observedAt,
    cacheStatus: sequence % 2 ? 'miss' : 'hit',
    payloadFingerprint: sequence.toString(16).padStart(64, '0'),
    sourceRowsFetched: rows.length,
    acceptedCount: rows.length,
    droppedCount: 0,
    malformedUrlCount: 0,
    offsiteUrlCount: 0,
    duplicateUrlCount: 0,
    invalidMetricCount: 0,
    sourceTruncated: false,
    keywords: rows.map((row) => ({ ...page(row.url), keyword: row.keyword, position: row.position, searchVolume: row.searchVolume, difficulty: row.difficulty, estimatedTraffic: row.estimatedTraffic })),
  });
}

function listQuery(overrides: Record<string, unknown> = {}) {
  return { range: '28d' as const, sort: 'opportunity' as const, limit: 25, ...overrides } as never;
}

function rewriteSignedCursor(cursor: string, update: (payload: Record<string, unknown>) => void): string {
  const [body] = cursor.split('.');
  const payload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Record<string, unknown>;
  update(payload);
  const rewritten = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const key = createHmac('sha256', CURSOR_SECRET).update('pages-cursor:v1', 'utf8').digest();
  return `${rewritten}.${createHmac('sha256', key).update(rewritten).digest('base64url')}`;
}

function rewriteSignedCursorJson(cursor: string, update: (json: string) => string): string {
  const [body] = cursor.split('.');
  const rewritten = Buffer.from(update(Buffer.from(body!, 'base64url').toString('utf8')), 'utf8').toString('base64url');
  const key = createHmac('sha256', CURSOR_SECRET).update('pages-cursor:v1', 'utf8').digest();
  return `${rewritten}.${createHmac('sha256', key).update(rewritten).digest('base64url')}`;
}

describe('Pages insight boundaries', () => {
  const row = (overrides: Partial<PageRow> = {}): PageRow => ({
    pageId: 'x'.repeat(43), url: 'https://example.com/', displayUrl: 'example.com/', title: null,
    performanceSource: 'gsc', isIndexable: true, nonIndexableReason: null, onPageScore: null,
    metrics: { clicks: 10, impressions: 100, ctr: 0.019, averagePosition: 4, bestPosition: null, keywordCount: null, searchVolume: null, difficulty: null, estimatedTraffic: null, associatedQueryCount: 1 },
    deltas: { positionChange: 3, clickChangePct: 0.2 }, insights: [], ...overrides,
  });

  it('applies inclusive thresholds, fixed ordering, multiple flags, and source null rules', () => {
    expect(classifyPageInsights(row({ isIndexable: false }), 10)).toEqual([
      'striking_distance', 'low_ctr', 'winning', 'non_indexable_visibility',
    ]);
    expect(classifyPageInsights(row({
      performanceSource: 'dataforseo',
      metrics: { ...row().metrics, clicks: null, impressions: null, ctr: null, averagePosition: 20, searchVolume: 100 },
      deltas: { positionChange: -3, clickChangePct: null },
    }), null)).toEqual(['striking_distance', 'declining']);
    expect(classifyPageInsights(row({ performanceSource: null, metrics: { ...row().metrics, impressions: 0 }, deltas: { positionChange: null, clickChangePct: null } }), null)).toEqual(['unmeasured']);
  });

  it.each([
    [{ averagePosition: 3 }, ['low_ctr', 'winning']],
    [{ averagePosition: 3.01 }, ['striking_distance', 'low_ctr', 'winning']],
    [{ averagePosition: 20.01 }, ['winning']],
    [{ impressions: 99 }, ['winning']],
    [{ ctr: 0.02 }, ['striking_distance', 'winning']],
  ])('does not cross the exact boundary %#', (metrics, expected) => {
    expect(classifyPageInsights(row({ metrics: { ...row().metrics, ...metrics } }), 9)).toEqual(expected);
  });

  it('requires ten previous clicks for click change classification and accepts both exact signs', () => {
    const declining = row({ deltas: { positionChange: null, clickChangePct: -0.2 }, metrics: { ...row().metrics, averagePosition: 30 } });
    expect(classifyPageInsights(declining, 9)).toEqual([]);
    expect(classifyPageInsights(declining, 10)).toEqual(['declining']);
    const winning = row({ deltas: { positionChange: null, clickChangePct: 0.2 }, metrics: { ...row().metrics, averagePosition: 30 } });
    expect(classifyPageInsights(winning, 10)).toEqual(['winning']);
  });
});

describe('Pages fallback list/detail/refresh', () => {
  it('aggregates weighted fallback metrics, compares previous sync, merges audit, searches and filters', async () => {
    await seedFallback(new Date('2026-08-01T00:00:00Z'), 1, [
      { url: 'https://example.com/a', keyword: 'older', position: 8, searchVolume: 100, difficulty: 40, estimatedTraffic: 5 },
    ]);
    await seedFallback(new Date('2026-08-08T00:00:00Z'), 2, [
      { url: 'https://example.com/a', keyword: 'Alpha Query', position: 4, searchVolume: 100, difficulty: 20, estimatedTraffic: 10 },
      { url: 'https://example.com/a', keyword: 'Beta', position: 10, searchVolume: 0, difficulty: 40, estimatedTraffic: null },
      { url: 'https://example.com/b', keyword: 'Gamma', position: 30, searchVolume: null, difficulty: null, estimatedTraffic: null },
    ]);
    const audit = emptyAudit([
      { url: 'https://example.com/a', title: 'Audit title', isIndexable: false, nonIndexableReason: 'noindex', onPageScore: 81 },
      { url: 'https://example.com/c', title: 'Unmeasured', isIndexable: true, nonIndexableReason: null, onPageScore: 70 },
      { url: 'https://example.com/d', title: 'Excluded', isIndexable: false, nonIndexableReason: 'blocked', onPageScore: 20 },
      { url: 'https://evil.test/', title: null, isIndexable: true, nonIndexableReason: null, onPageScore: null },
      { url: 'https://example.com/c', title: 'Duplicate', isIndexable: true, nonIndexableReason: null, onPageScore: 70 },
    ]);
    const telemetry = vi.fn();
    const service = makeService({ audit, telemetry });
    const response = await service.list(ACCOUNT, SITE, listQuery({ q: 'alpha query', sort: 'average_position' }));
    expect(response.envelope).toMatchObject({ source: 'dataforseo', status: 'ready', fallbackReason: 'gsc_not_connected', rangeSemantics: 'point_in_time' });
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({ title: 'Audit title', isIndexable: false, performanceSource: 'dataforseo', metrics: { clicks: null, impressions: null, ctr: null, averagePosition: 4, bestPosition: 4, keywordCount: 2, searchVolume: 100, difficulty: 20, estimatedTraffic: 10, associatedQueryCount: 2 }, deltas: { positionChange: 4, clickChangePct: null } });
    expect(response.items[0]).not.toHaveProperty('associated');
    expect(response.items[0]).not.toHaveProperty('searchText');
    expect(response.items[0]!.insights).toEqual(['striking_distance', 'winning', 'non_indexable_visibility']);
    expect(response.envelope.coverage).toMatchObject({ auditRowsFetched: 5, auditRowsAccepted: 3, auditRowsDropped: 2, inventoryPages: 3, measuredPages: 2, unmeasuredPages: 1 });
    expect(telemetry).toHaveBeenCalledWith('pages.read.completed', expect.objectContaining({ source: 'dataforseo', cache: 'hit', acceptedRows: 3 }));
    const unmeasured = await service.list(ACCOUNT, SITE, listQuery({ visibility: 'unmeasured', indexability: 'indexable', insight: 'unmeasured' }));
    expect(unmeasured.items.map((item) => item.displayUrl)).toEqual(['example.com/c']);
    expect((await service.list(ACCOUNT, SITE, listQuery({ q: 'example.com/a' }))).items).toHaveLength(1);
  });

  it('supports every allowlisted sort in both directions with nulls last and stable IDs', async () => {
    await seedFallback(new Date('2026-08-08T00:00:00Z'), 31, [
      { url: 'https://example.com/a', keyword: 'same', position: 8, searchVolume: 100, difficulty: 10, estimatedTraffic: 5 },
      { url: 'https://example.com/b', keyword: 'same', position: 8, searchVolume: 100, difficulty: 10, estimatedTraffic: 5 },
    ]);
    const audit = emptyAudit([
      { url: 'https://example.com/a', title: 'Zulu', isIndexable: true, nonIndexableReason: null, onPageScore: 90 },
      { url: 'https://example.com/b', title: 'Alpha', isIndexable: true, nonIndexableReason: null, onPageScore: 80 },
      { url: 'https://example.com/c', title: null, isIndexable: true, nonIndexableReason: null, onPageScore: 70 },
    ]);
    const service = makeService({ audit });
    for (const sort of PAGES_SORTS) {
      for (const direction of ['asc', 'desc'] as const) {
        const result = await service.list(ACCOUNT, SITE, listQuery({ sort, direction }));
        expect(result.items).toHaveLength(3);
        expect(new Set(result.items.map((item) => item.pageId)).size).toBe(3);
        if (sort !== 'opportunity' && sort !== 'url') {
          expect(result.items.at(-1)!.performanceSource).toBeNull();
        }
      }
    }
  });

  it('uses deterministic keyword tie ordering and nulls an overflowing weighted average', async () => {
    await seedFallback(new Date('2026-08-08T00:00:00Z'), 33, [
      { url: 'https://example.com/tie', keyword: 'Zulu', position: 5, searchVolume: null, difficulty: null, estimatedTraffic: null },
      { url: 'https://example.com/tie', keyword: 'Alpha', position: 5, searchVolume: null, difficulty: null, estimatedTraffic: null },
      { url: 'https://example.com/no-flag', keyword: 'Quiet', position: 30, searchVolume: 1, difficulty: 1, estimatedTraffic: 1 },
    ]);
    const base = createPagesRepository(getTestDb() as never, { now: () => NOW });
    const ordered = await makeService({ repository: base }).detail(ACCOUNT, SITE, page('https://example.com/tie').pageHash, '28d');
    expect(ordered.associated.rows.map((row) => row.query)).toEqual(['Alpha', 'Zulu']);

    const repository = {
      ...base,
      readKeywords: async (input: Parameters<typeof base.readKeywords>[0]) => (await base.readKeywords(input)).map((row) => ({ ...row, position: 1e308, searchVolume: 1e308 })),
    };
    const overflow = await makeService({ repository }).list(ACCOUNT, SITE, listQuery({ sort: 'opportunity' }));
    const overflowTie = overflow.items.find((item) => item.url.endsWith('/tie'))!;
    expect(overflowTie.metrics.averagePosition).toBeNull();
    expect(overflowTie.metrics.searchVolume).toBeNull();
    expect(overflow.items.every((item) => item.insights.length === 0)).toBe(true);
  });

  it('sorts nulls last in both directions and binds deterministic signed cursors to the query and inventory', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({
      url: `https://example.com/${String(index).padStart(2, '0')}`,
      keyword: `keyword-${index}`,
      position: index + 1,
      searchVolume: index % 3 === 0 ? null : index,
      difficulty: index % 4 === 0 ? null : index,
      estimatedTraffic: index % 5 === 0 ? null : index,
    }));
    await seedFallback(new Date('2026-08-08T00:00:00Z'), 3, rows);
    const service = makeService();
    const first = await service.list(ACCOUNT, SITE, listQuery({ sort: 'estimated_traffic', direction: 'desc' }));
    expect(first.pageInfo).toMatchObject({ hasNext: true, totalFiltered: 30 });
    const second = await service.list(ACCOUNT, SITE, listQuery({ sort: 'estimated_traffic', direction: 'desc', cursor: first.pageInfo.nextCursor }));
    expect(new Set([...first.items, ...second.items].map((item) => item.pageId)).size).toBe(30);
    expect(second.items.at(-1)!.metrics.estimatedTraffic).toBeNull();
    await expect(service.list(ACCOUNT, SITE, listQuery({ sort: 'estimated_traffic', direction: 'asc', cursor: first.pageInfo.nextCursor }))).rejects.toMatchObject({ code: 'PAGES_INVALID_CURSOR' });
    const tampered = `${first.pageInfo.nextCursor!.slice(0, -1)}x`;
    await expect(service.list(ACCOUNT, SITE, listQuery({ sort: 'estimated_traffic', direction: 'desc', cursor: tampered }))).rejects.toBeInstanceOf(PagesError);
    await expect(service.list(ACCOUNT, SITE, listQuery({ sort: 'estimated_traffic', direction: 'desc', cursor: `${first.pageInfo.nextCursor}.extra` }))).rejects.toMatchObject({ code: 'PAGES_INVALID_CURSOR' });
    await expect(service.list(ACCOUNT, SITE, listQuery({ sort: 'estimated_traffic', direction: 'desc', cursor: first.pageInfo.nextCursor }))).resolves.toBeTruthy();
    const nullMarkerMismatch = rewriteSignedCursor(first.pageInfo.nextCursor!, (payload) => { payload.n = !payload.n; });
    await expect(service.list(ACCOUNT, SITE, listQuery({ sort: 'estimated_traffic', direction: 'desc', cursor: nullMarkerMismatch }))).rejects.toMatchObject({ code: 'PAGES_INVALID_CURSOR' });
    const invalidPrimary = rewriteSignedCursor(first.pageInfo.nextCursor!, (payload) => { payload.p = { unsafe: true }; });
    await expect(service.list(ACCOUNT, SITE, listQuery({ sort: 'estimated_traffic', direction: 'desc', cursor: invalidPrimary }))).rejects.toMatchObject({ code: 'PAGES_INVALID_CURSOR' });
    const infinitePrimary = rewriteSignedCursorJson(first.pageInfo.nextCursor!, (json) => json.replace(/"p":[^,]+/u, '"p":1e400'));
    await expect(service.list(ACCOUNT, SITE, listQuery({ sort: 'estimated_traffic', direction: 'desc', cursor: infinitePrimary }))).rejects.toMatchObject({ code: 'PAGES_INVALID_CURSOR' });
    const expired = makeService({ now: new Date(NOW.getTime() + 24 * 60 * 60 * 1_000 + 1) });
    await expect(expired.list(ACCOUNT, SITE, listQuery({ sort: 'estimated_traffic', direction: 'desc', cursor: first.pageInfo.nextCursor }))).rejects.toMatchObject({ code: 'PAGES_INVALID_CURSOR' });
    const anchorId = first.items.at(-1)!.pageId;
    await getTestDb().delete(pagePerformanceKeywords).where(and(eq(pagePerformanceKeywords.accountId, ACCOUNT), eq(pagePerformanceKeywords.pageHash, anchorId)));
    await expect(service.list(ACCOUNT, SITE, listQuery({ sort: 'estimated_traffic', direction: 'desc', cursor: first.pageInfo.nextCursor }))).rejects.toMatchObject({ code: 'PAGES_INVALID_CURSOR' });
    await getTestDb().delete(pagePerformanceSnapshots).where(eq(pagePerformanceSnapshots.accountId, ACCOUNT));
    await expect(service.list(ACCOUNT, SITE, listQuery({ sort: 'estimated_traffic', direction: 'desc', cursor: first.pageInfo.nextCursor }))).rejects.toMatchObject({ code: 'PAGES_INVALID_CURSOR' });
  });

  it('returns bounded associated keywords and source-aware historical points', async () => {
    const hash = page('https://example.com/a').pageHash;
    await seedFallback(new Date('2026-08-01T00:00:00Z'), 9, [
      { url: 'https://example.com/other', keyword: 'other', position: 9, searchVolume: 9, difficulty: 9, estimatedTraffic: 9 },
    ]);
    for (let index = 1; index <= 3; index += 1) {
      await seedFallback(new Date(`2026-08-0${index + 1}T00:00:00Z`), 10 + index, [
        { url: 'https://example.com/a', keyword: `k-${index}`, position: index, searchVolume: index * 10, difficulty: index, estimatedTraffic: index },
      ]);
    }
    const service = makeService();
    const detail = await service.detail(ACCOUNT, SITE, hash, '7d');
    expect(detail.associated).toMatchObject({ kind: 'keywords', total: 1, truncated: false });
    expect(detail.page).not.toHaveProperty('associated');
    expect(detail.trend).toHaveLength(3);
    expect(detail.trend[0]!.metrics.clicks).toBeNull();
    await expect(service.detail(ACCOUNT, SITE, 'z'.repeat(43), '7d')).rejects.toMatchObject({ code: 'PAGES_PAGE_NOT_FOUND', status: 404 });
  });

  it('sorts a measured value before an earlier null value', async () => {
    await seedFallback(new Date('2026-08-08T00:00:00Z'), 34, [
      { url: 'https://example.com/null-first', keyword: 'null', position: 1, searchVolume: 100, difficulty: null, estimatedTraffic: 100 },
      { url: 'https://example.com/value-second', keyword: 'value', position: 2, searchVolume: 1, difficulty: 10, estimatedTraffic: 1 },
    ]);
    const result = await makeService().list(ACCOUNT, SITE, listQuery({ sort: 'difficulty', direction: 'asc' }));
    expect(result.items.map((item) => item.url)).toEqual([
      'https://example.com/value-second', 'https://example.com/null-first',
    ]);
  });

  it('distinguishes never-refreshed none, stale successful empty, and provider/persistence failures', async () => {
    const service = makeService({ now: NOW });
    const none = await service.list(ACCOUNT, SITE, listQuery());
    expect(none.envelope).toMatchObject({ source: 'none', status: 'empty', observedAt: null });
    await seedFallback(new Date('2026-07-01T00:00:00Z'), 20, []);
    const empty = await service.list(ACCOUNT, SITE, listQuery());
    expect(empty.envelope).toMatchObject({ source: 'dataforseo', status: 'empty' });

    await seedFallback(new Date('2026-07-02T00:00:00Z'), 21, [
      { url: 'https://example.com/stale', keyword: 'stale', position: 5, searchVolume: 10, difficulty: 10, estimatedTraffic: 1 },
    ]);
    expect((await service.list(ACCOUNT, SITE, listQuery())).envelope.status).toBe('stale');

    const prior = await getTestDb().select().from((await import('../../db/schema/page-performance.js')).pagePerformanceSnapshots).limit(1);
    const failed = fallbackService({ ok: false, failure: 'provider_unavailable', lastGood: prior[0] });
    const failedTelemetry = vi.fn();
    await expect(makeService({ fallback: failed, telemetry: failedTelemetry }).refresh(ACCOUNT, SITE)).rejects.toMatchObject({ code: 'PAGES_PROVIDER_UNAVAILABLE', state: { envelope: { status: 'stale' } } });
    expect(failedTelemetry).toHaveBeenCalledWith('pages.refresh.failed', expect.objectContaining({ status: 'stale', errorClass: 'provider_unavailable' }));
    const persistence = fallbackService({ ok: false, failure: 'persistence_failed', lastGood: null });
    await expect(makeService({ fallback: persistence }).refresh(ACCOUNT, SITE)).rejects.toMatchObject({ code: 'PAGES_REFRESH_FAILED', state: undefined });
  });

  it('delegates a successful fallback refresh once and returns typed metering/cache state', async () => {
    await seedFallback(NOW, 30, [{ url: 'https://example.com/a', keyword: 'a', position: 1, searchVolume: 1, difficulty: 1, estimatedTraffic: 1 }]);
    const fallback = fallbackService();
    const telemetry = vi.fn();
    const response = await makeService({ fallback, telemetry }).refresh(ACCOUNT, SITE);
    expect(fallback.refresh).toHaveBeenCalledTimes(1);
    expect(response.refresh).toEqual({ outcome: 'refreshed', source: 'dataforseo', cache: 'miss', observedAt: NOW.toISOString() });
    expect(telemetry).toHaveBeenCalledWith('pages.refresh.started', {
      source: 'dataforseo',
      range: '28d',
      cache: 'not_started',
    });
  });

  it('exposes demo distinctly and reports an unavailable no-source GSC fallback reason', async () => {
    await seedFallback(NOW, 32, [{ url: 'https://example.com/demo', keyword: 'demo', position: 2, searchVolume: 5, difficulty: 5, estimatedTraffic: 2 }], 'demo');
    expect((await makeService({ providerSelection: 'fake' }).list(ACCOUNT, SITE, listQuery())).envelope).toMatchObject({ source: 'demo', status: 'ready' });
    const demoTelemetry = vi.fn();
    const demoFallback = fallbackService({ source: 'demo' });
    await makeService({ providerSelection: 'fake', fallback: demoFallback, telemetry: demoTelemetry }).refresh(ACCOUNT, SITE);
    expect(demoTelemetry).toHaveBeenCalledWith('pages.refresh.started', {
      source: 'demo',
      range: '28d',
      cache: 'not_started',
    });
    const noSource = createPagesService({
      db: getTestDb() as never,
      cursorSecret: CURSOR_SECRET,
      providerSelection: 'dataforseo',
      fallbackRefresh: fallbackService(),
      now: () => NOW,
      loadSite: vi.fn().mockResolvedValue(SITE_SHAPE),
      resolveGscState: vi.fn().mockResolvedValue({ usable: false, propertyUrl: null, propertyUrlHash: null, fallbackReason: 'gsc_property_unmatched' }),
      readAudit: vi.fn().mockResolvedValue(emptyAudit()),
    });
    expect((await noSource.list(ACCOUNT, SITE, listQuery())).envelope).toMatchObject({ source: 'none', status: 'unavailable', fallbackReason: 'gsc_property_unmatched' });
  });

  it('reports a non-Error demo refresh rejection without rewriting the thrown value', async () => {
    const fallback = fallbackService();
    fallback.refresh.mockRejectedValueOnce('provider stopped');
    const telemetry = vi.fn();

    await expect(
      makeService({ providerSelection: 'fake', fallback, telemetry }).refresh(ACCOUNT, SITE),
    ).rejects.toBe('provider stopped');
    expect(telemetry).toHaveBeenCalledWith(
      'pages.refresh.failed',
      expect.objectContaining({ source: 'demo', errorClass: 'unknown' }),
    );

    const dataforseoFallback = fallbackService();
    dataforseoFallback.refresh.mockRejectedValueOnce(new TypeError('provider stopped'));
    const dataforseoTelemetry = vi.fn();

    await expect(
      makeService({ fallback: dataforseoFallback, telemetry: dataforseoTelemetry }).refresh(
        ACCOUNT,
        SITE,
      ),
    ).rejects.toThrow('provider stopped');
    expect(dataforseoTelemetry).toHaveBeenCalledWith(
      'pages.refresh.failed',
      expect.objectContaining({ source: 'dataforseo', errorClass: 'TypeError' }),
    );
  });

  it('returns audit-only detail as unmeasured with no associated evidence', async () => {
    const audit = emptyAudit([{ url: 'https://example.com/audit-only', title: 'Audit only', isIndexable: true, nonIndexableReason: null, onPageScore: 55 }]);
    const service = makeService({ audit });
    const listed = await service.list(ACCOUNT, SITE, listQuery());
    expect(listed.summary).toMatchObject({ keywordCount: null, clicks: null, impressions: null });
    const detail = await service.detail(ACCOUNT, SITE, listed.items[0]!.pageId, '28d');
    expect(detail.associated).toEqual({ kind: 'none', rows: [], total: 0, truncated: false });
  });
});

async function seedGsc(input: { date: string; fetchedAt: Date; pageUrl: string; clicks: number; impressions: number; position: number; query?: string }) {
  const values = [{
    accountId: ACCOUNT, siteId: SITE, bindingGenerationId: BINDING_GENERATION_ID, snapshotDate: input.date, dimensionSet: 'page', windowDays: 28,
    dimensionKey: input.pageUrl, clicks: input.clicks, impressions: input.impressions,
    ctr: input.impressions ? input.clicks / input.impressions : 0, position: input.position, fetchedAt: input.fetchedAt,
  }];
  await getTestDb().insert(gscSearchAnalytics).values(values);
  if (input.query) {
    await getTestDb().insert(gscSearchAnalytics).values({ ...values[0]!, dimensionSet: 'query,page', dimensionKey: `${input.query}\u001f${input.pageUrl}` });
  }
}

describe('Pages GSC precedence and refresh', () => {
  it('uses tenant-scoped GSC snapshots, observed totals/query rows, comparisons, history, and low-CTR rules', async () => {
    await seedGsc({ date: '2026-08-01', fetchedAt: new Date('2026-08-04T00:00:00Z'), pageUrl: 'https://example.com/a', clicks: 20, impressions: 200, position: 12, query: 'older query' });
    await getTestDb().insert(gscSearchAnalytics).values({ accountId: ACCOUNT, siteId: SITE, bindingGenerationId: BINDING_GENERATION_ID, snapshotDate: '2026-08-01', dimensionSet: 'page', windowDays: 28, dimensionKey: 'not a url', clicks: 1, impressions: 1, ctr: 1, position: 1, fetchedAt: new Date('2026-08-04T00:00:00Z') });
    await seedGsc({ date: '2026-08-06', fetchedAt: new Date('2026-08-09T00:00:00Z'), pageUrl: 'https://example.com/a', clicks: 10, impressions: 1000, position: 8, query: 'current query' });
    await getTestDb().insert(gscSearchAnalytics).values({ accountId: ACCOUNT, siteId: SITE, bindingGenerationId: BINDING_GENERATION_ID, snapshotDate: '2026-08-07', dimensionSet: 'query,page', windowDays: 28, dimensionKey: `newer partial${String.fromCharCode(31)}https://example.com/a`, clicks: 999, impressions: 999, ctr: 1, position: 1, fetchedAt: NOW });
    await getTestDb().insert(gscSearchAnalytics).values({ accountId: ACCOUNT, siteId: SITE, bindingGenerationId: BINDING_GENERATION_ID, snapshotDate: '2026-08-06', dimensionSet: 'query,page', windowDays: 28, dimensionKey: `second current${String.fromCharCode(31)}https://example.com/a`, clicks: 5, impressions: 100, ctr: 0.05, position: 9, fetchedAt: NOW });
    await getTestDb().insert(gscSearchAnalytics).values({ accountId: 'other', siteId: SITE, bindingGenerationId: BINDING_GENERATION_ID, snapshotDate: '2026-08-07', dimensionSet: 'page', windowDays: 28, dimensionKey: 'https://example.com/leak', clicks: 999, impressions: 999, ctr: 1, position: 1, fetchedAt: NOW });
    const service = makeService({ source: 'gsc' });
    const response = await service.list(ACCOUNT, SITE, listQuery());
    expect(response.envelope).toMatchObject({ source: 'gsc', status: 'ready', fallbackReason: null, market: null, rangeSemantics: 'rolling_window', coverage: { reportingLagDays: 3 } });
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({ performanceSource: 'gsc', metrics: { clicks: 10, impressions: 1000, ctr: 0.01, averagePosition: 8, bestPosition: null, keywordCount: null, associatedQueryCount: 2 }, deltas: { positionChange: 4, clickChangePct: -0.5 }, insights: ['striking_distance', 'low_ctr', 'declining', 'winning'] });
    const detail = await service.detail(ACCOUNT, SITE, response.items[0]!.pageId, '28d');
    expect(detail.associated).toMatchObject({ kind: 'queries', total: 2, truncated: false, rows: [{ query: 'current query', clicks: 10, searchVolume: null }, { query: 'second current', clicks: 5 }] });
    expect(detail.trend).toHaveLength(2);
  });

  it('drops malformed/offsite GSC rows, ignores malformed query associations, and keeps zero-impression arithmetic null', async () => {
    await seedGsc({ date: '2026-08-01', fetchedAt: new Date('2026-08-04T00:00:00Z'), pageUrl: 'https://example.com/zero', clicks: 0, impressions: 0, position: 10 });
    await seedGsc({ date: '2026-08-06', fetchedAt: NOW, pageUrl: 'https://example.com/zero', clicks: 0, impressions: 0, position: 7 });
    await getTestDb().insert(gscSearchAnalytics).values([
      { accountId: ACCOUNT, siteId: SITE, bindingGenerationId: BINDING_GENERATION_ID, snapshotDate: '2026-08-06', dimensionSet: 'page', windowDays: 28, dimensionKey: 'not a url', clicks: 1, impressions: 1, ctr: 1, position: 1, fetchedAt: NOW },
      { accountId: ACCOUNT, siteId: SITE, bindingGenerationId: BINDING_GENERATION_ID, snapshotDate: '2026-08-06', dimensionSet: 'page', windowDays: 28, dimensionKey: 'https://other.test/leak', clicks: 1, impressions: 1, ctr: 1, position: 1, fetchedAt: NOW },
      { accountId: ACCOUNT, siteId: SITE, bindingGenerationId: BINDING_GENERATION_ID, snapshotDate: '2026-08-06', dimensionSet: 'query,page', windowDays: 28, dimensionKey: 'missing-page-key', clicks: 0, impressions: 0, ctr: 0, position: 1, fetchedAt: NOW },
      { accountId: ACCOUNT, siteId: SITE, bindingGenerationId: BINDING_GENERATION_ID, snapshotDate: '2026-08-06', dimensionSet: 'query,page', windowDays: 28, dimensionKey: `Zulu${String.fromCharCode(31)}https://example.com/zero`, clicks: 0, impressions: 0, ctr: 0, position: 2, fetchedAt: NOW },
      { accountId: ACCOUNT, siteId: SITE, bindingGenerationId: BINDING_GENERATION_ID, snapshotDate: '2026-08-06', dimensionSet: 'query,page', windowDays: 28, dimensionKey: `Alpha${String.fromCharCode(31)}https://example.com/zero`, clicks: 0, impressions: 0, ctr: 0, position: 2, fetchedAt: NOW },
    ]);
    const response = await makeService({ source: 'gsc' }).list(ACCOUNT, SITE, listQuery());
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({ metrics: { clicks: 0, impressions: 0, ctr: null, associatedQueryCount: 2 }, deltas: { positionChange: 3, clickChangePct: null } });
    expect(response.envelope.coverage).toMatchObject({ sourceRowsAccepted: 1, sourceRowsDropped: 2, dropped: { malformedUrl: 1, offsiteUrl: 1 } });
    const detail = await makeService({ source: 'gsc' }).detail(ACCOUNT, SITE, response.items[0]!.pageId, '28d');
    expect(detail.associated.rows.map((row) => [row.query, row.ctr])).toEqual([['Alpha', null], ['Zulu', null]]);
  });

  it('bounds GSC associated queries at 100 and rolling history at 90 points', async () => {
    const pageUrl = 'https://example.com/history';
    const history = Array.from({ length: 91 }, (_, index) => {
      const date = new Date('2026-05-08T00:00:00Z');
      date.setUTCDate(date.getUTCDate() + index);
      const snapshotDate = date.toISOString().slice(0, 10);
      return {
        accountId: ACCOUNT,
        siteId: SITE,
        bindingGenerationId: BINDING_GENERATION_ID,
        snapshotDate,
        dimensionSet: 'page',
        windowDays: 90,
        dimensionKey: pageUrl,
        clicks: index,
        impressions: index + 1,
        ctr: index / (index + 1),
        position: index + 1,
        fetchedAt: new Date(`${snapshotDate}T12:00:00Z`),
      } as const;
    });
    await getTestDb().insert(gscSearchAnalytics).values(history);
    await getTestDb().insert(gscSearchAnalytics).values(Array.from({ length: 101 }, (_, index) => ({
      ...history.at(-1)!,
      dimensionSet: 'query,page',
      dimensionKey: `query-${String(index).padStart(3, '0')}${String.fromCharCode(31)}${pageUrl}`,
      clicks: 101 - index,
      impressions: 200 - index,
    })));
    const service = makeService({ source: 'gsc', now: new Date('2026-08-09T12:00:00Z') });
    const listed = await service.list(ACCOUNT, SITE, listQuery({ range: '90d' }));
    const detail = await service.detail(ACCOUNT, SITE, listed.items[0]!.pageId, '90d');
    expect(detail.associated).toMatchObject({ kind: 'queries', total: 101, truncated: true });
    expect(detail.associated.rows).toHaveLength(100);
    expect(detail.trend).toHaveLength(90);
  });

  it('omits GSC history points that contain only another page', async () => {
    await seedGsc({ date: '2026-08-01', fetchedAt: new Date('2026-08-04T00:00:00Z'), pageUrl: 'https://example.com/other', clicks: 1, impressions: 2, position: 3 });
    await seedGsc({ date: '2026-08-06', fetchedAt: NOW, pageUrl: 'https://example.com/target', clicks: 2, impressions: 4, position: 2 });
    const service = makeService({ source: 'gsc' });
    const listed = await service.list(ACCOUNT, SITE, listQuery());
    const target = listed.items.find((item) => item.url.endsWith('/target'))!;
    const detail = await service.detail(ACCOUNT, SITE, target.pageId, '28d');
    expect(detail.trend).toHaveLength(1);
  });

  it.each([
    [undefined, 'syncing'],
    ['empty', 'empty'],
    ['failed', 'unavailable'],
  ] as const)('maps no-row sync health %s to %s without fallback', async (runStatus, expected) => {
    if (runStatus) await getTestDb().insert(gscSyncRuns).values({ accountId: ACCOUNT, siteId: SITE, bindingGenerationId: BINDING_GENERATION_ID, generation: 1, propertyUrlHash: 'a'.repeat(64), status: runStatus, startedAt: NOW, completedAt: NOW });
    const response = await makeService({ source: 'gsc' }).list(ACCOUNT, SITE, listQuery());
    expect(response.envelope).toMatchObject({ source: 'gsc', status: expected });
  });

  it('treats the newest successful-empty GSC run as authoritative over older rows', async () => {
    await seedGsc({ date: '2026-08-01', fetchedAt: new Date('2026-08-04T00:00:00Z'), pageUrl: 'https://example.com/old', clicks: 5, impressions: 50, position: 5 });
    await getTestDb().insert(gscSyncRuns).values({ accountId: ACCOUNT, siteId: SITE, bindingGenerationId: BINDING_GENERATION_ID, generation: 2, propertyUrlHash: 'a'.repeat(64), status: 'empty', startedAt: NOW, completedAt: NOW, snapshotDate: '2026-08-06', lastSuccessAt: NOW });
    const response = await makeService({ source: 'gsc' }).list(ACCOUNT, SITE, listQuery());
    expect(response.envelope).toMatchObject({ source: 'gsc', status: 'empty', observedAt: NOW.toISOString(), staleAt: null });
    expect(response.items).toEqual([]);
  });

  it('marks old/failed-with-history GSC stale and never invokes fallback', async () => {
    await seedGsc({ date: '2026-07-01', fetchedAt: new Date('2026-07-04T00:00:00Z'), pageUrl: 'https://example.com/a', clicks: 1, impressions: 1, position: 1 });
    await getTestDb().insert(gscSyncRuns).values({ accountId: ACCOUNT, siteId: SITE, bindingGenerationId: BINDING_GENERATION_ID, generation: 1, propertyUrlHash: 'a'.repeat(64), status: 'failed', startedAt: NOW, completedAt: NOW });
    const fallback = fallbackService();
    const response = await makeService({ source: 'gsc', fallback }).list(ACCOUNT, SITE, listQuery());
    expect(response.envelope.status).toBe('stale');
    expect(fallback.refresh).not.toHaveBeenCalled();
  });

  it('runs GSC refresh without keyword metering and handles empty/unavailable outcomes with last-good state', async () => {
    await seedGsc({ date: '2026-08-06', fetchedAt: NOW, pageUrl: 'https://example.com/a', clicks: 1, impressions: 1, position: 1 });
    const ok = vi.fn().mockResolvedValue({ status: 'ok', snapshotDate: '2026-08-06' });
    const service = makeService({ source: 'gsc', syncGsc: ok });
    const response = await service.refresh(ACCOUNT, SITE);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(response.refresh).toMatchObject({ source: 'gsc', cache: 'not_applicable' });
    const empty = vi.fn().mockResolvedValue({ status: 'no-data', snapshotDate: '2026-08-06' });
    expect((await makeService({ source: 'gsc', syncGsc: empty }).refresh(ACCOUNT, SITE)).refresh.outcome).toBe('empty');
    const fail = vi.fn().mockResolvedValue({ status: 'unavailable', snapshotDate: null });
    await expect(makeService({ source: 'gsc', syncGsc: fail }).refresh(ACCOUNT, SITE)).rejects.toMatchObject({ code: 'PAGES_GSC_UNAVAILABLE', state: { envelope: { status: 'stale' } } });
    const telemetry = vi.fn();
    await expect(makeService({ source: 'gsc', telemetry }).refresh(ACCOUNT, SITE)).rejects.toMatchObject({ code: 'PAGES_GSC_UNAVAILABLE' });
    expect(telemetry).toHaveBeenCalledWith('pages.refresh.failed', expect.objectContaining({ errorClass: 'sync_unconfigured' }));
    const rejected = vi.fn().mockRejectedValue(new Error('secret provider detail'));
    await expect(makeService({ source: 'gsc', syncGsc: rejected, telemetry }).refresh(ACCOUNT, SITE)).rejects.toMatchObject({ code: 'PAGES_GSC_UNAVAILABLE', state: { envelope: { status: 'stale' } } });
    expect(telemetry).toHaveBeenCalledWith('pages.refresh.failed', expect.objectContaining({ errorClass: 'Error', source: 'gsc' }));
    expect(JSON.stringify(telemetry.mock.calls)).not.toContain('secret provider detail');
  });

  it('reads and refreshes a legacy GSC binding when the generation id is absent', async () => {
    await seedGsc({ date: '2026-08-06', fetchedAt: NOW, pageUrl: 'https://example.com/legacy', clicks: 2, impressions: 20, position: 6 });
    const syncGsc = vi.fn().mockResolvedValue({ status: 'ok', snapshotDate: '2026-08-06' });
    const service = makeService({ source: 'gsc', legacyBinding: true, syncGsc });

    await expect(service.list(ACCOUNT, SITE, listQuery())).resolves.toMatchObject({
      items: [{ url: 'https://example.com/legacy' }],
    });
    await service.refresh(ACCOUNT, SITE);

    expect(syncGsc).toHaveBeenCalledWith(expect.objectContaining({
      bindingGenerationId: 'legacy',
    }));
  });

  it('returns empty after a no-data GSC refresh and omits state for a failed first sync', async () => {
    const noData = vi.fn().mockResolvedValue({ status: 'no-data' as const, snapshotDate: null });
    const empty = await makeService({ source: 'gsc', syncGsc: noData }).refresh(ACCOUNT, SITE);
    expect(empty).toMatchObject({ refresh: { outcome: 'empty', observedAt: NOW.toISOString() }, state: { envelope: { status: 'empty' } } });
    const failed = vi.fn().mockResolvedValue({ status: 'unavailable' as const, snapshotDate: null });
    await expect(makeService({ source: 'gsc', syncGsc: failed }).refresh(ACCOUNT, SITE)).rejects.toMatchObject({ code: 'PAGES_GSC_UNAVAILABLE', state: undefined });
    const throwing = vi.fn().mockRejectedValue('opaque failure');
    const telemetry = vi.fn();
    await expect(makeService({ source: 'gsc', syncGsc: throwing, telemetry }).refresh(ACCOUNT, SITE)).rejects.toMatchObject({ code: 'PAGES_GSC_UNAVAILABLE', state: undefined });
    expect(telemetry).toHaveBeenCalledWith('pages.refresh.failed', expect.objectContaining({ errorClass: 'unknown' }));
  });
});
