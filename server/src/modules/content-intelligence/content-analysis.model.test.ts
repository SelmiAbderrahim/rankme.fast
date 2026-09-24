import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  ContentAnalysis,
  ContentSnapshot,
  CONTENT_SNAPSHOT_MAX_EXCERPT_CHARS,
} from './index.js';

const ORIGIN = 'https://example.com';

function baseAnalysis(overrides: Partial<Parameters<typeof ContentAnalysis.create>[0]> = {}) {
  const accountId = new Types.ObjectId().toString();
  return {
    accountId,
    ownerUserId: accountId,
    siteId: new Types.ObjectId().toString(),
    ownedUrl: `${ORIGIN}/pillar`,
    keyword: 'seo audit tools',
    locale: 'en' as const,
    status: 'queued' as const,
    stages: [{ name: 'queued' as const, startedAt: new Date(), completedAt: null, error: null }],
    inputFingerprint: 'x'.repeat(64),
    idempotencyKey: `idem_${'x'.repeat(43)}`,
    providerRefs: { snapshotIds: [] },
    requestedAt: new Date(),
    ...overrides,
  };
}

beforeAll(async () => {
  await startMemoryMongo();
  // Force index build so the (accountId, siteId, idempotencyKey) uniqueness
  // assertion below actually has an index to enforce it — mongoose builds
  // indexes lazily and the in-memory server does not sync them on connect.
  await ContentAnalysis.syncIndexes();
  await ContentSnapshot.syncIndexes();
});
afterAll(async () => {
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
});

describe('ContentAnalysis schema', () => {
  it('accepts a valid document', async () => {
    const doc = await ContentAnalysis.create(baseAnalysis());
    expect(doc._id).toBeDefined();
    expect(doc.status).toBe('queued');
    expect(doc.stages).toHaveLength(1);
    expect(doc.idempotencyKey).toMatch(/^idem_/);
    expect(doc.costMicros).toBe(0);
  });

  it('defaults provider references when the caller omits them', async () => {
    const input = baseAnalysis();
    delete (input as Partial<typeof input>).providerRefs;
    const doc = await ContentAnalysis.create(input);
    expect(doc.providerRefs.snapshotIds).toEqual([]);
  });

  it('rejects a draft that contains a raw <script> marker (SEC-OUT guard)', async () => {
    await expect(
      ContentAnalysis.create(
        baseAnalysis({
          status: 'completed',
          draft: {
            versionId: 'v1',
            markdown: 'Here is text <script>alert(1)</script>',
            wordCount: 5,
          },
        }),
      ),
    ).rejects.toThrow(/must not contain raw HTML markers/);
  });

  it('rejects an ownedUrl carrying an <iframe> marker', async () => {
    await expect(
      ContentAnalysis.create(
        baseAnalysis({
          ownedUrl: 'https://example.com/<iframe src="evil">',
        }),
      ),
    ).rejects.toThrow(/must not contain raw HTML markers/);
  });

  it('rejects a keyword with a raw <!doctype prefix', async () => {
    await expect(
      ContentAnalysis.create(
        baseAnalysis({
          keyword: '<!doctype html>',
        }),
      ),
    ).rejects.toThrow(/must not contain raw HTML markers/);
  });

  it('rejects HTML markers in saved brief and draft versions', async () => {
    await expect(
      ContentAnalysis.create(baseAnalysis({
        briefVersions: [{
          versionId: 'brief-v1',
          sections: [{ heading: '<iframe>', body: 'safe body' }],
          savedAt: new Date(),
          actorUserId: new Types.ObjectId().toString(),
          clientKey: 'brief-version-key',
        }],
      })),
    ).rejects.toThrow(/must not contain raw HTML markers/);
    await expect(
      ContentAnalysis.create(baseAnalysis({
        draftVersions: [{
          versionId: 'draft-v1',
          markdown: '<script>unsafe</script>',
          wordCount: 1,
          savedAt: new Date(),
          actorUserId: new Types.ObjectId().toString(),
          clientKey: 'draft-version-key',
        }],
      })),
    ).rejects.toThrow(/must not contain raw HTML markers/);
  });

  it('enforces uniqueness on (accountId, siteId, idempotencyKey)', async () => {
    const doc1 = await ContentAnalysis.create(baseAnalysis());
    await expect(
      ContentAnalysis.create(
        baseAnalysis({
          accountId: doc1.accountId.toString(),
          siteId: doc1.siteId.toString(),
          idempotencyKey: doc1.idempotencyKey,
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects an unknown locale', async () => {
    await expect(
      ContentAnalysis.create(
        baseAnalysis({
          locale: 'xx' as never,
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects an unknown status', async () => {
    await expect(
      ContentAnalysis.create(
        baseAnalysis({
          status: 'invented' as never,
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('ContentSnapshot schema', () => {
  const validExcerpt = 'The quick brown fox jumps over the lazy dog.';
  const analysisId = new Types.ObjectId().toString();

  function baseSnapshot(
    overrides: Partial<Parameters<typeof ContentSnapshot.create>[0]> = {},
  ) {
    const now = new Date();
    return {
      analysisId,
      role: 'owned' as const,
      sourceUrl: `${ORIGIN}/page`,
      excerpt: validExcerpt,
      derivedFacts: {
        headings: ['H1'],
        links: [`${ORIGIN}/related`],
        wordCount: 8,
        hasSchemaOrgArticle: false,
        canonical: null,
      },
      contentHash: 'abcdef',
      retrievedAt: now,
      retrievalCost: { micros: 5_000, provider: 'firecrawl', credits: 1 },
      expiryAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      ...overrides,
    };
  }

  it('accepts a valid snapshot', async () => {
    const doc = await ContentSnapshot.create(baseSnapshot());
    expect(doc.excerpt).toBe(validExcerpt);
    expect(doc.role).toBe('owned');
    expect(doc.derivedFacts.wordCount).toBe(8);
  });

  it('rejects an excerpt that contains an HTML marker', async () => {
    await expect(
      ContentSnapshot.create(
        baseSnapshot({
          excerpt: 'Body <script>evil()</script>',
        }),
      ),
    ).rejects.toThrow(/must not contain raw HTML markers/);
  });

  it('rejects an over-length excerpt', async () => {
    await expect(
      ContentSnapshot.create(
        baseSnapshot({
          excerpt: 'x'.repeat(CONTENT_SNAPSHOT_MAX_EXCERPT_CHARS + 1),
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects an unknown role', async () => {
    await expect(
      ContentSnapshot.create(
        baseSnapshot({
          role: 'nope' as never,
        }),
      ),
    ).rejects.toThrow();
  });
});
