/**
 * Integration coverage — `POST /api/keyword-research/trends/explore`,
 * `GET /api/keyword-research/trends`, `GET /api/keyword-research/trends/:runId`.
 *
 * Covers: cache reuse, run outcome truth table (provider failure / sparse /
 * flat / empty), kill-switch, cross-account 404, estimate-labeling DTO
 * invariant, and 7-locale key presence for the trends dictionary namespace.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
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
import {
  teamMembers,
  teamMemberSiteGrants,
} from '../../db/schema/team-members.js';
import { createFakeTrendsProvider } from '../../shared/providers/fakes.js';
import {
  VendorUnavailableError,
  type TrendsProvider,
} from '../../shared/providers/index.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import {
  setKeywordResearchDb,
  setKeywordResearchTrendsProvider,
} from './keyword-research.holder.js';
import { setRanksDb } from '../ranks/index.js';
import { TrendsExplorationRun } from './trends-explorations.model.js';
import { Site } from '../sites/index.js';
import { setTeamDb } from '../team/team.holder.js';
import {
  findTrendsRun,
  listTrendsRunsForAccount,
  resolveOwnedTrendsRunSiteId,
} from './keyword-research.service.js';

const app = createApp();

async function seedUser(email: string) {
  return signupVerifiedUser(app, { email });
}

async function runCount(accountId: string): Promise<number> {
  return TrendsExplorationRun.countDocuments({ accountId });
}

/** Force the kill switch flag mutably for the duration of a test. */
function withKillSwitch(state: boolean, fn: () => Promise<void>): Promise<void> {
  const original = env.KEYWORD_TRENDS_ENABLED;
  (env as { KEYWORD_TRENDS_ENABLED: boolean }).KEYWORD_TRENDS_ENABLED = state;
  return fn().finally(() => {
    (env as { KEYWORD_TRENDS_ENABLED: boolean }).KEYWORD_TRENDS_ENABLED = original;
  });
}

/** Enable the flag by default across the suite so the happy path exercises. */
function withTrendsEnabled(fn: () => Promise<void>): Promise<void> {
  return withKillSwitch(true, fn);
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setKeywordResearchDb(db as unknown as never);
  setRanksDb(db as unknown as never);
  setTeamDb(db as unknown as never);
});
afterAll(async () => {
  uninstallTestAuth();
  setKeywordResearchDb(null);
  setRanksDb(null);
  setKeywordResearchTrendsProvider(null);
  setTeamDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  setKeywordResearchTrendsProvider(createFakeTrendsProvider());
});

describe('POST /api/keyword-research/trends/explore — auth + kill', () => {
  it('rejects unauthenticated calls with 401', async () => {
    await withTrendsEnabled(async () => {
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .send({ keywords: ['seo'] });
      expect(res.status).toBe(401);
    });
  });

  it('serves an identical repeat from the cache', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('cachedrepeat@x.co');
      await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['cache-me'] })
        .expect(200);
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['cache-me'] });
      expect(res.status).toBe(200);
      expect(res.body.cached).toBe(true);
      expect(await runCount(user.id)).toBe(2);
    });
  });

  it('requires selected-site teammates to choose one of their granted sites', async () => {
    await withTrendsEnabled(async () => {
      const owner = await seedUser('selected-trends-owner@x.co');
      const member = await signupVerifiedUser(app, {
        email: 'selected-trends-member@x.co',
      });
      const site = await Site.create({
        accountId: owner.id,
        url: 'https://selected-trends.example',
        domain: 'selected-trends.example',
      });
      const [membership] = await getTestDb()
        .insert(teamMembers)
        .values({
          teamId: owner.id,
          userId: member.id,
          email: member.email,
          role: 'member',
          siteAccessMode: 'selected',
          inviteTokenHash: '7'.repeat(64),
          invitedBy: owner.id,
          acceptedAt: new Date(),
          expiresAt: new Date(Date.now() + 86_400_000),
        })
        .returning({ id: teamMembers.id });
      await getTestDb().insert(teamMemberSiteGrants).values({
        teamMemberId: membership!.id,
        siteId: String(site._id),
      });
      const headers = {
        Cookie: member.cookie,
        'x-workspace-id': owner.id,
      };

      const denied = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set(headers)
        .send({ keywords: ['account-wide is hidden'] });
      expect(denied.body).toMatchObject({
        error: { message: DICTIONARIES.en.keywordResearch.trends.errors.notFound },
      });
      expect(denied.status).toBe(404);
      expect(await runCount(owner.id)).toBe(0);

      await request(app)
        .post('/api/keyword-research/trends/explore')
        .set(headers)
        .send({ keywords: ['granted site'], siteId: String(site._id) })
        .expect(200);
      expect(await runCount(owner.id)).toBe(1);
    });
  });

  it('kill switch OFF → POST returns localized 503; stored reads survive', async () => {
    // First: create a stored run with the flag ON.
    let runId = '';
    await withTrendsEnabled(async () => {
      const user = await seedUser('killstore@x.co');
      const create = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['kill-switch-kw'] });
      expect(create.status).toBe(200);
      runId = create.body.runId;
      expect(runId).toMatch(/^[a-f0-9]{24}$/);
      // Now flip the flag OFF and confirm POST fails + GET still works.
      await withKillSwitch(false, async () => {
        const post = await request(app)
          .post('/api/keyword-research/trends/explore')
          .set('Cookie', user.cookie)
          .send({ keywords: ['blocked'] });
        expect(post.status).toBe(503);
        expect(post.body.error.message).toBe(
          DICTIONARIES.en.keywordResearch.trends.errors.unavailable,
        );
        expect(post.body.error.details).toEqual({ reason: 'disabled' });
        const get = await request(app)
          .get(`/api/keyword-research/trends/${runId}`)
          .set('Cookie', user.cookie);
        expect(get.status).toBe(200);
        expect(get.body.runId).toBe(runId);
        const list = await request(app)
          .get('/api/keyword-research/trends')
          .set('Cookie', user.cookie);
        expect(list.status).toBe(200);
        expect(list.body.runs).toHaveLength(1);
      });
    });
  });
});

describe('run outcome truth table', () => {
  it('provider failure — vendor throw → run failed, nothing retained', async () => {
    await withTrendsEnabled(async () => {
      const failing: TrendsProvider = {
        async explore() {
          throw new VendorUnavailableError('trends down', {
            provider: 'fake',
            operation: 'trends.explore',
          });
        },
      };
      setKeywordResearchTrendsProvider(failing);
      const user = await seedUser('providerfail@x.co');
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['fail-me'] });
      expect(res.status).toBe(503);
      expect(res.body.error.message).toBe(
        DICTIONARIES.en.keywordResearch.trends.errors.providerFailed,
      );
      expect(res.body.error.details).toEqual({ reason: 'provider_failed' });
      const runs = await TrendsExplorationRun.find({ accountId: user.id }).exec();
      expect(runs).toHaveLength(1);
      const run = runs[0]!;
      expect(run.get('status')).toBe('failed');
      expect(run.get('retained')).toBe(false);
      expect(run.get('errorCode')).toBe('VendorUnavailableError');
    });
  });

  it('sparse — provider returns few points → succeeded, retained=true', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('sparseok@x.co');
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        // Sentinel keyword forces the fake into the 'sparse' scenario.
        .send({ keywords: ['__scenario:sparse'] });
      expect(res.status).toBe(200);
      const runs = await TrendsExplorationRun.find({ accountId: user.id }).exec();
      expect(runs[0]!.get('status')).toBe('succeeded');
      expect(runs[0]!.get('retained')).toBe(true);
    });
  });

  it('flat — flat series → succeeded, retained=true', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('flatok@x.co');
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['__scenario:flat'] });
      expect(res.status).toBe(200);
      const runs = await TrendsExplorationRun.find({ accountId: user.id }).exec();
      expect(runs[0]!.get('status')).toBe('succeeded');
      expect(runs[0]!.get('retained')).toBe(true);
      // 24 monthly points → seriesCount 1.
      expect(runs[0]!.get('seriesCount')).toBe(1);
    });
  });

  it('empty success — zero series from a successful provider result still succeeds', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('emptyok@x.co');
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['__scenario:empty'] });
      expect(res.status).toBe(200);
      expect(res.body.series).toEqual([]);
      expect(res.body.seriesReadouts).toEqual([]);
      const runs = await TrendsExplorationRun.find({ accountId: user.id }).exec();
      expect(runs[0]!.get('status')).toBe('succeeded');
      expect(runs[0]!.get('retained')).toBe(true);
      expect(runs[0]!.get('seriesCount')).toBe(0);
    });
  });
});

describe('cross-account isolation returns 404 (never 403)', () => {
  it('user B GET on user A\'s runId → 404 with localized notFound key', async () => {
    await withTrendsEnabled(async () => {
      const a = await seedUser('owner@x.co');
      const b = await seedUser('stranger@x.co');
      const create = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', a.cookie)
        .send({ keywords: ['owner-kw'] });
      expect(create.status).toBe(200);
      const runId = create.body.runId as string;
      const res = await request(app)
        .get(`/api/keyword-research/trends/${runId}`)
        .set('Cookie', b.cookie);
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe(
        DICTIONARIES.en.keywordResearch.trends.errors.notFound,
      );
    });
  });

  it('malformed runId → 404 (never leaks distinction from cross-account)', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('badrun@x.co');
      const res = await request(app)
        .get('/api/keyword-research/trends/not-a-run-id')
        .set('Cookie', user.cookie);
      expect(res.status).toBe(400);
    });
  });
});

describe('estimate-labeling DTO invariants', () => {
  it('every series + readout carries source=estimate and the coverage-note key', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('label@x.co');
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['label-kw'] });
      expect(res.status).toBe(200);
      const KEY = 'keywordResearch.trends.coverageNote.searchInterestIndex';
      for (const s of res.body.series) {
        expect(s.source).toBe('estimate');
        expect(s.observationMeta.searchInterestIndexKey).toBe(KEY);
      }
      for (const r of res.body.seriesReadouts) {
        for (const ro of [r.readouts.yoy, r.readouts.momentum, r.readouts.seasonality]) {
          expect(ro.source).toBe('estimate');
          expect(ro.observationMeta.searchInterestIndexKey).toBe(KEY);
        }
      }
      const defaultReadouts = res.body.seriesReadouts[0].readouts;
      expect(defaultReadouts.yoy.deltaFraction).toBeTypeOf('number');
      expect(defaultReadouts.yoy.reason).toBeUndefined();
      expect(defaultReadouts.momentum.direction).toBe('up');
      expect(defaultReadouts.momentum.slopePerWeek).toBeGreaterThan(0.5);
      expect(defaultReadouts.seasonality.months).toEqual([12]);
      expect(defaultReadouts.seasonality.reason).toBeUndefined();
      // Stored-read carries the invariant too.
      const stored = await request(app)
        .get(`/api/keyword-research/trends/${res.body.runId}`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(stored.body.source).toBe('estimate');
      expect(stored.body.observationMeta.searchInterestIndexKey).toBe(KEY);
    });
  });

  it('response clamps related queries to 100 chars and 50 items', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('clamp@x.co');
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['clampme'] })
        .expect(200);
      expect(res.body.relatedQueries.length).toBeLessThanOrEqual(50);
      for (const r of res.body.relatedQueries) {
        expect(typeof r.query).toBe('string');
        expect(r.query.length).toBeLessThanOrEqual(100);
      }
    });
  });
});

describe('list + pagination', () => {
  it('GET /trends lists the caller\'s stored runs newest first', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('list@x.co');
      for (const kw of ['one', 'two', 'three']) {
        await request(app)
          .post('/api/keyword-research/trends/explore')
          .set('Cookie', user.cookie)
          .send({ keywords: [kw] })
          .expect(200);
      }
      const list = await request(app)
        .get('/api/keyword-research/trends')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(list.body.runs).toHaveLength(3);
      // Never shows another account's runs.
      const stranger = await seedUser('other@x.co');
      const strangerList = await request(app)
        .get('/api/keyword-research/trends')
        .set('Cookie', stranger.cookie)
        .expect(200);
      expect(strangerList.body.runs).toEqual([]);
    });
  });

  it('rejects a bad cursor with 400', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('badc@x.co');
      const res = await request(app)
        .get('/api/keyword-research/trends?cursor=not-b64url')
        .set('Cookie', user.cookie);
      expect(res.status).toBe(400);
    });
  });

  it.each([
    ['unparseable date', { createdAt: 'not-a-date', id: 'a'.repeat(24) }],
    ['non-string id', { createdAt: new Date().toISOString(), id: 42 }],
    ['non-hex id', { createdAt: new Date().toISOString(), id: 'zzzz' }],
  ])('rejects a well-formed cursor carrying a %s with 400', async (_label, decoded) => {
    await withTrendsEnabled(async () => {
      const user = await seedUser(`cursor-${String(_label).replace(/\W+/g, '')}@x.co`);
      const cursor = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');
      const res = await request(app)
        .get(`/api/keyword-research/trends?cursor=${cursor}`)
        .set('Cookie', user.cookie);
      expect(res.status).toBe(400);
    });
  });

  it('pages with the returned cursor and filters by siteId', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('paging@x.co');
      await Site.create({
        _id: '507f1f77bcf86cd799439011',
        accountId: user.id,
        url: 'https://paging.example',
        domain: 'paging.example',
      });
      for (const kw of ['page-a', 'page-b', 'page-c']) {
        await request(app)
          .post('/api/keyword-research/trends/explore')
          .set('Cookie', user.cookie)
          .send({ keywords: [kw], siteId: '507f1f77bcf86cd799439011' })
          .expect(200);
      }

      const firstPage = await request(app)
        .get('/api/keyword-research/trends?limit=2')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(firstPage.body.runs).toHaveLength(2);
      expect(firstPage.body.nextCursor).toBeTypeOf('string');

      const secondPage = await request(app)
        .get(`/api/keyword-research/trends?limit=2&cursor=${firstPage.body.nextCursor}`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(secondPage.body.runs).toHaveLength(1);
      expect(secondPage.body.nextCursor).toBeNull();
      const firstIds = firstPage.body.runs.map((r: { runId: string }) => r.runId);
      for (const run of secondPage.body.runs)
        expect(firstIds).not.toContain((run as { runId: string }).runId);

      // siteId narrows the same ledger; an unrelated site id returns nothing.
      const matching = await request(app)
        .get('/api/keyword-research/trends?siteId=507f1f77bcf86cd799439011')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(matching.body.runs).toHaveLength(3);
      const other = await request(app)
        .get('/api/keyword-research/trends?siteId=507f1f77bcf86cd799439012')
        .set('Cookie', user.cookie)
        .expect(200);
      expect(other.body.runs).toEqual([]);
    });
  });

  it('omits denied and account-wide runs from a selected Site aggregate', async () => {
    const user = await seedUser('scoped-list@x.co');
    const [allowedSite, deniedSite] = await Site.create([
      {
        accountId: user.id,
        url: 'https://allowed-trends.example',
        domain: 'allowed-trends.example',
      },
      {
        accountId: user.id,
        url: 'https://denied-trends.example',
        domain: 'denied-trends.example',
      },
    ]);
    const stored = (siteId: string | null, keyword: string) => ({
      accountId: user.id,
      siteId,
      inputs: { keywords: [keyword], geo: null, language: null },
      status: 'succeeded',
      retained: true,
      errorCode: null,
      completedAt: new Date(),
      seriesCount: 1,
      relatedQueryCount: 0,
    });
    await TrendsExplorationRun.create([
      stored(String(allowedSite!._id), 'allowed'),
      stored(String(deniedSite!._id), 'denied'),
      stored(null, 'account-wide'),
    ]);

    const scoped = await listTrendsRunsForAccount({
      accountId: user.id,
      allowedSiteIds: [String(allowedSite!._id)],
      limit: 20,
    });
    expect(scoped.runs).toHaveLength(1);
    expect(scoped.runs[0]?.get('siteId')).toBe(String(allowedSite!._id));

    const empty = await listTrendsRunsForAccount({
      accountId: user.id,
      allowedSiteIds: [],
      limit: 20,
    });
    expect(empty.runs).toEqual([]);
  });

  it('serializes a run that never reached a terminal state with completedAt: null', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('running-run@x.co');
      const run = await TrendsExplorationRun.create({
        accountId: user.id,
        siteId: null,
        inputs: { keywords: ['stuck'], geo: null, language: null },
        status: 'running',
        retained: false,
          errorCode: null,
        completedAt: null,
        seriesCount: 0,
        relatedQueryCount: 0,
      });
      const res = await request(app)
        .get(`/api/keyword-research/trends/${String(run._id)}`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(res.body.status).toBe('running');
      expect(res.body.completedAt).toBeNull();
      expect(res.body.siteId).toBeNull();
      expect(res.body.inputs).toEqual({ keywords: ['stuck'], geo: null, language: null });
    });
  });
});

describe('explore — geo/language scoping, clamping, and non-vendor faults', () => {
  it('maps geo and language through to the provider and stores the scoped inputs', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('geolang@x.co');
      const seen: { languageCode?: string; locationCode?: number }[] = [];
      setKeywordResearchTrendsProvider({
        async explore(input) {
          seen.push({
            ...(input.languageCode ? { languageCode: input.languageCode } : {}),
            ...(input.locationCode ? { locationCode: input.locationCode } : {}),
          });
          return createFakeTrendsProvider().explore(input);
        },
      });
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['Scoped Term'], geo: 'US', language: 'EN' })
        .expect(200);
      expect(seen[0]).toEqual({ languageCode: 'en', locationCode: 2840 });
      const stored = await request(app)
        .get(`/api/keyword-research/trends/${res.body.runId}`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(stored.body.inputs).toEqual({
        keywords: ['scoped term'],
        geo: 'us',
        language: 'en',
      });
    });
  });

  it('checks site ownership before creating a trends run', async () => {
    await withTrendsEnabled(async () => {
      const owner = await seedUser('site-owner@x.co');
      const caller = await seedUser('site-caller@x.co');
      const site = await Site.create({
        accountId: owner.id,
        url: 'https://owned.example',
        domain: 'owned.example',
      });

      await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', caller.cookie)
        .send({ keywords: ['private site'], siteId: String(site._id) })
        .expect(404);
      expect(await runCount(caller.id)).toBe(0);
    });
  });

  it('hides a stored site run as soon as its site enters deletion', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('deleted-trends-site@x.co');
      const site = await Site.create({
        accountId: user.id,
        url: 'https://deleted-trends.example',
        domain: 'deleted-trends.example',
      });
      const created = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['site lifecycle'], siteId: String(site._id) })
        .expect(200);

      await request(app)
        .get(`/api/keyword-research/trends/${created.body.runId as string}`)
        .set('Cookie', user.cookie)
        .expect(200);
      await expect(
        resolveOwnedTrendsRunSiteId(user.id, created.body.runId as string),
      ).resolves.toBe(String(site._id));

      await Site.updateOne(
        { _id: site._id },
        { $set: { deletionStartedAt: new Date() } },
      );
      await expect(
        findTrendsRun({ accountId: user.id, runId: created.body.runId as string }),
      ).resolves.toBeNull();
      await request(app)
        .get(`/api/keyword-research/trends/${created.body.runId as string}`)
        .set('Cookie', user.cookie)
        .expect(404);
    });
  });

  it('rejects markets and languages outside the provider boundary', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('bad-market@x.co');
      await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['seo'], geo: 'anywhere' })
        .expect(400);
      await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['seo'], language: 'english' })
        .expect(400);
      expect(await runCount(user.id)).toBe(0);
    });
  });

  it('truncates an over-long related query and labels a short series insufficient_history', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('clamp-long@x.co');
      const longQuery = 'q'.repeat(180);
      setKeywordResearchTrendsProvider({
        async explore() {
          return {
            series: [
              {
                keyword: 'shorthistory',
                points: [
                  { year: 2026, month: 5, value: 10 },
                  { year: 2026, month: 6, value: 12 },
                  { year: 2026, month: 7, value: 14 },
                ],
              },
            ],
            relatedQueries: [{ query: longQuery, value: 90, kind: 'rising' as const }],
            window: { startDate: null, endDate: null },
            observedAt: '2026-07-22T12:00:00.000Z',
            locationCode: null,
            languageCode: null,
          };
        },
      });
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['shorthistory'] })
        .expect(200);
      expect(res.body.relatedQueries[0].query).toHaveLength(100);
      expect(res.body.relatedQueries[0].query).toBe(longQuery.slice(0, 100));
      expect(res.body.seriesReadouts[0].readouts.yoy.reason).toBe('insufficient_history');
      expect(res.body.seriesReadouts[0].readouts.momentum.reason).toBe(
        'insufficient_history',
      );
    });
  });

  it('omits the insufficient_history reason once the series carries five full years', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('longhistory@x.co');
      const points: { year: number; month: number; value: number }[] = [];
      for (let i = 0; i < 60; i += 1) {
        points.push({
          year: 2021 + Math.floor(i / 12),
          month: (i % 12) + 1,
          value: 40 + (i % 7),
        });
      }
      setKeywordResearchTrendsProvider({
        async explore() {
          return {
            series: [{ keyword: 'longhistory', points }],
            relatedQueries: [{ query: 'short one', value: 50, kind: 'top' as const }],
            window: { startDate: null, endDate: null },
            observedAt: '2026-07-22T12:00:00.000Z',
            locationCode: null,
            languageCode: null,
          };
        },
      });
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['longhistory'] })
        .expect(200);
      const readouts = res.body.seriesReadouts[0].readouts;
      expect(readouts.yoy.reason).toBeUndefined();
      expect(readouts.yoy.deltaFraction).toBeTypeOf('number');
      expect(readouts.momentum.reason).toBeUndefined();
      expect(res.body.relatedQueries[0].query).toBe('short one');
    });
  });

  it('a throw that is not an Error records the Unknown error code', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('nonerror@x.co');
      setKeywordResearchTrendsProvider({
        async explore(): Promise<never> {
          throw 'a bare string, not an Error';
        },
      });
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['bare-throw'] });
      expect(res.status).toBe(500);
      const run = await TrendsExplorationRun.findOne({ accountId: user.id }).exec();
      expect(run?.get('status')).toBe('failed');
      expect(run?.get('errorCode')).toBe('Unknown');
    });
  });

  it('a non-vendor throw fails the run and is not re-wrapped as 503', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('plainthrow@x.co');
      setKeywordResearchTrendsProvider({
        async explore(): Promise<never> {
          throw new TypeError('not a vendor fault');
        },
      });
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['boom'] });
      expect(res.status).toBe(500);
      const run = await TrendsExplorationRun.findOne({ accountId: user.id }).exec();
      expect(run?.get('status')).toBe('failed');
      expect(run?.get('retained')).toBe(false);
      expect(run?.get('errorCode')).toBe('TypeError');
    });
  });
});

describe('7-locale key parity for the new trends namespace', () => {
  it('every locale defines keywordResearch.trends.errors.unavailable + providerFailed + notFound + coverageNote', async () => {
    for (const lang of ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const) {
      const dict = DICTIONARIES[lang].keywordResearch.trends;
      expect(dict.errors.unavailable).toBeTypeOf('string');
      expect(dict.errors.providerFailed).toBeTypeOf('string');
      expect(dict.errors.notFound).toBeTypeOf('string');
      expect(dict.coverageNote.searchInterestIndex).toBeTypeOf('string');
      expect(dict.readouts.insufficientHistory).toBeTypeOf('string');
      for (const k of ['queued', 'running', 'succeeded', 'failed'] as const) {
        expect(dict.status[k]).toBeTypeOf('string');
      }
    }
  });
});
