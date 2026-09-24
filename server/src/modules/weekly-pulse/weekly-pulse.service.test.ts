/**
 * Weekly Pulse — HTTP service (spec §11) — direct-call tests.
 *
 * These tests exercise the service layer bypassing Express so we can
 * mock/inject the queue and observe the scheduler upsert/remove path
 * directly. Router-level auth, verified, and cross-account tests live in
 * weekly-pulse.routes.test.ts.
 */
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
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
import { Site, setSitesDb } from '../sites/index.js';
import {
  sitePulseSettings,
  sitePulseSubscriptions,
  weeklyPulseCitationChanges,
  weeklyPulseCitations,
  weeklyPulseDigestProjections,
  weeklyPulseRuns,
} from '../../db/schema/weekly-pulse.js';
import { gscSearchAppearance } from '../../db/schema/gsc-search-appearance.js';
import {
  getPulseHistoryDetail,
  getPulseHistoryPage,
  getPulseState,
  previewPulseSpend,
  setPulseSubscription,
  type WeeklyPulseServiceDeps,
} from './weekly-pulse.service.js';

function fakeQueue() {
  const upserts: Array<{ key: string; pattern: string; data: unknown }> = [];
  const removes: string[] = [];
  const queue = {
    async upsertJobScheduler(
      key: string,
      opts: { pattern: string; tz: string },
      template: { name: string; data: unknown },
    ) {
      upserts.push({ key, pattern: opts.pattern, data: template.data });
    },
    async removeJobScheduler(key: string) {
      removes.push(key);
      return true;
    },
  } as unknown as Queue;
  return { queue, upserts, removes };
}

async function seedAccountSite(accountId: string, domain: string) {
  const site = await Site.create({
    accountId,
    domain,
    url: `https://${domain}/`,
  });
  return String(site._id);
}

function deps(overrides: Partial<WeeklyPulseServiceDeps> = {}): WeeklyPulseServiceDeps {
  return {
    db: getTestDb() as unknown as WeeklyPulseServiceDeps['db'],
    queue: null,
    now: () => new Date('2026-01-05T09:00:00.000Z'),
    ...overrides,
  };
}

beforeAll(async () => {
  await startMemoryMongo();
  await startTestPostgres();
  setSitesDb(getTestDb() as unknown as never);
});

afterAll(async () => {
  setSitesDb(null);
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
});

describe('getPulseState', () => {
  it('returns stored generative appearance rows for the current binding', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    await Site.updateOne(
      { _id: siteId, accountId },
      {
        $set: {
          gscPropertyUrl: 'sc-domain:example.com',
          gscBindingGenerationId: undefined,
          gscBindingSource: 'manual',
        },
      },
    );
    await getTestDb().insert(gscSearchAppearance).values({
      accountId,
      siteId,
      bindingGenerationId: 'legacy',
      property: 'sc-domain:example.com',
      snapshotDate: '2026-08-20',
      windowDays: 28,
      rawAppearance: 'AI_OVERVIEWS',
      classificationSlug: 'ai_overviews',
      classifiedGenerative: true,
      clicks: 4,
      impressions: 100,
      ctr: 0.04,
      position: 3,
      observationMeta: {},
    });
    const view = await getPulseState({ accountId, siteId, userId: accountId }, deps());
    expect(view.gscAppearance.status).toBe('available');
    expect(view.gscAppearance.rows[0]).toMatchObject({
      rawAppearance: 'AI_OVERVIEWS',
      clicks: 4,
    });
  });

  it('returns null subscription + setting when the site has no pulse rows', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const userId = accountId;
    const siteId = await seedAccountSite(accountId, 'example.com');
    const view = await getPulseState({ accountId, siteId, userId }, deps());
    expect(view.subscription).toBeNull();
    expect(view.setting).toBeNull();
    expect(view.lastRun).toBeNull();
    expect(view.gscAppearance.status).toBe('unavailable');
    expect(view.coverage[0]?.observationType).toBe('weekly_pulse');
  });

  it('degrades the GSC appearance card to unavailable when the store read throws', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    await Site.updateOne(
      { _id: siteId, accountId },
      {
        $set: {
          gscPropertyUrl: 'sc-domain:example.com',
          gscBindingGenerationId: 'legacy',
          gscBindingSource: 'legacy',
        },
      },
    );
    let appearanceReadAttempted = false;
    const real = getTestDb() as unknown as Record<string, unknown>;
    const throwingDb = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== 'select') return Reflect.get(target, prop, receiver);
        return (...args: unknown[]) => {
          const builder = (
            target.select as (...a: unknown[]) => { from: (t: unknown) => unknown }
          )(...args);
          return new Proxy(builder as unknown as Record<string, unknown>, {
            get(b, p, r) {
              if (p !== 'from') return Reflect.get(b, p, r);
              return (table: unknown) => {
                if (table === gscSearchAppearance) {
                  appearanceReadAttempted = true;
                  throw new Error('search appearance store down');
                }
                return (b.from as (t: unknown) => unknown)(table);
              };
            },
          });
        };
      },
    }) as unknown as WeeklyPulseServiceDeps['db'];

    const view = await getPulseState(
      { accountId, siteId, userId: accountId },
      deps({ db: throwingDb }),
    );
    expect(appearanceReadAttempted).toBe(true);
    expect(view.gscAppearance.status).toBe('unavailable');
  });

  it('cross-account 404 (never 403)', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const otherAccountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    await expect(
      getPulseState(
        { accountId: otherAccountId, siteId, userId: otherAccountId },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 404, message: 'sites.errors.notFound' });
  });

  it('reflects an existing subscription + setting', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const userId = accountId;
    const siteId = await seedAccountSite(accountId, 'example.com');
    await getTestDb().insert(sitePulseSubscriptions).values({
      accountId,
      siteId,
      userId,
      locale: 'en',
    });
    await getTestDb().insert(sitePulseSettings).values({
      accountId,
      siteId,
      enabled: true,
      scheduleKey: 42,
      nextRunAt: new Date('2026-01-06T09:00:00.000Z'),
    });
    const view = await getPulseState({ accountId, siteId, userId }, deps());
    expect(view.subscription?.enabled).toBe(true);
    expect(view.setting?.enabled).toBe(true);
  });

  it('summarizes the most recent run on the state card', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    await getTestDb().insert(weeklyPulseRuns).values({
      accountId,
      siteId,
      isoWeek: '2026-W01',
      status: 'partial',
      marketSnapshot: {},
      promptCohortId: 'c',
      promptCohortVersion: 1,
      engineSurfaceSet: [],
      observationMeta: {},
      usageReference: {},
      counts: {},
      startedAt: new Date('2026-01-05T09:00:00.000Z'),
      finishedAt: new Date('2026-01-05T09:04:00.000Z'),
    });
    const view = await getPulseState(
      { accountId, siteId, userId: accountId },
      deps(),
    );
    expect(view.lastRun).toMatchObject({
      isoWeek: '2026-W01',
      status: 'partial',
      startedAt: '2026-01-05T09:00:00.000Z',
      finishedAt: '2026-01-05T09:04:00.000Z',
    });
    expect(view.lastRun!.runId).toEqual(expect.any(String));
  });

  it('nulls startedAt/finishedAt on the summary when the run never began', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    await getTestDb().insert(weeklyPulseRuns).values({
      accountId,
      siteId,
      isoWeek: '2026-W02',
      status: 'queued',
      marketSnapshot: {},
      promptCohortId: 'c',
      promptCohortVersion: 1,
      engineSurfaceSet: [],
      observationMeta: {},
      usageReference: {},
      counts: {},
    });
    const view = await getPulseState(
      { accountId, siteId, userId: accountId },
      deps(),
    );
    expect(view.lastRun).toMatchObject({
      status: 'queued',
      startedAt: null,
      finishedAt: null,
    });
  });

  it('malformed siteId returns 404 not 500', async () => {
    const accountId = new Types.ObjectId().toHexString();
    await expect(
      getPulseState(
        { accountId, siteId: 'not-a-hex-id', userId: accountId },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('previewPulseSpend — read-only', () => {
  it('returns the community SpendPreview without writing a run', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    const preview = await previewPulseSpend({ accountId, siteId, userId: accountId });
    expect(preview).toEqual({ deploymentMode: 'community', capacityEnforced: false });
    const rows = await getTestDb()
      .select()
      .from(weeklyPulseRuns)
      .where(eq(weeklyPulseRuns.accountId, accountId));
    expect(rows).toHaveLength(0);
  });

  it('cross-account 404', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const other = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    await expect(
      previewPulseSpend({ accountId: other, siteId, userId: other }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('setPulseSubscription', () => {
  const ack = '2026-01-05T08:59:00.000Z';

  it('rejects enable=true without acknowledgedPreviewAt', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    await expect(
      setPulseSubscription(
        {
          accountId,
          siteId,
          userId: accountId,
          enabled: true,
          resolvedLocale: 'en',
        },
        deps(),
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: 'weeklyPulse.errors.acknowledgePreviewRequired',
    });
  });

  it('rejects enable=true when acknowledgedPreviewAt is > 24h old', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    await expect(
      setPulseSubscription(
        {
          accountId,
          siteId,
          userId: accountId,
          enabled: true,
          acknowledgedPreviewAt: '2026-01-01T00:00:00.000Z',
          resolvedLocale: 'en',
        },
        deps(),
      ),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects enable=true when acknowledgedPreviewAt is not a valid date', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    await expect(
      setPulseSubscription(
        {
          accountId,
          siteId,
          userId: accountId,
          enabled: true,
          acknowledgedPreviewAt: '2026-01-05T99:99:99.999Z',
          resolvedLocale: 'en',
        },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('enable=true upserts subscription + setting AND asks queue to upsert', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    const { queue, upserts } = fakeQueue();
    const view = await setPulseSubscription(
      {
        accountId,
        siteId,
        userId: accountId,
        enabled: true,
        acknowledgedPreviewAt: ack,
        resolvedLocale: 'en',
      },
      deps({ queue }),
    );
    expect(view.subscription?.enabled).toBe(true);
    expect(view.setting?.enabled).toBe(true);
    expect(upserts).toHaveLength(1);
    expect(upserts[0]!.key).toContain('weekly-pulse:');
  });

  it('disable=false clears my row and removes the scheduler when there are no active subs', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    const { queue, upserts, removes } = fakeQueue();
    await setPulseSubscription(
      {
        accountId,
        siteId,
        userId: accountId,
        enabled: true,
        acknowledgedPreviewAt: ack,
        resolvedLocale: 'en',
      },
      deps({ queue }),
    );
    await setPulseSubscription(
      {
        accountId,
        siteId,
        userId: accountId,
        enabled: false,
        resolvedLocale: 'en',
      },
      deps({ queue }),
    );
    expect(upserts).toHaveLength(1);
    expect(removes).toHaveLength(1);
    const setting = await getTestDb()
      .select({ enabled: sitePulseSettings.enabled })
      .from(sitePulseSettings)
      .where(
        and(
          eq(sitePulseSettings.accountId, accountId),
          eq(sitePulseSettings.siteId, siteId),
        ),
      );
    expect(setting[0]!.enabled).toBe(false);
  });

  it('disabling one of two subscribers keeps the scheduler up', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const userA = new Types.ObjectId().toHexString();
    const userB = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    const { queue, removes } = fakeQueue();
    await setPulseSubscription(
      {
        accountId,
        siteId,
        userId: userA,
        enabled: true,
        acknowledgedPreviewAt: ack,
        resolvedLocale: 'en',
      },
      deps({ queue }),
    );
    await setPulseSubscription(
      {
        accountId,
        siteId,
        userId: userB,
        enabled: true,
        acknowledgedPreviewAt: ack,
        resolvedLocale: 'en',
      },
      deps({ queue }),
    );
    await setPulseSubscription(
      {
        accountId,
        siteId,
        userId: userA,
        enabled: false,
        resolvedLocale: 'en',
      },
      deps({ queue }),
    );
    expect(removes).toHaveLength(0);
    // Only user A's row is disabled.
    const subs = await getTestDb()
      .select()
      .from(sitePulseSubscriptions)
      .where(eq(sitePulseSubscriptions.siteId, siteId));
    const userARow = subs.find((s) => s.userId === userA)!;
    const userBRow = subs.find((s) => s.userId === userB)!;
    expect(userARow.disabledAt).not.toBeNull();
    expect(userBRow.disabledAt).toBeNull();
  });

  it('accepts explicit locale override', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    const view = await setPulseSubscription(
      {
        accountId,
        siteId,
        userId: accountId,
        enabled: true,
        acknowledgedPreviewAt: ack,
        locale: 'fr',
        resolvedLocale: 'en',
      },
      deps(),
    );
    expect(view.subscription?.locale).toBe('fr');
  });

  it('re-enabling after an unsubscribe reuses the row and re-anchors consent', async () => {
    // The subscription row is preserved (never deleted) so the consent trail
    // survives, which means re-opt-in has to clear `disabledAt` AND move
    // `enabledAt` forward — an untouched `enabledAt` would date the new
    // consent to the original opt-in.
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    const base = {
      accountId,
      siteId,
      userId: accountId,
      resolvedLocale: 'en',
    };
    await setPulseSubscription({ ...base, enabled: true, acknowledgedPreviewAt: ack }, deps());
    const [firstRow] = await getTestDb()
      .select()
      .from(sitePulseSubscriptions)
      .where(eq(sitePulseSubscriptions.siteId, siteId));

    await setPulseSubscription({ ...base, enabled: false }, deps());
    const [disabledRow] = await getTestDb()
      .select()
      .from(sitePulseSubscriptions)
      .where(eq(sitePulseSubscriptions.siteId, siteId));
    expect(disabledRow!.id).toBe(firstRow!.id);
    expect(disabledRow!.disabledAt).not.toBeNull();
    // Disabling must NOT re-anchor the original opt-in timestamp.
    expect(disabledRow!.enabledAt.toISOString()).toBe(
      firstRow!.enabledAt.toISOString(),
    );

    const view = await setPulseSubscription(
      { ...base, enabled: true, acknowledgedPreviewAt: ack },
      deps(),
    );
    expect(view.subscription?.enabled).toBe(true);
    expect(view.setting?.enabled).toBe(true);
    const rows = await getTestDb()
      .select()
      .from(sitePulseSubscriptions)
      .where(eq(sitePulseSubscriptions.siteId, siteId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(firstRow!.id);
    expect(rows[0]!.disabledAt).toBeNull();
    expect(rows[0]!.enabledAt.getTime()).toBeGreaterThanOrEqual(
      disabledRow!.enabledAt.getTime(),
    );
  });

  it('disable path works when queue is null (self-host)', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    await setPulseSubscription(
      {
        accountId,
        siteId,
        userId: accountId,
        enabled: true,
        acknowledgedPreviewAt: ack,
        resolvedLocale: 'en',
      },
      deps(),
    );
    await setPulseSubscription(
      {
        accountId,
        siteId,
        userId: accountId,
        enabled: false,
        resolvedLocale: 'en',
      },
      deps(),
    );
    // No throws when queue is null.
    expect(true).toBe(true);
  });
});

describe('getPulseHistoryPage — cursor pagination', () => {
  it('paginates newest-first and returns nextCursor when more rows exist', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    // Seed 3 runs with different createdAt.
    for (let i = 0; i < 3; i += 1) {
      await getTestDb().insert(weeklyPulseRuns).values({
        accountId,
        siteId,
        isoWeek: `2026-W0${i + 1}`,
        status: 'completed',
        marketSnapshot: {},
        promptCohortId: 'c',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
      });
      // spread createdAt manually because pg default is single tx
      await new Promise((r) => setTimeout(r, 20));
    }
    const first = await getPulseHistoryPage(
      { accountId, siteId, userId: accountId, limit: 2 },
      deps(),
    );
    expect(first.runs).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await getPulseHistoryPage(
      { accountId, siteId, userId: accountId, limit: 2, cursor: first.nextCursor! },
      deps(),
    );
    expect(second.runs.length).toBeGreaterThanOrEqual(0);
    expect(second.nextCursor).toBeNull();
  });

  it('cross-account 404 on history list', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const other = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    await expect(
      getPulseHistoryPage(
        { accountId: other, siteId, userId: other, limit: 10 },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('handles a malformed cursor by treating it as unset', async () => {
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    const page = await getPulseHistoryPage(
      { accountId, siteId, userId: accountId, limit: 10, cursor: '@@@invalid' },
      deps(),
    );
    expect(page.runs).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('ignores a well-formed cursor whose timestamp half is not a date', async () => {
    // The cursor decodes cleanly into two halves, so the shape guard passes —
    // only the Date check catches it. A tampered cursor must degrade to the
    // unfiltered first page, never to a query with an Invalid Date bound
    // (which Postgres would reject outright).
    const accountId = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(accountId, 'example.com');
    await getTestDb().insert(weeklyPulseRuns).values({
      accountId,
      siteId,
      isoWeek: '2026-W01',
      status: 'completed',
      marketSnapshot: {},
      promptCohortId: 'c',
      promptCohortVersion: 1,
      engineSurfaceSet: [],
      observationMeta: {},
      usageReference: {},
      counts: {},
    });
    const tampered = Buffer.from(
      'not-a-timestamp|11111111-1111-1111-1111-111111111111',
      'utf8',
    ).toString('base64url');
    const page = await getPulseHistoryPage(
      { accountId, siteId, userId: accountId, limit: 10, cursor: tampered },
      deps(),
    );
    expect(page.runs).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });
});

describe('getPulseHistoryDetail', () => {
  it('cross-account 404 for a pulse belonging to another account', async () => {
    const owner = new Types.ObjectId().toHexString();
    const other = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(owner, 'example.com');
    const insRun = await getTestDb()
      .insert(weeklyPulseRuns)
      .values({
        accountId: owner,
        siteId,
        isoWeek: '2026-W01',
        status: 'completed',
        marketSnapshot: {},
        promptCohortId: 'c',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
      })
      .returning({ id: weeklyPulseRuns.id });
    const runId = insRun[0]!.id;
    await expect(
      getPulseHistoryDetail(
        { accountId: other, siteId, userId: other, pulseId: runId },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns the stored citation changes alongside the run', async () => {
    const owner = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(owner, 'example.com');
    const insRun = await getTestDb()
      .insert(weeklyPulseRuns)
      .values({
        accountId: owner,
        siteId,
        isoWeek: '2026-W02',
        status: 'partial',
        marketSnapshot: {},
        promptCohortId: 'c',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
      })
      .returning({ id: weeklyPulseRuns.id });
    const runId = insRun[0]!.id;
    const insCitation = await getTestDb()
      .insert(weeklyPulseCitations)
      .values({
        pulseRunId: runId,
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'c',
        promptCohortVersion: 1,
        canonicalUrl: 'https://a.example/x',
        host: 'a.example',
      })
      .returning({ id: weeklyPulseCitations.id });
    await getTestDb().insert(weeklyPulseCitationChanges).values([
      {
        pulseRunId: runId,
        change: 'new',
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'c',
        promptCohortVersion: 1,
        canonicalUrl: 'https://a.example/x',
        host: 'a.example',
        citationId: insCitation[0]!.id,
      },
      {
        pulseRunId: runId,
        change: 'lost',
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'c',
        promptCohortVersion: 1,
        canonicalUrl: 'https://b.example/y',
        host: 'b.example',
        citationId: null,
      },
    ]);

    const detail = await getPulseHistoryDetail(
      { accountId: owner, siteId, userId: owner, pulseId: runId },
      deps(),
    );
    expect(detail.status).toBe('partial');
    const byChange = Object.fromEntries(
      detail.citationChanges.map((c) => [c.change, c]),
    );
    expect(detail.citationChanges).toHaveLength(2);
    expect(byChange.new).toMatchObject({
      engine: 'chatgpt',
      surface: 'mentions',
      host: 'a.example',
      canonicalUrl: 'https://a.example/x',
      citationId: insCitation[0]!.id,
    });
    // `lost` lives on the prior pulse only — no citation row on this run.
    expect(byChange.lost).toMatchObject({
      host: 'b.example',
      citationId: null,
    });
  });

  it('returns projection when it exists (null when it does not)', async () => {
    const owner = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(owner, 'example.com');
    const insRun = await getTestDb()
      .insert(weeklyPulseRuns)
      .values({
        accountId: owner,
        siteId,
        isoWeek: '2026-W01',
        status: 'completed',
        marketSnapshot: {},
        promptCohortId: 'c',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
      })
      .returning({ id: weeklyPulseRuns.id });
    const runId = insRun[0]!.id;
    const detail = await getPulseHistoryDetail(
      { accountId: owner, siteId, userId: owner, pulseId: runId },
      deps(),
    );
    expect(detail.projection).toBeNull();
    expect(detail.status).toBe('completed');

    await getTestDb().insert(weeklyPulseDigestProjections).values({
      pulseRunId: runId,
      payload: {
        actions_completed: [{
          actionId: 'completed-action',
          messageKey: 'weeklyPulse.actions.completed',
          targetMessageKey: 'weeklyPulse.actions.targetUnavailable',
          targetUrl: null,
          state: 'completed',
        }],
        actions_regressed: [],
        next_actions_top3: [],
      },
    });
    const defaultLocale = await getPulseHistoryDetail(
      { accountId: owner, siteId, userId: owner, pulseId: runId },
      deps(),
    );
    const arabic = await getPulseHistoryDetail(
      { accountId: owner, siteId, userId: owner, pulseId: runId, locale: 'ar' },
      deps(),
    );
    expect(defaultLocale.projection?.actions_completed[0]?.verb).toBe('Completed action');
    expect(arabic.projection?.actions_completed[0]?.verb).toMatch(/[\u0600-\u06ff]/u);
  });

  it('404 for a valid uuid but unknown pulse', async () => {
    const owner = new Types.ObjectId().toHexString();
    const siteId = await seedAccountSite(owner, 'example.com');
    await expect(
      getPulseHistoryDetail(
        {
          accountId: owner,
          siteId,
          userId: owner,
          pulseId: '11111111-1111-1111-1111-111111111111',
        },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// Smoke: exercise the exported utilities so 100% cover holds.
describe('utility exports', () => {
  it('siteSchedulerKey derives from siteId', async () => {
    const { siteSchedulerKey } = await import('./weekly-pulse.service.js');
    expect(siteSchedulerKey('abc')).toBe('weekly-pulse:abc');
  });

  it('countActiveRecipients counts subscription rows', async () => {
    const { countActiveRecipients } = await import('./weekly-pulse.service.js');
    const owner = new Types.ObjectId().toHexString();
    const siteId = new Types.ObjectId().toHexString();
    await getTestDb().insert(sitePulseSubscriptions).values({
      accountId: owner,
      siteId,
      userId: owner,
      locale: 'en',
    });
    const n = await countActiveRecipients(
      getTestDb() as unknown as WeeklyPulseServiceDeps['db'],
      owner,
      siteId,
    );
    expect(n).toBe(1);
  });

  it('countActiveRecipients reads 0 when the store returns no aggregate row', async () => {
    // `count(*)` always yields one row in Postgres, so the zero-row fallback is
    // only reachable through a store that answers the aggregate differently.
    // The fallback matters: returning `undefined` here would surface as NaN in
    // the superadmin recipient column.
    const { countActiveRecipients } = await import('./weekly-pulse.service.js');
    const emptyAggregateStore = {
      select: () => ({
        from: () => ({
          where: async () => [],
        }),
      }),
    } as unknown as WeeklyPulseServiceDeps['db'];
    await expect(
      countActiveRecipients(emptyAggregateStore, 'acct', 'site'),
    ).resolves.toBe(0);
  });
});
