/**
 * Keyword-research stored-data read tools — real Mongo-memory + PGlite + Better
 * Auth harness. History is seeded through the HTTP flow, so the tools read
 * exactly what a real lookup stored.
 */
// Entry via the module barrel first: it evaluates the registry before the
// controller, which the barrel/permissions import cycle requires.
import './index.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { getTestDb, startTestPostgres, stopTestPostgres, truncateAllTables } from '../../shared/testing/postgres.js';
import { installTestAuth, signupVerifiedUser, uninstallTestAuth, type TestUser } from '../../shared/testing/auth.js';
import { Site } from '../sites/index.js';
import { keywordResearchHistory, vendorCache } from '../../db/schema/index.js';
import { createFakeKeywordProvider, FAKE_KEYWORD_METRICS, type KeywordProvider } from '../../shared/providers/index.js';
import { setKeywordProvider, setKeywordResearchDb } from '../keyword-research/index.js';
import { setRanksDb } from '../ranks/index.js';
import { resolveEffectivePermissions } from '../../shared/mcp-permissions/index.js';
import { STORED_READ_MAX_BYTES } from './mcp.read-kit.js';
import { MCP_TOOL_NAMES } from './mcp.registry.js';
import { toolGetKeywordResearchResult, toolListKeywordResearchHistory } from './mcp.tools.keyword-research.js';
import type { McpToolContext } from './mcp.tools.js';

const app = createApp();
const MARKET = { locationCode: 2840, languageCode: 'en' };
const oid = () => new mongoose.Types.ObjectId().toString();
const UNKNOWN_UUID = '11111111-1111-4111-8111-111111111111';

function contextFor(
  accountId: string,
  accountSpec: Parameters<typeof resolveEffectivePermissions>[0] = null,
  keySpec: Parameters<typeof resolveEffectivePermissions>[1] = null,
): McpToolContext {
  return { accountId, locale: 'en', permissions: resolveEffectivePermissions(accountSpec, keySpec, MCP_TOOL_NAMES) };
}

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedSite(accountId: string, domain: string): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
  });
  return String(site._id);
}

async function post(user: TestUser, path: string, body: Record<string, unknown>) {
  const res = await request(app)
    .post(`/api/keyword-research/${path}`)
    .set('Cookie', user.cookie)
    .send({ ...MARKET, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function historyRows(accountId: string) {
  return getTestDb()
    .select()
    .from(keywordResearchHistory)
    .where(eq(keywordResearchHistory.accountId, accountId))
    .orderBy(keywordResearchHistory.createdAt, keywordResearchHistory.id);
}

const PROVIDER_METHODS = ['getMetrics', 'getRelated', 'classifyIntent', 'getIdeas', 'getLongTailSuggestions'] as const;
let spies: Array<ReturnType<typeof vi.spyOn>>;
const providerCalls = () => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);

function installProvider(base: KeywordProvider = createFakeKeywordProvider()) {
  spies = PROVIDER_METHODS.map((method) => vi.spyOn(base, method));
  setKeywordProvider(base);
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setKeywordResearchDb(db as never);
  setRanksDb(db as never);
});
afterAll(async () => {
  uninstallTestAuth();
  setKeywordResearchDb(null);
  setRanksDb(null);
  setKeywordProvider(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  installProvider();
});

describe('list_keyword_research_history', () => {
  it('lists stored history newest first, pages by cursor, and never calls the provider', async () => {
    const user = await seedUser('hist@x.co');
    const lookupId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    await post(user, 'metrics', { keywords: ['seo audit tool'], lookupId });
    await post(user, 'ideas', { seed: 'seo audit tool' });
    const callsBefore = providerCalls();
    const rowsBefore = (await historyRows(user.id)).length;

    const first = await toolListKeywordResearchHistory({ limit: 1 }, contextFor(user.id));
    const body = first.structuredContent as { history: Array<Record<string, unknown>>; nextCursor: string | null };
    expect(first.isError).toBeUndefined();
    expect(first.structuredContent).toMatchObject({
      status: 'ok',
      source: 'stored_history',
      rowsReturned: 1,
      totalCount: 2,
      truncated: true,
    });
    expect(body.history[0]).toMatchObject({
      kind: 'ideas',
      phrases: ['seo audit tool'],
      locationCode: 2840,
      languageCode: 'en',
      servedFromCache: false,
      lookupId: null,
    });
    expect(typeof body.history[0]?.id).toBe('string');
    expect(typeof body.history[0]?.createdAt).toBe('string');
    expect(body.nextCursor).toBeTruthy();

    const second = await toolListKeywordResearchHistory({ limit: 5, cursor: body.nextCursor }, contextFor(user.id));
    const secondBody = second.structuredContent as { history: Array<Record<string, unknown>> };
    expect(secondBody.history).toHaveLength(1);
    expect(secondBody.history[0]).toMatchObject({ kind: 'metrics', lookupId });
    expect(second.structuredContent).toMatchObject({ truncated: false, nextCursor: null });

    expect(providerCalls()).toBe(callsBefore);
    expect(await historyRows(user.id)).toHaveLength(rowsBefore);
  });

  it('reports empty for an account with no history and isolates accounts', async () => {
    const owner = await seedUser('hist-owner@x.co');
    const other = await seedUser('hist-other@x.co');
    await post(owner, 'metrics', { keywords: ['seo audit tool'] });
    const result = await toolListKeywordResearchHistory({}, contextFor(other.id));
    expect(result.structuredContent).toMatchObject({ status: 'empty', reason: 'noData' });
    expect(result.structuredContent).not.toHaveProperty('history');
  });

  it('rejects cursors from another account or unknown rows as a tool error', async () => {
    const owner = await seedUser('cur-owner@x.co');
    const other = await seedUser('cur-other@x.co');
    await post(owner, 'metrics', { keywords: ['seo audit tool'] });
    await post(other, 'metrics', { keywords: ['rank tracker'] });
    const ownerRow = (await historyRows(owner.id))[0]!;
    const foreign = await toolListKeywordResearchHistory({ cursor: ownerRow.id }, contextFor(other.id));
    expect(foreign.isError).toBe(true);
    const unknown = await toolListKeywordResearchHistory({ cursor: UNKNOWN_UUID }, contextFor(owner.id));
    expect(unknown.isError).toBe(true);
    const malformed = await toolListKeywordResearchHistory({ cursor: 'nope' }, contextFor(owner.id));
    expect(malformed.structuredContent.error).toMatchObject({ code: 'mcp.errors.invalidInput' });
  });

  it('hides rows outside the allowed sites and all account-level rows when restricted', async () => {
    const user = await seedUser('hist-sites@x.co');
    const siteA = await seedSite(user.id, 'a.example');
    const siteB = await seedSite(user.id, 'b.example');
    await post(user, 'metrics', { keywords: ['seo audit tool'], siteId: siteA });
    await post(user, 'metrics', { keywords: ['rank tracker'], siteId: siteB });
    await post(user, 'ideas', { seed: 'account level seed' });

    const open = await toolListKeywordResearchHistory({}, contextFor(user.id));
    expect((open.structuredContent as { history: unknown[] }).history).toHaveLength(3);

    const restricted = await toolListKeywordResearchHistory(
      {},
      contextFor(user.id, { allowedSiteIds: [siteA, siteB] }, { allowedSiteIds: [siteA] }),
    );
    const rows = (restricted.structuredContent as { history: Array<{ phrases: string[] }> }).history;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.phrases).toEqual(['seo audit tool']);

    const none = await toolListKeywordResearchHistory(
      {},
      { ...contextFor(user.id), permissions: { tools: {}, allowedSiteIds: [], allowSpend: true } },
    );
    expect(none.structuredContent).toMatchObject({ status: 'empty', reason: 'noData' });
  });

  it('rejects out-of-range limits', async () => {
    const user = await seedUser('hist-limit@x.co');
    const tooMany = await toolListKeywordResearchHistory({ limit: 101 }, contextFor(user.id));
    expect(tooMany.isError).toBe(true);
  });
});

describe('get_keyword_research_result', () => {
  it('re-opens a metrics lookup from the cache with no provider call or history row', async () => {
    const user = await seedUser('res-metrics@x.co');
    const lookupId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    await post(user, 'metrics', { keywords: ['seo audit tool', 'rank tracker'], lookupId });
    await post(user, 'intent', { keywords: ['seo audit tool', 'rank tracker'], lookupId });
    const row = (await historyRows(user.id))[0]!;
    const callsBefore = providerCalls();
    const rowsBefore = (await historyRows(user.id)).length;

    const result = await toolGetKeywordResearchResult({ historyId: row.id }, contextFor(user.id));
    const body = result.structuredContent as Record<string, unknown> & { keywords: Array<Record<string, unknown>> };
    expect(result.isError).toBeUndefined();
    expect(body).toMatchObject({
      status: 'ok',
      source: 'stored_cache',
      id: row.id,
      kind: 'metrics',
      lookupId,
      phrases: ['seo audit tool', 'rank tracker'],
      locationCode: 2840,
      languageCode: 'en',
      storedStatus: 'available',
      requestedCount: 2,
      storedCount: 2,
      seed: null,
      truncated: false,
    });
    expect(body).not.toHaveProperty('refreshUnits');
    expect(body.keywords).toHaveLength(2);
    expect(body.keywords[0]).toMatchObject({ keyword: 'seo audit tool', searchVolume: 5400, intent: 'commercial' });
    expect(typeof body.fetchedAt).toBe('string');
    expect(typeof body.expiresAt).toBe('string');

    expect(providerCalls()).toBe(callsBefore);
    expect(await historyRows(user.id)).toHaveLength(rowsBefore);
  });

  it('reports a partially stored lookup as ok with a partial storedStatus', async () => {
    const user = await seedUser('res-partial@x.co');
    await post(user, 'metrics', { keywords: ['seo audit tool', 'rank tracker'] });
    const row = (await historyRows(user.id))[0]!;
    const cached = await getTestDb().select().from(vendorCache);
    await getTestDb().delete(vendorCache).where(eq(vendorCache.id, cached[0]!.id));
    const result = await toolGetKeywordResearchResult({ historyId: row.id }, contextFor(user.id));
    expect(result.structuredContent).toMatchObject({ status: 'ok', storedStatus: 'partial', requestedCount: 2, storedCount: 1 });
  });

  it('returns the stored expansion list for a seed lookup and clips it at 100 rows', async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ ...FAKE_KEYWORD_METRICS[0]!, keyword: `generated idea number ${i}` }));
    installProvider(createFakeKeywordProvider({ ideas: many }));
    const user = await seedUser('res-ideas@x.co');
    await post(user, 'ideas', { seed: 'seo audit tool', limit: 1000 });
    const row = (await historyRows(user.id))[0]!;
    const result = await toolGetKeywordResearchResult({ historyId: row.id }, contextFor(user.id));
    const body = result.structuredContent as { items: unknown[]; keywords: unknown[] };
    expect(result.structuredContent).toMatchObject({
      status: 'ok',
      kind: 'ideas',
      seed: 'seo audit tool',
      storedStatus: 'available',
      truncated: true,
    });
    expect(body.items).toHaveLength(100);
    expect(body.keywords).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(result.structuredContent))).toBeLessThanOrEqual(STORED_READ_MAX_BYTES);
  });

  it('marks an evicted cache as unavailable/expired but keeps the lookup facts', async () => {
    const user = await seedUser('res-expired@x.co');
    await post(user, 'metrics', { keywords: ['seo audit tool'] });
    const row = (await historyRows(user.id))[0]!;
    await getTestDb().delete(vendorCache);
    const result = await toolGetKeywordResearchResult({ historyId: row.id }, contextFor(user.id));
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      status: 'unavailable',
      reason: 'expired',
      id: row.id,
      storedStatus: 'expired',
      storedCount: 0,
      phrases: ['seo audit tool'],
    });
  });

  it('marks kinds without a stored read as unavailable/unsupported', async () => {
    const user = await seedUser('res-unsupported@x.co');
    const [inserted] = await getTestDb()
      .insert(keywordResearchHistory)
      .values({
        accountId: user.id,
        kind: 'overview',
        phrases: ['seo audit tool'],
        locationCode: 2840,
        languageCode: 'en',
        resultCount: 1,
        cached: false,
      })
      .returning();
    const result = await toolGetKeywordResearchResult({ historyId: inserted!.id }, contextFor(user.id));
    expect(result.structuredContent).toMatchObject({ status: 'unavailable', reason: 'unsupported', storedStatus: 'unsupported' });
  });

  it('returns not-found for another account, unknown ids and hidden rows; rejects bad ids', async () => {
    const owner = await seedUser('res-owner@x.co');
    const stranger = await seedUser('res-stranger@x.co');
    const siteA = await seedSite(owner.id, 'a.example');
    await post(owner, 'metrics', { keywords: ['seo audit tool'], siteId: siteA });
    await post(owner, 'metrics', { keywords: ['rank tracker'] });
    const [siteRow, accountRow] = await historyRows(owner.id);

    const foreign = await toolGetKeywordResearchResult({ historyId: siteRow!.id }, contextFor(stranger.id));
    expect(foreign.isError).toBe(true);
    expect(foreign.structuredContent.error).toMatchObject({ code: 'keywordResearch.errors.historyNotFound' });
    const unknown = await toolGetKeywordResearchResult({ historyId: UNKNOWN_UUID }, contextFor(owner.id));
    expect(unknown.isError).toBe(true);

    const restricted = contextFor(owner.id, null, { allowedSiteIds: [siteA] });
    const allowed = await toolGetKeywordResearchResult({ historyId: siteRow!.id }, restricted);
    expect(allowed.structuredContent.status).toBe('ok');
    const accountLevel = await toolGetKeywordResearchResult({ historyId: accountRow!.id }, restricted);
    expect(accountLevel.isError).toBe(true);
    const otherSite = await toolGetKeywordResearchResult(
      { historyId: siteRow!.id },
      contextFor(owner.id, { allowedSiteIds: [oid()] }),
    );
    expect(otherSite.isError).toBe(true);

    const bad = await toolGetKeywordResearchResult({ historyId: 'nope' }, contextFor(owner.id));
    expect(bad.structuredContent.error).toMatchObject({ code: 'mcp.errors.invalidInput' });
  });
});
