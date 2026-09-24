import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  CONTENT_INVENTORY_SNAPSHOT_MAX_EXCERPT_CHARS,
  ContentInventoryPage,
  ContentInventoryRun,
  ContentInventorySnapshot,
} from './inventory.model.js';

function baseRun(overrides: Record<string, unknown> = {}) {
  const accountId = new Types.ObjectId().toString();
  return {
    accountId,
    ownerUserId: accountId,
    siteId: new Types.ObjectId().toString(),
    origin: 'https://example.com',
    locale: 'en' as const,
    status: 'queued' as const,
    input: { pageLimit: 20, allowedPaths: [], excludedPaths: [], sitemapSeeds: [] },
    inputFingerprint: 'x'.repeat(64),
    idempotencyKey: `idem_${'x'.repeat(43)}`,
    requestedAt: new Date(),
    ...overrides,
  };
}

beforeAll(async () => {
  await startMemoryMongo();
  await ContentInventoryRun.syncIndexes();
  await ContentInventoryPage.syncIndexes();
  await ContentInventorySnapshot.syncIndexes();
});
afterAll(async () => {
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
});

describe('ContentInventoryRun schema', () => {
  it('accepts a valid run with progress defaults', async () => {
    const doc = await ContentInventoryRun.create(baseRun());
    expect(doc.status).toBe('queued');
    expect(doc.progress.pagesProcessed).toBe(0);
    expect(doc.progress.blocksReserved).toBe(0);
    expect(doc.findings).toBeNull();
    expect(doc.costMicros).toBe(0);
  });

  it('rejects an origin carrying a raw HTML marker (SEC-OUT guard)', async () => {
    await expect(
      ContentInventoryRun.create(baseRun({ origin: 'https://x.com/<script>evil</script>' })),
    ).rejects.toThrow(/must not contain raw HTML markers/);
  });

  it('rejects an unknown status and an unknown locale', async () => {
    await expect(ContentInventoryRun.create(baseRun({ status: 'nope' }))).rejects.toThrow();
    await expect(ContentInventoryRun.create(baseRun({ locale: 'xx' }))).rejects.toThrow();
  });

  it('enforces uniqueness on (accountId, siteId, idempotencyKey)', async () => {
    const first = await ContentInventoryRun.create(baseRun());
    await expect(
      ContentInventoryRun.create(
        baseRun({
          accountId: first.accountId.toString(),
          siteId: first.siteId.toString(),
          idempotencyKey: first.idempotencyKey,
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('ContentInventoryPage schema', () => {
  function basePage(overrides: Record<string, unknown> = {}) {
    return {
      runId: new Types.ObjectId().toString(),
      accountId: new Types.ObjectId().toString(),
      siteId: new Types.ObjectId().toString(),
      facts: { url: 'https://example.com/a', wordCount: 500 },
      url: 'https://example.com/a',
      contentHash: 'abc',
      createdAtMs: Date.now(),
      ...overrides,
    };
  }

  it('accepts a valid page of derived facts', async () => {
    const doc = await ContentInventoryPage.create(basePage());
    expect(doc.url).toBe('https://example.com/a');
    expect(doc.contentHash).toBe('abc');
  });

  it('rejects a url carrying a raw HTML marker', async () => {
    await expect(
      ContentInventoryPage.create(basePage({ url: 'https://x.com/<iframe>' })),
    ).rejects.toThrow(/must not contain raw HTML markers/);
  });

  it('enforces uniqueness on (runId, url)', async () => {
    const first = await ContentInventoryPage.create(basePage());
    await expect(
      ContentInventoryPage.create(
        basePage({ runId: first.runId.toString(), url: first.url }),
      ),
    ).rejects.toThrow();
  });
});

describe('ContentInventorySnapshot schema', () => {
  function baseSnapshot(overrides: Record<string, unknown> = {}) {
    const now = new Date();
    return {
      runId: new Types.ObjectId().toString(),
      sourceUrl: 'https://example.com/a',
      excerpt: 'The quick brown fox.',
      contentHash: 'abc',
      retrievedAt: now,
      expiryAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      ...overrides,
    };
  }

  it('accepts a valid sanitized snapshot', async () => {
    const doc = await ContentInventorySnapshot.create(baseSnapshot());
    expect(doc.excerpt).toBe('The quick brown fox.');
  });

  it('rejects an excerpt with an HTML marker', async () => {
    await expect(
      ContentInventorySnapshot.create(baseSnapshot({ excerpt: 'x <script>y</script>' })),
    ).rejects.toThrow(/must not contain raw HTML markers/);
  });

  it('rejects an over-length excerpt', async () => {
    await expect(
      ContentInventorySnapshot.create(
        baseSnapshot({ excerpt: 'x'.repeat(CONTENT_INVENTORY_SNAPSHOT_MAX_EXCERPT_CHARS + 1) }),
      ),
    ).rejects.toThrow();
  });
});
