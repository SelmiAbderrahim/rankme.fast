import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { ContentInventoryPage, ContentInventoryRun } from './inventory.model.js';
import {
  COMPLETED_INVENTORY_PAGE_READ_LIMIT,
  loadCompletedInventorySnapshot,
} from './inventory.reads.js';
import type { InventoryPageFacts } from './inventory.schemas.js';

function facts(url: string): InventoryPageFacts {
  return {
    url,
    canonical: null,
    statusCode: 200,
    robots: [],
    language: 'en',
    title: 'Stored page',
    description: null,
    headings: ['Stored heading'],
    wordCount: 400,
    schemaTypes: [],
    hasSchemaOrgArticle: false,
    internalLinkCount: 0,
    externalLinkCount: 0,
    internalOutLinks: [],
    contentHash: `hash-${url}`,
    primaryTopics: [],
    secondaryTopics: [],
    targetQueries: [],
    qualityFlags: [],
  };
}

async function run(input: {
  accountId: string;
  siteId: string;
  status?: string;
  completedAt?: Date | null;
  suffix: string;
}) {
  return ContentInventoryRun.create({
    accountId: input.accountId,
    ownerUserId: input.accountId,
    siteId: input.siteId,
    origin: 'https://example.com',
    locale: 'en',
    status: input.status ?? 'completed',
    input: { pageLimit: 20, allowedPaths: [], excludedPaths: [], sitemapSeeds: [] },
    inputFingerprint: `fingerprint-${input.suffix}`,
    idempotencyKey: `inventory-${input.suffix}`,
    requestedAt: new Date('2026-07-01T00:00:00Z'),
    completedAt: input.completedAt ?? null,
  });
}

async function storedPage(input: {
  runId: string;
  accountId: string;
  siteId: string;
  url: string;
  pageFacts?: unknown;
}) {
  return ContentInventoryPage.create({
    runId: input.runId,
    accountId: input.accountId,
    siteId: input.siteId,
    facts: input.pageFacts ?? facts(input.url),
    url: input.url,
    contentHash: `hash-${input.url}`,
    createdAtMs: Date.now(),
  });
}

beforeAll(async () => {
  await startMemoryMongo();
});
afterAll(async () => {
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
});

describe('loadCompletedInventorySnapshot', () => {
  it('returns null for absent, partial, or completion-date-less runs', async () => {
    const accountId = new Types.ObjectId().toString();
    const siteId = new Types.ObjectId().toString();
    expect(
      await loadCompletedInventorySnapshot({ accountId, siteId }),
    ).toBeNull();
    await run({
      accountId,
      siteId,
      status: 'partial',
      completedAt: new Date('2026-08-01T00:00:00Z'),
      suffix: 'partial',
    });
    await run({
      accountId,
      siteId,
      status: 'completed',
      completedAt: null,
      suffix: 'undated',
    });
    expect(
      await loadCompletedInventorySnapshot({ accountId, siteId }),
    ).toBeNull();
  });

  it('selects newest, supports an exact pin, sorts pages, and skips malformed facts', async () => {
    const accountId = new Types.ObjectId().toString();
    const siteId = new Types.ObjectId().toString();
    const older = await run({
      accountId,
      siteId,
      completedAt: new Date('2026-07-30T00:00:00Z'),
      suffix: 'older',
    });
    const newer = await run({
      accountId,
      siteId,
      completedAt: new Date('2026-08-01T00:00:00Z'),
      suffix: 'newer',
    });
    await storedPage({
      runId: String(newer._id),
      accountId,
      siteId,
      url: 'https://example.com/z',
    });
    await storedPage({
      runId: String(newer._id),
      accountId,
      siteId,
      url: 'https://example.com/a',
    });
    await storedPage({
      runId: String(newer._id),
      accountId,
      siteId,
      url: 'https://example.com/bad',
      pageFacts: { url: 'https://example.com/bad' },
    });
    await storedPage({
      runId: String(older._id),
      accountId,
      siteId,
      url: 'https://example.com/old',
    });

    const latest = await loadCompletedInventorySnapshot({ accountId, siteId });
    expect(latest?.runId).toBe(String(newer._id));
    expect(latest?.completedAt.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(latest?.pages.map((item) => item.url)).toEqual([
      'https://example.com/a',
      'https://example.com/z',
    ]);

    const pinned = await loadCompletedInventorySnapshot({
      accountId,
      siteId,
      runId: String(older._id),
    });
    expect(pinned?.pages[0]?.url).toBe('https://example.com/old');
    expect(COMPLETED_INVENTORY_PAGE_READ_LIMIT).toBe(1_000);
  });

  it('keeps account and site scope on a pinned run', async () => {
    const owner = new Types.ObjectId().toString();
    const siteId = new Types.ObjectId().toString();
    const created = await run({
      accountId: owner,
      siteId,
      completedAt: new Date('2026-08-01T00:00:00Z'),
      suffix: 'scope',
    });
    expect(
      await loadCompletedInventorySnapshot({
        accountId: new Types.ObjectId().toString(),
        siteId,
        runId: String(created._id),
      }),
    ).toBeNull();
    expect(
      await loadCompletedInventorySnapshot({
        accountId: owner,
        siteId: new Types.ObjectId().toString(),
        runId: String(created._id),
      }),
    ).toBeNull();
  });
});

