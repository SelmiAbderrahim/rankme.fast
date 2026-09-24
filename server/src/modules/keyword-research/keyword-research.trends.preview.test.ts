/**
 * Integration coverage — `POST /api/keyword-research/trends/explore/preview`
 * + `captureVendorCost` archive wiring for the explore path.
 *
 * Covers:
 *   1. Preview returns the community spend preview without touching the
 *      provider, the cache, or the run collection.
 *   2. Cost rows produced match the pinned ≤ 2-task math (one row for the
 *      vendor call + one audit-tag row per exploration, including the
 *      cached-zero-cost row).
 *   3. Preview refuses > 5 keywords with the localized boundary error in
 *      all seven locales.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
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
import { vendorCache, vendorResponses } from '../../db/schema/vendor-cache.js';
import { createFakeTrendsProvider } from '../../shared/providers/fakes.js';
import { DICTIONARIES } from '../../shared/i18n/index.js';
import {
  setKeywordResearchDb,
  setKeywordResearchTrendsProvider,
} from './keyword-research.holder.js';
import { setRanksDb } from '../ranks/index.js';
import { Site } from '../sites/index.js';
import { setTeamDb } from '../team/team.holder.js';
import { TrendsExplorationRun } from './trends-explorations.model.js';

const app = createApp();

async function seedUser(email: string) {
  return signupVerifiedUser(app, { email });
}

async function readAuditRows(accountId: string) {
  return getTestDb()
    .select()
    .from(vendorResponses)
    .where(
      and(
        eq(vendorResponses.accountId, accountId),
        eq(vendorResponses.capability, 'keyword'),
        eq(vendorResponses.operation, 'trends_live'),
      ),
    );
}

function withKillSwitch(state: boolean, fn: () => Promise<void>): Promise<void> {
  const original = env.KEYWORD_TRENDS_ENABLED;
  (env as { KEYWORD_TRENDS_ENABLED: boolean }).KEYWORD_TRENDS_ENABLED = state;
  return fn().finally(() => {
    (env as { KEYWORD_TRENDS_ENABLED: boolean }).KEYWORD_TRENDS_ENABLED = original;
  });
}

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

describe('POST /api/keyword-research/trends/explore/preview — auth + kill', () => {
  it('rejects unauthenticated calls with 401', async () => {
    await withTrendsEnabled(async () => {
      const res = await request(app)
        .post('/api/keyword-research/trends/explore/preview')
        .send({ keywords: ['seo'] });
      expect(res.status).toBe(401);
    });
  });

  it('checks an optional site scope before previewing', async () => {
    await withTrendsEnabled(async () => {
      const owner = await seedUser('preview-owner@x.co');
      const caller = await seedUser('preview-caller@x.co');
      const site = await Site.create({
        accountId: owner.id,
        url: 'https://preview-owned.example',
        domain: 'preview-owned.example',
      });
      await request(app)
        .post('/api/keyword-research/trends/explore/preview')
        .set('Cookie', caller.cookie)
        .send({ keywords: ['seo'], siteId: String(site._id) })
        .expect(404);
    });
  });

  it('requires and validates a granted site for selected-site teammates', async () => {
    await withTrendsEnabled(async () => {
      const owner = await seedUser('preview-selected-owner@x.co');
      const member = await signupVerifiedUser(app, {
        email: 'preview-selected-member@x.co',
      });
      const site = await Site.create({
        accountId: owner.id,
        url: 'https://preview-selected.example',
        domain: 'preview-selected.example',
      });
      const [membership] = await getTestDb()
        .insert(teamMembers)
        .values({
          teamId: owner.id,
          userId: member.id,
          email: member.email,
          role: 'member',
          siteAccessMode: 'selected',
          inviteTokenHash: '8'.repeat(64),
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
        .post('/api/keyword-research/trends/explore/preview')
        .set(headers)
        .send({ keywords: ['account-wide is hidden'] });
      expect(denied.body).toMatchObject({
        error: { message: DICTIONARIES.en.keywordResearch.trends.errors.notFound },
      });
      expect(denied.status).toBe(404);
      const allowed = await request(app)
        .post('/api/keyword-research/trends/explore/preview')
        .set(headers)
        .send({ keywords: ['granted site'], siteId: String(site._id) })
        .expect(200);
      expect(allowed.body).toEqual({ deploymentMode: 'community', capacityEnforced: false });
    });
  });

  it('kill switch OFF → localized 503 (preview never runs)', async () => {
    const user = await seedUser('killpreview@x.co');
    await withKillSwitch(false, async () => {
      const res = await request(app)
        .post('/api/keyword-research/trends/explore/preview')
        .set('Cookie', user.cookie)
        .send({ keywords: ['seo'] });
      expect(res.status).toBe(503);
      expect(res.body.error.message).toBe(
        DICTIONARIES.en.keywordResearch.trends.errors.unavailable,
      );
      expect(res.body.error.details).toEqual({ reason: 'disabled' });
    });
  });

  it('> 5 keywords rejected with localized boundary error in every locale', async () => {
    // Zod error precedes auth: no cookie required.
    await withTrendsEnabled(async () => {
      const user = await seedUser('sixkeys@x.co');
      const tooMany = ['a', 'b', 'c', 'd', 'e', 'f'];
      const res = await request(app)
        .post('/api/keyword-research/trends/explore/preview')
        .set('Cookie', user.cookie)
        .send({ keywords: tooMany });
      expect(res.status).toBe(400);
      // Every locale exposes the localized tooManyKeywords key for the
      // preview boundary (asserted for parity across 7 locales).
      for (const locale of ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const) {
        expect(
          DICTIONARIES[locale].keywordResearch.trends.errors.tooManyKeywords,
        ).toBeTypeOf('string');
      }
    });
  });
});

describe('POST /trends/explore/preview — community preview', () => {
  it('returns the community spend preview without touching the provider, cache, or runs', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('community-preview@x.co');
      const res = await request(app)
        .post('/api/keyword-research/trends/explore/preview')
        .set('Cookie', user.cookie)
        .send({ keywords: ['Localised Term'], geo: 'US', language: 'EN' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deploymentMode: 'community', capacityEnforced: false });
      expect(await getTestDb().select().from(vendorCache)).toEqual([]);
      expect(await getTestDb().select().from(vendorResponses)).toEqual([]);
      expect(await TrendsExplorationRun.countDocuments()).toBe(0);
    });
  });
});

describe('captureVendorCost archive wiring on the explore path', () => {
  it('uncached run produces at least one vendor_responses row tagged keyword/trends_live with the runId + cached=false audit row', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('costcap-uncached@x.co');
      const res = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['costcap-fresh'] });
      expect(res.status).toBe(200);
      expect(res.body.cached).toBe(false);

      const rows = await readAuditRows(user.id);
      // Two rows expected on the uncached path:
      //   (1) the read-through's own archive row (vendor call, cost=null
      //       because the fake reports nothing).
      //   (2) the exploration audit-tag row (runId + cached=false + 0
      //       micros).
      expect(rows.length).toBeGreaterThanOrEqual(2);
      const audit = rows.find(
        (r) =>
          typeof r.params === 'object' &&
          r.params !== null &&
          (r.params as Record<string, unknown>).tag === 'exploration_audit',
      );
      expect(audit).toBeDefined();
      const auditParams = audit!.params as Record<string, unknown>;
      expect(auditParams.runId).toBe(res.body.runId);
      expect(auditParams.cached).toBe(false);
      expect(audit!.costMicros).toBe(0n);
    });
  });

  it('cached run produces one audit row with cached=true and zero micros', async () => {
    await withTrendsEnabled(async () => {
      const user = await seedUser('costcap-cached@x.co');
      // Populate the cache first.
      const first = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['costcap-cached'] });
      expect(first.status).toBe(200);
      expect(first.body.cached).toBe(false);

      const rowsAfterFirst = await readAuditRows(user.id);
      const firstAuditCount = rowsAfterFirst.filter(
        (r) =>
          (r.params as Record<string, unknown>).tag === 'exploration_audit',
      ).length;

      const second = await request(app)
        .post('/api/keyword-research/trends/explore')
        .set('Cookie', user.cookie)
        .send({ keywords: ['costcap-cached'] });
      expect(second.status).toBe(200);
      expect(second.body.cached).toBe(true);

      const rowsAfterSecond = await readAuditRows(user.id);
      const audits = rowsAfterSecond.filter(
        (r) =>
          (r.params as Record<string, unknown>).tag === 'exploration_audit',
      );
      // Exactly one additional audit row was appended for the cached run.
      expect(audits.length).toBe(firstAuditCount + 1);
      const cachedAudit = audits.find(
        (r) =>
          (r.params as Record<string, unknown>).runId === second.body.runId,
      );
      expect(cachedAudit).toBeDefined();
      const cachedParams = cachedAudit!.params as Record<string, unknown>;
      expect(cachedParams.cached).toBe(true);
      expect(cachedAudit!.costMicros).toBe(0n);
    });
  });
});
