/**
 * Detection invariants.
 *
 * Proves the pure domain diff, the no-baseline refusal, correct new/lost
 * semantics across THREE consecutive snapshots, threshold matching (including
 * "left vendor depth"), one-alert-per-snapshot-pair, and that the sweep is a
 * read-only consumer of `rank_drop_confirmations`.
 */
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alertRules,
  backlinkRowSnapshots,
  keywords,
  rankDropConfirmations,
  rankings,
} from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { Site } from '../sites/sites.model.js';
import {
  detectBacklinkAlerts,
  detectRankDropAlerts,
  diffDomains,
  hasEnabledRule,
  meetsThreshold,
  runAlertDetectionSweep,
  type AlertDetectionDeps,
} from './alert-detection.service.js';
import { newRuleId } from './alerts.secrets.js';

type Db = AlertDetectionDeps['db'];
const db = () => getTestDb() as unknown as Db;

const ACCOUNT = 'acct-1';
const SITE = 'site-1';

interface EnqueuedJob {
  name: string;
  data: { ruleId: string; transitionId: string; evidence: Record<string, unknown> };
  opts: { jobId?: string };
}

function fakeQueue(): { queue: Queue; jobs: EnqueuedJob[] } {
  const jobs: EnqueuedJob[] = [];
  const queue = {
    add: async (name: string, data: EnqueuedJob['data'], opts: EnqueuedJob['opts']) => {
      jobs.push({ name, data, opts });
      return { id: opts.jobId };
    },
  } as unknown as Queue;
  return { queue, jobs };
}

async function seedRule(
  type: 'rank_drop' | 'new_backlink' | 'lost_backlink',
  overrides: { threshold?: number; enabled?: boolean; siteId?: string } = {},
): Promise<string> {
  const id = newRuleId();
  await db()
    .insert(alertRules)
    .values({
      id,
      accountId: ACCOUNT,
      siteId: overrides.siteId ?? SITE,
      type,
      threshold: type === 'rank_drop' ? (overrides.threshold ?? 10) : null,
      enabled: overrides.enabled ?? true,
      emailRecipientIds: ['u1'],
    });
  return id;
}

async function seedReview(
  reviewId: string,
  capturedAt: string,
  domains: string[],
  siteId: string = SITE,
): Promise<void> {
  if (domains.length === 0) return;
  await db()
    .insert(backlinkRowSnapshots)
    .values(
      domains.map((domain) => ({
        reviewId,
        accountId: ACCOUNT,
        siteId,
        url: `https://${domain}/page`,
        domain,
        spamScore: 5,
        rubricBand: 'clean' as const,
        rubricVersion: 'v1',
        dofollow: true,
        isBroken: false,
        capturedAt: new Date(capturedAt),
      })),
    );
}

async function seedConfirmation(input: {
  state: 'confirmed' | 'volatile';
  settledAt: string;
  confirmationPosition: number | null;
  siteId?: string;
}): Promise<string> {
  const siteId = input.siteId ?? SITE;
  const [keyword] = await db()
    .insert(keywords)
    .values({
      accountId: ACCOUNT,
      siteId,
      phrase: 'seo audit tool',
      locationCode: 2840,
      languageCode: 'en',
    })
    .returning();
  const [ranking] = await db()
    .insert(rankings)
    .values({
      keywordId: keyword!.id,
      position: input.confirmationPosition,
      checkedAt: new Date(input.settledAt),
      source: 'fresh',
    })
    .returning();
  const [row] = await db()
    .insert(rankDropConfirmations)
    .values({
      accountId: ACCOUNT,
      siteId,
      keywordId: keyword!.id,
      rankingId: ranking!.id,
      state: input.state,
      previousPosition: 3,
      candidatePosition: input.confirmationPosition,
      confirmationPosition: input.confirmationPosition,
      candidateObservedAt: new Date('2026-07-01T00:00:00.000Z'),
      confirmationObservedAt: new Date(input.settledAt),
      locationCode: 2840,
      languageCode: 'en',
      device: 'desktop',
      attemptReservedAt: new Date(input.settledAt),
      settledAt: new Date(input.settledAt),
    })
    .returning();
  return row!.id;
}

beforeAll(async () => {
  await startTestPostgres();
  // The sweep's paused-site filter reads the Mongo `Site` model.
  await startMemoryMongo();
});

afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await truncateAllTables();
  await clearCollections();
});

describe('diffDomains', () => {
  it('reports added and removed domains', () => {
    expect(diffDomains(['a', 'b'], ['b', 'c'])).toEqual({
      added: ['c'],
      removed: ['a'],
    });
  });

  it('reports nothing for an identical set', () => {
    expect(diffDomains(['a', 'b'], ['a', 'b'])).toEqual({ added: [], removed: [] });
  });
});

describe('meetsThreshold', () => {
  it('fires at or past the threshold and never above it', () => {
    expect(meetsThreshold(24, 10)).toBe(true);
    expect(meetsThreshold(10, 10)).toBe(true);
    expect(meetsThreshold(4, 10)).toBe(false);
  });

  it('treats leaving vendor depth as worse than any position', () => {
    expect(meetsThreshold(null, 100)).toBe(true);
  });
});

describe('detectRankDropAlerts', () => {
  const drop = {
    accountId: ACCOUNT,
    siteId: SITE,
    confirmationId: 'conf-1',
    keyword: 'seo audit tool',
    beforePosition: 3,
    beforeAt: new Date('2026-07-01T00:00:00.000Z'),
    afterPosition: 24,
    afterAt: new Date('2026-07-02T00:00:00.000Z'),
  };

  it('enqueues one job per matching rule with evidence-derived identity', async () => {
    const ruleId = await seedRule('rank_drop', { threshold: 10 });
    const { queue, jobs } = fakeQueue();

    const outcome = await detectRankDropAlerts(drop, { db: db(), queue });

    expect(outcome.dispatched).toEqual([ruleId]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data.transitionId).toBe('rank:conf-1');
    expect(jobs[0]!.opts.jobId).toMatch(/^alert-dispatch-[0-9a-f-]{36}-[0-9a-f]{16}$/u);
    expect(jobs[0]!.opts.jobId).not.toContain(':');
    expect(jobs[0]!.data.evidence).toMatchObject({
      kind: 'rank_drop',
      before: { at: '2026-07-01T00:00:00.000Z', position: 3 },
      after: { at: '2026-07-02T00:00:00.000Z', position: 24 },
    });
  });

  it('skips a rule whose threshold is not reached', async () => {
    await seedRule('rank_drop', { threshold: 40 });
    const { queue, jobs } = fakeQueue();
    const outcome = await detectRankDropAlerts(drop, { db: db(), queue });
    expect(outcome).toEqual({ dispatched: [], skipped: 'below_threshold' });
    expect(jobs).toHaveLength(0);
  });

  it('skips a disabled rule and a rule on another site', async () => {
    await seedRule('rank_drop', { enabled: false });
    await seedRule('rank_drop', { siteId: 'other-site' });
    const { queue } = fakeQueue();
    const outcome = await detectRankDropAlerts(drop, { db: db(), queue });
    expect(outcome).toEqual({ dispatched: [], skipped: 'no_rules' });
  });

  it('no-ops when the kill switch left the queue unbuilt', async () => {
    await seedRule('rank_drop');
    const outcome = await detectRankDropAlerts(drop, { db: db(), queue: null });
    expect(outcome).toEqual({ dispatched: [], skipped: 'disabled' });
  });
});

describe('detectBacklinkAlerts', () => {
  it('refuses to alert without a baseline snapshot', async () => {
    await seedRule('new_backlink');
    await seedReview('rev-1', '2026-07-01T00:00:00.000Z', ['a.test']);
    const { queue, jobs } = fakeQueue();

    const outcome = await detectBacklinkAlerts(
      {
        accountId: ACCOUNT,
        siteId: SITE,
        reviewId: 'rev-1',
        capturedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      { db: db(), queue },
    );

    expect(outcome).toEqual({ dispatched: [], skipped: 'no_baseline' });
    expect(jobs).toHaveLength(0);
  });

  it('emits one new and one lost alert across two consecutive reviews', async () => {
    const newRule = await seedRule('new_backlink');
    const lostRule = await seedRule('lost_backlink');
    await seedReview('rev-1', '2026-07-01T00:00:00.000Z', ['keep.test', 'gone.test']);
    await seedReview('rev-2', '2026-07-02T00:00:00.000Z', ['keep.test', 'fresh.test']);
    const { queue, jobs } = fakeQueue();

    const outcome = await detectBacklinkAlerts(
      {
        accountId: ACCOUNT,
        siteId: SITE,
        reviewId: 'rev-2',
        capturedAt: new Date('2026-07-02T00:00:00.000Z'),
      },
      { db: db(), queue },
    );

    expect(outcome.dispatched.sort()).toEqual([newRule, lostRule].sort());
    expect(jobs).toHaveLength(2);
    const added = jobs.find((job) => job.data.evidence.kind === 'new_backlink')!;
    expect(added.data.transitionId).toBe('link:new:rev-1:rev-2');
    expect(added.data.evidence).toMatchObject({
      before: { reviewId: 'rev-1', rowCount: 2 },
      after: { reviewId: 'rev-2', rowCount: 2 },
      changedDomains: ['fresh.test'],
      changedTotal: 1,
    });
    const removed = jobs.find((job) => job.data.evidence.kind === 'lost_backlink')!;
    expect(removed.data.evidence).toMatchObject({ changedDomains: ['gone.test'] });
  });

  it('treats three snapshots as two independent ordered transitions', async () => {
    await seedRule('new_backlink');
    await seedReview('rev-1', '2026-07-01T00:00:00.000Z', ['a.test']);
    await seedReview('rev-2', '2026-07-02T00:00:00.000Z', ['a.test', 'b.test']);
    await seedReview('rev-3', '2026-07-03T00:00:00.000Z', ['a.test', 'b.test', 'c.test']);
    const { queue, jobs } = fakeQueue();
    const deps = { db: db(), queue };

    await detectBacklinkAlerts(
      { accountId: ACCOUNT, siteId: SITE, reviewId: 'rev-2', capturedAt: new Date('2026-07-02T00:00:00.000Z') },
      deps,
    );
    await detectBacklinkAlerts(
      { accountId: ACCOUNT, siteId: SITE, reviewId: 'rev-3', capturedAt: new Date('2026-07-03T00:00:00.000Z') },
      deps,
    );

    expect(jobs.map((job) => job.data.transitionId)).toEqual([
      'link:new:rev-1:rev-2',
      'link:new:rev-2:rev-3',
    ]);
  });

  it('counts a domain once however many URLs it links from', async () => {
    await seedRule('new_backlink');
    await seedReview('rev-1', '2026-07-01T00:00:00.000Z', ['a.test']);
    await db()
      .insert(backlinkRowSnapshots)
      .values(
        ['one', 'two', 'three'].map((slug) => ({
          reviewId: 'rev-2',
          accountId: ACCOUNT,
          siteId: SITE,
          url: `https://multi.test/${slug}`,
          domain: 'multi.test',
          spamScore: 1,
          rubricBand: 'clean' as const,
          rubricVersion: 'v1',
          dofollow: true,
          isBroken: false,
          capturedAt: new Date('2026-07-02T00:00:00.000Z'),
        })),
      );
    const { queue, jobs } = fakeQueue();

    await detectBacklinkAlerts(
      { accountId: ACCOUNT, siteId: SITE, reviewId: 'rev-2', capturedAt: new Date('2026-07-02T00:00:00.000Z') },
      { db: db(), queue },
    );

    expect(jobs[0]!.data.evidence).toMatchObject({
      changedDomains: ['multi.test'],
      changedTotal: 1,
    });
  });

  it('emits nothing when the domain set is unchanged', async () => {
    await seedRule('new_backlink');
    await seedReview('rev-1', '2026-07-01T00:00:00.000Z', ['a.test']);
    await seedReview('rev-2', '2026-07-02T00:00:00.000Z', ['a.test']);
    const { queue, jobs } = fakeQueue();

    const outcome = await detectBacklinkAlerts(
      { accountId: ACCOUNT, siteId: SITE, reviewId: 'rev-2', capturedAt: new Date('2026-07-02T00:00:00.000Z') },
      { db: db(), queue },
    );

    expect(outcome).toEqual({ dispatched: [], skipped: 'no_change' });
    expect(jobs).toHaveLength(0);
  });

  it('reports no_rules when a change exists but nothing subscribes', async () => {
    await seedReview('rev-1', '2026-07-01T00:00:00.000Z', ['a.test']);
    await seedReview('rev-2', '2026-07-02T00:00:00.000Z', ['b.test']);
    const { queue } = fakeQueue();

    const outcome = await detectBacklinkAlerts(
      { accountId: ACCOUNT, siteId: SITE, reviewId: 'rev-2', capturedAt: new Date('2026-07-02T00:00:00.000Z') },
      { db: db(), queue },
    );

    expect(outcome).toEqual({ dispatched: [], skipped: 'no_rules' });
  });

  it('no-ops when the kill switch left the queue unbuilt', async () => {
    const outcome = await detectBacklinkAlerts(
      { accountId: ACCOUNT, siteId: SITE, reviewId: 'rev-2', capturedAt: new Date() },
      { db: db(), queue: null },
    );
    expect(outcome).toEqual({ dispatched: [], skipped: 'disabled' });
  });
});

describe('runAlertDetectionSweep', () => {
  const now = () => new Date('2026-07-02T12:00:00.000Z');

  it('dispatches settled confirmations without writing to the table', async () => {
    await seedRule('rank_drop', { threshold: 10 });
    const confirmationId = await seedConfirmation({
      state: 'confirmed',
      settledAt: '2026-07-02T00:00:00.000Z',
      confirmationPosition: 24,
    });
    const { queue, jobs } = fakeQueue();

    const before = await db().select().from(rankDropConfirmations);
    const outcome = await runAlertDetectionSweep({ db: db(), queue, now });
    const after = await db().select().from(rankDropConfirmations);

    expect(outcome).toEqual({ examined: 1, dispatched: 1 });
    expect(jobs[0]!.data.transitionId).toBe(`rank:${confirmationId}`);
    // Read-only consumer: the 04-owned row is byte-identical afterwards.
    expect(after).toEqual(before);
  });

  it('ignores confirmations that never settled confirmed', async () => {
    await seedRule('rank_drop');
    await seedConfirmation({
      state: 'volatile',
      settledAt: '2026-07-02T00:00:00.000Z',
      confirmationPosition: 4,
    });
    const { queue, jobs } = fakeQueue();

    const outcome = await runAlertDetectionSweep({ db: db(), queue, now });

    expect(outcome).toEqual({ examined: 0, dispatched: 0 });
    expect(jobs).toHaveLength(0);
  });

  it('ignores confirmations outside the recency window', async () => {
    await seedRule('rank_drop');
    await seedConfirmation({
      state: 'confirmed',
      settledAt: '2026-06-01T00:00:00.000Z',
      confirmationPosition: 30,
    });
    const { queue } = fakeQueue();
    expect(await runAlertDetectionSweep({ db: db(), queue, now })).toEqual({
      examined: 0,
      dispatched: 0,
    });
  });

  it('is safe to re-run — the same transition id every time', async () => {
    await seedRule('rank_drop');
    await seedConfirmation({
      state: 'confirmed',
      settledAt: '2026-07-02T00:00:00.000Z',
      confirmationPosition: 24,
    });
    const { queue, jobs } = fakeQueue();

    await runAlertDetectionSweep({ db: db(), queue, now });
    await runAlertDetectionSweep({ db: db(), queue, now });

    expect(jobs).toHaveLength(2);
    expect(jobs[0]!.opts.jobId).toBe(jobs[1]!.opts.jobId);
  });

  it('isolates one bad confirmation from the rest of the sweep', async () => {
    await seedRule('rank_drop');
    await seedConfirmation({
      state: 'confirmed',
      settledAt: '2026-07-02T00:00:00.000Z',
      confirmationPosition: 24,
    });
    const warn = vi.fn();
    const exploding = {
      add: async () => {
        throw new Error('redis down');
      },
    } as unknown as Queue;

    const outcome = await runAlertDetectionSweep({
      db: db(),
      queue: exploding,
      now,
      logger: { warn } as unknown as AlertDetectionDeps['logger'],
    });

    expect(outcome).toEqual({ examined: 1, dispatched: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('also dispatches link transitions from the same read-only pass', async () => {
    const ruleId = await seedRule('new_backlink');
    await seedReview('rev-1', '2026-07-01T00:00:00.000Z', ['a.test']);
    await seedReview('rev-2', '2026-07-02T00:00:00.000Z', ['a.test', 'b.test']);
    const { queue, jobs } = fakeQueue();

    const outcome = await runAlertDetectionSweep({ db: db(), queue, now });

    // Only rev-2 falls inside the 24h sweep window; its baseline (rev-1) is
    // found by capture time regardless of the window, so the ordered pair
    // rev-1 → rev-2 still produces exactly one alert.
    expect(outcome).toEqual({ examined: 1, dispatched: 1 });
    expect(jobs[0]!.data.ruleId).toBe(ruleId);
    expect(jobs[0]!.data.transitionId).toBe('link:new:rev-1:rev-2');
  });

  it('isolates a failing review from the rest of the pass', async () => {
    await seedRule('new_backlink');
    await seedReview('rev-1', '2026-07-01T00:00:00.000Z', ['a.test']);
    await seedReview('rev-2', '2026-07-02T00:00:00.000Z', ['b.test']);
    const warn = vi.fn();
    const exploding = {
      add: async () => {
        throw new Error('redis down');
      },
    } as unknown as Queue;

    const outcome = await runAlertDetectionSweep({
      db: db(),
      queue: exploding,
      now,
      logger: { warn } as unknown as AlertDetectionDeps['logger'],
    });

    expect(outcome.dispatched).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('skips paused-site drops and reviews while a live site still dispatches', async () => {
    // A real paused Site doc — the sweep's batch filter resolves it by _id.
    const PAUSED_SITE = '00000000000000000000aaaa';
    await Site.create({
      _id: PAUSED_SITE,
      accountId: '000000000000000000000abc',
      url: 'https://paused.example.com',
      domain: 'paused.example.com',
      paused: true,
      pausedAt: new Date(),
    });
    // Rules on both sites, both arms.
    await seedRule('rank_drop', { threshold: 10, siteId: PAUSED_SITE });
    const liveRule = await seedRule('rank_drop', { threshold: 10 });
    await seedRule('new_backlink', { siteId: PAUSED_SITE });
    // One confirmed drop per site — only the live one may dispatch.
    await seedConfirmation({
      state: 'confirmed',
      settledAt: '2026-07-02T00:00:00.000Z',
      confirmationPosition: 24,
      siteId: PAUSED_SITE,
    });
    const liveConfirmation = await seedConfirmation({
      state: 'confirmed',
      settledAt: '2026-07-02T00:00:00.000Z',
      confirmationPosition: 24,
    });
    // A changed review pair on the paused site — must not dispatch either.
    await seedReview('rev-p1', '2026-07-01T00:00:00.000Z', ['a.test'], PAUSED_SITE);
    await seedReview('rev-p2', '2026-07-02T00:00:00.000Z', ['a.test', 'b.test'], PAUSED_SITE);
    const { queue, jobs } = fakeQueue();

    const outcome = await runAlertDetectionSweep({ db: db(), queue, now });

    // Both drops + the paused review are examined; only the live drop dispatches.
    expect(outcome).toEqual({ examined: 3, dispatched: 1 });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data.ruleId).toBe(liveRule);
    expect(jobs[0]!.data.transitionId).toBe(`rank:${liveConfirmation}`);
  });

  it('uses the current clock when the sweep has no injected clock', async () => {
    const { queue } = fakeQueue();

    await expect(runAlertDetectionSweep({ db: db(), queue })).resolves.toEqual({
      examined: 0,
      dispatched: 0,
    });
  });

  it('no-ops when the kill switch left the queue unbuilt', async () => {
    expect(await runAlertDetectionSweep({ db: db(), queue: null })).toEqual({
      examined: 0,
      dispatched: 0,
    });
  });
});

describe('hasEnabledRule', () => {
  it('answers per site and type', async () => {
    await seedRule('rank_drop');
    expect(
      await hasEnabledRule(db(), { accountId: ACCOUNT, siteId: SITE, type: 'rank_drop' }),
    ).toBe(true);
    expect(
      await hasEnabledRule(db(), { accountId: ACCOUNT, siteId: SITE, type: 'new_backlink' }),
    ).toBe(false);
  });
});
