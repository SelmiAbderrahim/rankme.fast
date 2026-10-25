/**
 * Production-qa #11 (group G1) — stored-data Google read tools:
 * get_gsc_search_summary, list_gsc_top_queries, list_gsc_top_pages,
 * get_ga4_summary. Real in-memory Mongo + PGlite; the Google provider and the
 * sync queue are spies that must never be touched.
 */
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import type { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAccountMcpSpec: vi.fn(async (): Promise<unknown> => null),
}));

vi.mock('../mcp-permissions/index.js', () => ({
  getAccountMcpSpec: mocks.getAccountMcpSpec,
}));

import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { subscriptions } from '../../db/schema/subscriptions.js';
import { usageCounters } from '../../db/schema/usage-counters.js';
import { resolveEffectivePermissions } from '../../shared/mcp-permissions/index.js';
import { bearerLanguage } from '../../shared/middleware/bearer-language.js';
import { errorHandler } from '../../shared/middleware/error-handler.js';
import type { GoogleGscProvider } from '../../shared/providers/google/gsc.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { upsertGa4Metrics } from '../ga4-snapshots/index.js';
import { upsertSearchAnalytics } from '../gsc-snapshots/index.js';
import {
  GoogleConnection,
  SCOPE_GA4,
  SCOPE_GSC,
  setGa4SyncQueue,
  setGoogleConnectionsDb,
  setGoogleGscProvider,
  setGscSyncQueue,
  upsertConnection,
} from '../google-connections/index.js';
import { setApiKeysDb } from '../api-keys/index.js';
import { Site } from '../sites/index.js';
import { User } from '../users/index.js';
import { MCP_TOOL_NAMES } from './mcp.registry.js';
import { mcpRouter } from './mcp.routes.js';
import {
  toolGetGa4Summary,
  toolGetGscSearchSummary,
  toolListGscTopPages,
  toolListGscTopQueries,
  windowStart,
} from './mcp.tools.google.js';
import type { McpToolContext, McpToolResult } from './mcp.tools.js';

const ACCOUNT = '64b0c0ffee0000000000a001';
const OTHER_ACCOUNT = '64b0c0ffee0000000000b002';
const ASOF = '2026-09-30';

const permissive = () => resolveEffectivePermissions(null, null, MCP_TOOL_NAMES);
const ctx = (overrides: Partial<McpToolContext> = {}): McpToolContext => ({
  accountId: ACCOUNT,
  locale: 'en',
  permissions: permissive(),
  ...overrides,
});

/** PGlite stands in for the postgres-js `Db` the production holders hand out. */
const testDb = (): Db => getTestDb() as unknown as Db;

const providerSpies = {
  listProperties: vi.fn(),
  inspectUrl: vi.fn(),
  querySearchAnalytics: vi.fn(),
  listSitemaps: vi.fn(),
  refreshAccessToken: vi.fn(),
  revokeToken: vi.fn(),
};
const queueAdd = vi.fn();

function addDays(day: string, delta: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + delta * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** 90 consecutive days ending ASOF: clicks 10..16 cycling, impressions 100+i. */
function dailyRows() {
  return Array.from({ length: 90 }, (_, i) => {
    const clicks = 10 + (i % 7);
    const impressions = 100 + i;
    return {
      keys: [addDays(ASOF, i - 89)],
      clicks,
      impressions,
      ctr: clicks / impressions,
      position: 5,
    };
  });
}

function expectedWindow(days: number) {
  const from = windowStart(ASOF, days);
  const rows = dailyRows().filter((row) => row.keys[0]! >= from && row.keys[0]! <= ASOF);
  return {
    clicks: rows.reduce((sum, row) => sum + row.clicks, 0),
    impressions: rows.reduce((sum, row) => sum + row.impressions, 0),
    from,
  };
}

interface SeedOptions {
  property?: string | null;
  connected?: boolean;
  /** `null` leaves the binding generation unset on the Site (legacy sites). */
  generation?: string | null;
  ga4?: boolean;
  scopes?: string[];
  accountId?: string;
}

async function seedSite(options: SeedOptions = {}): Promise<string> {
  const accountId = options.accountId ?? ACCOUNT;
  const property = options.property === undefined ? 'sc-domain:example.com' : options.property;
  const site = await Site.create({
    accountId,
    url: 'https://example.com',
    domain: 'example.com',
    ...(property
      ? {
          gscPropertyUrl: property,
          ...(options.generation === null
            ? {}
            : { gscBindingGenerationId: options.generation ?? 'legacy' }),
          gscBindingSource: 'legacy',
        }
      : {}),
    ...(options.ga4
      ? {
          ga4PropertyId: 'properties/123',
          ...(options.generation === null
            ? {}
            : { ga4BindingGenerationId: options.generation ?? 'legacy' }),
        }
      : {}),
  });
  if (options.connected !== false) {
    await upsertConnection({
      accountId,
      googleAccountEmail: 'owner@example.com',
      refreshToken: 'refresh-token',
      scopes: options.scopes ?? [SCOPE_GSC, SCOPE_GA4],
    });
  }
  return String(site._id);
}

async function seedGsc(siteId: string, generation = 'legacy', queryCount = 3) {
  const db = testDb();
  const base = { siteId, accountId: ACCOUNT, snapshotDate: ASOF, bindingGenerationId: generation };
  await upsertSearchAnalytics(db, {
    ...base,
    dimensionSet: 'date',
    windowDays: 90,
    rows: dailyRows(),
  });
  for (const windowDays of [7, 28, 90]) {
    await upsertSearchAnalytics(db, {
      ...base,
      dimensionSet: 'query',
      windowDays,
      rows: Array.from({ length: queryCount }, (_, i) => ({
        keys: [`seo query ${i}`],
        clicks: 200 - i,
        impressions: 1000 + i,
        ctr: 0.1,
        position: 4,
      })),
    });
    await upsertSearchAnalytics(db, {
      ...base,
      dimensionSet: 'page',
      windowDays,
      rows: [
        { keys: ['https://example.com/a'], clicks: 50, impressions: 400, ctr: 0.125, position: 3 },
        { keys: ['https://example.com/b'], clicks: 50, impressions: 900, ctr: 0.05, position: 6 },
      ],
    });
    await upsertSearchAnalytics(db, {
      ...base,
      dimensionSet: 'country',
      windowDays,
      rows: [{ keys: ['usa'], clicks: 80, impressions: 700, ctr: 0.11, position: 4 }],
    });
    await upsertSearchAnalytics(db, {
      ...base,
      dimensionSet: 'device',
      windowDays,
      rows: [{ keys: ['MOBILE'], clicks: 60, impressions: 600, ctr: 0.1, position: 4 }],
    });
  }
}

async function seedGa4(siteId: string, generation = 'legacy', withPrevious = true) {
  const db = testDb();
  const base = { siteId, accountId: ACCOUNT, bindingGenerationId: generation, windowDays: 28 };
  const rows = (key: string, sessions: number) => [
    { key, sessions, activeUsers: sessions - 1, engagedSessions: sessions - 2, keyEvents: 1 },
  ];
  const snapshots = [ASOF, ...(withPrevious ? [addDays(ASOF, -7)] : [])];
  for (const snapshotDate of snapshots) {
    await upsertGa4Metrics(db, { ...base, snapshotDate, dimensionSet: 'channel', rows: rows('Organic Search', 40) });
    await upsertGa4Metrics(db, { ...base, snapshotDate, dimensionSet: 'page', rows: rows('/home', 30) });
    await upsertGa4Metrics(db, { ...base, snapshotDate, dimensionSet: 'country', rows: rows('US', 25) });
    await upsertGa4Metrics(db, { ...base, snapshotDate, dimensionSet: 'device', rows: rows('mobile', 20) });
  }
  await upsertGa4Metrics(db, {
    ...base,
    windowDays: 90,
    snapshotDate: ASOF,
    dimensionSet: 'date',
    rows: [
      ...rows(addDays(ASOF, -1), 10),
      ...rows(ASOF, 12),
    ],
  });
}

interface Row {
  clicks: number;
  query?: string;
  url?: string;
}

interface ToolBody {
  status?: string;
  reason?: string;
  message?: string;
  range?: string;
  dimension?: string;
  startDate?: string;
  endDate?: string;
  asOf?: string;
  timezone?: string;
  totalsSource?: string;
  scopeNote: string;
  scopeNoteKey?: string;
  requiredTier?: string;
  rowsAvailable?: number;
  truncated?: boolean;
  totals?: { clicks: number };
  previousPeriod?: object | null;
  dimensionTotals: { query: { rows: number } };
  freshness?: object;
  topQueries: Row[];
  topPages: Row[];
  rows: Row[];
  channels: object[];
  countries: object[];
  devices: object[];
  dailySeries: object[];
  error: { code: string };
}

function structured(result: McpToolResult): ToolBody {
  return result.structuredContent as unknown as ToolBody;
}

function expectToolError(result: McpToolResult, code: string): void {
  expect(result.isError).toBe(true);
  expect(structured(result).error.code).toBe(code);
}

async function counters() {
  return testDb().select().from(usageCounters);
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});
/** Fresh Mongo state. The Site work lease also takes the owning account's lease, so both accounts need a user doc. */
async function resetMongo(): Promise<void> {
  await clearCollections();
  for (const _id of [ACCOUNT, OTHER_ACCOUNT]) {
    await User.create({ _id, email: `${_id}@example.com`, emailVerified: true });
  }
}

beforeEach(async () => {
  await resetMongo();
  await truncateAllTables();
  vi.clearAllMocks();
  mocks.getAccountMcpSpec.mockResolvedValue(null);
  setGoogleConnectionsDb(testDb());
  setApiKeysDb(testDb());
  setGoogleGscProvider(providerSpies as unknown as GoogleGscProvider);
  setGscSyncQueue({ add: queueAdd } as unknown as Queue);
  setGa4SyncQueue({ add: queueAdd } as unknown as Queue);
  (env as { MCP_ENABLED: boolean }).MCP_ENABLED = true;
});
afterEach(() => {
  (env as { PAYMENT_PROVIDER: string }).PAYMENT_PROVIDER = 'none';
});

describe('get_gsc_search_summary', () => {
  it('answers "clicks and impressions in the last 28 days" from stored daily rows with explicit scope', async () => {
    const siteId = await seedSite();
    await seedGsc(siteId);
    const result = await toolGetGscSearchSummary({ siteId, range: '28d' }, ctx());
    const body = structured(result);
    const expected = expectedWindow(28);
    expect(result.isError).toBeUndefined();
    expect(body).toMatchObject({
      status: 'ok',
      source: 'search_console',
      range: '28d',
      startDate: expected.from,
      endDate: ASOF,
      asOf: ASOF,
      timezone: 'America/Los_Angeles',
      totalsSource: 'date',
      scopeNoteKey: 'dimensionTotalsMayDiffer',
      totals: { clicks: expected.clicks, impressions: expected.impressions },
    });
    expect(typeof body.scopeNote).toBe('string');
    expect(body.scopeNote.length).toBeGreaterThan(0);
    expect(body.startDate).toBe('2026-09-03');
    expect(body.previousPeriod).toMatchObject({ clicks: expect.any(Number) });
    expect(body.dimensionTotals.query.rows).toBe(3);
    expect(body.topQueries).toHaveLength(3);
    expect(body.topPages[0]).toHaveProperty('url');
    expect(body.countries).toHaveLength(1);
    expect(body.devices).toHaveLength(1);
    expect(body.dailySeries).toHaveLength(28);
    expect(result.content[0]?.text).toBeTruthy();
  });

  it('defaults to 28d and sums a different window for 7d; 90d has no previous period', async () => {
    const siteId = await seedSite();
    await seedGsc(siteId);
    const byDefault = structured(await toolGetGscSearchSummary({ siteId }, ctx()));
    expect(byDefault.range).toBe('28d');
    expect(byDefault.totals?.clicks).toBe(expectedWindow(28).clicks);

    const week = structured(await toolGetGscSearchSummary({ siteId, range: '7d' }, ctx()));
    expect(week.totals).toMatchObject({
      clicks: expectedWindow(7).clicks,
      impressions: expectedWindow(7).impressions,
    });
    expect(week.startDate).toBe(windowStart(ASOF, 7));

    const quarter = structured(await toolGetGscSearchSummary({ siteId, range: '90d' }, ctx()));
    expect(quarter.totals?.clicks).toBe(expectedWindow(90).clicks);
    expect(quarter.previousPeriod).toBeNull();
  });

  it('reads snapshots stored under a non-legacy binding generation', async () => {
    const siteId = await seedSite({ generation: 'gen-1' });
    await seedGsc(siteId, 'gen-1');
    const body = structured(await toolGetGscSearchSummary({ siteId }, ctx()));
    expect(body.status).toBe('ok');
    expect(body.totals?.clicks).toBe(expectedWindow(28).clicks);
  });

  it('falls back to query-row totals (with a stored previous period) when no daily rows exist', async () => {
    const siteId = await seedSite({ generation: null });
    const db = testDb();
    const rows = [{ keys: ['only query'], clicks: 7, impressions: 70, ctr: 0.1, position: 3 }];
    const base = { siteId, accountId: ACCOUNT, dimensionSet: 'query', windowDays: 28, rows };
    await upsertSearchAnalytics(db, { ...base, snapshotDate: ASOF });
    const noPrevious = structured(await toolGetGscSearchSummary({ siteId }, ctx()));
    expect(noPrevious).toMatchObject({
      totalsSource: 'query',
      totals: { clicks: 7, impressions: 70 },
      previousPeriod: null,
    });
    await upsertSearchAnalytics(db, { ...base, snapshotDate: addDays(ASOF, -28) });
    const withPrevious = structured(await toolGetGscSearchSummary({ siteId }, ctx()));
    expect(withPrevious.previousPeriod).toEqual({ clicks: 7, impressions: 70 });
  });

  it('reads legacy sites whose binding generation was never stored', async () => {
    const siteId = await seedSite({ generation: null, ga4: true });
    await seedGsc(siteId);
    await seedGa4(siteId);
    expect(structured(await toolGetGscSearchSummary({ siteId }, ctx())).status).toBe('ok');
    expect(structured(await toolListGscTopQueries({ siteId }, ctx())).status).toBe('ok');
    expect(structured(await toolGetGa4Summary({ siteId }, ctx())).status).toBe('ok');
  });

  it('returns an explicit unavailable marker (not zeros) when no snapshot is stored', async () => {
    const siteId = await seedSite();
    const body = structured(await toolGetGscSearchSummary({ siteId }, ctx()));
    expect(body).toMatchObject({ status: 'unavailable', reason: 'snapshotMissing', range: '28d' });
    expect(body.totals).toBeUndefined();
    expect(typeof body.message).toBe('string');
  });

  it('maps connection and binding problems to localized reasons', async () => {
    const noConnection = await seedSite({ connected: false });
    expect(
      structured(await toolGetGscSearchSummary({ siteId: noConnection }, ctx())),
    ).toMatchObject({ status: 'unavailable', reason: 'googleNotConnected' });

    await resetMongo();
    const reconnect = await seedSite();
    await GoogleConnection.updateOne({ accountId: ACCOUNT }, { status: 'needs_reconnect' });
    expect(
      structured(await toolGetGscSearchSummary({ siteId: reconnect }, ctx())),
    ).toMatchObject({ status: 'unavailable', reason: 'googleReconnect' });

    await GoogleConnection.updateOne({ accountId: ACCOUNT }, { status: 'revoked' });
    expect(
      structured(await toolGetGscSearchSummary({ siteId: reconnect }, ctx())),
    ).toMatchObject({ status: 'unavailable', reason: 'googleNotConnected' });

    await resetMongo();
    const unlinked = await seedSite({ property: null });
    expect(
      structured(await toolGetGscSearchSummary({ siteId: unlinked }, ctx())),
    ).toMatchObject({
      status: 'unavailable',
      reason: 'gscNotLinked',
      // QA 10: Google is connected, so the one step is choosing a property.
      setupPath: `/sites/${unlinked}?tab=google`,
    });
  });

  it('rethrows unexpected failures as a generic tool error', async () => {
    const siteId = await seedSite();
    setGoogleConnectionsDb({
      select: () => {
        throw new Error('database exploded');
      },
    } as never);
    expectToolError(await toolGetGscSearchSummary({ siteId }, ctx()), 'common.internalError');
  });

  it('rejects malformed input with the localized invalid-input code', async () => {
    const siteId = await seedSite();
    expectToolError(
      await toolGetGscSearchSummary({ siteId, range: '14d' }, ctx()),
      'mcp.errors.invalidInput',
    );
    expectToolError(
      await toolGetGscSearchSummary({ siteId, extra: 1 }, ctx()),
      'mcp.errors.invalidInput',
    );
    expectToolError(await toolGetGscSearchSummary(undefined, ctx()), 'mcp.errors.invalidInput');
  });
});

describe('list_gsc_top_queries / list_gsc_top_pages', () => {
  it('lists stored query rows with scope fields, stable order and a row limit', async () => {
    const siteId = await seedSite();
    await seedGsc(siteId, 'legacy', 150);

    const first = structured(await toolListGscTopQueries({ siteId }, ctx()));
    expect(first).toMatchObject({
      status: 'ok',
      source: 'search_console',
      dimension: 'query',
      range: '28d',
      startDate: '2026-09-03',
      endDate: ASOF,
      timezone: 'America/Los_Angeles',
      rowsAvailable: 150,
      truncated: true,
      scopeNoteKey: 'dimensionTotalsMayDiffer',
    });
    expect(first.rows).toHaveLength(25);
    expect(first.rows[0]).toMatchObject({ query: 'seo query 0', clicks: 200 });
    expect(first.rows[24]?.clicks).toBeLessThan(first.rows[0]?.clicks ?? 0);

    const maxed = structured(await toolListGscTopQueries({ siteId, limit: 100, range: '7d' }, ctx()));
    expect(maxed.rows).toHaveLength(100);
    expect(maxed.range).toBe('7d');
    expect(maxed.startDate).toBe(windowStart(ASOF, 7));

    expectToolError(
      await toolListGscTopQueries({ siteId, limit: 101 }, ctx()),
      'mcp.errors.invalidInput',
    );
  });

  it('lists top pages ordered by clicks then impressions and is not truncated when it fits', async () => {
    const siteId = await seedSite();
    await seedGsc(siteId);
    const body = structured(await toolListGscTopPages({ siteId, range: '90d' }, ctx()));
    expect(body.dimension).toBe('page');
    expect(body.truncated).toBe(false);
    expect(body.rows.map((row: Row) => row.url)).toEqual([
      'https://example.com/b',
      'https://example.com/a',
    ]);
    expect(body.rowsAvailable).toBe(2);
  });

  it('breaks full ties on the key so ordering is stable', async () => {
    const siteId = await seedSite();
    const db = testDb();
    await upsertSearchAnalytics(db, {
      siteId,
      accountId: ACCOUNT,
      snapshotDate: ASOF,
      dimensionSet: 'query',
      windowDays: 28,
      rows: ['zeta', 'alpha', 'mid'].map((key) => ({
        keys: [key],
        clicks: 5,
        impressions: 50,
        ctr: 0.1,
        position: 2,
      })),
    });
    const body = structured(await toolListGscTopQueries({ siteId }, ctx()));
    expect(body.rows.map((row: Row) => row.query)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('is unavailable without a snapshot or with an unlinked property', async () => {
    const siteId = await seedSite();
    expect(structured(await toolListGscTopQueries({ siteId }, ctx()))).toMatchObject({
      status: 'unavailable',
      reason: 'snapshotMissing',
    });
    await resetMongo();
    const unlinked = await seedSite({ property: null });
    expect(structured(await toolListGscTopPages({ siteId: unlinked }, ctx()))).toMatchObject({
      status: 'unavailable',
      reason: 'gscNotLinked',
    });
  });
});

describe('get_ga4_summary', () => {
  it('returns the stored GA4 window with explicit scope and a previous period', async () => {
    const siteId = await seedSite({ ga4: true });
    await seedGa4(siteId);
    const result = await toolGetGa4Summary({ siteId, range: '28d' }, ctx());
    const body = structured(result);
    expect(body).toMatchObject({
      status: 'ok',
      source: 'google_analytics_4',
      range: '28d',
      startDate: windowStart(ASOF, 28),
      endDate: ASOF,
      asOf: ASOF,
      totals: { sessions: 40, activeUsers: 39, engagedSessions: 38, keyEvents: 1 },
      previousPeriod: { sessions: 40 },
    });
    expect(body.freshness).toHaveProperty('expectedAsOf');
    expect(body.channels).toHaveLength(1);
    expect(body.topPages[0]).toMatchObject({ url: '/home' });
    expect(body.countries).toHaveLength(1);
    expect(body.devices).toHaveLength(1);
    expect(body.dailySeries.length).toBe(28);
  });

  it('reports a null previous period and reads another binding generation', async () => {
    const siteId = await seedSite({ ga4: true, generation: 'gen-2' });
    await seedGa4(siteId, 'gen-2', false);
    const body = structured(await toolGetGa4Summary({ siteId }, ctx()));
    expect(body.status).toBe('ok');
    expect(body.previousPeriod).toBeNull();
  });

  it('maps missing link, connection and snapshot to unavailable reasons', async () => {
    const unlinked = await seedSite({ ga4: false });
    expect(structured(await toolGetGa4Summary({ siteId: unlinked }, ctx()))).toMatchObject({
      status: 'unavailable',
      reason: 'ga4NotLinked',
      source: 'google_analytics_4',
    });

    await resetMongo();
    const noScope = await seedSite({ ga4: true, scopes: [SCOPE_GSC] });
    expect(structured(await toolGetGa4Summary({ siteId: noScope }, ctx()))).toMatchObject({
      reason: 'ga4NotLinked',
    });

    await resetMongo();
    const noSnapshot = await seedSite({ ga4: true });
    expect(structured(await toolGetGa4Summary({ siteId: noSnapshot }, ctx()))).toMatchObject({
      status: 'unavailable',
      reason: 'snapshotMissing',
    });

    await resetMongo();
    const disconnected = await seedSite({ ga4: true, connected: false });
    expect(structured(await toolGetGa4Summary({ siteId: disconnected }, ctx()))).toMatchObject({
      reason: 'googleNotConnected',
    });
  });

  it('answers locked (not an error) below Pro and works at Pro', async () => {
    (env as { PAYMENT_PROVIDER: string }).PAYMENT_PROVIDER = 'polar';
    const siteId = await seedSite({ ga4: true });
    await seedGa4(siteId);
    await testDb()
      .insert(subscriptions)
      .values({ accountId: ACCOUNT, tier: 'starter', status: 'active' });

    const locked = await toolGetGa4Summary({ siteId }, ctx());
    expect(locked.isError).toBeUndefined();
    expect(structured(locked)).toMatchObject({
      status: 'locked',
      reason: 'featureLocked',
      requiredTier: 'pro',
    });
    expect(structured(locked).totals).toBeUndefined();

    await testDb()
      .update(subscriptions)
      .set({ tier: 'pro' });
    expect(structured(await toolGetGa4Summary({ siteId }, ctx())).status).toBe('ok');
  });
});

describe('isolation and permissions', () => {
  const tools = [
    ['get_gsc_search_summary', toolGetGscSearchSummary],
    ['list_gsc_top_queries', toolListGscTopQueries],
    ['list_gsc_top_pages', toolListGscTopPages],
    ['get_ga4_summary', toolGetGa4Summary],
  ] as const;

  it.each(tools)('%s: another account\'s site is not found (never forbidden)', async (_name, tool) => {
    const siteId = await seedSite({ ga4: true });
    await seedGsc(siteId);
    await seedGa4(siteId);
    const result = await tool({ siteId }, ctx({ accountId: OTHER_ACCOUNT }));
    expectToolError(result, 'sites.errors.notFound');
    expect(structured(result).totals).toBeUndefined();
  });

  it.each(tools)('%s: a site outside allowedSiteIds reads as not found', async (_name, tool) => {
    const siteId = await seedSite({ ga4: true });
    await seedGsc(siteId);
    const permissions = resolveEffectivePermissions(
      { allowedSiteIds: ['64b0c0ffee0000000000c003'] },
      null,
      MCP_TOOL_NAMES,
    );
    expectToolError(await tool({ siteId }, ctx({ permissions })), 'sites.errors.notFound');
  });

  it('intersects account defaults with key scopes at execution', async () => {
    const siteId = await seedSite();
    await seedGsc(siteId);
    const other = '64b0c0ffee0000000000c003';
    const allowed = resolveEffectivePermissions({ allowedSiteIds: [siteId, other] }, { allowedSiteIds: [siteId] }, MCP_TOOL_NAMES);
    expect(structured(await toolGetGscSearchSummary({ siteId }, ctx({ permissions: allowed }))).status).toBe('ok');
    const denied = resolveEffectivePermissions({ allowedSiteIds: [siteId, other] }, { allowedSiteIds: [other] }, MCP_TOOL_NAMES);
    expect(denied.allowedSiteIds).toEqual([other]);
    expectToolError(
      await toolGetGscSearchSummary({ siteId }, ctx({ permissions: denied })),
      'sites.errors.notFound',
    );
  });

  it('a deleted or malformed site id is not found', async () => {
    const siteId = await seedSite();
    await Site.updateOne({ _id: siteId }, { $set: { deletionStartedAt: new Date() } });
    expectToolError(await toolGetGscSearchSummary({ siteId }, ctx()), 'sites.errors.notFound');
    expectToolError(
      await toolGetGscSearchSummary({ siteId: 'not-an-id' }, ctx()),
      'mcp.errors.invalidInput',
    );
  });
});

describe('no spend, no provider, no queue', () => {
  it('leaves usage counters untouched and never calls Google or enqueues', async () => {
    const siteId = await seedSite({ ga4: true });
    await seedGsc(siteId);
    await seedGa4(siteId);
    const before = await counters();
    for (const [tool, input] of [
      [toolGetGscSearchSummary, { siteId }],
      [toolListGscTopQueries, { siteId }],
      [toolListGscTopPages, { siteId }],
      [toolGetGa4Summary, { siteId }],
    ] as const) {
      expect(structured(await tool(input, ctx())).status).toBe('ok');
    }
    expect(await counters()).toEqual(before);
    expect(queueAdd).not.toHaveBeenCalled();
    for (const spy of Object.values(providerSpies)) expect(spy).not.toHaveBeenCalled();
  });
});

describe('through the MCP transport', () => {
  const authenticate: RequestHandler = (req, _res, next) => {
    req.user = { id: ACCOUNT } as never;
    req.apiKeyScopes = null;
    next();
  };
  const app = express();
  app.use(express.json());
  app.use('/api/mcp', bearerLanguage, authenticate, mcpRouter);
  app.use(errorHandler);

  const rpc = (body: object) =>
    request(app)
      .post('/api/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send(body);

  it('exposes the four tools and answers the 28-day question end to end', async () => {
    const siteId = await seedSite();
    await seedGsc(siteId);
    const list = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const names = list.body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'get_gsc_search_summary',
        'list_gsc_top_queries',
        'list_gsc_top_pages',
        'get_ga4_summary',
      ]),
    );
    const call = await rpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_gsc_search_summary', arguments: { siteId, range: '28d' } },
    });
    expect(call.body.result.structuredContent).toMatchObject({
      status: 'ok',
      range: '28d',
      startDate: '2026-09-03',
      endDate: ASOF,
      totals: { clicks: expectedWindow(28).clicks },
    });
  });

  it('does not register a tool the account turned off', async () => {
    const siteId = await seedSite();
    mocks.getAccountMcpSpec.mockResolvedValue({ tools: { get_gsc_search_summary: false } });
    const list = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const names = list.body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).not.toContain('get_gsc_search_summary');
    expect(names).toContain('list_gsc_top_queries');
    const call = await rpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_gsc_search_summary', arguments: { siteId } },
    });
    expect(call.body.error).toBeDefined();
    expect(call.body.result).toBeUndefined();
  });
});
