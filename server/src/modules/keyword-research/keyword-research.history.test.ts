/**
 * Research-history recording + GET /api/keyword-research/history tests.
 *
 * Every successful research call, including long-tail discovery, lands one
 * per-account history row — cache hits included, probe calls and failures
 * excluded. The list endpoint pages with a keyset cursor and never leaks
 * another account's rows or cursors.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { desc, eq } from 'drizzle-orm';
import { createApp } from '../../app.js';
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
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
} from '../../shared/testing/auth.js';
import { keywordResearchHistory } from '../../db/schema/index.js';
import {
  VendorUnavailableError,
  createFakeKeywordProvider,
  type KeywordProvider,
} from '../../shared/providers/index.js';
import {
  setKeywordProvider,
  setKeywordResearchDb,
} from './keyword-research.holder.js';
import { setRanksDb } from '../ranks/index.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import { logger } from '../../config/logger.js';
import { recordResearchHistory } from './keyword-research.history.js';
import { createKeywordResearchReportExportAdapters } from './report-export.adapters.js';

const app = createApp();

async function seedUser(email: string) {
  return signupVerifiedUser(app, { email });
}

async function readHistoryRows(accountId: string) {
  return getTestDb()
    .select()
    .from(keywordResearchHistory)
    .where(eq(keywordResearchHistory.accountId, accountId))
    .orderBy(desc(keywordResearchHistory.createdAt), desc(keywordResearchHistory.id));
}

async function seedHistoryRow(
  accountId: string,
  overrides: Partial<typeof keywordResearchHistory.$inferInsert> = {},
) {
  const rows = await getTestDb()
    .insert(keywordResearchHistory)
    .values({
      accountId,
      kind: 'metrics',
      phrases: ['seed'],
      locationCode: 2840,
      languageCode: 'en',
      resultCount: 1,
      cached: false,
      ...overrides,
    })
    .returning();
  return rows[0]!;
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setKeywordResearchDb(db as unknown as never);
  setRanksDb(db as unknown as never);
});
afterAll(async () => {
  uninstallTestAuth();
  setKeywordResearchDb(null);
  setRanksDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setKeywordProvider(createFakeKeywordProvider());
  vi.restoreAllMocks();
});

describe('research-history recording', () => {
  it('/metrics records one row with the deduped phrase list', async () => {
    const user = await seedUser('hist-metrics@x.co');
    await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', user.cookie)
      .send({
        keywords: ['seo audit tool', 'SEO   Audit Tool ', 'what is an seo audit'],
        locationCode: 2840,
        languageCode: 'EN',
      })
      .expect(200);
    const rows = await readHistoryRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'metrics',
      phrases: ['seo audit tool', 'what is an seo audit'],
      locationCode: 2840,
      languageCode: 'en',
      resultCount: 2,
      cached: false,
    });
  });

  it('/related records one row keyed by the normalized seed', async () => {
    const user = await seedUser('hist-related@x.co');
    await request(app)
      .post('/api/keyword-research/related')
      .set('Cookie', user.cookie)
      .send({ keyword: '  SEO ', locationCode: 2840, languageCode: 'en' })
      .expect(200);
    const rows = await readHistoryRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('related');
    expect(rows[0]!.phrases).toEqual(['seo']);
    expect(rows[0]!.cached).toBe(false);
    expect(rows[0]!.resultCount).toBeGreaterThanOrEqual(0);
  });

  it('/intent records one row with the deduped phrase list', async () => {
    const user = await seedUser('hist-intent@x.co');
    await request(app)
      .post('/api/keyword-research/intent')
      .set('Cookie', user.cookie)
      .send({
        keywords: ['seo audit tool', 'seo audit tool'],
        locationCode: 2840,
        languageCode: 'en',
      })
      .expect(200);
    const rows = await readHistoryRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'intent',
      phrases: ['seo audit tool'],
      resultCount: 1,
      cached: false,
    });
  });

  it('/ideas records one row keyed by the normalized seed', async () => {
    const user = await seedUser('hist-ideas@x.co');
    await request(app)
      .post('/api/keyword-research/ideas')
      .set('Cookie', user.cookie)
      .send({ seed: 'SEO Audit', locationCode: 2840, languageCode: 'en' })
      .expect(200);
    const rows = await readHistoryRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('ideas');
    expect(rows[0]!.phrases).toEqual(['seo audit']);
    expect(rows[0]!.cached).toBe(false);
  });

  it('/long-tail records one row and exports its archived suggestions', async () => {
    const user = await seedUser('hist-long-tail@x.co');
    await request(app)
      .post('/api/keyword-research/long-tail')
      .set('Cookie', user.cookie)
      .send({ seed: '  SEO   Audit Tool ', locationCode: 2840, languageCode: 'EN' })
      .expect(200);
    const rows = await readHistoryRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'long_tail',
      phrases: ['seo audit tool'],
      locationCode: 2840,
      languageCode: 'en',
      resultCount: 2,
      cached: false,
    });

    const adapter = createKeywordResearchReportExportAdapters(getTestDb() as never)
      .find((candidate) => candidate.kind === 'keyword.research_result');
    expect(adapter).toBeDefined();
    const selection = adapter!.selectionSchema.parse({ operation: 'long_tail' });
    const exported = await adapter!.compose({
      accountId: user.id,
      actorUserId: user.id,
      target: { scope: 'account_resource', resourceId: rows[0]!.id },
      format: 'json',
      locale: 'en',
      selection,
      branding: {
        mode: 'rankmefast',
        companyName: 'RankMeFast',
        accentColor: '#b5321e',
        logo: null,
      },
    });
    expect(JSON.stringify(exported.document)).toContain('how to use an seo audit tool');
  });

  it('cache hits are still recorded — second identical search logs cached=true', async () => {
    const user = await seedUser('hist-cachehit@x.co');
    const body = { keywords: ['seo'], locationCode: 2840, languageCode: 'en' };
    await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', user.cookie)
      .send(body)
      .expect(200);
    await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', user.cookie)
      .send(body)
      .expect(200);
    const rows = await readHistoryRows(user.id);
    expect(rows).toHaveLength(2);
    // Newest first: the cache-served repeat is rows[0].
    expect(rows[0]!.cached).toBe(true);
    expect(rows[1]!.cached).toBe(false);
  });

  it('the mount-time probe never pollutes history (probe: true)', async () => {
    const user = await seedUser('hist-probe@x.co');
    await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', user.cookie)
      .send({ keywords: ['probe'], locationCode: 2840, languageCode: 'en', probe: true })
      .expect(200);
    await expect(readHistoryRows(user.id)).resolves.toHaveLength(0);
  });

  it('provider failure records nothing (only successes are re-runnable)', async () => {
    const failing: KeywordProvider = {
      async getLongTailSuggestions() { return []; },
      async getMetrics() {
        throw new VendorUnavailableError('vendor down', { provider: 'x', operation: 'y' });
      },
      async getRelated() { return []; },
      async classifyIntent() { return []; },
      async getIdeas() { return []; },
      async getOverview() { return []; },
      async getHistoricalVolume() { return []; },
    };
    setKeywordProvider(failing);
    const user = await seedUser('hist-fail@x.co');
    await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', user.cookie)
      .send({ keywords: ['seo'], locationCode: 2840, languageCode: 'en' })
      .expect(503);
    await expect(readHistoryRows(user.id)).resolves.toHaveLength(0);
  });

  it('recordResearchHistory never throws — a failed insert logs and moves on', async () => {
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => logger);
    const rejectingDb = {
      insert: () => ({
        values: () => Promise.reject(new Error('insert boom')),
      }),
    };
    await expect(
      recordResearchHistory(rejectingDb as never, {
        accountId: 'acc-1',
        kind: 'metrics',
        phrases: ['seo'],
        locationCode: 2840,
        languageCode: 'EN',
        resultCount: 1,
        cached: false,
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', kind: 'metrics' }),
      'keyword-research history write failed',
    );
  });
});

describe('GET /api/keyword-research/history', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).get('/api/keyword-research/history');
    expect(res.status).toBe(401);
  });

  it('returns { items, nextCursor } newest-first with ISO createdAt', async () => {
    const user = await seedUser('hist-list@x.co');
    await seedHistoryRow(user.id, {
      phrases: ['old'],
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
    });
    await seedHistoryRow(user.id, {
      kind: 'ideas',
      phrases: ['new'],
      cached: true,
      createdAt: new Date('2026-07-02T00:00:00.000Z'),
    });
    const res = await request(app)
      .get('/api/keyword-research/history')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({
      kind: 'ideas',
      phrases: ['new'],
      locationCode: 2840,
      languageCode: 'en',
      resultCount: 1,
      cached: true,
      createdAt: '2026-07-02T00:00:00.000Z',
    });
    expect(res.body.items[1].phrases).toEqual(['old']);
    expect(typeof res.body.items[0].id).toBe('string');
  });

  it('pages with a keyset cursor — no overlap, no skip, terminal null cursor', async () => {
    const user = await seedUser('hist-page@x.co');
    for (let i = 0; i < 5; i += 1) {
      await seedHistoryRow(user.id, {
        phrases: [`kw-${i}`],
        createdAt: new Date(`2026-07-0${i + 1}T00:00:00.000Z`),
      });
    }
    const page1 = await request(app)
      .get('/api/keyword-research/history?limit=2')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(page1.body.items.map((r: { phrases: string[] }) => r.phrases[0])).toEqual(['kw-4', 'kw-3']);
    expect(page1.body.nextCursor).toBe(page1.body.items[1].id);

    const page2 = await request(app)
      .get(`/api/keyword-research/history?limit=2&cursor=${page1.body.nextCursor}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(page2.body.items.map((r: { phrases: string[] }) => r.phrases[0])).toEqual(['kw-2', 'kw-1']);

    const page3 = await request(app)
      .get(`/api/keyword-research/history?limit=2&cursor=${page2.body.nextCursor}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(page3.body.items.map((r: { phrases: string[] }) => r.phrases[0])).toEqual(['kw-0']);
    expect(page3.body.nextCursor).toBeNull();
  });

  it('applies the default limit of 20', async () => {
    const user = await seedUser('hist-default@x.co');
    for (let i = 0; i < 21; i += 1) {
      await seedHistoryRow(user.id, {
        phrases: [`bulk-${i}`],
        createdAt: new Date(2026, 0, 1, 0, 0, i),
      });
    }
    const res = await request(app)
      .get('/api/keyword-research/history')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(res.body.items).toHaveLength(20);
    expect(res.body.nextCursor).not.toBeNull();
  });

  it('validates limit bounds with zod (0, 101, non-numeric → 400)', async () => {
    const user = await seedUser('hist-zod@x.co');
    for (const limit of ['0', '101', 'abc']) {
      const res = await request(app)
        .get(`/api/keyword-research/history?limit=${limit}`)
        .set('Cookie', user.cookie);
      expect(res.status).toBe(400);
    }
  });

  it('rejects a malformed (non-uuid) cursor with a localized 400', async () => {
    const user = await seedUser('hist-badcursor@x.co');
    const res = await request(app)
      .get('/api/keyword-research/history?cursor=not-a-uuid')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.keywordResearch.errors.unknownCursor,
    );
  });

  it('rejects a well-formed but unknown cursor with the same 400', async () => {
    const user = await seedUser('hist-unknowncursor@x.co');
    const res = await request(app)
      .get('/api/keyword-research/history?cursor=00000000-0000-4000-8000-000000000000')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.keywordResearch.errors.unknownCursor,
    );
  });

  it("another account's cursor reads exactly like an unknown cursor (no existence leak)", async () => {
    const a = await seedUser('hist-cursor-a@x.co');
    const b = await seedUser('hist-cursor-b@x.co');
    const rowA = await seedHistoryRow(a.id);
    const res = await request(app)
      .get(`/api/keyword-research/history?cursor=${rowA.id}`)
      .set('Cookie', b.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.keywordResearch.errors.unknownCursor,
    );
  });

  it('cross-account isolation: each account only ever sees its own rows', async () => {
    const a = await seedUser('hist-iso-a@x.co');
    const b = await seedUser('hist-iso-b@x.co');
    await seedHistoryRow(a.id, { phrases: ['a-only'] });
    await seedHistoryRow(b.id, { phrases: ['b-only'] });
    const resA = await request(app)
      .get('/api/keyword-research/history')
      .set('Cookie', a.cookie)
      .expect(200);
    expect(resA.body.items).toHaveLength(1);
    expect(resA.body.items[0].phrases).toEqual(['a-only']);
    const resB = await request(app)
      .get('/api/keyword-research/history')
      .set('Cookie', b.cookie)
      .expect(200);
    expect(resB.body.items).toHaveLength(1);
    expect(resB.body.items[0].phrases).toEqual(['b-only']);
  });

  it('end-to-end: a real search shows up on the history endpoint', async () => {
    const user = await seedUser('hist-e2e@x.co');
    await request(app)
      .post('/api/keyword-research/metrics')
      .set('Cookie', user.cookie)
      .send({ keywords: ['seo audit tool'], locationCode: 2840, languageCode: 'en' })
      .expect(200);
    const res = await request(app)
      .get('/api/keyword-research/history')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      kind: 'metrics',
      phrases: ['seo audit tool'],
      cached: false,
    });
  });
});
