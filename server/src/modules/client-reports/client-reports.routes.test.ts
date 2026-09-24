import { randomUUID } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import sharp from 'sharp';
import {
  afterAll,
  afterEach,
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
  scheduledReportDeliveries,
  scheduledReports,
} from '../../db/schema/client-reports.js';
import { keywords, rankings } from '../../db/schema/keywords.js';
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
import { AuditRun, writeReportSnapshot } from '../audits/index.js';
import { makeAuditResult } from '../audits/rules/fixtures.js';
import { Site } from '../sites/sites.model.js';
import { upsertSearchAnalytics } from '../gsc-snapshots/index.js';
import { User } from '../users/users.model.js';
import { listClientPortals } from './portal.service.js';
import { createSchedule, listSchedules } from './schedules.service.js';
import { clientReportScheduleBodySchema } from './client-reports.schema.js';
import { requireOwnedClientReportSite } from './client-reports.routes.js';
import {
  ClientPortalToken,
  hashClientPortalToken,
  setClientReportsDb,
  setClientReportsQueue,
} from './index.js';

const originalFlag = env.CLIENT_REPORTS_ENABLED;
const app = createApp();
let sequence = 0;

function fakeQueue() {
  const upsertJobScheduler = vi.fn(async (
    _key: string,
    _repeat: { pattern: string; tz: string },
    _template?: unknown,
  ) => ({}));
  const removeJobScheduler = vi.fn(async (_key: string) => true);
  const add = vi.fn(async (_name: string, _data: unknown, options: { jobId: string }) =>
    ({ id: options.jobId }) as Job);
  return {
    queue: { upsertJobScheduler, removeJobScheduler, add } as unknown as Queue,
    upsertJobScheduler,
    removeJobScheduler,
  };
}

let queue = fakeQueue();

async function seedUser(): Promise<TestUser> {
  sequence += 1;
  return signupVerifiedUser(app, {
    email: `client-reports-${sequence}@example.test`,
  });
}

async function seedSite(
  user: TestUser,
  withAudit = false,
  displayName = '<img src=x onerror=alert(1)>',
): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(user.id),
    url: 'https://hostile.example.test',
    domain: 'hostile.example.test',
    displayName,
  });
  if (withAudit) {
    const run = await AuditRun.create({
      accountId: user.id,
      siteId: site._id,
      pageCap: 100,
      status: 'succeeded',
      finishedAt: new Date('2026-07-22T08:00:00.000Z'),
    });
    await writeReportSnapshot({
      runId: run.id as string,
      siteId: site.id as string,
      accountId: user.id,
      result: makeAuditResult(),
    });
  }
  return site.id as string;
}

const scheduleBody = {
  name: 'Monday report',
  frequency: 'weekly',
  weekdayUtc: 1,
  hourUtc: 9,
  locale: 'en',
  recipients: ['CLIENT@example.test', 'client@example.test'],
  sections: { audit: true, ranks: false, gsc: false },
  enabled: true,
};

const portalBody = {
  clientLabel: 'Private client label',
  locale: 'en',
  sections: { audit: true, ranks: false, gsc: false },
  expiresInDays: 90,
};

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  installTestAuth();
  setClientReportsDb(getTestDb() as never);
});

afterAll(async () => {
  setClientReportsDb(null);
  setClientReportsQueue(null);
  uninstallTestAuth();
  (env as { CLIENT_REPORTS_ENABLED: boolean }).CLIENT_REPORTS_ENABLED = originalFlag;
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  (env as { CLIENT_REPORTS_ENABLED: boolean }).CLIENT_REPORTS_ENABLED = true;
  queue = fakeQueue();
  setClientReportsQueue(queue.queue);
});

afterEach(() => {
  setClientReportsQueue(null);
});

describe('scheduled report CRUD', () => {
  it('conceals invalid and missing site ids at the route ownership boundary', async () => {
    const user = await seedUser();
    for (const siteId of ['not-an-object-id', new mongoose.Types.ObjectId().toString()]) {
      const next = vi.fn() as unknown as NextFunction;
      requireOwnedClientReportSite(
        { user: { id: user.id }, params: { siteId } } as unknown as Request,
        {} as Response,
        next,
      );
      await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
      expect((next as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject({
        status: 404,
        message: 'sites.errors.notFound',
      });
    }
  });

  it('upserts a deterministic scheduler, removes it on disable, and deletes it', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await request(app)
      .post(`/api/client-reports/sites/${siteId}/schedules`)
      .set('Cookie', user.cookie)
      .send(scheduleBody);
    expect(created.status).toBe(201);
    expect(created.body.recipients).toEqual(['client@example.test']);
    expect(created.body.minuteUtc).toBeGreaterThanOrEqual(0);
    expect(created.body.minuteUtc).toBeLessThan(60);
    expect(queue.upsertJobScheduler).toHaveBeenCalledOnce();
    const [key, options] = queue.upsertJobScheduler.mock.calls[0]!;
    expect(key).toBe(`client-report-${created.body.id}`);
    expect(options).toEqual({
      pattern: `${created.body.minuteUtc} 9 * * 1`,
      tz: 'UTC',
    });
    expect(key).not.toContain(':');

    const disabled = await request(app)
      .put(`/api/client-reports/sites/${siteId}/schedules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({ ...scheduleBody, enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);
    expect(queue.removeJobScheduler).toHaveBeenCalledWith(key);

    const removed = await request(app)
      .delete(`/api/client-reports/sites/${siteId}/schedules/${created.body.id}`)
      .set('Cookie', user.cookie);
    expect(removed.status).toBe(204);
  });

  it('rolls back a create and compensates an ambiguously-created scheduler', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const schedulerKeys = new Set<string>();
    const upsertJobScheduler = vi.fn(async (key: string) => {
      // Model Redis applying the command before the transport reports failure.
      schedulerKeys.add(key);
      throw new Error('scheduler acknowledgement lost');
    });
    const removeJobScheduler = vi.fn(async (key: string) => {
      schedulerKeys.delete(key);
      // Exercise the final reconciliation fallback too: the compensating
      // delete applied, but its acknowledgement was also lost.
      throw new Error('compensation acknowledgement lost');
    });
    setClientReportsQueue({
      upsertJobScheduler,
      removeJobScheduler,
    } as unknown as Queue);

    const response = await request(app)
      .post(`/api/client-reports/sites/${siteId}/schedules`)
      .set('Cookie', user.cookie)
      .send(scheduleBody);

    expect(response.status).toBe(503);
    expect(await getTestDb().select().from(scheduledReports)).toHaveLength(0);
    expect(schedulerKeys).toEqual(new Set());
    expect(removeJobScheduler).toHaveBeenCalledOnce();
  });

  it('keeps DB and scheduler truth aligned across concurrent create failure', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const schedulerKeys = new Set<string>();
    let upsertCalls = 0;
    const upsertJobScheduler = vi.fn(async (key: string) => {
      schedulerKeys.add(key);
      upsertCalls += 1;
      if (upsertCalls === 1) throw new Error('first scheduler acknowledgement lost');
      return {};
    });
    const removeJobScheduler = vi.fn(async (key: string) => schedulerKeys.delete(key));
    setClientReportsQueue({
      upsertJobScheduler,
      removeJobScheduler,
    } as unknown as Queue);

    const responses = await Promise.all([
      request(app)
        .post(`/api/client-reports/sites/${siteId}/schedules`)
        .set('Cookie', user.cookie)
        .send({ ...scheduleBody, name: 'Parallel schedule one' }),
      request(app)
        .post(`/api/client-reports/sites/${siteId}/schedules`)
        .set('Cookie', user.cookie)
        .send({ ...scheduleBody, name: 'Parallel schedule two' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 503]);
    const rows = await getTestDb().select().from(scheduledReports);
    expect(rows).toHaveLength(1);
    const enabledRows = rows.filter((row) => row.enabled);
    expect(enabledRows).toHaveLength(1);
    expect(schedulerKeys).toEqual(new Set([`client-report-${enabledRows[0]!.id}`]));
    expect(removeJobScheduler).toHaveBeenCalledOnce();
  });

  it('rolls back update/delete state when scheduler synchronization fails', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await request(app)
      .post(`/api/client-reports/sites/${siteId}/schedules`)
      .set('Cookie', user.cookie)
      .send(scheduleBody)
      .expect(201);

    queue.removeJobScheduler.mockRejectedValueOnce(new Error('remove unavailable'));
    queue.upsertJobScheduler.mockRejectedValueOnce(new Error('restore unavailable'));
    const update = await request(app)
      .put(`/api/client-reports/sites/${siteId}/schedules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({ ...scheduleBody, enabled: false });
    expect(update.status).toBe(503);
    expect((await getTestDb().select().from(scheduledReports))[0]).toMatchObject({
      id: created.body.id,
      enabled: true,
    });

    queue = fakeQueue();
    queue.removeJobScheduler.mockRejectedValueOnce(new Error('remove unavailable'));
    setClientReportsQueue(queue.queue);
    const deleted = await request(app)
      .delete(`/api/client-reports/sites/${siteId}/schedules/${created.body.id}`)
      .set('Cookie', user.cookie);
    expect(deleted.status).toBe(503);
    expect((await getTestDb().select().from(scheduledReports))[0]).toMatchObject({
      id: created.body.id,
      enabled: true,
    });
    expect(queue.upsertJobScheduler).toHaveBeenCalledOnce();
  });

  it('does not let rollback compensation overwrite a newer concurrent update', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const schedulerPatterns = new Map<string, string>();
    let failNextRemove = false;
    let resolveRemoveStarted!: () => void;
    let releaseRemove!: () => void;
    const removeStarted = new Promise<void>((resolve) => {
      resolveRemoveStarted = resolve;
    });
    const removeRelease = new Promise<void>((resolve) => {
      releaseRemove = resolve;
    });
    const upsertJobScheduler = vi.fn(async (
      key: string,
      repeat: { pattern: string },
    ) => {
      schedulerPatterns.set(key, repeat.pattern);
      return {};
    });
    const removeJobScheduler = vi.fn(async (key: string) => {
      schedulerPatterns.delete(key);
      if (failNextRemove) {
        failNextRemove = false;
        resolveRemoveStarted();
        await removeRelease;
        throw new Error('remove acknowledgement lost');
      }
      return true;
    });
    setClientReportsQueue({
      upsertJobScheduler,
      removeJobScheduler,
    } as unknown as Queue);
    const created = await request(app)
      .post(`/api/client-reports/sites/${siteId}/schedules`)
      .set('Cookie', user.cookie)
      .send(scheduleBody)
      .expect(201);
    const schedulerKey = `client-report-${created.body.id}`;

    failNextRemove = true;
    const failedDisable = request(app)
      .put(`/api/client-reports/sites/${siteId}/schedules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({ ...scheduleBody, enabled: false })
      .then((response) => response);
    await removeStarted;
    const newerUpdate = request(app)
      .put(`/api/client-reports/sites/${siteId}/schedules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send({
        ...scheduleBody,
        name: 'Newest monthly schedule',
        frequency: 'monthly',
        weekdayUtc: null,
        monthdayUtc: 12,
        hourUtc: 10,
      })
      .then((response) => response);
    // Give the newer request an opportunity to queue behind the account lock
    // before the first Redis command reports its ambiguous failure.
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    releaseRemove();

    const [failed, updated] = await Promise.all([failedDisable, newerUpdate]);
    expect(failed.status).toBe(503);
    expect(updated.status).toBe(200);
    const [stored] = await getTestDb().select().from(scheduledReports);
    expect(stored).toMatchObject({
      id: created.body.id,
      name: 'Newest monthly schedule',
      frequency: 'monthly',
      monthdayUtc: 12,
      enabled: true,
    });
    expect(schedulerPatterns.get(schedulerKey)).toBe(`${stored!.minuteUtc} 10 12 * *`);
  });

  it('surfaces a failed insert without scheduler compensation', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const failure = new Error('insert unavailable');
    const failingDb = {
      transaction: async () => {
        throw failure;
      },
    } as unknown as Parameters<typeof createSchedule>[1]['db'];
    await expect(createSchedule(
      { accountId: user.id, siteId, body: clientReportScheduleBodySchema.parse(scheduleBody) },
      { db: failingDb, queue: queue.queue },
    )).rejects.toBe(failure);
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });

  it('returns 404 for cross-account schedule mutation', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const siteId = await seedSite(owner);
    const created = await request(app)
      .post(`/api/client-reports/sites/${siteId}/schedules`)
      .set('Cookie', owner.cookie)
      .send(scheduleBody);
    const response = await request(app)
      .delete(`/api/client-reports/sites/${siteId}/schedules/${created.body.id}`)
      .set('Cookie', stranger.cookie);
    expect(response.status).toBe(404);
  });

  it('resolves site ownership before feature-flag gates on every resource route', async () => {
    const owner = await seedUser();
    const siteId = await seedSite(owner);
    const schedule = await request(app)
      .post(`/api/client-reports/sites/${siteId}/schedules`)
      .set('Cookie', owner.cookie)
      .send({ ...scheduleBody, enabled: false });
    expect(schedule.status).toBe(201);
    const outsider = await signupVerifiedUser(app, {
      email: `client-reports-outsider-${++sequence}@example.test`,
    });

    for (const enabled of [true, false]) {
      (env as { CLIENT_REPORTS_ENABLED: boolean }).CLIENT_REPORTS_ENABLED = enabled;
      await request(app)
        .get(`/api/client-reports/sites/${siteId}`)
        .set('Cookie', outsider.cookie)
        .expect(404);
      await request(app)
        .post(`/api/client-reports/sites/${siteId}/schedules`)
        .set('Cookie', outsider.cookie)
        .send(scheduleBody)
        .expect(404);
      await request(app)
        .put(`/api/client-reports/sites/${siteId}/schedules/${schedule.body.id}`)
        .set('Cookie', outsider.cookie)
        .send(scheduleBody)
        .expect(404);
      await request(app)
        .post(`/api/client-reports/sites/${siteId}/portals`)
        .set('Cookie', outsider.cookie)
        .send(portalBody)
        .expect(404);
    }

    const ownSiteId = await seedSite(outsider);
    (env as { CLIENT_REPORTS_ENABLED: boolean }).CLIENT_REPORTS_ENABLED = true;
    await request(app)
      .get(`/api/client-reports/sites/${ownSiteId}`)
      .set('Cookie', outsider.cookie)
      .expect(200);
  });

  it('supports disabled monthly creates, re-enabling, and safe queue outages', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await request(app)
      .post(`/api/client-reports/sites/${siteId}/schedules`)
      .set('Cookie', user.cookie)
      .send({
        ...scheduleBody,
        frequency: 'monthly',
        weekdayUtc: null,
        monthdayUtc: 12,
        enabled: false,
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      frequency: 'monthly',
      weekdayUtc: null,
      monthdayUtc: 12,
      nextRunAt: null,
      lastRunAt: null,
    });
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled();

    const enabled = await request(app)
      .put(`/api/client-reports/sites/${siteId}/schedules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send(scheduleBody);
    expect(enabled.status).toBe(200);
    expect(enabled.body.enabled).toBe(true);
    expect(queue.upsertJobScheduler).toHaveBeenCalledOnce();

    const missing = await request(app)
      .put(`/api/client-reports/sites/${siteId}/schedules/${randomUUID()}`)
      .set('Cookie', user.cookie)
      .send(scheduleBody);
    expect(missing.status).toBe(404);

    setClientReportsQueue(null);
    const unavailableUpdate = await request(app)
      .put(`/api/client-reports/sites/${siteId}/schedules/${created.body.id}`)
      .set('Cookie', user.cookie)
      .send(scheduleBody);
    expect(unavailableUpdate.status).toBe(503);
    await request(app)
      .put(`/api/client-reports/sites/${siteId}/schedules/${randomUUID()}`)
      .set('Cookie', user.cookie)
      .send(scheduleBody)
      .expect(404);
    const unavailableCreate = await request(app)
      .post(`/api/client-reports/sites/${siteId}/schedules`)
      .set('Cookie', user.cookie)
      .send(scheduleBody);
    expect(unavailableCreate.status).toBe(503);

    const deleted = await request(app)
      .delete(`/api/client-reports/sites/${siteId}/schedules/${created.body.id}`)
      .set('Cookie', user.cookie);
    expect(deleted.status).toBe(204);
    const missingDelete = await request(app)
      .delete(`/api/client-reports/sites/${siteId}/schedules/${created.body.id}`)
      .set('Cookie', user.cookie);
    expect(missingDelete.status).toBe(404);
  });

  it('paginates a dated and null-snapshot delivery log with opaque cursors', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await request(app)
      .post(`/api/client-reports/sites/${siteId}/schedules`)
      .set('Cookie', user.cookie)
      .send(scheduleBody);
    const base = Date.parse('2026-08-01T10:00:00.000Z');
    await getTestDb().insert(scheduledReportDeliveries).values(
      Array.from({ length: 3 }, (_, index) => ({
        id: randomUUID(),
        scheduleId: created.body.id as string,
        accountId: user.id,
        siteId,
        runKey: `run-${index}`,
        recipient: `client-${index}@example.test`,
        status: index === 0 ? 'pending' as const : 'sent' as const,
        claimToken: index === 0 ? randomUUID() : null,
        requestFingerprint: index === 0 ? 'pending-request-fingerprint' : null,
        firstAttemptAt: index === 0 ? new Date(base) : null,
        suppressionReason: null,
        errorCode: null,
        snapshotDate: index === 0 ? null : new Date('2026-08-01T00:00:00.000Z'),
        createdAt: new Date(base + index * 1_000),
        finishedAt: index === 0 ? null : new Date(base + index * 1_000 + 500),
      })),
    );
    await getTestDb().update(scheduledReports).set({
      lastRunAt: new Date('2026-08-01T10:00:00.000Z'),
    });

    const first = await request(app)
      .get(`/api/client-reports/sites/${siteId}/deliveries?limit=2`)
      .set('Cookie', user.cookie);
    expect(first.status).toBe(200);
    expect(first.body.deliveries).toHaveLength(2);
    expect(first.body.nextCursor).toBeTypeOf('string');
    expect(first.body.deliveries[0].snapshotDate).toBeTypeOf('string');

    const second = await request(app)
      .get(`/api/client-reports/sites/${siteId}/deliveries?limit=2&cursor=${first.body.nextCursor}`)
      .set('Cookie', user.cookie);
    expect(second.status).toBe(200);
    expect(second.body.deliveries).toHaveLength(1);
    expect(second.body.deliveries[0]).toMatchObject({
      snapshotDate: null,
      finishedAt: null,
      status: 'pending',
    });
    expect(second.body.nextCursor).toBeNull();

    const invalid = await request(app)
      .get(`/api/client-reports/sites/${siteId}/deliveries?cursor=${randomUUID()}`)
      .set('Cookie', user.cookie);
    expect(invalid.status).toBe(404);
    const refreshed = await request(app)
      .get(`/api/client-reports/sites/${siteId}`)
      .set('Cookie', user.cookie);
    expect(refreshed.body.schedules[0].lastRunAt).toBe('2026-08-01T10:00:00.000Z');
  });

  it('paginates every delivery when multiple recipients share a timestamp', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await request(app)
      .post(`/api/client-reports/sites/${siteId}/schedules`)
      .set('Cookie', user.cookie)
      .send(scheduleBody);
    const ids = [
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ];
    const timestamp = new Date('2026-08-01T10:00:00.000Z');
    await getTestDb().insert(scheduledReportDeliveries).values(ids.map((id, index) => ({
      id,
      scheduleId: created.body.id as string,
      accountId: user.id,
      siteId,
      runKey: `tied-run-${index}`,
      recipient: `tied-${index}@example.test`,
      status: 'sent' as const,
      suppressionReason: null,
      errorCode: null,
      snapshotDate: timestamp,
      createdAt: timestamp,
      finishedAt: timestamp,
    })));

    const observed: string[] = [];
    let cursor: string | null = null;
    do {
      const suffix = cursor ? `&cursor=${cursor}` : '';
      const response = await request(app)
        .get(`/api/client-reports/sites/${siteId}/deliveries?limit=1${suffix}`)
        .set('Cookie', user.cookie);
      expect(response.status).toBe(200);
      expect(response.body.deliveries).toHaveLength(1);
      observed.push(response.body.deliveries[0].id as string);
      cursor = response.body.nextCursor as string | null;
    } while (cursor);

    expect(observed).toEqual([...ids].reverse());
  });

  it('downloads a stored-snapshot PDF for any verified account', async () => {
    const owner = await seedUser();
    const siteId = await seedSite(owner, true);
    const pdf = await request(app)
      .post(`/api/client-reports/sites/${siteId}/pdf`)
      .set('Cookie', owner.cookie)
      .send({ locale: 'en', sections: { audit: true, ranks: false, gsc: false } });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.body.subarray(0, 5)).toEqual(Buffer.from('%PDF-'));

    const logo = await sharp({
      create: {
        width: 16,
        height: 8,
        channels: 4,
        background: { r: 20, g: 80, b: 160, alpha: 1 },
      },
    }).png().toBuffer();
    await User.findByIdAndUpdate(owner.id, {
      $set: {
        branding: {
          companyName: 'Agency brand',
          accentColor: '#1450a0',
          logoPngBase64: logo.toString('base64'),
          logoWidth: 16,
          logoHeight: 8,
        },
      },
    });
    const [keyword] = await getTestDb().insert(keywords).values({
      accountId: owner.id,
      siteId,
      phrase: 'engine tagged phrase',
      locationCode: 2_848,
      languageCode: 'en',
      device: 'desktop',
      engine: 'bing',
      engineTarget: null,
      active: true,
    }).returning({ id: keywords.id });
    await getTestDb().insert(rankings).values({
      keywordId: keyword!.id,
      engine: 'bing',
      position: 4,
      checkedAt: new Date('2026-08-02T00:00:00.000Z'),
      source: 'fresh',
    });
    await upsertSearchAnalytics(getTestDb() as never, {
      accountId: owner.id,
      siteId,
      snapshotDate: '2026-08-03',
      dimensionSet: 'query',
      windowDays: 28,
      rows: [{
        keys: ['dated query'],
        clicks: 3,
        impressions: 30,
        ctr: 0.1,
        position: 4,
      }],
    });
    const completePdf = await request(app)
      .post(`/api/client-reports/sites/${siteId}/pdf`)
      .set('Cookie', owner.cookie)
      .send({ locale: 'ar', sections: { audit: true, ranks: true, gsc: true } });
    expect(completePdf.status).toBe(200);
    expect(completePdf.headers['content-language']).toBe('ar');
    expect(completePdf.body.subarray(0, 5)).toEqual(Buffer.from('%PDF-'));
    const rankOnlyPdf = await request(app)
      .post(`/api/client-reports/sites/${siteId}/pdf`)
      .set('Cookie', owner.cookie)
      .send({ locale: 'en', sections: { audit: false, ranks: true, gsc: false } });
    expect(rankOnlyPdf.status).toBe(200);
    expect(rankOnlyPdf.body.subarray(0, 5)).toEqual(Buffer.from('%PDF-'));
  }, 120_000);
});

function scanForForbidden(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => scanForForbidden(item, [...path, String(index)]));
  }
  if (value === null || typeof value !== 'object') return [];
  const forbidden = /^(?:_?id|accountId|siteId|runId|scheduleId|clientLabel|email|recipient|billing|subscription|tier|usage|cap|token|tokenHash|expiresAt|revokedAt|createdAt|updatedAt|vendor|provider)$/i;
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const here = [...path, key];
    const leak = forbidden.test(key) && key !== 'ruleId' ? [here.join('.')] : [];
    return [...leak, ...scanForForbidden(child, here)];
  });
}

describe('client portal token and public allowlist', () => {
  it('is show-once, sha256-only at rest, noindex, leak-free, and immediately revocable', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user, true);
    const created = await request(app)
      .post(`/api/client-reports/sites/${siteId}/portals`)
      .set('Cookie', user.cookie)
      .send(portalBody);
    expect(created.status).toBe(201);
    const rawToken = new URL(created.body.url).pathname.split('/').at(-1)!;
    expect(rawToken).toHaveLength(43);
    const stored = await ClientPortalToken.findById(created.body.id);
    expect(stored?.tokenHash).toBe(hashClientPortalToken(rawToken));
    expect(JSON.stringify(stored?.toObject())).not.toContain(rawToken);

    const overview = await request(app)
      .get(`/api/client-reports/sites/${siteId}`)
      .set('Cookie', user.cookie);
    expect(overview.status).toBe(200);
    expect(JSON.stringify(overview.body.portals)).not.toContain(rawToken);
    expect(overview.body.portals[0].url).toBeUndefined();
    expect(overview.body.portals[0].tokenHash).toBeUndefined();

    const publicRead = await request(app).get(`/api/client-portal/${rawToken}`);
    expect(publicRead.status).toBe(200);
    expect(publicRead.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(publicRead.headers['cache-control']).toBe('private, no-store');
    expect(publicRead.body.site.label).toBe('<img src=x onerror=alert(1)>');
    expect(scanForForbidden(publicRead.body)).toEqual([]);
    expect(JSON.stringify(publicRead.body)).not.toContain('Private client label');
    expect(publicRead.body.sections.audit.snapshotDate).toBe(
      '2026-07-22T08:00:00.000Z',
    );
    expect(Object.values(publicRead.body.sections.audit.counts)).toEqual(
      expect.arrayContaining([expect.any(Number)]),
    );

    const arabicRead = await request(app).get(
      `/api/client-portal/${rawToken}?locale=ar`,
    );
    expect(arabicRead.status).toBe(200);
    expect(arabicRead.headers['content-language']).toBe('en');
    expect(arabicRead.body).toEqual(publicRead.body);

    const revoked = await request(app)
      .post(`/api/client-reports/sites/${siteId}/portals/${created.body.id}/revoke`)
      .set('Cookie', user.cookie);
    expect(revoked.status).toBe(200);
    expect(revoked.body.revokedAt).toBeTypeOf('string');
    const nextRead = await request(app)
      .get(`/api/client-portal/${rawToken}?locale=en`)
      .set('x-lang', 'ar');
    expect(nextRead.status).toBe(404);
    expect(nextRead.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(nextRead.body.error.message).toMatch(/[\u0600-\u06ff]/u);
  });

  it('declares a Mongo TTL index and rejects an expired token before TTL cleanup runs', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user, true);
    const created = await request(app)
      .post(`/api/client-reports/sites/${siteId}/portals`)
      .set('Cookie', user.cookie)
      .send(portalBody);
    const rawToken = new URL(created.body.url).pathname.split('/').at(-1)!;
    await ClientPortalToken.findByIdAndUpdate(created.body.id, {
      $set: { expiresAt: new Date(Date.now() - 1_000) },
    });

    expect(ClientPortalToken.schema.indexes()).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          { expiresAt: 1 },
          expect.objectContaining({ expireAfterSeconds: 0 }),
        ]),
      ]),
    );
    const expired = await request(app).get(`/api/client-portal/${rawToken}`);
    expect(expired.status).toBe(404);
    expect(expired.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('returns 404 for foreign portal revocation and creation', async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const siteId = await seedSite(owner);
    await request(app)
      .post(`/api/client-reports/sites/${siteId}/portals`)
      .set('Cookie', owner.cookie)
      .send(portalBody)
      .expect(201);
    const portalId = String((await ClientPortalToken.findOne())!._id);
    const foreign = await request(app)
      .post(`/api/client-reports/sites/${siteId}/portals/${portalId}/revoke`)
      .set('Cookie', stranger.cookie);
    expect(foreign.status).toBe(404);
    const foreignCreate = await request(app)
      .post(`/api/client-reports/sites/${siteId}/portals`)
      .set('Cookie', stranger.cookie)
      .send(portalBody);
    expect(foreignCreate.status).toBe(404);
  });

  it('uses the domain fallback and locale-prefixed URL without exposing the token in lists', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user, false, '   ');
    const created = await request(app)
      .post(`/api/client-reports/sites/${siteId}/portals`)
      .set('Cookie', user.cookie)
      .send({ ...portalBody, locale: 'ar' });
    expect(created.status).toBe(201);
    expect(new URL(created.body.url).pathname).toMatch(/^\/ar\/portal\//);
    expect(created.body.siteLabel).toBe('hostile.example.test');

    const overview = await request(app)
      .get(`/api/client-reports/sites/${siteId}`)
      .set('Cookie', user.cookie);
    expect(overview.body.portals[0].siteLabel).toBe('hostile.example.test');
    expect(JSON.stringify(overview.body.portals)).not.toContain('/portal/');

    const revoked = await request(app)
      .post(`/api/client-reports/sites/${siteId}/portals/${created.body.id}/revoke`)
      .set('Cookie', user.cookie);
    expect(revoked.body.siteLabel).toBe('hostile.example.test');
    const missing = await request(app)
      .post(`/api/client-reports/sites/${siteId}/portals/${new mongoose.Types.ObjectId()}/revoke`)
      .set('Cookie', user.cookie);
    expect(missing.status).toBe(404);
  });

  it('keeps stored reads and revocation available while flag-off blocks creates', async () => {
    const user = await seedUser();
    const siteId = await seedSite(user);
    const created = await request(app)
      .post(`/api/client-reports/sites/${siteId}/portals`)
      .set('Cookie', user.cookie)
      .send(portalBody);
    const schedule = await request(app)
      .post(`/api/client-reports/sites/${siteId}/schedules`)
      .set('Cookie', user.cookie)
      .send(scheduleBody);
    expect(schedule.status).toBe(201);
    (env as { CLIENT_REPORTS_ENABLED: boolean }).CLIENT_REPORTS_ENABLED = false;
    const overview = await request(app)
      .get(`/api/client-reports/sites/${siteId}`)
      .set('Cookie', user.cookie);
    expect(overview.status).toBe(200);
    expect(overview.body.enabled).toBe(false);
    const blocked = await request(app)
      .post(`/api/client-reports/sites/${siteId}/portals`)
      .set('Cookie', user.cookie)
      .send(portalBody);
    expect(blocked.status).toBe(404);
    const blockedSchedule = await request(app)
      .post(`/api/client-reports/sites/${siteId}/schedules`)
      .set('Cookie', user.cookie)
      .send(scheduleBody);
    expect(blockedSchedule.status).toBe(404);
    const blockedEnable = await request(app)
      .put(`/api/client-reports/sites/${siteId}/schedules/${schedule.body.id}`)
      .set('Cookie', user.cookie)
      .send(scheduleBody);
    expect(blockedEnable.status).toBe(404);
    const disabled = await request(app)
      .put(`/api/client-reports/sites/${siteId}/schedules/${schedule.body.id}`)
      .set('Cookie', user.cookie)
      .send({ ...scheduleBody, enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);
    const blockedPdf = await request(app)
      .post(`/api/client-reports/sites/${siteId}/pdf`)
      .set('Cookie', user.cookie)
      .send({ locale: 'en', sections: scheduleBody.sections });
    expect(blockedPdf.status).toBe(404);
    const revoked = await request(app)
      .post(`/api/client-reports/sites/${siteId}/portals/${created.body.id}/revoke`)
      .set('Cookie', user.cookie);
    expect(revoked.status).toBe(200);
    const deleted = await request(app)
      .delete(`/api/client-reports/sites/${siteId}/schedules/${schedule.body.id}`)
      .set('Cookie', user.cookie);
    expect(deleted.status).toBe(204);
  });
});

// The route suite can never reach the service-level ownership guard:
// `siteMutationLease` answers 404 for an unowned or missing site before the
// router runs. This is the defence-in-depth layer every non-HTTP caller hits.
describe('client-portal service ownership guard', () => {
  const GUARD_ACCOUNT = '6a6fa7c28d75c2fd32d84a63';

  it('refuses a well-formed site id for the schedule list too', async () => {
    await expect(
      listSchedules(
        GUARD_ACCOUNT,
        '6a6fa7c28d75c2fd32d84a99',
        getTestDb() as unknown as Parameters<typeof listSchedules>[2],
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a well-formed site id this account does not own', async () => {
    await expect(listClientPortals(GUARD_ACCOUNT, '6a6fa7c28d75c2fd32d84a99')).rejects.toMatchObject({ status: 404 });
  });
});
