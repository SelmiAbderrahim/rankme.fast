import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import {
  sitePulseSettings,
  sitePulseSubscriptions,
  weeklyPulseDeliveryEvents,
  weeklyPulseRuns,
} from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  pulseSchedulerKey,
  enqueueRecoverablePulseDeliveries,
  pulseDeliveryRecoveryJobId,
  reconcilePulseSchedulers,
  removePulseScheduler,
  scheduleDueWeeklyPulses,
  upsertPulseScheduler,
} from './scheduler.js';
import { computeSchedule, nextRunAt } from './schedule.js';
import {
  WEEKLY_PULSE_DELIVERY_LEASE_MS,
  WEEKLY_PULSE_IDEMPOTENCY_RETRY_WINDOW_MS,
} from './delivery.service.js';

interface AddCall {
  name: string;
  data: unknown;
  opts: unknown;
}

function makeFakeQueue() {
  const upserts: Array<{ key: string; opts: unknown; template: unknown }> = [];
  const removes: string[] = [];
  const adds: AddCall[] = [];
  const schedulers = new Map<string, unknown>();
  const queue = {
    upsertJobScheduler: vi.fn(async (key: string, opts: unknown, template: unknown) => {
      upserts.push({ key, opts, template });
      schedulers.set(key, { key });
      return {} as unknown;
    }),
    getJobScheduler: vi.fn(async (key: string) => schedulers.get(key)),
    getJobSchedulers: vi.fn(async () => [...schedulers.values()]),
    removeJobScheduler: vi.fn(async (key: string) => {
      removes.push(key);
      schedulers.delete(key);
      return true;
    }),
    add: vi.fn(async (name: string, data: unknown, opts: unknown) => {
      adds.push({ name, data, opts });
      return { id: 'x' } as unknown;
    }),
  } as unknown as Queue;
  return { queue, upserts, removes, adds, schedulers };
}

const ACCOUNT_A = '000000000000000000000001';
const SITE_A = '000000000000000000000002';
const USER_A = 'user-a';

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
beforeEach(async () => {
  await truncateAllTables();
});

describe('upsertPulseScheduler', () => {
  it('is idempotent: calling twice for the same site upserts one entry', async () => {
    const { queue, upserts } = makeFakeQueue();
    await upsertPulseScheduler(queue, { accountId: ACCOUNT_A, siteId: SITE_A });
    await upsertPulseScheduler(queue, { accountId: ACCOUNT_A, siteId: SITE_A });
    expect(upserts).toHaveLength(2);
    expect(upserts[0]!.key).toBe(upserts[1]!.key);
    expect(upserts[0]!.key).toBe(pulseSchedulerKey(SITE_A));
  });

  it('uses the deterministic cron derived from the site hash', async () => {
    const { queue, upserts } = makeFakeQueue();
    await upsertPulseScheduler(queue, { accountId: ACCOUNT_A, siteId: SITE_A });
    const expected = computeSchedule(SITE_A).cron;
    expect((upserts[0]!.opts as { pattern: string; tz: string }).pattern).toBe(expected);
    expect((upserts[0]!.opts as { pattern: string; tz: string }).tz).toBe('UTC');
  });

  it('stamps a scheduled payload on the template', async () => {
    const { queue, upserts } = makeFakeQueue();
    await upsertPulseScheduler(queue, { accountId: ACCOUNT_A, siteId: SITE_A });
    const tpl = upserts[0]!.template as { name: string; data: { scheduled: boolean } };
    expect(tpl.name).toBe('weekly-pulse');
    expect(tpl.data.scheduled).toBe(true);
  });
});

describe('removePulseScheduler', () => {
  it('removes the scheduler by deterministic key', async () => {
    const { queue, removes } = makeFakeQueue();
    const removed = await removePulseScheduler(queue, SITE_A);
    expect(removed).toBe(true);
    expect(removes).toEqual([pulseSchedulerKey(SITE_A)]);
  });
});

describe('reconcilePulseSchedulers', () => {
  it('recovers only enabled sites with an active subscriber', async () => {
    const db = getTestDb();
    const secondSite = '000000000000000000000003';
    const staleSite = '000000000000000000000004';
    for (const [siteId, enabled] of [
      [SITE_A, true],
      [secondSite, true],
      [staleSite, true],
      ['000000000000000000000005', false],
    ] as const) {
      const schedule = computeSchedule(siteId);
      await db.insert(sitePulseSettings).values({
        accountId: ACCOUNT_A,
        siteId,
        enabled,
        scheduleKey: schedule.scheduleKey,
        nextRunAt: new Date('2026-07-14T09:00:00Z'),
      });
    }
    await db.insert(sitePulseSubscriptions).values([
      { accountId: ACCOUNT_A, siteId: SITE_A, userId: USER_A, locale: 'en' },
      { accountId: ACCOUNT_A, siteId: SITE_A, userId: 'user-b', locale: 'en' },
      { accountId: ACCOUNT_A, siteId: secondSite, userId: 'user-c', locale: 'en' },
      {
        accountId: ACCOUNT_A,
        siteId: staleSite,
        userId: 'user-disabled',
        locale: 'en',
        disabledAt: new Date(),
      },
    ]);
    const { queue, upserts } = makeFakeQueue();

    await expect(reconcilePulseSchedulers(db, queue)).resolves.toBe(2);

    expect(upserts.map((row) => row.key)).toEqual([
      pulseSchedulerKey(SITE_A),
      pulseSchedulerKey(secondSite),
    ]);

    // Reconciliation is recovery-only: it must not replace an accepted,
    // delayed scheduler job merely because the periodic sweep ran again.
    await expect(reconcilePulseSchedulers(db, queue)).resolves.toBe(2);
    expect(upserts).toHaveLength(2);
  });

  it('does nothing when durable state has no eligible site', async () => {
    const { queue, upserts } = makeFakeQueue();
    await expect(reconcilePulseSchedulers(getTestDb(), queue)).resolves.toBe(0);
    expect(upserts).toEqual([]);
  });

  it('removes a prefix-scoped orphan when the last subscriber is disabled', async () => {
    const db = getTestDb();
    const schedule = computeSchedule(SITE_A);
    await db.insert(sitePulseSettings).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      enabled: true,
      scheduleKey: schedule.scheduleKey,
      nextRunAt: new Date('2026-07-14T09:00:00Z'),
    });
    await db.insert(sitePulseSubscriptions).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      userId: USER_A,
      locale: 'en',
    });
    const harness = makeFakeQueue();
    await reconcilePulseSchedulers(db, harness.queue);
    expect(harness.upserts).toHaveLength(1);
    harness.schedulers.set('another-feature-scheduler', {
      key: 'another-feature-scheduler',
    });

    await db
      .update(sitePulseSubscriptions)
      .set({ disabledAt: new Date('2026-07-14T10:00:00Z') })
      .where(eq(sitePulseSubscriptions.siteId, SITE_A));
    await expect(reconcilePulseSchedulers(db, harness.queue)).resolves.toBe(0);
    expect(harness.removes).toEqual([pulseSchedulerKey(SITE_A)]);
    expect(harness.schedulers.has('another-feature-scheduler')).toBe(true);
  });
});

describe('enqueueRecoverablePulseDeliveries', () => {
  async function seedDelivery(status: 'queued' | 'not_delivered', input: {
    attempt: number;
    createdAt: Date;
    updatedAt: Date;
    userId?: string;
    errorCode?: string;
  }) {
    const rows = await getTestDb()
      .insert(weeklyPulseRuns)
      .values({
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        isoWeek: '2026-W29',
        status: 'completed',
        marketSnapshot: {},
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
        finishedAt: input.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: weeklyPulseRuns.id });
    const run = rows[0] ?? (await getTestDb()
      .select({ id: weeklyPulseRuns.id })
      .from(weeklyPulseRuns))[0]!;
    await getTestDb().insert(weeklyPulseDeliveryEvents).values({
      pulseRunId: run.id,
      userId: input.userId ?? USER_A,
      channel: 'email',
      locale: 'en',
      status,
      attempt: input.attempt,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      errorCode: input.errorCode,
    });
    return run.id;
  }

  it('enqueues one delivery-only replay per run after the queued lease expires', async () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    const updatedAt = new Date(now.getTime() - WEEKLY_PULSE_DELIVERY_LEASE_MS - 1);
    const runId = await seedDelivery('queued', {
      attempt: 1,
      createdAt: new Date('2026-07-14T11:00:00.000Z'),
      updatedAt,
    });
    await getTestDb().insert(weeklyPulseDeliveryEvents).values({
      pulseRunId: runId,
      userId: 'user-b',
      channel: 'email',
      locale: 'fr',
      status: 'not_delivered',
      attempt: 1,
      createdAt: new Date('2026-07-14T11:00:00.000Z'),
      updatedAt,
    });
    const { queue, adds } = makeFakeQueue();
    await expect(enqueueRecoverablePulseDeliveries(getTestDb(), queue, now)).resolves.toBe(1);
    expect(adds).toHaveLength(1);
    expect(adds[0]).toMatchObject({
      name: 'weekly-pulse',
      data: { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: '2026-W29' },
    });
    expect((adds[0]!.opts as { jobId: string }).jobId).toBe(
      pulseDeliveryRecoveryJobId({ runId, attempt: 1, updatedAt }),
    );
  });

  it('does not race a fresh lease or replay a terminal attempt', async () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    await seedDelivery('queued', { attempt: 1, createdAt: now, updatedAt: now });
    const { queue, adds } = makeFakeQueue();
    await expect(enqueueRecoverablePulseDeliveries(getTestDb(), queue, now)).resolves.toBe(0);
    expect(adds).toEqual([]);
  });

  it('expires ambiguous work before the provider idempotency window closes', async () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    const createdAt = new Date(
      now.getTime() - WEEKLY_PULSE_IDEMPOTENCY_RETRY_WINDOW_MS - 1,
    );
    await seedDelivery('queued', { attempt: 1, createdAt, updatedAt: createdAt });
    const { queue, adds } = makeFakeQueue();
    await expect(enqueueRecoverablePulseDeliveries(getTestDb(), queue, now)).resolves.toBe(0);
    expect(adds).toEqual([]);
    const rows = await getTestDb().select().from(weeklyPulseDeliveryEvents);
    expect(rows[0]).toMatchObject({
      status: 'not_delivered',
      attempt: 3,
      errorCode: 'idempotency_window_expired',
    });
  });

  it('never re-enqueues a terminal provider-outcome-unknown row', async () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    await seedDelivery('not_delivered', {
      attempt: 1,
      createdAt: new Date('2026-07-14T11:00:00.000Z'),
      updatedAt: new Date('2026-07-14T11:59:00.000Z'),
      errorCode: 'provider_outcome_unknown_payload_drift',
    });
    const { queue, adds } = makeFakeQueue();
    await expect(enqueueRecoverablePulseDeliveries(getTestDb(), queue, now)).resolves.toBe(0);
    expect(adds).toEqual([]);
    const rows = await getTestDb().select().from(weeklyPulseDeliveryEvents);
    expect(rows[0]).toMatchObject({
      status: 'not_delivered',
      errorCode: 'provider_outcome_unknown_payload_drift',
    });
  });
});

describe('scheduleDueWeeklyPulses', () => {
  it('enqueues nothing when there are no enabled sites', async () => {
    const { queue, adds } = makeFakeQueue();
    const now = () => new Date('2026-07-14T12:00:00Z');
    const result = await scheduleDueWeeklyPulses({
      db: getTestDb(),
      queue,
      now,
    });
    expect(result.enqueued).toEqual([]);
    expect(adds).toEqual([]);
  });

  it('skips enabled sites without eligible subscribers (production-check parity)', async () => {
    const db = getTestDb();
    await db.insert(sitePulseSettings).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      enabled: true,
      scheduleKey: 5,
      nextRunAt: new Date('2026-07-14T09:00:00Z'),
    });
    // No subscription rows exist.
    const { queue, adds } = makeFakeQueue();
    const result = await scheduleDueWeeklyPulses({
      db,
      queue,
      now: () => new Date('2026-07-14T12:00:00Z'),
    });
    expect(result.enqueued).toEqual([]);
    expect(adds).toEqual([]);
  });

  it('skips a due site whose only subscriber is disabled', async () => {
    const db = getTestDb();
    await db.insert(sitePulseSettings).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      enabled: true,
      scheduleKey: 5,
      nextRunAt: new Date('2026-07-14T09:00:00Z'),
    });
    await db.insert(sitePulseSubscriptions).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      userId: USER_A,
      locale: 'en',
      disabledAt: new Date('2026-07-14T10:00:00Z'),
    });
    const { queue, adds } = makeFakeQueue();
    const result = await scheduleDueWeeklyPulses({
      db,
      queue,
      now: () => new Date('2026-07-14T12:00:00Z'),
    });
    expect(result.enqueued).toEqual([]);
    expect(adds).toEqual([]);
  });

  it('enqueues once when active and disabled subscribers are mixed', async () => {
    const db = getTestDb();
    await db.insert(sitePulseSettings).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      enabled: true,
      scheduleKey: 5,
      nextRunAt: new Date('2026-07-14T09:00:00Z'),
    });
    await db.insert(sitePulseSubscriptions).values([
      { accountId: ACCOUNT_A, siteId: SITE_A, userId: USER_A, locale: 'en' },
      {
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        userId: 'user-disabled',
        locale: 'en',
        disabledAt: new Date('2026-07-14T10:00:00Z'),
      },
    ]);
    const { queue, adds } = makeFakeQueue();
    const result = await scheduleDueWeeklyPulses({
      db,
      queue,
      now: () => new Date('2026-07-14T12:00:00Z'),
    });
    expect(result.enqueued).toHaveLength(1);
    expect(adds).toHaveLength(1);
  });

  it('enqueues one job per due, subscribed site with the deterministic jobId', async () => {
    const db = getTestDb();
    await db.insert(sitePulseSettings).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      enabled: true,
      scheduleKey: 5,
      nextRunAt: new Date('2026-07-14T09:00:00Z'),
    });
    await db.insert(sitePulseSubscriptions).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      userId: USER_A,
      locale: 'en',
    });
    const { queue, adds } = makeFakeQueue();
    const result = await scheduleDueWeeklyPulses({
      db,
      queue,
      now: () => new Date('2026-07-14T12:00:00Z'), // Tue = 2026-W29
    });
    expect(result.enqueued).toHaveLength(1);
    expect(adds).toHaveLength(1);
    const call = adds[0]!;
    expect(call.name).toBe('weekly-pulse');
    expect((call.opts as { jobId: string }).jobId).toBe(
      `weekly-pulse-${SITE_A}-${result.enqueued[0]!.isoWeek}`,
    );
  });

  it('a replayed drainer produces the same jobId → BullMQ dedupes at the queue', async () => {
    const db = getTestDb();
    await db.insert(sitePulseSettings).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      enabled: true,
      scheduleKey: 5,
      nextRunAt: new Date('2026-07-14T09:00:00Z'),
    });
    await db.insert(sitePulseSubscriptions).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      userId: USER_A,
      locale: 'en',
    });
    const { queue, adds } = makeFakeQueue();
    const now = () => new Date('2026-07-14T12:00:00Z');
    const r1 = await scheduleDueWeeklyPulses({ db, queue, now });
    const r2 = await scheduleDueWeeklyPulses({ db, queue, now });
    expect(adds).toHaveLength(2);
    expect((adds[0]!.opts as { jobId: string }).jobId).toBe(
      (adds[1]!.opts as { jobId: string }).jobId,
    );
    expect(r1.enqueued[0]?.isoWeek).toBe(r2.enqueued[0]?.isoWeek);
  });

  it('does not enqueue when nextRunAt is in the future', async () => {
    const db = getTestDb();
    const schedule = computeSchedule(SITE_A);
    const future = nextRunAt(schedule, new Date('2026-07-14T00:00:00Z'));
    await db.insert(sitePulseSettings).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      enabled: true,
      scheduleKey: schedule.scheduleKey,
      nextRunAt: future,
    });
    await db.insert(sitePulseSubscriptions).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      userId: USER_A,
      locale: 'en',
    });
    const { queue, adds } = makeFakeQueue();
    const result = await scheduleDueWeeklyPulses({
      db,
      queue,
      now: () => new Date('2026-07-13T00:00:00Z'),
    });
    expect(result.enqueued).toEqual([]);
    expect(adds).toEqual([]);
  });
});
