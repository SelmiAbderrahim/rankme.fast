/**
 * Competitor content Mongo model unit tests. Proves the pre-validate
 * hooks reject raw-HTML markers on workflow-state text fields (SEC-OUT /
 * no-raw-HTML) and the snippet length cap holds.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  COMPETITOR_CONTENT_SNAPSHOT_MAX_EXCERPT_CHARS,
  CompetitorContentRun,
  CompetitorContentSnapshot,
  CompetitorPageFacts,
} from './competitor-content.model.js';

const ACCOUNT = '000000000000000000000abc';
const SITE = '000000000000000000000def';

function runDoc(over: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT,
    ownerUserId: ACCOUNT,
    siteId: SITE,
    origin: 'https://example.com',
    ownedUrl: 'https://example.com/page',
    locale: 'en',
    status: 'queued',
    input: { competitorIds: ['a'], competitorDomains: ['rival.com'], pageLimit: 15 },
    inputFingerprint: 'fp',
    idempotencyKey: 'res1',
    requestedAt: new Date(),
    ...over,
  };
}

beforeAll(async () => {
  await startMemoryMongo();
});
afterAll(async () => {
  await stopMemoryMongo();
});
afterEach(async () => {
  await clearCollections();
});

describe('CompetitorContentRun', () => {
  it('persists a valid run', async () => {
    const doc = await CompetitorContentRun.create(runDoc());
    expect(doc.status).toBe('queued');
    expect(doc.idempotencyKey).toBe('res1');
  });

  it('rejects a raw-HTML marker in origin', async () => {
    await expect(
      CompetitorContentRun.create(runDoc({ origin: 'https://x.com/<script>alert(1)</script>' })),
    ).rejects.toThrow(/raw HTML/);
  });
});

describe('CompetitorPageFacts', () => {
  it('rejects a raw-HTML marker in url', async () => {
    await expect(
      CompetitorPageFacts.create({
        runId: SITE,
        accountId: ACCOUNT,
        siteId: SITE,
        role: 'competitor',
        facts: {},
        url: 'https://x.com/<iframe>',
        contentHash: 'h',
        createdAtMs: Date.now(),
      }),
    ).rejects.toThrow(/raw HTML/);
  });
});

describe('CompetitorContentSnapshot', () => {
  it('rejects a raw-HTML marker in the excerpt', async () => {
    await expect(
      CompetitorContentSnapshot.create({
        runId: SITE,
        sourceUrl: 'https://rival.com/',
        excerpt: 'clean text <!doctype html>',
        contentHash: 'h',
        retrievedAt: new Date(),
        expiryAt: new Date(Date.now() + 1000),
      }),
    ).rejects.toThrow(/raw HTML/);
  });

  it('enforces the excerpt length cap', async () => {
    await expect(
      CompetitorContentSnapshot.create({
        runId: SITE,
        sourceUrl: 'https://rival.com/',
        excerpt: 'x'.repeat(COMPETITOR_CONTENT_SNAPSHOT_MAX_EXCERPT_CHARS + 50),
        contentHash: 'h',
        retrievedAt: new Date(),
        expiryAt: new Date(Date.now() + 1000),
      }),
    ).rejects.toThrow();
  });
});
