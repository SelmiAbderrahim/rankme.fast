/**
 * Weekly Pulse — Brand Radar delta projection (07b §3).
 *
 * The honesty contract is the point of this suite: a missing baseline yields
 * `null`, never `0`; a window without a settled scan yields the
 * "no new scan this period" branch; and the whole path is provably
 * read-only (no queue `add`, no `captureVendorCost`).
 */
import type { Queue } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CostCaptureModule from '../../shared/providers/cost-capture.js';
import {
  getBrandRadarQueue,
  setBrandRadarQueue,
} from '../brand-radar/index.js';
import {
  computeBrandDeltas,
  projectBrandDeltas,
  WEEKLY_PULSE_BRAND_DELTA_WINDOW_DAYS,
  WEEKLY_PULSE_BRAND_DELTA_WINDOW_MS,
  type BrandRadarScanFacts,
  type BrandRadarScanWindow,
} from './brand-deltas.service.js';

/**
 * Spend seams the brand-delta path must never touch. `vi.mock` keeps the
 * real implementations for every other consumer in the module graph and
 * only swaps the callable the read-only contract forbids.
 */
const spend = vi.hoisted(() => ({
  captureVendorCost: vi.fn(),
  queueAdd: vi.fn(),
}));

vi.mock('../../shared/providers/cost-capture.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CostCaptureModule>();
  return { ...actual, captureVendorCost: spend.captureVendorCost };
});

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function scan(overrides: Partial<BrandRadarScanFacts> = {}): BrandRadarScanFacts {
  return {
    scanId: 'scan-1',
    queryHash: HASH_A,
    brandQuery: 'acme crm',
    mentionCount: 10,
    sentimentDistribution: { positive: 40, neutral: 40, negative: 15, unknown: 5 },
    terminalAt: new Date('2026-07-10T00:00:00Z'),
    ...overrides,
  };
}

afterEach(() => {
  setBrandRadarQueue(null);
  vi.clearAllMocks();
});

describe('projectBrandDeltas — deltas against a comparison scan', () => {
  it('computes the mention delta and the four-way sentiment shift for a pair', () => {
    const window: BrandRadarScanWindow = {
      inWindow: [
        scan({
          scanId: 'scan-1',
          mentionCount: 10,
          sentimentDistribution: { positive: 40, neutral: 40, negative: 15, unknown: 5 },
          terminalAt: new Date('2026-07-09T00:00:00Z'),
        }),
        scan({
          scanId: 'scan-2',
          mentionCount: 14,
          sentimentDistribution: { positive: 45, neutral: 38, negative: 12, unknown: 5 },
          terminalAt: new Date('2026-07-12T00:00:00Z'),
        }),
      ],
      baselines: [],
    };
    expect(projectBrandDeltas(window)).toEqual([
      {
        queryHash: HASH_A,
        brandQuerySafe: 'acme crm',
        currentScanId: 'scan-2',
        previousScanId: 'scan-1',
        hasNewScan: true,
        newMentionCount: 4,
        sentimentShift: { positive: 5, neutral: -2, negative: -3, unknown: 0 },
      },
    ]);
  });

  it('uses the pre-window baseline when the window holds exactly one scan', () => {
    const window: BrandRadarScanWindow = {
      inWindow: [scan({ scanId: 'scan-2', mentionCount: 7 })],
      baselines: [
        scan({
          scanId: 'scan-0',
          mentionCount: 9,
          sentimentDistribution: { positive: 30, neutral: 50, negative: 20, unknown: 0 },
          terminalAt: new Date('2026-07-01T00:00:00Z'),
        }),
      ],
    };
    const [entry] = projectBrandDeltas(window);
    expect(entry).toMatchObject({
      currentScanId: 'scan-2',
      previousScanId: 'scan-0',
      hasNewScan: true,
      newMentionCount: -2,
      sentimentShift: { positive: 10, neutral: -10, negative: -5, unknown: 5 },
    });
  });

  it('emits null — never 0 — when the first scan has no baseline', () => {
    const [entry] = projectBrandDeltas({
      inWindow: [scan({ scanId: 'scan-1' })],
      baselines: [],
    });
    expect(entry?.previousScanId).toBeNull();
    expect(entry?.newMentionCount).toBeNull();
    expect(entry?.sentimentShift).toBeNull();
    expect(entry?.newMentionCount).not.toBe(0);
    expect(entry?.hasNewScan).toBe(true);
  });

  it('falls back to the honest "no new scan this period" branch', () => {
    expect(
      projectBrandDeltas({
        inWindow: [],
        baselines: [scan({ scanId: 'scan-0', terminalAt: new Date('2026-07-01T00:00:00Z') })],
      }),
    ).toEqual([
      {
        queryHash: HASH_A,
        brandQuerySafe: 'acme crm',
        currentScanId: 'scan-0',
        previousScanId: null,
        hasNewScan: false,
        newMentionCount: null,
        sentimentShift: null,
      },
    ]);
  });

  it('emits an empty section when the account has never scanned', () => {
    expect(projectBrandDeltas({ inWindow: [], baselines: [] })).toEqual([]);
  });

  it('compares the two latest in-window scans and ignores the pre-window one', () => {
    const window: BrandRadarScanWindow = {
      inWindow: [
        scan({ scanId: 'scan-1', mentionCount: 1, terminalAt: new Date('2026-07-08T00:00:00Z') }),
        scan({ scanId: 'scan-3', mentionCount: 9, terminalAt: new Date('2026-07-13T00:00:00Z') }),
        scan({ scanId: 'scan-2', mentionCount: 5, terminalAt: new Date('2026-07-11T00:00:00Z') }),
      ],
      baselines: [
        scan({ scanId: 'scan-0', mentionCount: 100, terminalAt: new Date('2026-07-01T00:00:00Z') }),
      ],
    };
    expect(projectBrandDeltas(window)[0]).toMatchObject({
      currentScanId: 'scan-3',
      previousScanId: 'scan-2',
      newMentionCount: 4,
    });
  });

  it('breaks a terminalAt tie on scanId ascending', () => {
    const at = new Date('2026-07-12T00:00:00Z');
    const window: BrandRadarScanWindow = {
      inWindow: [
        scan({ scanId: 'scan-b', mentionCount: 8, terminalAt: at }),
        scan({ scanId: 'scan-a', mentionCount: 3, terminalAt: at }),
      ],
      baselines: [],
    };
    expect(projectBrandDeltas(window)[0]).toMatchObject({
      currentScanId: 'scan-b',
      previousScanId: 'scan-a',
      newMentionCount: 5,
    });
    // Same tie, opposite input order — the winner must not depend on it.
    expect(
      projectBrandDeltas({ inWindow: [...window.inWindow].reverse(), baselines: [] })[0],
    ).toMatchObject({
      currentScanId: 'scan-b',
      previousScanId: 'scan-a',
      newMentionCount: 5,
    });
  });

  it('keeps only the latest of several pre-window baselines for one query', () => {
    const [entry] = projectBrandDeltas({
      inWindow: [scan({ scanId: 'scan-2', mentionCount: 10 })],
      baselines: [
        scan({ scanId: 'scan-0', mentionCount: 1, terminalAt: new Date('2026-06-01T00:00:00Z') }),
        scan({ scanId: 'scan-1', mentionCount: 4, terminalAt: new Date('2026-07-01T00:00:00Z') }),
      ],
    });
    expect(entry).toMatchObject({ previousScanId: 'scan-1', newMentionCount: 6 });
  });

  it('orders by brandQuery then queryHash regardless of input order', () => {
    const shared = { mentionCount: 1, terminalAt: new Date('2026-07-12T00:00:00Z') };
    const out = projectBrandDeltas({
      inWindow: [
        scan({ ...shared, scanId: 's-z', queryHash: HASH_C, brandQuery: 'zeta' }),
        scan({ ...shared, scanId: 's-b', queryHash: HASH_B, brandQuery: 'acme crm' }),
        scan({ ...shared, scanId: 's-a', queryHash: HASH_A, brandQuery: 'acme crm' }),
      ],
      baselines: [],
    });
    expect(out.map((d) => [d.brandQuerySafe, d.queryHash])).toEqual([
      ['acme crm', HASH_A],
      ['acme crm', HASH_B],
      ['zeta', HASH_C],
    ]);
  });
});

describe('computeBrandDeltas — port-driven, zero spend', () => {
  it('passes the window through to the port and projects the result', async () => {
    const loadBrandRadarScans = vi.fn(
      async (): Promise<BrandRadarScanWindow> => ({
        inWindow: [scan({ scanId: 'scan-2', mentionCount: 12 })],
        baselines: [
          scan({ scanId: 'scan-1', mentionCount: 10, terminalAt: new Date('2026-07-01T00:00:00Z') }),
        ],
      }),
    );
    const windowEnd = new Date('2026-07-14T12:00:00Z');
    const windowStart = new Date(windowEnd.getTime() - WEEKLY_PULSE_BRAND_DELTA_WINDOW_MS);
    const out = await computeBrandDeltas(
      { ports: { loadBrandRadarScans } },
      { accountId: 'acct-1', siteId: 'site-1', windowStart, windowEnd },
    );
    expect(loadBrandRadarScans).toHaveBeenCalledWith({
      accountId: 'acct-1',
      siteId: 'site-1',
      windowStart,
      windowEnd,
    });
    expect(out[0]).toMatchObject({ newMentionCount: 2 });
  });

  it('never enqueues a scan or captures a vendor cost', async () => {
    setBrandRadarQueue({ add: spend.queueAdd } as unknown as Queue);
    expect(getBrandRadarQueue()).not.toBeNull();
    await computeBrandDeltas(
      {
        ports: {
          loadBrandRadarScans: async () => ({
            inWindow: [scan({ scanId: 'scan-2' })],
            baselines: [scan({ scanId: 'scan-1', terminalAt: new Date('2026-07-01T00:00:00Z') })],
          }),
        },
      },
      {
        accountId: 'acct-1',
        siteId: 'site-1',
        windowStart: new Date('2026-07-07T12:00:00Z'),
        windowEnd: new Date('2026-07-14T12:00:00Z'),
      },
    );
    expect(spend.captureVendorCost).not.toHaveBeenCalled();
    expect(spend.queueAdd).not.toHaveBeenCalled();
  });

  it('pins the seven-day comparison window', () => {
    expect(WEEKLY_PULSE_BRAND_DELTA_WINDOW_DAYS).toBe(7);
    expect(WEEKLY_PULSE_BRAND_DELTA_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
