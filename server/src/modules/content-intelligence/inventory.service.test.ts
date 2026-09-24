/**
 * Content inventory service unit tests (prompt 08) — fine-grained branches the
 * router test cannot reach directly: queue-null 503, invalid-id 404s, the
 * concurrent duplicate-start race, cursor pagination + invalid cursor,
 * findings/pages serialization, and the cancel edge cases.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
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
import { Site } from '../sites/index.js';
import {
  ContentInventoryPage,
  ContentInventoryRun,
} from './inventory.model.js';
import {
  cancelInventoryRun,
  getInventoryRun,
  listInventoryRuns,
  startInventoryRun,
  toPublicInventoryRun,
} from './inventory.service.js';

const ACCOUNT = '000000000000000000000abc';

function db(): ApplicationDb {
  return getTestDb() as unknown as ApplicationDb;
}

function okQueue(): Queue {
  return { async add() { return { id: 'x' }; } } as unknown as Queue;
}

async function ownedSite(origin = 'https://example.com'): Promise<string> {
  const site = await Site.create({
    accountId: ACCOUNT,
    url: origin,
    domain: new URL(origin).hostname,
    label: 'site',
  });
  return String(site._id);
}

function body(over: Record<string, unknown> = {}) {
  return { pageLimit: 4, allowedPaths: [], excludedPaths: [], sitemapSeeds: [], locale: 'en' as const, ...over };
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  await ContentInventoryRun.syncIndexes();
});
afterAll(async () => {
  await stopMemoryMongo();
  await stopTestPostgres();
});
afterEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('startInventoryRun — guards', () => {
  it('throws 503 when the queue is unavailable', async () => {
    const siteId = await ownedSite();
    await expect(
      startInventoryRun(
        { accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body() },
        { db: db(), queue: null },
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('throws 404 for an invalid site id', async () => {
    await expect(
      startInventoryRun(
        { accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId: 'not-an-id', body: body() },
        { db: db(), queue: okQueue() },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('resolves concurrent identical requests to a single run (dup-key race)', async () => {
    const siteId = await ownedSite();
    const start = () =>
      startInventoryRun(
        { accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body() },
        { db: db(), queue: okQueue() },
      );
    const [a, b] = await Promise.all([start(), start()]);
    expect(a.runId).toBe(b.runId);
    expect(a.duplicate !== b.duplicate).toBe(true);
    expect(await ContentInventoryRun.countDocuments({ accountId: ACCOUNT })).toBe(1);
  });

  it('rethrows a non-duplicate create failure', async () => {
    const siteId = await ownedSite();
    const spy = vi
      .spyOn(ContentInventoryRun, 'create')
      // A non-object rejection exercises the isDuplicateKeyError type guard.
      .mockRejectedValueOnce('boom' as never);
    await expect(
      startInventoryRun(
        { accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body() },
        { db: db(), queue: okQueue() },
      ),
    ).rejects.toBe('boom');
    spy.mockRestore();
  });

  it('rethrows a duplicate-key failure when the racing run is not visible', async () => {
    const siteId = await ownedSite();
    const spy = vi
      .spyOn(ContentInventoryRun, 'create')
      .mockRejectedValueOnce({ name: 'MongoServerError' } as never);
    // No existing run is present, so the race lookup misses and the error
    // re-raises.
    await expect(
      startInventoryRun(
        { accountId: ACCOUNT, ownerUserId: ACCOUNT, siteId, body: body() },
        { db: db(), queue: okQueue() },
      ),
    ).rejects.toMatchObject({ name: 'MongoServerError' });
    spy.mockRestore();
  });
});

describe('toPublicInventoryRun — defensive fallbacks', () => {
  it('serializes a bare document, filling every missing field', () => {
    const view = toPublicInventoryRun({
      _id: 'run1',
      siteId: 'site1',
      origin: 'https://example.com',
      locale: 'ar',
      status: 'queued',
      warnings: [{
        code: 'inventory_partial_crawl',
        messageKey: 'contentIntelligence.inventory.warnings.partialCrawl',
      }],
    } as never);
    expect(view.input.pageLimit).toBe(0);
    expect(view.progress.blocksReserved).toBe(0);
    expect(view.warnings[0]).toMatchObject({
      code: 'inventory_partial_crawl',
      messageKey: 'contentIntelligence.inventory.warnings.partialCrawl',
    });
    expect(view.findings).toBeNull();
    expect(view).not.toHaveProperty('reservation');
    expect(view.requestedAt).toBeNull();
    expect(view.costMicros).toBe(0);
    expect(toPublicInventoryRun({
      _id: 'legacy-run1',
      siteId: 'site1',
      origin: 'https://example.com',
      locale: 'en',
      status: 'queued',
    } as never).warnings).toEqual([]);
  });
});

describe('listInventoryRuns — pagination', () => {
  it('paginates with an HMAC cursor and rejects a tampered cursor', async () => {
    const siteId = await ownedSite();
    // Two runs on the same site via distinct client keys (bypasses the
    // single-active-run guard is not needed — we insert directly).
    for (let i = 0; i < 2; i += 1) {
      await ContentInventoryRun.create(makeRunDoc(siteId, { requestedAt: new Date(2026, 0, i + 1) }));
    }
    const first = await listInventoryRuns({ accountId: ACCOUNT, siteId, limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await listInventoryRuns({
      accountId: ACCOUNT,
      siteId,
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]!.runId).not.toBe(first.items[0]!.runId);

    await expect(
      listInventoryRuns({ accountId: ACCOUNT, siteId, limit: 1, cursor: 'garbage' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('getInventoryRun — serialization', () => {
  it('serializes findings, run dates, and per-page facts', async () => {
    const siteId = await ownedSite();
    const findings = {
      version: '1',
      thresholdsVersion: '1',
      clusters: [],
      duplicates: [],
      thinPages: [],
      orphanPages: [],
      cannibalization: [],
      gaps: [],
      opportunityExplanation: 'ok',
    };
    const run = await ContentInventoryRun.create(
      makeRunDoc(siteId, {
        status: 'completed',
        findings,
        startedAt: new Date('2026-07-01T00:00:00Z'),
        completedAt: new Date('2026-07-01T01:00:00Z'),
        cancelledAt: new Date('2026-07-01T02:00:00Z'),
      }),
    );

    await ContentInventoryPage.create({
      runId: run._id,
      accountId: ACCOUNT,
      siteId,
      url: 'https://example.com/a',
      contentHash: 'h1',
      createdAtMs: Date.now(),
      facts: validFacts('https://example.com/a'),
    });
    // A page whose facts fail schema validation is dropped, not returned.
    await ContentInventoryPage.create({
      runId: run._id,
      accountId: ACCOUNT,
      siteId,
      url: 'https://example.com/bad',
      contentHash: 'h2',
      createdAtMs: Date.now(),
      facts: { not: 'valid' },
    });

    const view = await getInventoryRun({ accountId: ACCOUNT, runId: String(run._id) });
    expect(view.findings?.opportunityExplanation).toBe('ok');
    expect(view.startedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(view.completedAt).toBe('2026-07-01T01:00:00.000Z');
    expect(view.cancelledAt).toBe('2026-07-01T02:00:00.000Z');
    expect(view.pages).toHaveLength(1);
    expect(view.pages[0]!.url).toBe('https://example.com/a');
  });

  it('returns null findings and null dates for a fresh queued run', async () => {
    const siteId = await ownedSite();
    const run = await ContentInventoryRun.create(makeRunDoc(siteId));
    const view = toPublicInventoryRun(run.toObject() as never);
    expect(view.findings).toBeNull();
    expect(view.startedAt).toBeNull();
    expect(view.completedAt).toBeNull();
  });

  it('throws 404 for an invalid run id', async () => {
    await expect(
      getInventoryRun({ accountId: ACCOUNT, runId: 'nope' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('cancelInventoryRun — edge cases', () => {
  it('throws 404 for an invalid run id', async () => {
    await expect(
      cancelInventoryRun({ accountId: ACCOUNT, runId: 'nope' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('throws 404 when the run does not exist', async () => {
    await expect(
      cancelInventoryRun({ accountId: ACCOUNT, runId: '0000000000000000000000ff' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('throws 409 when the run is already terminal', async () => {
    const siteId = await ownedSite();
    const run = await ContentInventoryRun.create(makeRunDoc(siteId, { status: 'completed' }));
    await expect(
      cancelInventoryRun({ accountId: ACCOUNT, runId: String(run._id) }),
    ).rejects.toMatchObject({ status: 409 });
  });
});

// ---------------------------------------------------------------------------

function validFacts(url: string) {
  return {
    url,
    canonical: url,
    statusCode: 200,
    robots: ['index'],
    language: 'en',
    title: 'A page',
    description: null,
    headings: ['Heading'],
    wordCount: 120,
    schemaTypes: [],
    hasSchemaOrgArticle: false,
    internalLinkCount: 1,
    externalLinkCount: 0,
    internalOutLinks: [],
    contentHash: 'hash',
    primaryTopics: [],
    secondaryTopics: [],
    targetQueries: [],
    qualityFlags: [],
  };
}

function makeRunDoc(siteId: string, over: Record<string, unknown> = {}) {
  const key = `run_${Math.random().toString(36).slice(2)}`;
  return {
    accountId: ACCOUNT,
    ownerUserId: ACCOUNT,
    siteId,
    origin: 'https://example.com',
    locale: 'en',
    status: 'queued',
    input: { pageLimit: 4, allowedPaths: [], excludedPaths: [], sitemapSeeds: [] },
    progress: {
      pagesRequested: 4,
      pagesProcessed: 0,
      pagesFailed: 0,
      blocksReserved: 1,
    },
    stages: [{ name: 'queued', startedAt: new Date(), completedAt: null, error: null }],
    warnings: [],
    error: null,
    inputFingerprint: `fp_${key}`,
    idempotencyKey: key,
    thresholdsVersion: '1',
    findings: null,
    costMicros: 0,
    aiCostMicros: 0,
    requestedAt: new Date(),
    ...over,
  };
}
