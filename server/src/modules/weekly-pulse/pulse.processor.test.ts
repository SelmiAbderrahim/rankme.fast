import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { AiVisibilityProvider } from '../../shared/providers/index.js';
import {
  sitePulseSettings,
  sitePulseSubscriptions,
  weeklyPulseCitationChanges,
  weeklyPulseCitations,
  weeklyPulseRuns,
} from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  createWeeklyPulseProcessor,
  recoverInterruptedWeeklyPulseRuns,
  runWeeklyPulse,
  weeklyPulseProcessorTestables,
  type PulseProcessorDeps,
} from './pulse.processor.js';
import type { CollectionPorts } from './collection.service.js';

const ACCOUNT_A = '000000000000000000000001';
const SITE_A = '000000000000000000000002';
const USER_A = 'user-a';

function fakeLogger(): Logger {
  const noop = () => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: () => fakeLogger(),
  } as unknown as Logger;
}

function makeProvider(overrides: Partial<AiVisibilityProvider> = {}): AiVisibilityProvider {
  return {
    checkMentions: vi.fn(async () => []),
    getAnswers: vi.fn(async () => {
      throw new Error('getAnswers must NOT be called by the weekly pulse');
    }),
    getAiKeywordVolume: vi.fn(async () => []),
    ...overrides,
  };
}

function makePorts(overrides: Partial<CollectionPorts> = {}): CollectionPorts {
  return {
    loadSiteMarket: vi.fn(async () => ({ value: { locale: 'en-US' } })),
    loadPromptCohort: vi.fn(async () => ({
      id: 'cohort-1',
      version: 1,
      prompts: ['best crm for smbs'],
    })),
    loadCoverage: vi.fn(async () => ({
      cells: [
        { engine: 'google', surface: 'mentions' as const, supported: true, reason: null },
      ],
    })),
    loadConfirmedRankDrops: vi.fn(async () => []),
    loadTopOpenActions: vi.fn(async () => []),
    loadActionTransitions: vi.fn(async () => []),
    loadAudienceDecisions: vi.fn(async () => []),
    ...overrides,
  };
}

async function seedSubscription() {
  const db = getTestDb();
  await db.insert(sitePulseSettings).values({
    accountId: ACCOUNT_A,
    siteId: SITE_A,
    enabled: true,
    scheduleKey: 3,
    nextRunAt: new Date('2026-07-14T09:00:00Z'),
  });
  await db.insert(sitePulseSubscriptions).values({
    accountId: ACCOUNT_A,
    siteId: SITE_A,
    userId: USER_A,
    locale: 'en',
  });
}

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
beforeEach(async () => {
  await truncateAllTables();
});

const NOW_A = () => new Date('2026-07-14T12:00:00Z');
const ISO_WEEK_A = '2026-W29';

function baseDeps(overrides: Partial<PulseProcessorDeps> = {}): PulseProcessorDeps {
  return {
    db: getTestDb() as unknown as PulseProcessorDeps['db'],
    aiVisibility: makeProvider(),
    ports: makePorts(),
    resolveSite: async () => ({ siteDomain: 'example.com' }),
    loadBrandRadarScans: async () => ({ inWindow: [], baselines: [] }),
    projectAndDeliver: vi.fn(async () => undefined),
    logger: fakeLogger(),
    now: NOW_A,
    ...overrides,
  };
}

/** One mentioned citation for the `google` cell — the happy-path provider. */
function citingProvider(url = 'https://example.com/blog/crm'): AiVisibilityProvider {
  return makeProvider({
    checkMentions: vi.fn(async () => [
      {
        prompt: 'best crm for smbs',
        model: 'google',
        mentioned: true,
        citedUrl: url,
        checkedAt: new Date('2026-07-14T11:00:00Z'),
      },
    ]),
  });
}

function fakeJob(data: unknown): Job {
  return { data } as unknown as Job;
}

async function readRuns() {
  return getTestDb()
    .select()
    .from(weeklyPulseRuns)
    .where(eq(weeklyPulseRuns.accountId, ACCOUNT_A));
}

describe('runWeeklyPulse — state machine', () => {
  it('unsupported — no supported cell → provider not called', async () => {
    await seedSubscription();
    const provider = makeProvider();
    const ports = makePorts({
      loadCoverage: vi.fn(async () => ({ cells: [] })),
    });
    const outcome = await runWeeklyPulse(
      {
        db: getTestDb(),
        aiVisibility: provider,
        ports,
        resolveSite: async () => ({ siteDomain: 'example.com' }),
        loadBrandRadarScans: async () => ({ inWindow: [], baselines: [] }),
        logger: fakeLogger(),
      },
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('unsupported');
    expect(provider.checkMentions).not.toHaveBeenCalled();
    const [row] = await getTestDb()
      .select()
      .from(weeklyPulseRuns)
      .where(eq(weeklyPulseRuns.accountId, ACCOUNT_A));
    expect(row?.status).toBe('unsupported');
  });

  it('unsupported — missing market → no provider call', async () => {
    await seedSubscription();
    const provider = makeProvider();
    const outcome = await runWeeklyPulse(
      {
        db: getTestDb(),
        aiVisibility: provider,
        ports: makePorts({ loadSiteMarket: vi.fn(async () => null) }),
        resolveSite: async () => ({ siteDomain: 'example.com' }),
        loadBrandRadarScans: async () => ({ inWindow: [], baselines: [] }),
        logger: fakeLogger(),
      },
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('unsupported');
    expect(provider.checkMentions).not.toHaveBeenCalled();
  });

  it('resolveSite=null (deleted site) → status unsupported, no run row', async () => {
    await seedSubscription();
    const provider = makeProvider();
    const outcome = await runWeeklyPulse(
      {
        db: getTestDb(),
        aiVisibility: provider,
        ports: makePorts(),
        resolveSite: async () => null,
        loadBrandRadarScans: async () => ({ inWindow: [], baselines: [] }),
        logger: fakeLogger(),
      },
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('unsupported');
    expect(outcome.runId).toBeNull();
    expect(provider.checkMentions).not.toHaveBeenCalled();
    const rows = await getTestDb().select().from(weeklyPulseRuns);
    expect(rows).toEqual([]);
  });

  it('no eligible subscribers → status unsupported, no run row', async () => {
    // No subscription row seeded.
    const provider = makeProvider();
    const outcome = await runWeeklyPulse(
      {
        db: getTestDb(),
        aiVisibility: provider,
        ports: makePorts(),
        resolveSite: async () => ({ siteDomain: 'example.com' }),
        loadBrandRadarScans: async () => ({ inWindow: [], baselines: [] }),
        logger: fakeLogger(),
      },
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('unsupported');
    expect(outcome.runId).toBeNull();
    expect(provider.checkMentions).not.toHaveBeenCalled();
  });

  it('disabled-only subscribers are ineligible before provider spend', async () => {
    const db = getTestDb();
    await db.insert(sitePulseSettings).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      enabled: true,
      scheduleKey: 3,
      nextRunAt: new Date('2026-07-14T09:00:00Z'),
    });
    await db.insert(sitePulseSubscriptions).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      userId: USER_A,
      locale: 'en',
      disabledAt: new Date('2026-07-14T10:00:00Z'),
    });
    const provider = citingProvider();
    const outcome = await runWeeklyPulse(
      baseDeps({ aiVisibility: provider }),
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome).toEqual({ status: 'unsupported', runId: null });
    expect(provider.checkMentions).not.toHaveBeenCalled();
    expect(await readRuns()).toEqual([]);
  });

  it('mixed active and disabled subscribers collect only once', async () => {
    await seedSubscription();
    await getTestDb().insert(sitePulseSubscriptions).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      userId: 'user-disabled',
      locale: 'en',
      disabledAt: new Date('2026-07-14T10:00:00Z'),
    });
    const provider = citingProvider();
    const outcome = await runWeeklyPulse(
      baseDeps({ aiVisibility: provider }),
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('completed');
    expect(provider.checkMentions).toHaveBeenCalledTimes(1);
  });

  it('completed — one supported cell succeeds → digest counts populated', async () => {
    await seedSubscription();
    const provider = makeProvider({
      checkMentions: vi.fn(async () => [
        {
          prompt: 'best crm for smbs',
          model: 'google',
          mentioned: true,
          citedUrl: 'https://example.com/blog/crm',
          checkedAt: new Date(),
        },
      ]),
    });
    const outcome = await runWeeklyPulse(
      {
        db: getTestDb(),
        aiVisibility: provider,
        ports: makePorts(),
        resolveSite: async () => ({ siteDomain: 'example.com' }),
        loadBrandRadarScans: async () => ({ inWindow: [], baselines: [] }),
        logger: fakeLogger(),
      },
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('completed');
    const db = getTestDb();
    const [row] = await db
      .select()
      .from(weeklyPulseRuns)
      .where(eq(weeklyPulseRuns.accountId, ACCOUNT_A));
    expect(row?.status).toBe('completed');
    const citations = await db
      .select()
      .from(weeklyPulseCitations)
      .where(eq(weeklyPulseCitations.pulseRunId, row!.id));
    expect(citations).toHaveLength(1);
  });

  it('failed — provider error on all supported cells lands in failed', async () => {
    await seedSubscription();
    const provider = makeProvider({
      checkMentions: vi.fn(async () => {
        throw Object.assign(new Error('boom'), { name: 'VendorTimeoutError' });
      }),
    });
    const outcome = await runWeeklyPulse(
      {
        db: getTestDb(),
        aiVisibility: provider,
        ports: makePorts(),
        resolveSite: async () => ({ siteDomain: 'example.com' }),
        loadBrandRadarScans: async () => ({ inWindow: [], baselines: [] }),
        logger: fakeLogger(),
      },
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('failed');
    const [row] = await readRuns();
    expect(row?.status).toBe('failed');
  });

  it('partial — mix of success + error cells lands in partial', async () => {
    await seedSubscription();
    const ports = makePorts({
      loadCoverage: vi.fn(async () => ({
        cells: [
          { engine: 'google', surface: 'mentions' as const, supported: true, reason: null },
          { engine: 'chat_gpt', surface: 'citations' as const, supported: true, reason: null },
        ],
      })),
    });
    const provider = makeProvider({
      checkMentions: vi.fn(async () => [
        {
          prompt: 'best crm for smbs',
          model: 'google',
          mentioned: true,
          citedUrl: 'https://example.com/blog/crm',
          checkedAt: new Date(),
        },
      ]),
    });
    const outcome = await runWeeklyPulse(
      {
        db: getTestDb(),
        aiVisibility: provider,
        ports,
        resolveSite: async () => ({ siteDomain: 'example.com' }),
        loadBrandRadarScans: async () => ({ inWindow: [], baselines: [] }),
        logger: fakeLogger(),
      },
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    // citations surface has no historical implementation → complete=false →
    // partial.
    expect(outcome.status).toBe('partial');
  });

  it('replayed job on the same (site, iso_week) does not call the provider twice', async () => {
    await seedSubscription();
    const provider = makeProvider({
      checkMentions: vi.fn(async () => [
        {
          prompt: 'best crm for smbs',
          model: 'google',
          mentioned: true,
          citedUrl: 'https://example.com/blog/crm',
          checkedAt: new Date(),
        },
      ]),
    });
    const deps = {
      db: getTestDb(),
      aiVisibility: provider,
      ports: makePorts(),
      resolveSite: async () => ({ siteDomain: 'example.com' }),
      loadBrandRadarScans: async () => ({ inWindow: [], baselines: [] }),
      logger: fakeLogger(),
    };
    await runWeeklyPulse(deps, { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A }, NOW_A);
    await runWeeklyPulse(deps, { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A }, NOW_A);
    const db = getTestDb();
    const rows = await db
      .select()
      .from(weeklyPulseRuns)
      .where(eq(weeklyPulseRuns.accountId, ACCOUNT_A));
    expect(rows).toHaveLength(1);
    expect(provider.checkMentions).toHaveBeenCalledTimes(1);
  });

  it('unsupported — missing prompt cohort records the `none` cohort placeholder', async () => {
    await seedSubscription();
    const provider = makeProvider();
    const outcome = await runWeeklyPulse(
      baseDeps({
        aiVisibility: provider,
        ports: makePorts({ loadPromptCohort: vi.fn(async () => null) }),
      }),
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('unsupported');
    expect(provider.checkMentions).not.toHaveBeenCalled();
    const [row] = await readRuns();
    // The columns are NOT NULL, so a missing cohort persists an explicit
    // placeholder rather than failing the insert.
    expect(row?.promptCohortId).toBe('none');
    expect(row?.promptCohortVersion).toBe(0);
    expect(row?.errorDetailSafe).toBe('weeklyPulse.errors.missingMarketOrCohort');
  });

  it('derives iso_week from the fire clock when the payload carries the scheduler template', async () => {
    await seedSubscription();
    const outcome = await runWeeklyPulse(
      baseDeps({ aiVisibility: citingProvider() }),
      // The BullMQ job-scheduler template pins `isoWeek: 'template'`; the
      // processor MUST recompute the real week from the fire time, otherwise
      // every scheduled run would collide on one bogus week key.
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: 'template' },
      NOW_A,
    );
    expect(outcome.status).toBe('completed');
    const [row] = await readRuns();
    expect(row?.isoWeek).toBe(ISO_WEEK_A);
  });
});

describe('runWeeklyPulse — replayed terminal states never write a second row', () => {
  it('missing-market replay converges on the first row', async () => {
    await seedSubscription();
    const deps = baseDeps({ ports: makePorts({ loadSiteMarket: vi.fn(async () => null) }) });
    const payload = { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A };
    const first = await runWeeklyPulse(deps, payload, NOW_A);
    const second = await runWeeklyPulse(deps, payload, NOW_A);
    expect(first.runId).not.toBeNull();
    // The replay returns the existing id without crossing the provider boundary,
    // allowing a failed post-collection projection/delivery to resume.
    expect(second.runId).toBe(first.runId);
    expect(second.status).toBe('unsupported');
    expect(await readRuns()).toHaveLength(1);
  });

  it('no-supported-cell replay converges on the first row', async () => {
    await seedSubscription();
    const deps = baseDeps({ ports: makePorts({ loadCoverage: vi.fn(async () => ({ cells: [] })) }) });
    const payload = { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A };
    const first = await runWeeklyPulse(deps, payload, NOW_A);
    const second = await runWeeklyPulse(deps, payload, NOW_A);
    expect(first.runId).not.toBeNull();
    expect(second.runId).toBe(first.runId);
    const rows = await readRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.errorDetailSafe).toBe('weeklyPulse.errors.noSupportedCell');
  });

  it('concurrent collectors converge at the unique-week boundary after both passed the early read', async () => {
    await seedSubscription();
    let enteredProvider!: () => void;
    const providerEntered = new Promise<void>((resolve) => {
      enteredProvider = resolve;
    });
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = makeProvider({
      checkMentions: vi.fn(async () => {
        enteredProvider();
        await barrier;
        return [
          {
            prompt: 'best crm for smbs',
            model: 'google',
            mentioned: true,
            citedUrl: 'https://example.com/blog/concurrent',
            checkedAt: new Date('2026-07-14T11:00:00.000Z'),
          },
        ];
      }),
    });
    const deps = baseDeps({ aiVisibility: provider });
    const payload = { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A };
    const winningRun = runWeeklyPulse(deps, payload, NOW_A);
    await providerEntered;
    const losingRun = await runWeeklyPulse(deps, payload, NOW_A);
    expect(losingRun).toEqual(
      expect.objectContaining({ status: 'collecting' }),
    );
    release();
    const winner = await winningRun;
    const outcomes = [winner, losingRun];
    expect(provider.checkMentions).toHaveBeenCalledTimes(1);
    expect(await readRuns()).toHaveLength(1);
    expect(new Set(outcomes.map((outcome) => outcome.runId)).size).toBe(1);
    expect(winner).toEqual(
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('returns the durable winner when a competing claim lands during preflight', async () => {
    await seedSubscription();
    const db = getTestDb();
    const winnerId = '12121212-1212-4212-8212-121212121212';
    const provider = makeProvider();
    const ports = makePorts({
      loadCoverage: vi.fn(async () => {
        await db.insert(weeklyPulseRuns).values({
          id: winnerId,
          accountId: ACCOUNT_A,
          siteId: SITE_A,
          isoWeek: ISO_WEEK_A,
          status: 'collecting',
          marketSnapshot: { locale: 'en-US' },
          promptCohortId: 'cohort-1',
          promptCohortVersion: 1,
          engineSurfaceSet: [],
          observationMeta: {},
          usageReference: {},
          counts: {},
          startedAt: NOW_A(),
        });
        return {
          cells: [
            {
              engine: 'google',
              surface: 'mentions' as const,
              supported: true,
              reason: null,
            },
          ],
        };
      }),
    });

    await expect(
      runWeeklyPulse(
        baseDeps({ ports, aiVisibility: provider }),
        { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
        NOW_A,
      ),
    ).resolves.toEqual({ status: 'collecting', runId: winnerId });
    expect(provider.checkMentions).not.toHaveBeenCalled();
  });
});

describe('weekly-pulse transactional race boundaries', () => {
  const terminalInput = (runId: string) => ({
    runId,
    accountId: ACCOUNT_A,
    siteId: SITE_A,
    isoWeek: ISO_WEEK_A,
    status: 'completed' as const,
    marketSnapshotValue: { locale: 'en-US' },
    promptCohortId: 'cohort-1',
    promptCohortVersion: 1,
    engineSurfaceSet: [],
    startedAt: NOW_A(),
    counts: {},
    errorCode: null,
    errorDetailSafe: null,
    citationRows: [],
    changeRows: [],
  });

  it('fails loudly when a unique-claim conflict has no durable winner', async () => {
    const tx = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({ returning: async () => [] }),
        }),
      }),
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [] }) }),
      }),
    };
    const db = {
      transaction: async (callback: (inner: typeof tx) => Promise<unknown>) =>
        callback(tx),
    } as unknown as PulseProcessorDeps['db'];

    await expect(
      weeklyPulseProcessorTestables.claimCollectingRun(
        baseDeps({ db }),
        {
          accountId: ACCOUNT_A,
          siteId: SITE_A,
          isoWeek: ISO_WEEK_A,
          marketSnapshotValue: {},
          promptCohortId: 'cohort-1',
          promptCohortVersion: 1,
          engineSurfaceSet: [],
          startedAt: NOW_A(),
        },
      ),
    ).rejects.toThrow('weekly pulse claim conflict did not resolve to a run');
  });

  it('returns a terminal CAS winner and rejects a disappeared claim', async () => {
    const db = getTestDb();
    const runId = '13131313-1313-4313-8313-131313131313';
    await db.insert(weeklyPulseRuns).values({
      id: runId,
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      isoWeek: ISO_WEEK_A,
      status: 'partial',
      marketSnapshot: {},
      promptCohortId: 'cohort-1',
      promptCohortVersion: 1,
      engineSurfaceSet: [],
      observationMeta: {},
      usageReference: {},
      counts: {},
      startedAt: NOW_A(),
      finishedAt: NOW_A(),
    });

    await expect(
      weeklyPulseProcessorTestables.finalizeClaimedRun(
        baseDeps(),
        terminalInput(runId),
      ),
    ).resolves.toMatchObject({ id: runId, status: 'partial' });
    await expect(
      weeklyPulseProcessorTestables.finalizeClaimedRun(
        baseDeps(),
        terminalInput('14141414-1414-4414-8414-141414141414'),
      ),
    ).rejects.toThrow('weekly pulse claim disappeared');
  });

  it('returns the immutable winner of a terminal insert conflict', async () => {
    const db = getTestDb();
    const runId = '15151515-1515-4515-8515-151515151515';
    await db.insert(weeklyPulseRuns).values({
      id: runId,
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      isoWeek: ISO_WEEK_A,
      status: 'unsupported',
      marketSnapshot: {},
      promptCohortId: 'none',
      promptCohortVersion: 0,
      engineSurfaceSet: [],
      observationMeta: {},
      usageReference: {},
      counts: {},
      errorCode: 'unsupported',
      errorDetailSafe: 'weeklyPulse.errors.missingMarketOrCohort',
      startedAt: NOW_A(),
      finishedAt: NOW_A(),
    });

    await expect(
      weeklyPulseProcessorTestables.persistTerminal(baseDeps(), {
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        isoWeek: ISO_WEEK_A,
        status: 'unsupported',
        marketSnapshotValue: {},
        promptCohortId: 'none',
        promptCohortVersion: 0,
        engineSurfaceSet: [],
        startedAt: NOW_A(),
        counts: {},
        errorCode: 'unsupported',
        errorDetailSafe: 'weeklyPulse.errors.missingMarketOrCohort',
      }),
    ).resolves.toMatchObject({ id: runId, status: 'unsupported' });
  });

  it('returns the successful finalization winner of a competing collector', async () => {
    await seedSubscription();
    const db = getTestDb();
    const ports = makePorts({
      loadConfirmedRankDrops: vi.fn(async () => {
        await db
          .update(weeklyPulseRuns)
          .set({ status: 'partial', finishedAt: NOW_A() })
          .where(
            and(
              eq(weeklyPulseRuns.accountId, ACCOUNT_A),
              eq(weeklyPulseRuns.siteId, SITE_A),
              eq(weeklyPulseRuns.status, 'collecting'),
            ),
          );
        return [];
      }),
    });

    await expect(
      runWeeklyPulse(
        baseDeps({ aiVisibility: citingProvider(), ports }),
        { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
        NOW_A,
      ),
    ).resolves.toMatchObject({ status: 'partial' });
  });

  it('returns the failed finalization winner of a competing collector', async () => {
    await seedSubscription();
    const db = getTestDb();
    const ports = makePorts({
      loadConfirmedRankDrops: vi.fn(async () => {
        await db
          .update(weeklyPulseRuns)
          .set({ status: 'failed', finishedAt: NOW_A() })
          .where(
            and(
              eq(weeklyPulseRuns.accountId, ACCOUNT_A),
              eq(weeklyPulseRuns.siteId, SITE_A),
              eq(weeklyPulseRuns.status, 'collecting'),
            ),
          );
        throw new Error('competing collector finalized');
      }),
    });

    await expect(
      runWeeklyPulse(
        baseDeps({ ports }),
        { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
        NOW_A,
      ),
    ).resolves.toMatchObject({ status: 'failed' });
  });

});

describe('recoverInterruptedWeeklyPulseRuns', () => {
  it('finalizes an abandoned claim once without repeating provider work', async () => {
    await seedSubscription();
    const db = getTestDb();
    const createdAt = new Date('2026-07-13T08:00:00.000Z');
    await db.insert(weeklyPulseRuns).values({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      isoWeek: ISO_WEEK_A,
      status: 'collecting',
      marketSnapshot: { locale: 'en-US' },
      promptCohortId: 'cohort-1',
      promptCohortVersion: 1,
      engineSurfaceSet: [],
      observationMeta: { provider: 'dataforseo' },
      usageReference: {},
      counts: {},
      startedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });

    const now = new Date('2026-07-14T12:00:00.000Z');
    await expect(
      recoverInterruptedWeeklyPulseRuns(db, {
        now,
        interruptedAfterMs: 60_000,
      }),
    ).resolves.toBe(1);
    await expect(
      recoverInterruptedWeeklyPulseRuns(db, {
        now,
        interruptedAfterMs: 60_000,
      }),
    ).resolves.toBe(0);

    const [run] = await readRuns();
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'interrupted',
      errorDetailSafe: 'weeklyPulse.errors.interrupted',
      finishedAt: now,
    });
    const [setting] = await db
      .select()
      .from(sitePulseSettings)
      .where(eq(sitePulseSettings.siteId, SITE_A));
    expect(setting?.lastStatus).toBe('failed');
    expect(setting?.nextRunAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('does not count a candidate whose recovery CAS loses', async () => {
    const tx = {
      update: () => ({
        set: () => ({
          where: () => ({ returning: async () => [] }),
        }),
      }),
    };
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{
              id: '16161616-1616-4616-8616-161616161616',
              accountId: ACCOUNT_A,
              siteId: SITE_A,
            }],
          }),
        }),
      }),
      transaction: async (callback: (inner: typeof tx) => Promise<boolean>) =>
        callback(tx),
    } as unknown as PulseProcessorDeps['db'];

    await expect(
      recoverInterruptedWeeklyPulseRuns(db, { now: NOW_A() }),
    ).resolves.toBe(0);
  });
});

describe('runWeeklyPulse — run-claim store failures', () => {
  it('propagates a store error out of the run claim without writing a run row', async () => {
    await seedSubscription();
    // A store outage must bubble so BullMQ retries the job — swallowing it
    // would silently skip the site's pulse for the week.
    const real = getTestDb() as unknown as Record<string, unknown>;
    let transactionAttempted = false;
    const throwingDb = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop !== 'transaction') return Reflect.get(target, prop, receiver);
        return async () => {
          transactionAttempted = true;
          throw new Error('weekly_pulse_runs store down');
        };
      },
    }) as unknown as PulseProcessorDeps['db'];

    const provider = makeProvider();
    await expect(
      runWeeklyPulse(
        baseDeps({ db: throwingDb, aiVisibility: provider }),
        { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
        NOW_A,
      ),
    ).rejects.toThrow('weekly_pulse_runs store down');
    expect(transactionAttempted).toBe(true);
    // The claim runs before the first vendor call — nothing was spent.
    expect(provider.checkMentions).not.toHaveBeenCalled();
    expect(await readRuns()).toHaveLength(0);
  });
});

describe('runWeeklyPulse — collection throws after the run is claimed', () => {
  /**
   * Ports whose `loadSiteMarket` answers once (for the processor's own
   * eligibility read) and then goes missing — the market/cohort race the
   * processor documents at the `UnsupportedPulseError` catch.
   */
  function vanishingMarketPorts(): CollectionPorts {
    let calls = 0;
    return makePorts({
      loadSiteMarket: vi.fn(async () => {
        calls += 1;
        return calls === 1 ? { value: { locale: 'en-US' } } : null;
      }),
    });
  }

  it('lands in `unsupported` when the market vanishes mid-run', async () => {
    await seedSubscription();
    const outcome = await runWeeklyPulse(
      baseDeps({ ports: vanishingMarketPorts() }),
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('unsupported');
    const [row] = await readRuns();
    expect(row?.status).toBe('unsupported');
    expect(row?.errorDetailSafe).toBe('weeklyPulse.errors.unsupported');
  });

  it('lands in `failed` when a local evidence port throws', async () => {
    await seedSubscription();
    const outcome = await runWeeklyPulse(
      baseDeps({
        ports: makePorts({
          loadConfirmedRankDrops: vi.fn(async () => {
            throw new Error('rank drop store down');
          }),
        }),
      }),
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('failed');
    const [row] = await readRuns();
    expect(row?.status).toBe('failed');
    expect(row?.errorCode).toBe('failed');
    // A crash must not leak the underlying message into the stored row.
    expect(row?.errorDetailSafe).toBe('weeklyPulse.errors.failed');
    expect(row?.counts).toMatchObject({ citations_now: 0 });
  });

  it('replaying a failed collection does not write a second row', async () => {
    await seedSubscription();
    const deps = baseDeps({
      ports: makePorts({
        loadConfirmedRankDrops: vi.fn(async () => {
          throw new Error('rank drop store down');
        }),
      }),
    });
    const payload = { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A };
    const first = await runWeeklyPulse(deps, payload, NOW_A);
    const second = await runWeeklyPulse(deps, payload, NOW_A);
    expect(first.runId).not.toBeNull();
    expect(second.runId).toBe(first.runId);
    expect(second.status).toBe('failed');
    expect(await readRuns()).toHaveLength(1);
  });
});

describe('runWeeklyPulse — counts + coverage bookkeeping', () => {
  it('counts action transitions and open actions into the digest header', async () => {
    await seedSubscription();
    const outcome = await runWeeklyPulse(
      baseDeps({
        aiVisibility: citingProvider(),
        loadBrandRadarScans: async () => ({
          inWindow: [
            {
              scanId: 'current-a',
              queryHash: 'a'.repeat(64),
              brandQuery: 'Acme',
              mentionCount: 3,
              sentimentDistribution: {
                positive: 50,
                neutral: 30,
                negative: 10,
                unknown: 10,
              },
              terminalAt: new Date('2026-07-14T10:00:00.000Z'),
            },
          ],
          baselines: [
            {
              scanId: 'baseline-a',
              queryHash: 'a'.repeat(64),
              brandQuery: 'Acme',
              mentionCount: 1,
              sentimentDistribution: {
                positive: 40,
                neutral: 40,
                negative: 10,
                unknown: 10,
              },
              terminalAt: new Date('2026-07-01T10:00:00.000Z'),
            },
            {
              scanId: 'baseline-b',
              queryHash: 'b'.repeat(64),
              brandQuery: 'Beta',
              mentionCount: 2,
              sentimentDistribution: {
                positive: 25,
                neutral: 25,
                negative: 25,
                unknown: 25,
              },
              terminalAt: new Date('2026-07-01T10:00:00.000Z'),
            },
          ],
        }),
        ports: makePorts({
          loadActionTransitions: vi.fn(async () => [
            { actionId: 'a1', verb: 'add', target: 'sitemap', state: 'completed' as const },
            { actionId: 'a2', verb: 'add', target: 'robots', state: 'completed' as const },
            { actionId: 'a3', verb: 'restore', target: 'canonical', state: 'regressed' as const },
            // `open` transitions are neither completed nor regressed.
            { actionId: 'a4', verb: 'fix', target: 'meta', state: 'open' as const },
          ]),
          loadTopOpenActions: vi.fn(async () => [
            { actionId: 't1', verb: 'fix', target: 'meta', state: 'open' as const },
            { actionId: 't2', verb: 'fix', target: 'title', state: 'open' as const },
          ]),
          loadConfirmedRankDrops: vi.fn(async () => [
            { keyword: 'k1', priorRank: 3, currentRank: 12, confirmedAt: '2026-07-13T00:00:00Z' },
          ]),
          loadAudienceDecisions: vi.fn(async () => [
            { id: 'decision-1', acceptedAt: '2026-07-13T00:00:00Z' },
          ]),
        }),
      }),
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('completed');
    const [row] = await readRuns();
    expect(row?.counts).toMatchObject({
      citations_now: 1,
      confirmed_rank_drops: 1,
      actions_completed: 2,
      actions_regressed: 1,
      next_actions_total: 2,
      audience_decisions_accepted: 1,
      brand_delta_queries: 2,
      brand_delta_new_scans: 1,
    });
  });

  it('cannot claim `lost` for a coverage cell that vanished mid-run', async () => {
    await seedSubscription();

    // A prior week where BOTH engines were supported and complete, and
    // perplexity carried a citation.
    const priorCells = [
      { engine: 'google', surface: 'mentions', supported: true, complete: true },
      { engine: 'perplexity', surface: 'mentions', supported: true, complete: true },
    ];
    const priorInsert = await getTestDb()
      .insert(weeklyPulseRuns)
      .values({
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        isoWeek: '2026-W25',
        status: 'completed',
        marketSnapshot: { locale: 'en-US' },
        promptCohortId: 'cohort-1',
        promptCohortVersion: 1,
        engineSurfaceSet: priorCells as unknown as object,
        observationMeta: {},
        usageReference: {},
        counts: {},
      })
      .returning({ id: weeklyPulseRuns.id });
    const priorId = priorInsert[0]!.id;
    await getTestDb().insert(weeklyPulseCitations).values({
      pulseRunId: priorId,
      engine: 'perplexity',
      surface: 'mentions',
      promptCohortId: 'cohort-1',
      promptCohortVersion: 1,
      canonicalUrl: 'https://example.com/blog/perplexity-only',
      host: 'example.com',
    });

    // The processor reads coverage once for the run claim, and the
    // collection reads it again. Between the two reads perplexity drops out,
    // so we never actually looked at that cell this week.
    let calls = 0;
    const ports = makePorts({
      loadCoverage: vi.fn(async () => {
        calls += 1;
        const cells = [
          { engine: 'google', surface: 'mentions' as const, supported: true, reason: null },
          { engine: 'perplexity', surface: 'mentions' as const, supported: true, reason: null },
        ];
        return { cells: calls === 1 ? cells : cells.slice(0, 1) };
      }),
    });
    const outcome = await runWeeklyPulse(
      baseDeps({
        aiVisibility: citingProvider('https://example.com/blog/new'),
        ports,
      }),
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('completed');

    const changes = await getTestDb()
      .select()
      .from(weeklyPulseCitationChanges)
      .where(eq(weeklyPulseCitationChanges.pulseRunId, outcome.runId!));
    const byUrl = Object.fromEntries(changes.map((c) => [c.canonicalUrl, c]));
    // The cell we DID collect behaves normally…
    expect(byUrl['https://example.com/blog/new']!.change).toBe('new');
    // …but the vanished cell is `complete: false`, so its missing citation is
    // reported honestly as unknown rather than as a real loss.
    expect(byUrl['https://example.com/blog/perplexity-only']!.change).toBe(
      'unknown_partial',
    );
  });

  it('tolerates duplicated coverage rows without losing the citation link', async () => {
    await seedSubscription();
    // Two identical coverage cells produce two identical citation rows; the
    // unique index collapses them, so the second row has no returned id and
    // its change entry must fall back to a null citation reference.
    const ports = makePorts({
      loadCoverage: vi.fn(async () => ({
        cells: [
          { engine: 'google', surface: 'mentions' as const, supported: true, reason: null },
          { engine: 'google', surface: 'mentions' as const, supported: true, reason: null },
        ],
      })),
    });
    const outcome = await runWeeklyPulse(
      baseDeps({ aiVisibility: citingProvider(), ports }),
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('completed');
    const citations = await getTestDb()
      .select()
      .from(weeklyPulseCitations)
      .where(eq(weeklyPulseCitations.pulseRunId, outcome.runId!));
    expect(citations).toHaveLength(1);
    const changes = await getTestDb()
      .select()
      .from(weeklyPulseCitationChanges)
      .where(eq(weeklyPulseCitationChanges.pulseRunId, outcome.runId!));
    // Both duplicates map to the same (engine, surface, url) change key.
    expect(changes).toHaveLength(1);
    expect(changes[0]!.change).toBe('unknown_partial');
  });
});

describe('runWeeklyPulse — prior-pulse comparison', () => {
  const PRIOR_CELLS = [
    { engine: 'google', surface: 'mentions', supported: true, complete: true },
  ];

  async function seedPriorRun(overrides: {
    isoWeek: string;
    status?: 'completed' | 'partial' | 'failed' | 'unsupported';
    promptCohortId?: string;
    promptCohortVersion?: number;
    engineSurfaceSet?: unknown;
  }) {
    const inserted = await getTestDb()
      .insert(weeklyPulseRuns)
      .values({
        accountId: ACCOUNT_A,
        siteId: SITE_A,
        isoWeek: overrides.isoWeek,
        status: overrides.status ?? 'completed',
        marketSnapshot: { locale: 'en-US' },
        promptCohortId: overrides.promptCohortId ?? 'cohort-1',
        promptCohortVersion: overrides.promptCohortVersion ?? 1,
        engineSurfaceSet: (overrides.engineSurfaceSet ?? PRIOR_CELLS) as object,
        observationMeta: {},
        usageReference: {},
        counts: {},
      })
      .returning({ id: weeklyPulseRuns.id });
    return inserted[0]!.id;
  }

  it('diffs against the newest compatible prior run and skips every incompatible one', async () => {
    await seedSubscription();

    // Oldest first — `loadCompatiblePrior` scans createdAt DESC and returns on
    // the first row that survives every filter, so the compatible run is
    // seeded first and the rejects are stacked on top of it.
    const compatibleId = await seedPriorRun({ isoWeek: '2026-W25' });
    await getTestDb().insert(weeklyPulseCitations).values({
      pulseRunId: compatibleId,
      engine: 'google',
      surface: 'mentions',
      promptCohortId: 'cohort-1',
      promptCohortVersion: 1,
      canonicalUrl: 'https://example.com/blog/old',
      host: 'example.com',
    });
    // Rejected: terminal status is not comparable.
    await seedPriorRun({ isoWeek: '2026-W26', status: 'failed' });
    // Rejected: the prompt cohort was replaced.
    await seedPriorRun({ isoWeek: '2026-W27', promptCohortId: 'cohort-2' });
    // Rejected: same cohort, newer version.
    await seedPriorRun({ isoWeek: '2026-W28', promptCohortVersion: 9 });

    const outcome = await runWeeklyPulse(
      baseDeps({ aiVisibility: citingProvider('https://example.com/blog/new') }),
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('completed');

    const changes = await getTestDb()
      .select()
      .from(weeklyPulseCitationChanges)
      .where(eq(weeklyPulseCitationChanges.pulseRunId, outcome.runId!));
    const byUrl = Object.fromEntries(changes.map((c) => [c.canonicalUrl, c]));
    // The fresh URL is `new`; the one only on the prior run is `lost`.
    expect(byUrl['https://example.com/blog/new']!.change).toBe('new');
    expect(byUrl['https://example.com/blog/old']!.change).toBe('lost');
    // Every change row points back at the compatible prior run, not a reject.
    for (const change of changes) {
      expect(change.priorPulseRunId).toBe(compatibleId);
    }
  });

  it('normalizes a malformed prior engine_surface_set instead of trusting it', async () => {
    await seedSubscription();
    const priorId = await seedPriorRun({
      isoWeek: '2026-W25',
      engineSurfaceSet: [
        null,
        'not-an-object',
        { engine: 42, surface: 'mentions', supported: true },
        { engine: 'google', surface: 7, supported: true },
        // Unknown surfaces collapse to `mentions`; a missing `complete` flag
        // falls back to the cell's `supported` value.
        { engine: 'google', surface: 'weird', supported: true },
        { engine: 'perplexity', surface: 'citations', supported: false, complete: false },
      ],
    });
    await getTestDb().insert(weeklyPulseCitations).values({
      pulseRunId: priorId,
      engine: 'google',
      surface: 'mentions',
      promptCohortId: 'cohort-1',
      promptCohortVersion: 1,
      canonicalUrl: 'https://example.com/blog/old',
      host: 'example.com',
    });

    const outcome = await runWeeklyPulse(
      baseDeps({ aiVisibility: citingProvider('https://example.com/blog/new') }),
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('completed');
    const changes = await getTestDb()
      .select()
      .from(weeklyPulseCitationChanges)
      .where(eq(weeklyPulseCitationChanges.pulseRunId, outcome.runId!));
    // The junk entries are dropped, leaving a google/mentions supported cell
    // that matches the current run → the comparison is still made.
    const byUrl = Object.fromEntries(changes.map((c) => [c.canonicalUrl, c]));
    expect(byUrl['https://example.com/blog/new']!.change).toBe('new');
    expect(byUrl['https://example.com/blog/old']!.change).toBe('lost');
    expect(byUrl['https://example.com/blog/old']!.priorPulseRunId).toBe(priorId);
  });

  it('falls back to unknown_partial when the prior set is not an array at all', async () => {
    await seedSubscription();
    const priorId = await seedPriorRun({
      isoWeek: '2026-W25',
      engineSurfaceSet: { broken: true },
    });
    await getTestDb().insert(weeklyPulseCitations).values({
      pulseRunId: priorId,
      engine: 'google',
      surface: 'mentions',
      promptCohortId: 'cohort-1',
      promptCohortVersion: 1,
      canonicalUrl: 'https://example.com/blog/old',
      host: 'example.com',
    });

    const outcome = await runWeeklyPulse(
      baseDeps({ aiVisibility: citingProvider('https://example.com/blog/new') }),
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('completed');
    const changes = await getTestDb()
      .select()
      .from(weeklyPulseCitationChanges)
      .where(eq(weeklyPulseCitationChanges.pulseRunId, outcome.runId!));
    // An unreadable coverage blob normalizes to zero cells, so the
    // supported-cell fingerprints cannot match and the candidate is rejected
    // as an incomparable baseline: every current citation is reported as
    // `unknown` and nothing is claimed `new` or `lost`.
    expect(changes).toHaveLength(1);
    expect(changes[0]!.change).toBe('unknown_partial');
    expect(changes[0]!.canonicalUrl).toBe('https://example.com/blog/new');
    // The row still records WHICH prior run was scanned, so an operator can
    // see the comparison was attempted and rejected.
    expect(changes[0]!.priorPulseRunId).toBe(priorId);
  });
});

describe('createWeeklyPulseProcessor — BullMQ seam', () => {
  it('consumes a scheduler payload and derives its ISO week at fire time', async () => {
    await seedSubscription();
    const process = createWeeklyPulseProcessor(
      baseDeps({ aiVisibility: citingProvider() }),
    );
    await process(
      fakeJob({ accountId: ACCOUNT_A, siteId: SITE_A, scheduled: true }),
    );
    const [run] = await readRuns();
    expect(run?.isoWeek).toBe(ISO_WEEK_A);
    expect(run?.status).toBe('completed');
  });

  it('drains legacy scheduler payloads accepted before the schema fix', async () => {
    await seedSubscription();
    const process = createWeeklyPulseProcessor(
      baseDeps({ aiVisibility: citingProvider() }),
    );
    await process(
      fakeJob({ accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: 'template' }),
    );
    const [run] = await readRuns();
    expect(run?.isoWeek).toBe(ISO_WEEK_A);
    expect(run?.status).toBe('completed');
  });

  it('parses the job payload and runs the pulse with the injected clock', async () => {
    await seedSubscription();
    const projectAndDeliver = vi.fn(async () => undefined);
    const process = createWeeklyPulseProcessor(
      baseDeps({ aiVisibility: citingProvider(), projectAndDeliver }),
    );
    await process(
      fakeJob({ accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A }),
    );
    const rows = await readRuns();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('completed');
    expect(rows[0]!.isoWeek).toBe(ISO_WEEK_A);
    expect(projectAndDeliver).toHaveBeenCalledWith(rows[0]!.id);
  });

  it('projects and delivers partial runs too', async () => {
    await seedSubscription();
    const projectAndDeliver = vi.fn(async () => undefined);
    const process = createWeeklyPulseProcessor(baseDeps({
      aiVisibility: citingProvider(),
      ports: makePorts({
        loadCoverage: vi.fn(async () => ({
          cells: [
            { engine: 'google', surface: 'mentions' as const, supported: true, reason: null },
            { engine: 'chat_gpt', surface: 'citations' as const, supported: true, reason: null },
          ],
        })),
      }),
      projectAndDeliver,
    }));
    await process(fakeJob({ accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A }));
    const [run] = await readRuns();
    expect(run!.status).toBe('partial');
    expect(projectAndDeliver).toHaveBeenCalledWith(run!.id);
  });

  it('fails loudly when terminal post-processing is not configured', async () => {
    await seedSubscription();
    const { projectAndDeliver: _omitted, ...withoutProjection } = baseDeps({
      aiVisibility: citingProvider(),
    });
    const process = createWeeklyPulseProcessor(withoutProjection as PulseProcessorDeps);
    await expect(
      process(fakeJob({ accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A })),
    ).rejects.toThrow('weekly-pulse projectAndDeliver port is not configured');
    expect(await readRuns()).toHaveLength(1);
  });

  it('does not project unsupported runs', async () => {
    await seedSubscription();
    const projectAndDeliver = vi.fn(async () => undefined);
    const process = createWeeklyPulseProcessor(baseDeps({
      ports: makePorts({ loadSiteMarket: vi.fn(async () => null) }),
      projectAndDeliver,
    }));
    await process(fakeJob({ accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A }));
    expect(projectAndDeliver).not.toHaveBeenCalled();
  });

  it('does not project when an ineligible site produced no run row', async () => {
    const projectAndDeliver = vi.fn(async () => undefined);
    const process = createWeeklyPulseProcessor(baseDeps({ projectAndDeliver }));
    await process(fakeJob({ accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A }));
    expect(projectAndDeliver).not.toHaveBeenCalled();
    expect(await readRuns()).toEqual([]);
  });

  it('defaults to the wall clock when no clock is injected', async () => {
    await seedSubscription();
    // Production wires no `now`; the run's started_at has to come from real
    // time so `next_run_at` is scheduled off an honest wall clock.
    const { now: _injected, ...withoutClock } = baseDeps({
      aiVisibility: citingProvider(),
    });
    const process = createWeeklyPulseProcessor(withoutClock as PulseProcessorDeps);
    const before = Date.now();
    await process(
      fakeJob({ accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A }),
    );
    const after = Date.now();
    const rows = await readRuns();
    expect(rows).toHaveLength(1);
    const startedAt = rows[0]!.startedAt!.getTime();
    expect(startedAt).toBeGreaterThanOrEqual(before);
    expect(startedAt).toBeLessThanOrEqual(after);
  });

  it('rejects a malformed job payload before touching the database', async () => {
    const process = createWeeklyPulseProcessor(baseDeps());
    await expect(
      process(fakeJob({ accountId: ACCOUNT_A, siteId: SITE_A })),
    ).rejects.toThrow(/malformed job payload/);
    expect(await readRuns()).toHaveLength(0);
  });
});
