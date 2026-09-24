/**
 * /api/audits + /api/sites/:siteId/audits HTTP tests (prompt 07).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Job, Queue } from 'bullmq';
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
import { setSitesDb } from '../sites/index.js';
import {
  installTestAuth,
  signupVerifiedUser,
  uninstallTestAuth,
  type TestUser,
} from '../../shared/testing/auth.js';
import { setAuditsQueue } from './audits.queue-holder.js';
import { AuditRun } from './audit-run.model.js';
import { AuditLog } from '../audit/index.js';
import { AUDIT_PAGE_CAP_MAX } from './audits.schema.js';

const app = createApp();

interface EnqueuedJob {
  name: string;
  data: { pageCap: number; runId: string; siteId: string; accountId: string };
  opts: { jobId?: string };
}

function fakeQueue(): { queue: Queue; jobs: EnqueuedJob[] } {
  const jobs: EnqueuedJob[] = [];
  const queue = {
    async add(name: string, data: unknown, opts: { jobId?: string }): Promise<Job> {
      jobs.push({ name, data: data as EnqueuedJob['data'], opts });
      return { id: opts.jobId } as Job;
    },
  } as unknown as Queue;
  return { queue, jobs };
}

async function addSite(user: TestUser): Promise<string> {
  const res = await request(app)
    .post('/api/sites')
    .set('Cookie', user.cookie)
    .send({ url: 'https://example.com' });
  return (res.body as { site: { id: string } }).site.id;
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setSitesDb(getTestDb() as unknown as never);
  installTestAuth();
});

afterAll(async () => {
  uninstallTestAuth();
  setSitesDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

afterEach(() => {
  setAuditsQueue(null);
});

describe('POST /api/sites/:siteId/audits', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).post('/api/sites/abc/audits');
    expect(res.status).toBe(401);
  });

  it('202 on success — requested page cap forwarded to the enqueued job', async () => {
    const { queue, jobs } = fakeQueue();
    setAuditsQueue(queue);
    const user = await signupVerifiedUser(app, { email: 'audit-happy@x.co' });
    const siteId = await addSite(user);

    const res = await request(app)
      .post(`/api/sites/${siteId}/audits`)
      .set('Cookie', user.cookie)
      .send({ requestedPageCap: 5_000 });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      run: { status: 'queued', pageCap: 5_000, siteId },
      message: expect.any(String),
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data.pageCap).toBe(5_000);
    const audit = await AuditLog.findOne({
      actorUserId: user.id,
      action: 'audit.run',
    }).lean();
    expect(audit).not.toBeNull();
    expect(audit?.targetType).toBe('site');
    expect(audit?.targetId).toBe(siteId);
  });

  it('rejects a second concurrent run with 409', async () => {
    const { queue } = fakeQueue();
    setAuditsQueue(queue);
    const user = await signupVerifiedUser(app, { email: 'audit-conflict@x.co' });
    const siteId = await addSite(user);

    await request(app).post(`/api/sites/${siteId}/audits`).set('Cookie', user.cookie).send({});
    const second = await request(app)
      .post(`/api/sites/${siteId}/audits`)
      .set('Cookie', user.cookie)
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.error?.message).toBeTypeOf('string');
  });

  it('cross-account site → 404', async () => {
    const { queue } = fakeQueue();
    setAuditsQueue(queue);
    const owner = await signupVerifiedUser(app, { email: 'audit-owner@x.co' });
    const intruder = await signupVerifiedUser(app, { email: 'audit-intruder@x.co' });
    const siteId = await addSite(owner);
    const res = await request(app)
      .post(`/api/sites/${siteId}/audits`)
      .set('Cookie', intruder.cookie)
      .send({});
    expect(res.status).toBe(404);
  });

  it('returns 503 when no queue is registered', async () => {
    setAuditsQueue(null);
    const user = await signupVerifiedUser(app, { email: 'audit-no-queue@x.co' });
    const siteId = await addSite(user);
    const res = await request(app)
      .post(`/api/sites/${siteId}/audits`)
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(503);
  });

  it('an omitted page cap takes the structural maximum', async () => {
    const { queue, jobs } = fakeQueue();
    setAuditsQueue(queue);
    const user = await signupVerifiedUser(app, { email: 'audit-max-cap@x.co' });
    const siteId = await addSite(user);
    const res = await request(app)
      .post(`/api/sites/${siteId}/audits`)
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(202);
    expect(jobs[0]?.data.pageCap).toBe(AUDIT_PAGE_CAP_MAX);
  });

  it('400 on invalid body (negative pageCap)', async () => {
    const { queue } = fakeQueue();
    setAuditsQueue(queue);
    const user = await signupVerifiedUser(app, { email: 'audit-bad-body@x.co' });
    const siteId = await addSite(user);
    const res = await request(app)
      .post(`/api/sites/${siteId}/audits`)
      .set('Cookie', user.cookie)
      .send({ requestedPageCap: -1 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/sites/:siteId/audits', () => {
  it('lists runs newest-first for the owner', async () => {
    const { queue } = fakeQueue();
    setAuditsQueue(queue);
    const user = await signupVerifiedUser(app, { email: 'audit-list@x.co' });
    const siteId = await addSite(user);
    await request(app).post(`/api/sites/${siteId}/audits`).set('Cookie', user.cookie).send({});
    // Simulate completion so a second run is allowed. Clearing `activeKey`
    // is load-bearing — the partial-unique index would otherwise reject the
    // second `queued` insert with E11000.
    await AuditRun.updateMany(
      {},
      { $set: { status: 'succeeded', activeKey: null } },
    );
    await request(app).post(`/api/sites/${siteId}/audits`).set('Cookie', user.cookie).send({});

    const res = await request(app)
      .get(`/api/sites/${siteId}/audits`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(2);
  });

  it('cross-account → 404', async () => {
    const { queue } = fakeQueue();
    setAuditsQueue(queue);
    const owner = await signupVerifiedUser(app, { email: 'audit-list-owner@x.co' });
    const intruder = await signupVerifiedUser(app, { email: 'audit-list-intruder@x.co' });
    const siteId = await addSite(owner);
    const res = await request(app)
      .get(`/api/sites/${siteId}/audits`)
      .set('Cookie', intruder.cookie);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/audits/:runId', () => {
  it('returns the run + summary for the owner', async () => {
    const { queue } = fakeQueue();
    setAuditsQueue(queue);
    const user = await signupVerifiedUser(app, { email: 'audit-get@x.co' });
    const siteId = await addSite(user);
    const started = await request(app)
      .post(`/api/sites/${siteId}/audits`)
      .set('Cookie', user.cookie)
      .send({});
    const runId = (started.body as { run: { id: string } }).run.id;

    const res = await request(app)
      .get(`/api/audits/${runId}`)
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.run.id).toBe(runId);
    expect(res.body.summary.pagesCrawled).toBe(0);
  });

  it('cross-account run → 404', async () => {
    const { queue } = fakeQueue();
    setAuditsQueue(queue);
    const owner = await signupVerifiedUser(app, { email: 'audit-get-owner@x.co' });
    const other = await signupVerifiedUser(app, { email: 'audit-get-other@x.co' });
    const siteId = await addSite(owner);
    const started = await request(app)
      .post(`/api/sites/${siteId}/audits`)
      .set('Cookie', owner.cookie)
      .send({});
    const runId = (started.body as { run: { id: string } }).run.id;
    const res = await request(app)
      .get(`/api/audits/${runId}`)
      .set('Cookie', other.cookie);
    expect(res.status).toBe(404);
  });
});
