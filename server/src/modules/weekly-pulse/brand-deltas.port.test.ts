/**
 * Weekly Pulse — Brand Radar scan reader.
 *
 * Proves the read is settled-status-only, account- AND site-scoped, correctly
 * split into window / baseline, and bounded.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { BrandRadarScan } from '../brand-radar/index.js';
import {
  createBrandRadarScanPort,
  loadBrandRadarScans,
  WEEKLY_PULSE_BRAND_SCAN_READ_LIMIT,
} from './brand-deltas.port.js';

const ACCOUNT_A = new mongoose.Types.ObjectId().toHexString();
const ACCOUNT_B = new mongoose.Types.ObjectId().toHexString();
const SITE_A = new mongoose.Types.ObjectId().toHexString();
const SITE_B = new mongoose.Types.ObjectId().toHexString();
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const WINDOW_START = new Date('2026-07-07T12:00:00Z');
const WINDOW_END = new Date('2026-07-14T12:00:00Z');

async function seedScan(overrides: Record<string, unknown> = {}) {
  return BrandRadarScan.create({
    accountId: ACCOUNT_A,
    siteId: SITE_A,
    brandQuery: 'acme crm',
    status: 'completed',
    queryHash: HASH_A,
    mentionCount: 5,
    sentimentDistribution: { positive: 50, neutral: 30, negative: 15, unknown: 5 },
    terminalAt: new Date('2026-07-10T00:00:00Z'),
    ...overrides,
  });
}

beforeAll(async () => {
  await startMemoryMongo();
});
afterAll(async () => {
  await stopMemoryMongo();
});
beforeEach(async () => {
  await clearCollections();
});

describe('loadBrandRadarScans', () => {
  it('splits settled scans into the window and the pre-window baseline', async () => {
    const baseline = await seedScan({
      terminalAt: new Date('2026-07-01T00:00:00Z'),
      mentionCount: 2,
    });
    const inside = await seedScan({ mentionCount: 9 });
    const out = await loadBrandRadarScans({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    expect(out.inWindow.map((s) => s.scanId)).toEqual([String(inside._id)]);
    expect(out.inWindow[0]).toMatchObject({
      queryHash: HASH_A,
      brandQuery: 'acme crm',
      mentionCount: 9,
      sentimentDistribution: { positive: 50, neutral: 30, negative: 15, unknown: 5 },
    });
    expect(out.baselines.map((s) => s.scanId)).toEqual([String(baseline._id)]);
  });

  it('keeps only the newest pre-window scan per queryHash', async () => {
    await seedScan({ terminalAt: new Date('2026-06-01T00:00:00Z'), mentionCount: 1 });
    const newer = await seedScan({
      terminalAt: new Date('2026-07-02T00:00:00Z'),
      mentionCount: 3,
    });
    await seedScan({
      queryHash: HASH_B,
      brandQuery: 'zeta',
      terminalAt: new Date('2026-07-02T00:00:00Z'),
      mentionCount: 4,
    });
    const out = await loadBrandRadarScans({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    expect(out.baselines).toHaveLength(2);
    const forA = out.baselines.find((s) => s.queryHash === HASH_A);
    expect(forA?.scanId).toBe(String(newer._id));
  });

  it('excludes queued, running and failed scans from both reads', async () => {
    await seedScan({ status: 'queued', terminalAt: null });
    await seedScan({ status: 'running', terminalAt: null });
    await seedScan({ status: 'failed' });
    await seedScan({ status: 'failed', terminalAt: new Date('2026-07-01T00:00:00Z') });
    const out = await loadBrandRadarScans({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    expect(out.inWindow).toEqual([]);
    expect(out.baselines).toEqual([]);
  });

  it('accepts every settled status', async () => {
    await seedScan({ status: 'completed' });
    await seedScan({ status: 'completed_partial', queryHash: HASH_B, brandQuery: 'zeta' });
    await seedScan({
      status: 'completed_empty',
      queryHash: 'c'.repeat(64),
      brandQuery: 'omega',
    });
    const out = await loadBrandRadarScans({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    expect(out.inWindow).toHaveLength(3);
  });

  it('never crosses the account boundary', async () => {
    await seedScan({ accountId: ACCOUNT_B });
    await seedScan({
      accountId: ACCOUNT_B,
      terminalAt: new Date('2026-07-01T00:00:00Z'),
    });
    const out = await loadBrandRadarScans({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    expect(out.inWindow).toEqual([]);
    expect(out.baselines).toEqual([]);
  });

  it('never crosses the site boundary inside one account', async () => {
    // Same account, sibling site — invisible to this site's pulse
    //.
    await seedScan({ siteId: SITE_B });
    await seedScan({ siteId: SITE_B, terminalAt: new Date('2026-07-01T00:00:00Z') });
    const out = await loadBrandRadarScans({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    expect(out.inWindow).toEqual([]);
    expect(out.baselines).toEqual([]);
  });

  it('exposes a ready-to-inject port bag and a bounded read limit', async () => {
    await seedScan();
    const port = createBrandRadarScanPort();
    const out = await port.loadBrandRadarScans({
      accountId: ACCOUNT_A,
      siteId: SITE_A,
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    });
    expect(out.inWindow).toHaveLength(1);
    expect(WEEKLY_PULSE_BRAND_SCAN_READ_LIMIT).toBe(500);
  });
});
