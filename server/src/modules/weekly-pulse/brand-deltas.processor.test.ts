/**
 * Weekly Pulse — brand-delta step inside a full pulse run (07b §3).
 *
 * Two guarantees:
 *   1. The run's `counts` carry the bounded brand-delta scalars.
 *   2. The brand-delta step spends NOTHING — no Brand Radar job is enqueued
 *      and no vendor cost is captured.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type * as CostCaptureModule from '../../shared/providers/cost-capture.js';
import type { AiVisibilityProvider } from '../../shared/providers/index.js';
import {
  sitePulseSettings,
  sitePulseSubscriptions,
  weeklyPulseRuns,
} from '../../db/schema/index.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { setBrandRadarQueue } from '../brand-radar/index.js';
import { runWeeklyPulse, type PulseProcessorDeps } from './pulse.processor.js';
import type { CollectionPorts } from './collection.service.js';
import type { BrandRadarScanFacts } from './brand-deltas.service.js';

const spend = vi.hoisted(() => ({
  captureVendorCost: vi.fn(),
  queueAdd: vi.fn(),
}));

vi.mock('../../shared/providers/cost-capture.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CostCaptureModule>();
  return { ...actual, captureVendorCost: spend.captureVendorCost };
});

const ACCOUNT_A = '000000000000000000000011';
const SITE_A = '000000000000000000000012';
const USER_A = 'user-brand-delta';
const HASH_A = 'a'.repeat(64);
const NOW_A = () => new Date('2026-07-14T12:00:00Z');
const ISO_WEEK_A = '2026-W29';

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

function provider(): AiVisibilityProvider {
  return {
    checkMentions: vi.fn(async () => [
      {
        prompt: 'best crm for smbs',
        model: 'google',
        mentioned: true,
        citedUrl: 'https://example.com/blog/crm',
        checkedAt: new Date('2026-07-14T11:00:00Z'),
      },
    ]),
    getAnswers: vi.fn(async () => {
      throw new Error('getAnswers must NOT be called by the weekly pulse');
    }),
    getAiKeywordVolume: vi.fn(async () => []),
  };
}

function ports(): CollectionPorts {
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
  };
}

function scan(overrides: Partial<BrandRadarScanFacts> = {}): BrandRadarScanFacts {
  return {
    scanId: 'scan-1',
    queryHash: HASH_A,
    brandQuery: 'acme crm',
    mentionCount: 10,
    sentimentDistribution: { positive: 40, neutral: 40, negative: 15, unknown: 5 },
    terminalAt: new Date('2026-07-12T00:00:00Z'),
    ...overrides,
  };
}

async function seed() {
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

function deps(
  loadBrandRadarScans: PulseProcessorDeps['loadBrandRadarScans'],
): PulseProcessorDeps {
  return {
    db: getTestDb() as unknown as PulseProcessorDeps['db'],
    aiVisibility: provider(),
    ports: ports(),
    resolveSite: async () => ({ siteDomain: 'example.com' }),
    loadBrandRadarScans,
    logger: fakeLogger(),
    now: NOW_A,
  };
}

beforeAll(async () => {
  await startTestPostgres();
});
afterAll(async () => {
  await stopTestPostgres();
});
beforeEach(async () => {
  await truncateAllTables();
  setBrandRadarQueue({ add: spend.queueAdd } as unknown as Queue);
});
afterEach(() => {
  setBrandRadarQueue(null);
  vi.clearAllMocks();
});

describe('runWeeklyPulse — brand-delta step', () => {
  it('records the bounded brand-delta counts and spends nothing extra', async () => {
    await seed();
    const load = vi.fn(async () => ({
      inWindow: [scan({ scanId: 'scan-2', mentionCount: 13 })],
      baselines: [
        scan({ scanId: 'scan-1', terminalAt: new Date('2026-07-01T00:00:00Z') }),
      ],
    }));
    const outcome = await runWeeklyPulse(
      deps(load),
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('completed');

    // The reader saw the run's OWN SITE over the seven-day window ending at
    // the run tick.
    expect(load).toHaveBeenCalledWith({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      windowStart: new Date('2026-07-07T12:00:00Z'),
      windowEnd: new Date('2026-07-14T12:00:00Z'),
    });

    const [row] = await getTestDb()
      .select()
      .from(weeklyPulseRuns)
      .where(eq(weeklyPulseRuns.accountId, ACCOUNT_A));
    expect(row?.counts).toMatchObject({
      brand_delta_queries: 1,
      brand_delta_new_scans: 1,
    });

    // Zero-spend proof: no Brand Radar job, no vendor cost.
    expect(spend.queueAdd).not.toHaveBeenCalled();
    expect(spend.captureVendorCost).not.toHaveBeenCalled();
  });

  it('counts the honest no-new-scan branch without a new scan', async () => {
    await seed();
    const outcome = await runWeeklyPulse(
      deps(async () => ({
        inWindow: [],
        baselines: [scan({ terminalAt: new Date('2026-07-01T00:00:00Z') })],
      })),
      { accountId: ACCOUNT_A, siteId: SITE_A, isoWeek: ISO_WEEK_A },
      NOW_A,
    );
    expect(outcome.status).toBe('completed');
    const [row] = await getTestDb()
      .select()
      .from(weeklyPulseRuns)
      .where(eq(weeklyPulseRuns.accountId, ACCOUNT_A));
    expect(row?.counts).toMatchObject({
      brand_delta_queries: 1,
      brand_delta_new_scans: 0,
    });
    expect(spend.queueAdd).not.toHaveBeenCalled();
    expect(spend.captureVendorCost).not.toHaveBeenCalled();
  });
});
