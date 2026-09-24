/**
 * Weekly Pulse — repository tests (spec `12-weekly-pulse.md` §4).
 *
 * PGlite runs the same generated SQL migrations that boot applies, so this
 * suite is the "migration + constraint + idempotency" gate for the whole
 * 12-set.
 *
 * Drizzle wraps PG errors so their message is `Failed query: ...` and the
 * underlying PostgresError lives on `.cause` (probed on drizzle-orm 0.44 +
 * @electric-sql/pglite 0.3). `expectDbError` walks the cause chain and
 * asserts both the SQLState code and (when relevant) the constraint name.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  sitePulseSettings,
  sitePulseSubscriptions,
  weeklyPulseCitationChanges,
  weeklyPulseCitations,
  weeklyPulseDeliveryEvents,
  weeklyPulseDigestProjections,
  weeklyPulseRuns,
  type WeeklyPulseRunStatus,
} from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';

interface DbErrorExpectation {
  /** SQLState code — `'23505'` for unique_violation, `'23514'` for
   * check_violation, `'22P02'` for invalid_text_representation (enum). */
  readonly code: string;
  readonly constraint?: string;
}

async function expectDbError(
  fn: () => Promise<unknown>,
  expectation: DbErrorExpectation,
): Promise<void> {
  let thrown: unknown = null;
  try {
    await fn();
  } catch (error) {
    thrown = error;
  }
  if (thrown === null) {
    throw new Error('Expected the DB operation to throw');
  }
  const seen = new Set<unknown>();
  let current: unknown = thrown;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const entry = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof entry.code === 'string' && entry.code === expectation.code) {
      if (
        !expectation.constraint ||
        (typeof entry.constraint === 'string' &&
          entry.constraint === expectation.constraint)
      ) {
        return;
      }
    }
    current = entry.cause;
  }
  const message =
    thrown instanceof Error ? thrown.message : String(thrown);
  throw new Error(
    `Expected DB error code ${expectation.code}${
      expectation.constraint ? ` on ${expectation.constraint}` : ''
    }; got: ${message}`,
  );
}

const ACCOUNT_ID = 'acct-000000000000000000000001';
const SITE_ID = 'site-000000000000000000000001';
const OTHER_ACCOUNT_ID = 'acct-000000000000000000000002';

async function insertRun(overrides: {
  isoWeek: string;
  status?: WeeklyPulseRunStatus;
  accountId?: string;
  siteId?: string;
}): Promise<string> {
  const db = getTestDb();
  const [row] = await db
    .insert(weeklyPulseRuns)
    .values({
      accountId: overrides.accountId ?? ACCOUNT_ID,
      siteId: overrides.siteId ?? SITE_ID,
      isoWeek: overrides.isoWeek,
      status: overrides.status ?? 'completed',
      marketSnapshot: { country: 'US', language: 'en' },
      promptCohortId: 'cohort-a',
      promptCohortVersion: 3,
      engineSurfaceSet: [
        { engine: 'openai', surface: 'mentions', supported: true, reason: null },
      ],
      observationMeta: { window: { start: '2026-07-06', end: '2026-07-12' } },
      usageReference: {},
      counts: {
        citations_now: 0,
        citations_new: 0,
        citations_lost: 0,
        citations_unknown_partial: 0,
        confirmed_rank_drops: 0,
        actions_completed: 0,
        actions_regressed: 0,
        next_actions_total: 0,
      },
    })
    .returning({ id: weeklyPulseRuns.id });
  if (!row) throw new Error('insertRun: no row returned');
  return row.id;
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

describe('site_pulse_settings', () => {
  it('enforces uniqueness on (account_id, site_id)', async () => {
    const db = getTestDb();
    await db.insert(sitePulseSettings).values({
      accountId: ACCOUNT_ID,
      siteId: SITE_ID,
      scheduleKey: 42,
      nextRunAt: new Date('2026-07-20T09:00:00Z'),
    });
    await expectDbError(
      () =>
        db.insert(sitePulseSettings).values({
          accountId: ACCOUNT_ID,
          siteId: SITE_ID,
          scheduleKey: 43,
          nextRunAt: new Date('2026-07-21T09:00:00Z'),
        }),
      { code: '23505', constraint: 'site_pulse_settings_account_site_uidx' },
    );
  });

  it('allows the same site under a different account', async () => {
    const db = getTestDb();
    await db.insert(sitePulseSettings).values({
      accountId: ACCOUNT_ID,
      siteId: SITE_ID,
      scheduleKey: 1,
      nextRunAt: new Date('2026-07-20T09:00:00Z'),
    });
    await expect(
      db.insert(sitePulseSettings).values({
        accountId: OTHER_ACCOUNT_ID,
        siteId: SITE_ID,
        scheduleKey: 1,
        nextRunAt: new Date('2026-07-20T09:00:00Z'),
      }),
    ).resolves.toBeDefined();
  });

  it('rejects a negative schedule_key (check constraint)', async () => {
    const db = getTestDb();
    await expectDbError(
      () =>
        db.insert(sitePulseSettings).values({
          accountId: ACCOUNT_ID,
          siteId: SITE_ID,
          scheduleKey: -1,
          nextRunAt: new Date('2026-07-20T09:00:00Z'),
        }),
      {
        code: '23514',
        constraint: 'site_pulse_settings_schedule_key_nonneg_check',
      },
    );
  });
});

describe('site_pulse_subscriptions', () => {
  it('enforces uniqueness on (account_id, site_id, user_id)', async () => {
    const db = getTestDb();
    await db.insert(sitePulseSubscriptions).values({
      accountId: ACCOUNT_ID,
      siteId: SITE_ID,
      userId: 'user-1',
      locale: 'en',
    });
    await expectDbError(
      () =>
        db.insert(sitePulseSubscriptions).values({
          accountId: ACCOUNT_ID,
          siteId: SITE_ID,
          userId: 'user-1',
          locale: 'fr',
        }),
      {
        code: '23505',
        constraint: 'site_pulse_subscriptions_account_site_user_uidx',
      },
    );
  });

  it('preserves history via disabled_at rather than deletion', async () => {
    const db = getTestDb();
    await db.insert(sitePulseSubscriptions).values({
      accountId: ACCOUNT_ID,
      siteId: SITE_ID,
      userId: 'user-1',
      locale: 'en',
    });
    await db
      .update(sitePulseSubscriptions)
      .set({ disabledAt: new Date('2026-07-19T00:00:00Z') })
      .where(
        and(
          eq(sitePulseSubscriptions.accountId, ACCOUNT_ID),
          eq(sitePulseSubscriptions.siteId, SITE_ID),
          eq(sitePulseSubscriptions.userId, 'user-1'),
        ),
      );
    const rows = await db
      .select({ disabledAt: sitePulseSubscriptions.disabledAt })
      .from(sitePulseSubscriptions);
    expect(rows).toHaveLength(1);
    const first = rows[0];
    if (!first) throw new Error('expected one row');
    expect(first.disabledAt).not.toBeNull();
  });
});

describe('weekly_pulse_runs', () => {
  it('enforces one run per (account, site, iso_week) — the whole 12-set replay guarantee', async () => {
    await insertRun({ isoWeek: '2026-W29' });
    await expectDbError(() => insertRun({ isoWeek: '2026-W29' }), {
      code: '23505',
      constraint: 'weekly_pulse_runs_account_site_week_uidx',
    });
  });

  it('allows the same ISO week for a different site', async () => {
    await insertRun({ isoWeek: '2026-W29' });
    await expect(
      insertRun({ isoWeek: '2026-W29', siteId: 'site-2' }),
    ).resolves.toBeDefined();
  });

  it('rejects a status outside the enum via the check constraint', async () => {
    const db = getTestDb();
    await expectDbError(
      () =>
        db.insert(weeklyPulseRuns).values({
          accountId: ACCOUNT_ID,
          siteId: SITE_ID,
          isoWeek: '2026-W30',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate boundary probe
          status: 'not-a-status' as any,
          marketSnapshot: {},
          promptCohortId: 'c',
          promptCohortVersion: 1,
          engineSurfaceSet: [],
          observationMeta: {},
          usageReference: {},
          counts: {},
        }),
      { code: '23514', constraint: 'weekly_pulse_runs_status_check' },
    );
  });

  it('rejects a negative cohort version', async () => {
    const db = getTestDb();
    await expectDbError(
      () =>
        db.insert(weeklyPulseRuns).values({
          accountId: ACCOUNT_ID,
          siteId: SITE_ID,
          isoWeek: '2026-W31',
          status: 'completed',
          marketSnapshot: {},
          promptCohortId: 'c',
          promptCohortVersion: -1,
          engineSurfaceSet: [],
          observationMeta: {},
          usageReference: {},
          counts: {},
        }),
      {
        code: '23514',
        constraint: 'weekly_pulse_runs_cohort_version_nonneg_check',
      },
    );
  });
});

describe('weekly_pulse_citations', () => {
  it('enforces (run, engine, surface, cohort, url) uniqueness', async () => {
    const db = getTestDb();
    const runId = await insertRun({ isoWeek: '2026-W29' });
    await db.insert(weeklyPulseCitations).values({
      pulseRunId: runId,
      engine: 'openai',
      surface: 'mentions',
      promptCohortId: 'cohort-a',
      promptCohortVersion: 3,
      canonicalUrl: 'https://example.com/x',
      host: 'example.com',
      mentionCount: 2,
    });
    await expectDbError(
      () =>
        db.insert(weeklyPulseCitations).values({
          pulseRunId: runId,
          engine: 'openai',
          surface: 'mentions',
          promptCohortId: 'cohort-a',
          promptCohortVersion: 3,
          canonicalUrl: 'https://example.com/x',
          host: 'example.com',
          mentionCount: 3,
        }),
      { code: '23505', constraint: 'weekly_pulse_citations_run_cell_url_uidx' },
    );
  });

  it('rejects a surface outside the enum', async () => {
    const db = getTestDb();
    const runId = await insertRun({ isoWeek: '2026-W29' });
    await expectDbError(
      () =>
        db.insert(weeklyPulseCitations).values({
          pulseRunId: runId,
          engine: 'openai',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate boundary probe
          surface: 'chatter' as any,
          promptCohortId: 'cohort-a',
          promptCohortVersion: 3,
          canonicalUrl: 'https://example.com/y',
          host: 'example.com',
        }),
      { code: '23514', constraint: 'weekly_pulse_citations_surface_check' },
    );
  });

  it('cascade-deletes when the parent run is deleted', async () => {
    const db = getTestDb();
    const runId = await insertRun({ isoWeek: '2026-W29' });
    await db.insert(weeklyPulseCitations).values({
      pulseRunId: runId,
      engine: 'openai',
      surface: 'mentions',
      promptCohortId: 'cohort-a',
      promptCohortVersion: 3,
      canonicalUrl: 'https://example.com/z',
      host: 'example.com',
    });
    await db.delete(weeklyPulseRuns).where(eq(weeklyPulseRuns.id, runId));
    const rows = await db.select().from(weeklyPulseCitations);
    expect(rows).toHaveLength(0);
  });
});

describe('weekly_pulse_citation_changes', () => {
  it('enforces (run, change, engine, surface, cohort, url) uniqueness', async () => {
    const db = getTestDb();
    const runId = await insertRun({ isoWeek: '2026-W30' });
    await db.insert(weeklyPulseCitationChanges).values({
      pulseRunId: runId,
      change: 'new',
      engine: 'openai',
      surface: 'mentions',
      promptCohortId: 'cohort-a',
      promptCohortVersion: 3,
      canonicalUrl: 'https://example.com/u',
      host: 'example.com',
    });
    await expectDbError(
      () =>
        db.insert(weeklyPulseCitationChanges).values({
          pulseRunId: runId,
          change: 'new',
          engine: 'openai',
          surface: 'mentions',
          promptCohortId: 'cohort-a',
          promptCohortVersion: 3,
          canonicalUrl: 'https://example.com/u',
          host: 'example.com',
        }),
      {
        code: '23505',
        constraint: 'weekly_pulse_citation_changes_cell_url_uidx',
      },
    );
  });

  it('allows the same url twice under different change kinds', async () => {
    const db = getTestDb();
    const runId = await insertRun({ isoWeek: '2026-W30' });
    await db.insert(weeklyPulseCitationChanges).values({
      pulseRunId: runId,
      change: 'new',
      engine: 'openai',
      surface: 'mentions',
      promptCohortId: 'cohort-a',
      promptCohortVersion: 3,
      canonicalUrl: 'https://example.com/u',
      host: 'example.com',
    });
    await expect(
      db.insert(weeklyPulseCitationChanges).values({
        pulseRunId: runId,
        change: 'unknown_partial',
        engine: 'openai',
        surface: 'mentions',
        promptCohortId: 'cohort-a',
        promptCohortVersion: 3,
        canonicalUrl: 'https://example.com/u',
        host: 'example.com',
      }),
    ).resolves.toBeDefined();
  });
});

describe('weekly_pulse_digest_projection', () => {
  it('enforces exactly one projection per run', async () => {
    const db = getTestDb();
    const runId = await insertRun({ isoWeek: '2026-W31' });
    await db.insert(weeklyPulseDigestProjections).values({
      pulseRunId: runId,
      payload: {
        coverage: { supported: 1, unsupported: 0 },
        citations_new: [],
        citations_lost: [],
        citations_unknown_partial: [],
        confirmed_rank_drops: [],
        actions_completed: [],
        actions_regressed: [],
        next_actions_top3: [],
        gsc_appearance: { status: 'unavailable', window: null, rows: [] },
      },
    });
    await expectDbError(
      () =>
        db.insert(weeklyPulseDigestProjections).values({
          pulseRunId: runId,
          payload: {},
        }),
      {
        code: '23505',
        constraint: 'weekly_pulse_digest_projection_run_uidx',
      },
    );
  });
});

describe('weekly_pulse_delivery_events', () => {
  it('enforces one terminal delivery event per (run, user, channel)', async () => {
    const db = getTestDb();
    const runId = await insertRun({ isoWeek: '2026-W32' });
    await db.insert(weeklyPulseDeliveryEvents).values({
      pulseRunId: runId,
      userId: 'user-1',
      channel: 'email',
      locale: 'en',
      status: 'queued',
    });
    await expectDbError(
      () =>
        db.insert(weeklyPulseDeliveryEvents).values({
          pulseRunId: runId,
          userId: 'user-1',
          channel: 'email',
          locale: 'en',
          status: 'delivered',
        }),
      {
        code: '23505',
        constraint:
          'weekly_pulse_delivery_events_run_user_channel_uidx',
      },
    );
  });

  it('allows updating the same row to a terminal state (retry path)', async () => {
    const db = getTestDb();
    const runId = await insertRun({ isoWeek: '2026-W33' });
    await db.insert(weeklyPulseDeliveryEvents).values({
      pulseRunId: runId,
      userId: 'user-1',
      channel: 'email',
      locale: 'en',
      status: 'queued',
    });
    await db
      .update(weeklyPulseDeliveryEvents)
      .set({ status: 'delivered', attempt: 2 })
      .where(
        and(
          eq(weeklyPulseDeliveryEvents.pulseRunId, runId),
          eq(weeklyPulseDeliveryEvents.userId, 'user-1'),
          eq(weeklyPulseDeliveryEvents.channel, 'email'),
        ),
      );
    const [row] = await db.select().from(weeklyPulseDeliveryEvents);
    if (!row) throw new Error('expected one row');
    expect(row.status).toBe('delivered');
    expect(row.attempt).toBe(2);
  });

  it('rejects a status outside the enum', async () => {
    const db = getTestDb();
    const runId = await insertRun({ isoWeek: '2026-W34' });
    await expectDbError(
      () =>
        db.insert(weeklyPulseDeliveryEvents).values({
          pulseRunId: runId,
          userId: 'user-1',
          channel: 'email',
          locale: 'en',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate boundary probe
          status: 'gone' as any,
        }),
      {
        code: '23514',
        constraint: 'weekly_pulse_delivery_events_status_check',
      },
    );
  });

  it('rejects a non-positive attempt', async () => {
    const db = getTestDb();
    const runId = await insertRun({ isoWeek: '2026-W35' });
    await expectDbError(
      () =>
        db.insert(weeklyPulseDeliveryEvents).values({
          pulseRunId: runId,
          userId: 'user-1',
          channel: 'email',
          locale: 'en',
          status: 'queued',
          attempt: 0,
        }),
      {
        code: '23514',
        constraint: 'weekly_pulse_delivery_events_attempt_positive_check',
      },
    );
  });
});
