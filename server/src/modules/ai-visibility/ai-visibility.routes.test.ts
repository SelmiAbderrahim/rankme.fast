/**
 * ai-visibility route + prompt-cap + cooldown + provider-error tests.
 * Exercises the controller, router, and request schema through the real
 * `createApp()` + Better Auth + PGlite/Mongo harness.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { eq } from 'drizzle-orm';
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
  type TestUser,
} from '../../shared/testing/auth.js';
import { Site } from '../sites/index.js';
import { keywords } from '../../db/schema/keywords.js';
import {
  aiMentionSnapshots,
  aiTrackedPrompts,
} from '../../db/schema/index.js';
import { createInMemoryCooldown } from '../../shared/cooldown/index.js';
import { translate, DICTIONARIES } from '../../shared/i18n/index.js';
import {
  FAKE_AI_KEYWORD_VOLUME,
  FAKE_AI_MENTIONS,
  FAKE_AI_ANSWERS,
  VendorUnavailableError,
  createFakeAiVisibilityProvider,
  createFakeSummaryProvider,
  type AiVisibilityProvider,
} from '../../shared/providers/index.js';
import {
  setAiVisibilityCooldown,
  setAiVisibilityDb,
  setAiVisibilityProvider,
  setAiVisibilitySummaryProvider,
} from './ai-visibility.holder.js';

const app = createApp();

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedSite(accountId: string, domain = 'example.com'): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
  });
  return (site._id as mongoose.Types.ObjectId).toString();
}

async function trackPrompt(accountId: string, siteId: string, prompt = 'best seo audit tool') {
  await getTestDb().insert(aiTrackedPrompts).values({ accountId, siteId, prompt });
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setAiVisibilityDb(db as unknown as never);
});
afterAll(async () => {
  uninstallTestAuth();
  setAiVisibilityDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setAiVisibilityProvider(createFakeAiVisibilityProvider());
  setAiVisibilitySummaryProvider(null);
  setAiVisibilityCooldown(null);
});

describe('GET /api/sites/:siteId/ai-visibility', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).get('/api/sites/anything/ai-visibility');
    expect(res.status).toBe(401);
  });

  it('returns an empty overview for an agency account before any activity', async () => {
    const user = await seedUser('av-empty@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/ai-visibility`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      prompts: [],
      snapshots: [],
      shareOfVoicePct: null,
      sentiment: { positive: 0, neutral: 0, negative: 0 },
      notMentionedPrompts: [],
      checkedAt: null,
    });
  });

  it('lists tracked prompts and flags them as not-yet-mentioned', async () => {
    const user = await seedUser('av-tracked@x.co');
    const siteId = await seedSite(user.id);
    await trackPrompt(user.id, siteId, 'best crm for startups');
    const res = await request(app)
      .get(`/api/sites/${siteId}/ai-visibility`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.prompts).toHaveLength(1);
    expect(res.body.prompts[0].prompt).toBe('best crm for startups');
    expect(res.body.notMentionedPrompts).toEqual(['best crm for startups']);
  });

  it('cross-account access 404s', async () => {
    const a = await seedUser('av-a@x.co');
    const b = await seedUser('av-b@x.co');
    const siteId = await seedSite(a.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/ai-visibility`)
      .set('Cookie', b.cookie);
    expect(res.status).toBe(404);
  });

  it('malformed siteId returns 404', async () => {
    const user = await seedUser('av-mal@x.co');
    const res = await request(app)
      .get('/api/sites/not-an-object-id/ai-visibility')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/sites/:siteId/ai-visibility/prompts', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).post('/api/sites/anything/ai-visibility/prompts');
    expect(res.status).toBe(401);
  });

  it('adds a prompt and returns it (201)', async () => {
    const user = await seedUser('ap-ok@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/prompts`)
      .set('Cookie', user.cookie)
      .send({ prompt: 'best tool' });
    expect(res.status).toBe(201);
    expect(res.body.prompt.prompt).toBe('best tool');
  });

  it('rejects a double-encoded (top-level JSON string) body with 400 malformedJson', async () => {
    // Reproduces the client double-stringify bug: the wire body is the JSON
    // *string* `"{\"prompt\":\"...\"}"`, which express.json({ strict: true })
    // rejects as `entity.parse.failed` before the handler ever runs.
    const user = await seedUser('ap-double@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/prompts`)
      .set('Cookie', user.cookie)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(JSON.stringify({ prompt: 'free uptime monitor website' })));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe(DICTIONARIES.en.errors.malformedJson);
  });

  it('returns the existing prompt on a duplicate add', async () => {
    const user = await seedUser('ap-dup@x.co');
    const siteId = await seedSite(user.id);
    const first = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/prompts`)
      .set('Cookie', user.cookie)
      .send({ prompt: 'best tool' });
    const second = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/prompts`)
      .set('Cookie', user.cookie)
      .send({ prompt: 'BEST TOOL' });
    expect(second.status).toBe(201);
    expect(second.body.prompt.id).toBe(first.body.prompt.id);
  });

  it('rejects a blank prompt with 400', async () => {
    const user = await seedUser('ap-blank@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/prompts`)
      .set('Cookie', user.cookie)
      .send({ prompt: '   ' });
    expect(res.status).toBe(400);
  });

  it('409s past the ten-prompt cap', async () => {
    const user = await seedUser('ap-cap@x.co');
    const siteId = await seedSite(user.id);
    for (let i = 0; i < 10; i += 1) {
      await trackPrompt(user.id, siteId, `tracked ${i}`);
    }
    const res = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/prompts`)
      .set('Cookie', user.cookie)
      .send({ prompt: 'one too many' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe(
      DICTIONARIES.en.aiVisibility.errors.promptCapReached,
    );
    expect(res.body.error.details).toMatchObject({ limit: 10 });
  });

  it('cross-account add 404s', async () => {
    const owner = await seedUser('ap-owner@x.co');
    const stranger = await seedUser('ap-stranger@x.co');
    const siteId = await seedSite(owner.id);
    const res = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/prompts`)
      .set('Cookie', stranger.cookie)
      .send({ prompt: 'best tool' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/sites/:siteId/ai-visibility/prompts/:promptId', () => {
  async function addPrompt(user: TestUser, siteId: string): Promise<string> {
    const res = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/prompts`)
      .set('Cookie', user.cookie)
      .send({ prompt: 'best tool' });
    return res.body.prompt.id as string;
  }

  it('removes a tracked prompt (204)', async () => {
    const user = await seedUser('dp-ok@x.co');
    const siteId = await seedSite(user.id);
    const promptId = await addPrompt(user, siteId);
    const res = await request(app)
      .delete(`/api/sites/${siteId}/ai-visibility/prompts/${promptId}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(204);
  });

  it('404s an unknown (but well-formed) prompt id', async () => {
    const user = await seedUser('dp-unknown@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .delete(
        `/api/sites/${siteId}/ai-visibility/prompts/00000000-0000-4000-8000-000000000000`,
      )
      .set('Cookie', user.cookie);
    expect(res.status).toBe(404);
  });

  it('400s a malformed prompt id (not a uuid)', async () => {
    const user = await seedUser('dp-bad@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .delete(`/api/sites/${siteId}/ai-visibility/prompts/not-a-uuid`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });

  it('cross-account delete 404s', async () => {
    const owner = await seedUser('dp-owner@x.co');
    const stranger = await seedUser('dp-stranger@x.co');
    const siteId = await seedSite(owner.id);
    const promptId = await addPrompt(owner, siteId);
    const res = await request(app)
      .delete(`/api/sites/${siteId}/ai-visibility/prompts/${promptId}`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/sites/:siteId/ai-visibility/check', () => {
  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).post('/api/sites/anything/ai-visibility/check');
    expect(res.status).toBe(401);
  });

  it('returns the overview without spending when no prompts are tracked', async () => {
    const user = await seedUser('ck-noprompt@x.co');
    const siteId = await seedSite(user.id);
    let calls = 0;
    setAiVisibilityProvider({
      async checkMentions() {
        calls += 1;
        return FAKE_AI_MENTIONS;
      },
      async getAnswers() {
        return FAKE_AI_ANSWERS;
      },
      async getAiKeywordVolume() {
        return FAKE_AI_KEYWORD_VOLUME;
      },
    });
    const res = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/check`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.snapshots).toEqual([]);
    expect(calls).toBe(0);
  });

  it('persists mention snapshots for every tracked prompt', async () => {
    const user = await seedUser('ck-ok@x.co');
    const siteId = await seedSite(user.id);
    await trackPrompt(user.id, siteId);
    const res = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/check`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    const mentionRows = await getTestDb()
      .select()
      .from(aiMentionSnapshots)
      .where(eq(aiMentionSnapshots.siteId, siteId));
    expect(mentionRows).toHaveLength(FAKE_AI_MENTIONS.length);
  });

  it('cooldown: a second rapid check 429s with a localized countdown; clears after the window', async () => {
    let clock = 1_000_000;
    setAiVisibilityCooldown(createInMemoryCooldown({ defaultMs: 60_000, now: () => clock }));
    const user = await seedUser('ck-cool@x.co');
    const siteId = await seedSite(user.id);
    await trackPrompt(user.id, siteId);

    await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/check`)
      .set('Cookie', user.cookie)
      .expect(200);

    clock += 45_000;
    const second = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/check`)
      .set('Cookie', user.cookie);
    expect(second.status).toBe(429);
    expect(second.body.error.message).toBe(
      translate('en', 'aiVisibility.errors.refreshCooldown', { seconds: 15 }),
    );
    expect(second.body.error.details.retryAfterMs).toBe(15_000);

    clock += 15_000;
    await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/check`)
      .set('Cookie', user.cookie)
      .expect(200);
  });

  it('surfaces a provider failure as 503', async () => {
    const user = await seedUser('ck-fail@x.co');
    const siteId = await seedSite(user.id);
    await trackPrompt(user.id, siteId);
    setAiVisibilityProvider(
      createFakeAiVisibilityProvider({
        failure: new VendorUnavailableError('down', { provider: 'x', operation: 'y' }),
      }),
    );
    const res = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/check`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe(DICTIONARIES.en.aiVisibility.errors.unavailable);
  });

  it('rethrows a non-provider failure as 500', async () => {
    const user = await seedUser('ck-plain@x.co');
    const siteId = await seedSite(user.id);
    await trackPrompt(user.id, siteId);
    const provider: AiVisibilityProvider = {
      async checkMentions() {
        throw new Error('plain');
      },
      async getAnswers() {
        return FAKE_AI_ANSWERS;
      },
      async getAiKeywordVolume() {
        return FAKE_AI_KEYWORD_VOLUME;
      },
    };
    setAiVisibilityProvider(provider);
    const res = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/check`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(500);
  });

  it('cross-account check 404s and never reaches the provider', async () => {
    const owner = await seedUser('ck-owner@x.co');
    const stranger = await seedUser('ck-stranger@x.co');
    const siteId = await seedSite(owner.id);
    await trackPrompt(owner.id, siteId);
    let calls = 0;
    setAiVisibilityProvider({
      async checkMentions() {
        calls += 1;
        return FAKE_AI_MENTIONS;
      },
      async getAnswers() {
        return FAKE_AI_ANSWERS;
      },
      async getAiKeywordVolume() {
        return FAKE_AI_KEYWORD_VOLUME;
      },
    });
    const res = await request(app)
      .post(`/api/sites/${siteId}/ai-visibility/check`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
    expect(calls).toBe(0);
  });
});

describe('/api/sites/:siteId/ai-visibility/suggestions', () => {
  async function seedKeyword(accountId: string, siteId: string, phrase = 'seo audit') {
    await getTestDb().insert(keywords).values({
      accountId,
      siteId,
      phrase,
      locationCode: 2840,
      languageCode: 'en',
    });
  }

  const url = (siteId: string) => `/api/sites/${siteId}/ai-visibility/suggestions`;

  it('rejects unauthenticated calls with 401', async () => {
    expect((await request(app).get(url('anything'))).status).toBe(401);
    expect((await request(app).post(url('anything'))).status).toBe(401);
  });

  it('GET returns generatedAt: null before anything has been generated', async () => {
    const user = await seedUser('sg-never@x.co');
    const siteId = await seedSite(user.id);
    await seedKeyword(user.id, siteId);
    const res = await request(app).get(url(siteId)).set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ generatedAt: null, outputLocale: 'en', suggestions: [] });
  });

  it('POST generates, persists, and the stored set survives a fresh GET', async () => {
    const user = await seedUser('sg-persist@x.co');
    const siteId = await seedSite(user.id);
    await seedKeyword(user.id, siteId);

    const created = await request(app).post(url(siteId)).set('Cookie', user.cookie);
    expect(created.status).toBe(201);
    expect(created.body.generatedAt).toEqual(expect.any(String));
    expect(created.body.outputLocale).toBe('en');
    expect(created.body.suggestions.length).toBeGreaterThan(0);

    // A separate request — proves persistence, not per-request memoisation.
    const read = await request(app).get(url(siteId)).set('Cookie', user.cookie);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);
  });

  it('freezes the requested locale and a language-only GET never generates or falls back', async () => {
    const user = await seedUser('sg-locale@x.co');
    const siteId = await seedSite(user.id);
    await seedKeyword(user.id, siteId, 'source-token');
    const seenLocales: string[] = [];
    setAiVisibilitySummaryProvider({
      ...createFakeSummaryProvider(),
      async generatePrompts(input) {
        seenLocales.push(input.locale);
        return createFakeSummaryProvider().generatePrompts(input);
      },
    });

    const generated = await request(app)
      .post(url(siteId))
      .set('Cookie', user.cookie)
      .set('x-lang', 'fr');
    expect(generated.status).toBe(201);
    expect(generated.body.outputLocale).toBe('fr');
    expect(seenLocales).toEqual(['fr']);
    expect(JSON.stringify(generated.body.suggestions)).toContain('source-token');

    const localeMiss = await request(app)
      .get(url(siteId))
      .set('Cookie', user.cookie)
      .set('x-lang', 'de');
    expect(localeMiss.status).toBe(200);
    expect(localeMiss.body).toEqual({ generatedAt: null, outputLocale: 'de', suggestions: [] });
    expect(seenLocales).toEqual(['fr']);

    const original = await request(app)
      .get(url(siteId))
      .set('Cookie', user.cookie)
      .set('x-lang', 'fr');
    expect(original.body).toEqual(generated.body);
  });

  it('POST 201s with an empty list when the generator and templates yield nothing', async () => {
    const user = await seedUser('sg-emptygen@x.co');
    const siteId = await seedSite(user.id);
    // No keywords, no titles, no competitors, no GSC rows → no templates.
    setAiVisibilitySummaryProvider({
      ...createFakeSummaryProvider(),
      async generatePrompts() {
        return { prompts: [], model: 'fake-summary-model' };
      },
    });
    const res = await request(app).post(url(siteId)).set('Cookie', user.cookie);
    expect(res.status).toBe(201);
    expect(res.body.generatedAt).toEqual(expect.any(String));
    expect(res.body.suggestions).toEqual([]);
  });

  it('POST keeps the template fallback when the provider throws', async () => {
    const user = await seedUser('sg-tplkeep@x.co');
    const siteId = await seedSite(user.id);
    await seedKeyword(user.id, siteId);
    setAiVisibilitySummaryProvider({
      ...createFakeSummaryProvider(),
      async generatePrompts(): Promise<never> {
        throw new VendorUnavailableError('down', {
          provider: 'anthropic',
          operation: 'messages',
        });
      },
    });
    const res = await request(app).post(url(siteId)).set('Cookie', user.cookie);
    expect(res.status).toBe(201);
    expect(res.body.suggestions.every((row: { source: string }) => row.source === 'template')).toBe(
      true,
    );
  });

  it('POST 502s when the provider throws with nothing retained', async () => {
    const user = await seedUser('sg-provider-fail@x.co');
    const siteId = await seedSite(user.id);
    // No seeds at all → no template fallback to retain.
    setAiVisibilitySummaryProvider({
      ...createFakeSummaryProvider(),
      async generatePrompts(): Promise<never> {
        throw new VendorUnavailableError('down', {
          provider: 'anthropic',
          operation: 'messages',
        });
      },
    });
    const res = await request(app).post(url(siteId)).set('Cookie', user.cookie);
    expect(res.status).toBe(502);
  });

  it('cooldown: a second rapid POST 429s while GET stays available', async () => {
    setAiVisibilityCooldown(createInMemoryCooldown({ defaultMs: 60_000 }));
    const user = await seedUser('sg-cooldown@x.co');
    const siteId = await seedSite(user.id);
    await seedKeyword(user.id, siteId);

    expect((await request(app).post(url(siteId)).set('Cookie', user.cookie)).status).toBe(201);
    const second = await request(app).post(url(siteId)).set('Cookie', user.cookie);
    expect(second.status).toBe(429);
    // The debounce is generate-only — reading the stored set is unaffected.
    expect((await request(app).get(url(siteId)).set('Cookie', user.cookie)).status).toBe(200);
  });

  it('cross-account suggestions 404 on both verbs', async () => {
    const owner = await seedUser('sg-owner@x.co');
    const other = await seedUser('sg-other@x.co');
    const siteId = await seedSite(owner.id);
    expect((await request(app).get(url(siteId)).set('Cookie', other.cookie)).status).toBe(404);
    const res = await request(app).post(url(siteId)).set('Cookie', other.cookie);
    expect(res.status).toBe(404);
  });

  it('404s a malformed siteId on both verbs', async () => {
    const user = await seedUser('sg-badid@x.co');
    expect((await request(app).get(url('not-an-id')).set('Cookie', user.cookie)).status).toBe(404);
    expect((await request(app).post(url('not-an-id')).set('Cookie', user.cookie)).status).toBe(404);
  });
});

describe('GET /api/sites/:siteId/ai-visibility/trend', () => {
  async function seedSnapshot(accountId: string, siteId: string, mentioned: boolean) {
    await getTestDb().insert(aiMentionSnapshots).values({
      accountId,
      siteId,
      prompt: 'best seo audit tool',
      model: 'chatgpt',
      mentioned,
      checkedAt: new Date(),
    });
  }

  it('rejects unauthenticated calls with 401', async () => {
    const res = await request(app).get('/api/sites/anything/ai-visibility/trend');
    expect(res.status).toBe(401);
  });

  it('400s an out-of-range days value', async () => {
    const user = await seedUser('tr-days@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/ai-visibility/trend?days=0`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(400);
  });

  it('returns daily buckets for the default window', async () => {
    const user = await seedUser('tr-ok@x.co');
    const siteId = await seedSite(user.id);
    await seedSnapshot(user.id, siteId, true);
    await seedSnapshot(user.id, siteId, false);
    const res = await request(app)
      .get(`/api/sites/${siteId}/ai-visibility/trend`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(1);
    expect(res.body.points[0]).toMatchObject({
      mentionedRatePct: 50,
      shareOfVoicePct: 100,
      checks: 2,
    });
    expect(res.body.points[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns an empty series before any checks', async () => {
    const user = await seedUser('tr-empty@x.co');
    const siteId = await seedSite(user.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/ai-visibility/trend?days=30`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ points: [] });
  });

  it('cross-account trend 404s', async () => {
    const owner = await seedUser('tr-owner@x.co');
    const stranger = await seedUser('tr-stranger@x.co');
    const siteId = await seedSite(owner.id);
    const res = await request(app)
      .get(`/api/sites/${siteId}/ai-visibility/trend`)
      .set('Cookie', stranger.cookie);
    expect(res.status).toBe(404);
  });
});
