/**
 * Backlinks stored-data read tools — real Mongo-memory +
 * PGlite harness. The load-bearing guarantee: neither tool moves a usage
 * counter, calls the provider, or enqueues a deep pull.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { eq } from 'drizzle-orm';
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
import { vendorCache, vendorResponses } from '../../db/schema/vendor-cache.js';
import { backlinkSnapshots } from '../../db/schema/backlinks.js';
import { Site } from '../sites/index.js';
import { User } from '../users/users.model.js';
import {
  createFakeBacklinkProvider,
  type BacklinkProvider,
} from '../../shared/providers/index.js';
import { computeVendorCacheKey } from '../../shared/vendor-cache/index.js';
import { createInMemoryCooldown } from '../../shared/cooldown/index.js';
import {
  listBacklinksPaged,
  refreshBacklinkSummary,
  setBacklinkDeepQueue,
  setBacklinkProvider,
  setBacklinksCooldown,
  setBacklinksDb,
} from '../backlinks/index.js';
import { setApiKeysDb } from '../api-keys/index.js';
import { resolveEffectivePermissions } from '../../shared/mcp-permissions/index.js';
import { STORED_READ_MAX_BYTES } from './mcp.read-kit.js';
import { toolGetBacklinksSummary, toolListBacklinks } from './mcp.tools.backlinks.js';
import type { McpToolContext } from './mcp.tools.js';

const TOOLS = ['get_backlinks_summary', 'list_backlinks'] as const;
const oid = () => new mongoose.Types.ObjectId().toString();

function contextFor(
  accountId: string,
  accountSpec: Parameters<typeof resolveEffectivePermissions>[0] = null,
  keySpec: Parameters<typeof resolveEffectivePermissions>[1] = null,
): McpToolContext {
  return {
    accountId,
    locale: 'en',
    permissions: resolveEffectivePermissions(accountSpec, keySpec, TOOLS),
  };
}

async function seedAccount(): Promise<string> {
  const accountId = oid();
  await User.create({ _id: accountId, email: `${accountId}@example.test` });
  return accountId;
}

async function seedSite(accountId: string, domain = 'example.com'): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
  });
  return String(site._id);
}

function spiedProvider(base: BacklinkProvider = createFakeBacklinkProvider()) {
  const getSummary = vi.spyOn(base, 'getSummary');
  const listBacklinks = vi.spyOn(base, 'listBacklinks');
  return {
    provider: base,
    calls: () => getSummary.mock.calls.length + listBacklinks.mock.calls.length,
  };
}

/** Seed path: one refresh + one fresh first-page pull. */
async function seedStoredData(accountId: string, siteId: string, provider: BacklinkProvider) {
  const db = getTestDb() as never;
  await refreshBacklinkSummary(
    { accountId, siteId },
    { db, provider, cooldown: createInMemoryCooldown({ defaultMs: 0 }) },
  );
  await listBacklinksPaged(
    { accountId, siteId, limit: 100, fresh: true },
    { db, provider },
  );
}

/** Row counts of the vendor cache + archive: a stored read must not write either. */
async function counters(): Promise<string> {
  const db = getTestDb();
  const cache = await db.select().from(vendorCache);
  const archive = await db.select().from(vendorResponses);
  return `${cache.length}:${archive.length}`;
}

async function expectSpendFree(run: () => Promise<unknown>, calls: () => number) {
  const before = await counters();
  const callsBefore = calls();
  await run();
  expect(await counters()).toBe(before);
  expect(calls()).toBe(callsBefore);
}

const deepQueue = { add: vi.fn(), addBulk: vi.fn() };

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  setBacklinksDb(db as never);
  setApiKeysDb(db as never);
  setBacklinkDeepQueue(deepQueue as never);
});
afterAll(async () => {
  setBacklinksDb(null);
  setApiKeysDb(null);
  setBacklinkDeepQueue(null);
  setBacklinkProvider(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setBacklinksCooldown(null);
  deepQueue.add.mockClear();
  deepQueue.addBulk.mockClear();
});

describe('get_backlinks_summary', () => {
  it('returns labelled stored counts without spending', async () => {
    const accountId = await seedAccount();
    const siteId = await seedSite(accountId);
    const spy = spiedProvider();
    setBacklinkProvider(spy.provider);
    await seedStoredData(accountId, siteId, spy.provider);

    const before = await counters();
    const calls = spy.calls();
    const result = await toolGetBacklinksSummary({ siteId }, contextFor(accountId));
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      status: 'ok',
      siteId,
      domain: 'example.com',
      source: 'stored_snapshot',
      totalLinks: expect.any(Number),
      referringDomains: expect.any(Number),
      brokenLinks: expect.any(Number),
      countScopes: {
        totalLinks: 'every_link',
        referringDomains: 'distinct_referring_domains',
      },
    });
    expect(typeof result.structuredContent.fetchedAt).toBe('string');
    expect(await counters()).toBe(before);
    expect(spy.calls()).toBe(calls);
    expect(deepQueue.add).not.toHaveBeenCalled();
    expect(result.content[0]?.type).toBe('text');
  });

  it('reads the cross-user cache without writing a snapshot (and past its TTL)', async () => {
    const owner = await seedAccount();
    const ownerSite = await seedSite(owner);
    const spy = spiedProvider();
    await seedStoredData(owner, ownerSite, spy.provider);
    await getTestDb()
      .update(vendorCache)
      .set({ expiresAt: new Date(Date.now() - 86_400_000) });
    const other = await seedAccount();
    const otherSite = await seedSite(other);

    const result = await toolGetBacklinksSummary({ siteId: otherSite }, contextFor(other));
    expect(result.structuredContent.status).toBe('ok');
    const snapshots = await getTestDb()
      .select()
      .from(backlinkSnapshots)
      .where(eq(backlinkSnapshots.siteId, otherSite));
    expect(snapshots).toHaveLength(0);
  });

  it('reports empty (not zeros) when nothing is stored, and ignores malformed cache rows', async () => {
    const accountId = await seedAccount();
    const siteId = await seedSite(accountId);
    const spy = spiedProvider();
    setBacklinkProvider(spy.provider);
    const empty = await toolGetBacklinksSummary({ siteId }, contextFor(accountId));
    expect(empty.structuredContent).toMatchObject({ status: 'empty', reason: 'noData' });
    expect(empty.structuredContent).not.toHaveProperty('totalLinks');

    const other = await seedAccount();
    const otherSite = await seedSite(other, 'broken.example');
    await getTestDb().insert(vendorCache).values({
      capability: 'backlink',
      operation: 'summary',
      cacheKey: computeVendorCacheKey({
        capability: 'backlink',
        operation: 'summary',
        params: { domain: 'broken.example' },
      }),
      params: {},
      payload: { nope: true },
      fetchedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
    } as never);
    const malformed = await toolGetBacklinksSummary({ siteId: otherSite }, contextFor(other));
    expect(malformed.structuredContent.status).toBe('empty');
    expect(spy.calls()).toBe(0);
  });

  it('returns a not-found tool error for another account, a blocked site and bad input', async () => {
    const owner = await seedAccount();
    const siteId = await seedSite(owner);
    const stranger = await seedAccount();

    const foreign = await toolGetBacklinksSummary({ siteId }, contextFor(stranger));
    expect(foreign.isError).toBe(true);
    expect(foreign.structuredContent.error).toMatchObject({ code: 'sites.errors.notFound' });

    const blocked = await toolGetBacklinksSummary(
      { siteId },
      contextFor(owner, { allowedSiteIds: [oid()] }),
    );
    expect(blocked.isError).toBe(true);
    expect(blocked.structuredContent.error).toMatchObject({ code: 'sites.errors.notFound' });

    const invalid = await toolGetBacklinksSummary({ siteId: 'nope' }, contextFor(owner));
    expect(invalid.isError).toBe(true);
    expect(invalid.structuredContent.error).toMatchObject({ code: 'mcp.errors.invalidInput' });

    const missing = await toolGetBacklinksSummary(undefined, contextFor(owner));
    expect(missing.isError).toBe(true);
  });

  it('intersects account defaults with key scopes for allowed sites', async () => {
    const accountId = await seedAccount();
    const siteA = await seedSite(accountId, 'a.example');
    const siteB = await seedSite(accountId, 'b.example');
    const ctx = contextFor(
      accountId,
      { allowedSiteIds: [siteA, siteB] },
      { allowedSiteIds: [siteB] },
    );
    const denied = await toolGetBacklinksSummary({ siteId: siteA }, ctx);
    expect(denied.isError).toBe(true);
    const allowed = await toolGetBacklinksSummary({ siteId: siteB }, ctx);
    expect(allowed.isError).toBeUndefined();
    expect(allowed.structuredContent.status).toBe('empty');
  });

  it('treats a site mid-deletion as not found', async () => {
    const accountId = await seedAccount();
    const siteId = await seedSite(accountId);
    await Site.updateOne({ _id: siteId }, { $set: { deletionStartedAt: new Date() } });
    const result = await toolGetBacklinksSummary({ siteId }, contextFor(accountId));
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toMatchObject({ code: 'sites.errors.notFound' });
  });
});

describe('list_backlinks', () => {
  it('lists the stored first page with truthful scope labels and no cursor', async () => {
    const accountId = await seedAccount();
    const siteId = await seedSite(accountId);
    const spy = spiedProvider();
    setBacklinkProvider(spy.provider);
    await seedStoredData(accountId, siteId, spy.provider);

    let result: Awaited<ReturnType<typeof toolListBacklinks>> | undefined;
    await expectSpendFree(async () => {
      result = await toolListBacklinks({ siteId }, contextFor(accountId));
    }, spy.calls);
    const body = result!.structuredContent as Record<string, unknown> & {
      rows: Array<Record<string, unknown>>;
    };
    expect(result!.isError).toBeUndefined();
    expect(body).toMatchObject({
      status: 'ok',
      source: 'stored_first_page',
      scope: 'one_per_referring_domain',
      rowsReturned: 3,
      rowsStored: 3,
      moreRowsExistInApp: true,
    });
    expect(body).not.toHaveProperty('nextCursor');
    expect(JSON.stringify(body)).not.toContain('fake-cursor-2');
    expect(typeof body.fetchedAt).toBe('string');
    expect(body.rows[0]).toMatchObject({
      domainFrom: 'blog.example.net',
      urlFrom: 'https://blog.example.net/best-tools',
      anchor: 'example tool',
      dofollow: true,
      isBroken: false,
      spamScore: 70,
    });
    const flagged = body.rows.find((row) => row.suspicion !== null);
    expect(flagged?.suspicion).toMatchObject({ status: 'suspected', verified: false });
    expect(Array.isArray((flagged?.suspicion as { reasons: unknown }).reasons)).toBe(true);
    expect(body.rows.some((row) => row.suspicion === null)).toBe(true);
    expect(deepQueue.add).not.toHaveBeenCalled();
  });

  it('honours limit, never exceeds 100 rows or 64 KB, and writes nothing to the vendor cache', async () => {
    const accountId = await seedAccount();
    const siteId = await seedSite(accountId);
    const rows = Array.from({ length: 130 }, (_, i) => ({
      domainFrom: `d${i}.example.net`,
      urlFrom: `https://d${i}.example.net/${'long-path-segment/'.repeat(8)}${i}`,
      urlTo: 'https://example.com/',
      anchor: `anchor text number ${i} <b>bold</b>`,
      dofollow: i % 2 === 0,
      isBroken: false,
      firstSeen: new Date('2026-01-01T00:00:00Z'),
      lastSeen: new Date('2026-02-01T00:00:00Z'),
      backlinkSpamScore: i % 100,
      urlToSpamScore: 0,
    }));
    const spy = spiedProvider(createFakeBacklinkProvider({ page: { rows } }));
    setBacklinkProvider(spy.provider);
    await seedStoredData(accountId, siteId, spy.provider);
    const before = await counters();

    const small = await toolListBacklinks({ siteId, limit: 2 }, contextFor(accountId));
    expect(small.structuredContent).toMatchObject({
      status: 'ok',
      rowsReturned: 2,
      rowsStored: 130,
      truncated: true,
      moreRowsExistInApp: false,
    });

    const big = await toolListBacklinks({ siteId, limit: 100 }, contextFor(accountId));
    const bigBody = big.structuredContent as { rows: Array<{ anchor: string }>; rowsReturned: number };
    expect(bigBody.rowsReturned).toBe(100);
    expect(bigBody.rows).toHaveLength(100);
    expect(Buffer.byteLength(JSON.stringify(big.structuredContent))).toBeLessThanOrEqual(
      STORED_READ_MAX_BYTES,
    );
    // Untrusted markup in anchors is neutralized, not rejected by the denylist.
    expect(bigBody.rows[0]?.anchor).not.toContain('<');

    const defaulted = await toolListBacklinks({ siteId }, contextFor(accountId));
    expect(defaulted.structuredContent).toMatchObject({ rowsReturned: 25 });

    expect(await counters()).toBe(before);
    expect(spy.calls()).toBe(2);
  });

  it('keeps optional row fields as explicit nulls', async () => {
    const accountId = await seedAccount();
    const siteId = await seedSite(accountId);
    const spy = spiedProvider(
      createFakeBacklinkProvider({
        page: {
          rows: [
            {
              urlFrom: 'https://plain.example.org/page',
              urlTo: 'https://example.com/',
              anchor: null,
              dofollow: false,
              isBroken: true,
              firstSeen: null,
              lastSeen: null,
              backlinkSpamScore: null,
              urlToSpamScore: null,
            },
          ],
          nextCursor: undefined,
        },
      }),
    );
    setBacklinkProvider(spy.provider);
    await seedStoredData(accountId, siteId, spy.provider);
    const result = await toolListBacklinks({ siteId }, contextFor(accountId));
    const body = result.structuredContent as { rows: Array<Record<string, unknown>> };
    expect(body.rows[0]).toMatchObject({
      domainFrom: null,
      anchor: null,
      firstSeen: null,
      lastSeen: null,
      spamScore: null,
      isBroken: true,
      suspicion: null,
    });
    expect(result.structuredContent).toMatchObject({ truncated: false, moreRowsExistInApp: false });
  });

  it('reports empty when no first page is stored and never fetches', async () => {
    const accountId = await seedAccount();
    const siteId = await seedSite(accountId);
    const spy = spiedProvider();
    setBacklinkProvider(spy.provider);
    const result = await toolListBacklinks({ siteId }, contextFor(accountId));
    expect(result.structuredContent).toMatchObject({ status: 'empty', reason: 'noData' });
    expect(spy.calls()).toBe(0);
    expect(await counters()).toBe('0:0');
  });

  it('rejects a cursor argument (paging reaches the vendor) and enforces limit bounds', async () => {
    const accountId = await seedAccount();
    const siteId = await seedSite(accountId);
    const cursor = await toolListBacklinks({ siteId, cursor: 'abc' }, contextFor(accountId));
    expect(cursor.isError).toBe(true);
    const tooMany = await toolListBacklinks({ siteId, limit: 101 }, contextFor(accountId));
    expect(tooMany.isError).toBe(true);
  });

  it('hides foreign and blocked sites', async () => {
    const owner = await seedAccount();
    const siteId = await seedSite(owner);
    const stranger = await seedAccount();
    const foreign = await toolListBacklinks({ siteId }, contextFor(stranger));
    expect(foreign.isError).toBe(true);
    const blocked = await toolListBacklinks(
      { siteId },
      contextFor(owner, null, { allowedSiteIds: [oid()] }),
    );
    expect(blocked.isError).toBe(true);
    expect(blocked.structuredContent.error).toMatchObject({ code: 'sites.errors.notFound' });
  });
});
