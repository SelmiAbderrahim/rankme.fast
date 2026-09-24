import type { Queue } from 'bullmq';
import mongoose from 'mongoose';
import request from 'supertest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import {
  teamMemberSiteGrants,
  teamMembers,
  trafficSnapshots,
} from '../../db/schema/index.js';
import { translate } from '../../shared/i18n/index.js';
import { WORKSPACE_HEADER } from '../../shared/middleware/workspace-context.js';
import {
  createFakeCompetitorProvider,
  VendorUnavailableError,
  type CompetitorProvider,
} from '../../shared/providers/index.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
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
import { setTeamDb } from '../team/index.js';
import {
  setCompetitorProvider,
  setCompetitorsDb,
  setTrafficSnapshotsQueue,
} from './competitors.holder.js';
import { createTrafficSnapshotProcessor } from './traffic-snapshots.processor.js';
import { TrafficSnapshotRun } from './traffic-snapshots.model.js';

const app = createApp();
const originalEnabled = env.TRAFFIC_INSIGHTS_ENABLED;
let jobs: Array<{ accountId: string; runId: string }> = [];

function installQueue(): void {
  jobs = [];
  setTrafficSnapshotsQueue({
    add: vi.fn(async (_name: string, data: (typeof jobs)[number]) => {
      jobs.push(data);
      return { id: data.runId };
    }),
  } as unknown as Queue);
}

async function seedUser(email: string): Promise<TestUser> {
  return signupVerifiedUser(app, { email });
}

async function seedSite(accountId: string, domain = 'owned.example'): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: `https://${domain}`,
    domain,
  });
  return String(site._id);
}

async function runs(accountId: string): Promise<number> {
  return TrafficSnapshotRun.countDocuments({ accountId });
}

async function processJob(
  data: (typeof jobs)[number],
  provider: CompetitorProvider,
): Promise<void> {
  await createTrafficSnapshotProcessor({
    db: getTestDb() as never,
    provider,
  })({ data } as never);
}

function failing(operation: string) {
  return new VendorUnavailableError(`${operation} unavailable`, {
    provider: 'fake',
    operation,
  });
}

beforeAll(async () => {
  await startMemoryMongo();
  const db = await startTestPostgres();
  installTestAuth();
  setCompetitorsDb(db as never);
  setTeamDb(db as never);
});

afterAll(async () => {
  (env as { TRAFFIC_INSIGHTS_ENABLED: boolean }).TRAFFIC_INSIGHTS_ENABLED = originalEnabled;
  setTrafficSnapshotsQueue(null);
  setCompetitorProvider(null);
  setCompetitorsDb(null);
  setTeamDb(null);
  uninstallTestAuth();
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { TRAFFIC_INSIGHTS_ENABLED: boolean }).TRAFFIC_INSIGHTS_ENABLED = true;
  installQueue();
  setCompetitorProvider(createFakeCompetitorProvider());
});

describe('Traffic Insights snapshot routes', () => {
  it('accepts repeated snapshot runs without any plan cap', async () => {
    const user = await seedUser('traffic-uncapped@example.test');
    for (let index = 0; index < 6; index += 1) {
      const created = await request(app)
        .post('/api/competitors/traffic-snapshots')
        .set('Cookie', user.cookie)
        .send({ targetDomain: `rival-${index}.example` })
        .expect(202);
      expect(created.body).not.toHaveProperty('reservedUnits');
    }
    expect(await runs(user.id)).toBe(6);
    expect(jobs).toHaveLength(6);
  });

  it('shares one domain cache row across accounts', async () => {
    const first = await seedUser('traffic-a@example.test');
    const second = await seedUser('traffic-b@example.test');
    const fake = createFakeCompetitorProvider();
    const provider: CompetitorProvider = {
      ...fake,
      getTrafficEstimation: vi.fn(fake.getTrafficEstimation),
      getDomainRankOverview: vi.fn(fake.getDomainRankOverview),
      getHistoricalRankOverview: vi.fn(fake.getHistoricalRankOverview),
    };

    const responses = [];
    const cacheSignals: boolean[] = [];
    for (const user of [first, second]) {
      const created = await request(app)
        .post('/api/competitors/traffic-snapshots')
        .set('Cookie', user.cookie)
        .send({ targetDomain: 'example.com' })
        .expect(202);
      cacheSignals.push(created.body.cached as boolean);
      await processJob(jobs.at(-1)!, provider);
      responses.push(
        await request(app)
          .get(`/api/competitors/traffic-snapshots/${created.body.runId}`)
          .set('Cookie', user.cookie)
          .expect(200),
      );
    }

    expect(provider.getTrafficEstimation).toHaveBeenCalledTimes(1);
    expect(provider.getDomainRankOverview).toHaveBeenCalledTimes(1);
    expect(provider.getHistoricalRankOverview).toHaveBeenCalledTimes(1);
    expect(cacheSignals).toEqual([false, true]);
    expect(responses[0]!.body.snapshot.payload).toEqual(
      responses[1]!.body.snapshot.payload,
    );
    expect(await runs(first.id)).toBe(1);
    expect(await runs(second.id)).toBe(1);
    expect(await getTestDb().select().from(trafficSnapshots)).toHaveLength(2);
  });

  it.each([
    [false, false, false],
    [true, false, false],
    [false, true, false],
    [false, false, true],
    [true, true, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ] as const)(
    'settles permutation traffic=%s rank=%s history=%s',
    async (trafficOk, rankOk, historyOk) => {
      const label = `${Number(trafficOk)}${Number(rankOk)}${Number(historyOk)}`;
      const user = await seedUser(`traffic-${label}@example.test`);
      await request(app)
        .post('/api/competitors/traffic-snapshots')
        .set('Cookie', user.cookie)
        .send({ targetDomain: `${label}.example` })
        .expect(202);
      const base = createFakeCompetitorProvider();
      const provider: CompetitorProvider = {
        ...base,
        getTrafficEstimation: trafficOk
          ? base.getTrafficEstimation
          : vi.fn().mockRejectedValue(failing('traffic')),
        getDomainRankOverview: rankOk
          ? base.getDomainRankOverview
          : vi.fn().mockRejectedValue(failing('rank')),
        getHistoricalRankOverview: historyOk
          ? base.getHistoricalRankOverview
          : vi.fn().mockRejectedValue(failing('history')),
      };
      const processing = processJob(jobs[0]!, provider);
      if (!trafficOk && !rankOk && !historyOk) {
        await expect(processing).rejects.toBeInstanceOf(VendorUnavailableError);
      } else {
        await processing;
      }
      const run = await TrafficSnapshotRun.findById(jobs[0]!.runId);
      const retained = Number(trafficOk) + Number(rankOk) + Number(historyOk);
      expect(run?.status).toBe(
        retained === 0 ? 'failed' : retained === 3 ? 'succeeded' : 'partial',
      );
      expect(await getTestDb().select().from(trafficSnapshots)).toHaveLength(
        retained === 0 ? 0 : 1,
      );
    },
  );

  it('returns 404 across accounts for create/read and isolates list results', async () => {
    const owner = await seedUser('traffic-owner@example.test');
    const stranger = await seedUser('traffic-stranger@example.test');
    const siteId = await seedSite(owner.id);
    await request(app)
      .post('/api/competitors/traffic-snapshots')
      .set('Cookie', stranger.cookie)
      .send({ targetDomain: 'example.com', siteId })
      .expect(404);
    expect(await runs(stranger.id)).toBe(0);

    const created = await request(app)
      .post('/api/competitors/traffic-snapshots')
      .set('Cookie', owner.cookie)
      .send({ targetDomain: 'example.com', siteId })
      .expect(202);
    await processJob(jobs[0]!, createFakeCompetitorProvider());
    await request(app)
      .get(`/api/competitors/traffic-snapshots/${created.body.runId}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    await request(app)
      .get(`/api/competitors/traffic-snapshots?siteId=${siteId}`)
      .set('Cookie', stranger.cookie)
      .expect(404);
    const list = await request(app)
      .get('/api/competitors/traffic-snapshots')
      .set('Cookie', stranger.cookie)
      .expect(200);
    expect(list.body.snapshots).toEqual([]);
  });

  it('scopes every stored read to the requested Site', async () => {
    const user = await seedUser('traffic-site-scope@example.test');
    const siteA = await seedSite(user.id, 'site-a.example');
    const siteB = await seedSite(user.id, 'site-b.example');
    const create = (targetDomain: string, siteId: string) =>
      request(app)
        .post('/api/competitors/traffic-snapshots')
        .set('Cookie', user.cookie)
        .send({ targetDomain, siteId });
    const firstA = await create('rival-a-one.example', siteA).expect(202);
    const secondA = await create('rival-a-two.example', siteA).expect(202);
    const firstB = await create('rival-b.example', siteB).expect(202);
    for (const job of jobs) await processJob(job, createFakeCompetitorProvider());

    const listA = await request(app)
      .get(`/api/competitors/traffic-snapshots?siteId=${siteA}`)
      .set('Cookie', user.cookie)
      .expect(200);
    expect(listA.body.snapshots.map((snapshot: { siteId: string }) => snapshot.siteId))
      .toEqual([siteA, siteA]);

    await request(app)
      .get(`/api/competitors/traffic-snapshots/${firstA.body.runId}?siteId=${siteA}`)
      .set('Cookie', user.cookie)
      .expect(200);
    await request(app)
      .get(`/api/competitors/traffic-snapshots/${firstA.body.runId}?siteId=${siteB}`)
      .set('Cookie', user.cookie)
      .expect(404);

    await request(app)
      .get(
        `/api/competitors/traffic-snapshots/compare?ids=${firstA.body.runId},${secondA.body.runId}&siteId=${siteA}`,
      )
      .set('Cookie', user.cookie)
      .expect(200);
    await request(app)
      .get(
        `/api/competitors/traffic-snapshots/compare?ids=${firstA.body.runId},${firstB.body.runId}&siteId=${siteA}`,
      )
      .set('Cookie', user.cookie)
      .expect(404);

    const aggregate = await request(app)
      .get('/api/competitors/traffic-snapshots')
      .set('Cookie', user.cookie)
      .expect(200);
    expect(aggregate.body.snapshots).toHaveLength(3);
    for (const path of [
      '/api/competitors/traffic-snapshots?siteId=bad',
      `/api/competitors/traffic-snapshots/${firstA.body.runId}?siteId=bad`,
      `/api/competitors/traffic-snapshots/compare?ids=${firstA.body.runId},${secondA.body.runId}&siteId=bad`,
    ]) {
      await request(app).get(path).set('Cookie', user.cookie).expect(400);
    }
  });

  it('requires a selected-scope teammate to bind new snapshots to an allowed Site', async () => {
    const owner = await seedUser('traffic-team-owner@example.test');
    const member = await seedUser('traffic-team-member@example.test');
    const siteId = await seedSite(owner.id, 'team-allowed.example');
    const [membership] = await getTestDb()
      .insert(teamMembers)
      .values({
        teamId: owner.id,
        userId: member.id,
        email: member.email,
        role: 'member',
        siteAccessMode: 'selected',
        inviteTokenHash: 'b'.repeat(64),
        invitedBy: owner.id,
        acceptedAt: new Date('2026-08-12T00:00:00.000Z'),
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      })
      .returning({ id: teamMembers.id });
    await getTestDb().insert(teamMemberSiteGrants).values({
      teamMemberId: membership!.id,
      siteId,
    });

    const workspaceRequest = () =>
      request(app)
        .post('/api/competitors/traffic-snapshots')
        .set('Cookie', member.cookie)
        .set(WORKSPACE_HEADER, owner.id);
    await workspaceRequest().send({ targetDomain: 'account-wide.example' }).expect(404);
    expect(await runs(owner.id)).toBe(0);

    const created = await workspaceRequest()
      .send({ targetDomain: 'site-bound.example', siteId })
      .expect(202);
    const run = await TrafficSnapshotRun.findById(created.body.runId);
    expect(String(run?.siteId)).toBe(siteId);
    expect(jobs).toEqual([expect.objectContaining({ accountId: owner.id })]);
    expect(await runs(owner.id)).toBe(1);
  });

  it('blocks only new runs when disabled and keeps stored reads live', async () => {
    const user = await seedUser('traffic-disabled@example.test');
    const created = await request(app)
      .post('/api/competitors/traffic-snapshots')
      .set('Cookie', user.cookie)
      .send({ targetDomain: 'example.com' })
      .expect(202);
    await processJob(jobs[0]!, createFakeCompetitorProvider());
    (env as { TRAFFIC_INSIGHTS_ENABLED: boolean }).TRAFFIC_INSIGHTS_ENABLED = false;
    const blocked = await request(app)
      .post('/api/competitors/traffic-snapshots')
      .set('Cookie', user.cookie)
      .set('Accept-Language', 'de')
      .send({ targetDomain: 'other.example' })
      .expect(503);
    expect(blocked.body.error.message).toBe(
      translate('de', 'trafficInsights.errors.productUnavailable'),
    );
    await request(app)
      .get(`/api/competitors/traffic-snapshots/${created.body.runId}`)
      .set('Cookie', user.cookie)
      .expect(200);
    await request(app)
      .get('/api/competitors/traffic-snapshots?domain=example.com')
      .set('Cookie', user.cookie)
      .expect(200);
  });

  it.each(['bogus', '127.0.0.1', '\ud800.example'])(
    'rejects unsafe or malformed domain %s',
    async (targetDomain) => {
      const user = await seedUser(`invalid-${Math.random()}@example.test`);
      await request(app)
        .post('/api/competitors/traffic-snapshots')
        .set('Cookie', user.cookie)
        .send({ targetDomain })
        .expect(400);
      expect(await runs(user.id)).toBe(0);
    },
  );

  it('normalizes a valid IDN to its ASCII cache-safe form', async () => {
    const user = await seedUser('traffic-idn@example.test');
    const response = await request(app)
      .post('/api/competitors/traffic-snapshots')
      .set('Cookie', user.cookie)
      .send({ targetDomain: 'münchen.de' })
      .expect(202);
    expect(response.body.targetDomain).toBe('xn--mnchen-3ya.de');
  });

  it('is authenticated and reports a missing queue before creating a run', async () => {
    await request(app)
      .post('/api/competitors/traffic-snapshots')
      .send({ targetDomain: 'example.com' })
      .expect(401);
    const user = await seedUser('traffic-no-queue@example.test');
    setTrafficSnapshotsQueue(null);
    await request(app)
      .post('/api/competitors/traffic-snapshots')
      .set('Cookie', user.cookie)
      .send({ targetDomain: 'example.com' })
      .expect(503);
    expect(await runs(user.id)).toBe(0);
  });
});
