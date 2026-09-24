/**
 * `BrandRadarScan` schema shape + index presence.
 *
 * The compound indexes are load-bearing: the site-scoped list (newest first
 * inside one site), the site-scoped trend linkage, the account-wide list the
 * cascades and superadmin reads still use, and the reconciliation sweep
 * reuses. A dropped index is a silent full-collection scan, so they are
 * asserted structurally rather than assumed.
 */
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  BrandRadarScan,
  BRAND_RADAR_DIGEST_STATES,
  BRAND_RADAR_DIGEST_TEXT_MAX_LENGTH,
  BRAND_RADAR_HALT_REASONS,
  BRAND_RADAR_HALT_STAGES,
  BRAND_RADAR_MAX_DIGEST_SENTENCES,
  BRAND_RADAR_MAX_RETAINED_ROWS,
  BRAND_RADAR_QUERY_MAX_LENGTH,
  BRAND_RADAR_SCAN_STATUSES,
  BRAND_RADAR_SETTLED_STATUSES,
  type BrandRadarScanDocument,
} from './brand-radar.model.js';

const HASH = 'a'.repeat(64);

function baseScan(accountId: mongoose.Types.ObjectId) {
  return {
    accountId,
    // Site scoping: a scan cannot exist without a
    // site, so every fixture carries one.
    siteId: new mongoose.Types.ObjectId(),
    brandQuery: 'Acme Corp',
    queryHash: HASH,
  };
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

describe('BrandRadarScan schema', () => {
  it('pins the terminal-state and digest-state enums', () => {
    expect([...BRAND_RADAR_SCAN_STATUSES]).toEqual([
      'queued',
      'running',
      'completed',
      'completed_empty',
      'completed_partial',
      'failed',
    ]);
    expect([...BRAND_RADAR_DIGEST_STATES]).toEqual([
      'pending',
      'digest_present',
      'digest_absent',
      'no_reliable_digest',
    ]);
    expect([...BRAND_RADAR_SETTLED_STATUSES]).toEqual([
      'completed',
      'completed_partial',
      'completed_empty',
    ]);
    // Halt contract: bounded taxonomy, never text.
    expect([...BRAND_RADAR_HALT_STAGES]).toEqual([
      'search',
      'summary',
      'brand_digest',
      'scan',
    ]);
    expect([...BRAND_RADAR_HALT_REASONS]).toEqual([
      'cost_ceiling',
      'provider_error',
      'digest_failed',
      'processing_failure',
    ]);
    expect(BRAND_RADAR_MAX_RETAINED_ROWS).toBe(1000);
    expect(BRAND_RADAR_QUERY_MAX_LENGTH).toBe(200);
  });

  it('declares the site-scoped list, trend, account-wide, and sweep indexes', () => {
    const indexes = BrandRadarScan.schema.indexes().map(([fields]) => fields);
    expect(indexes).toContainEqual({
      accountId: 1,
      siteId: 1,
      createdAt: -1,
      _id: -1,
    });
    expect(indexes).toContainEqual({
      accountId: 1,
      siteId: 1,
      queryHash: 1,
      createdAt: -1,
    });
    expect(indexes).toContainEqual({ accountId: 1, createdAt: -1, _id: -1 });
    expect(indexes).toContainEqual({ accountId: 1, status: 1, updatedAt: 1 });
    // The account-level trend index is gone — `findPriorScanId` is site-scoped.
    expect(indexes).not.toContainEqual({
      accountId: 1,
      queryHash: 1,
      createdAt: -1,
    });
  });

  it('requires siteId — a scan can never be account-only again', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const { siteId: _dropped, ...withoutSite } = baseScan(accountId);
    await expect(BrandRadarScan.create(withoutSite)).rejects.toThrow(
      /siteId/,
    );
    await expect(
      BrandRadarScan.create({ ...baseScan(accountId), siteId: null }),
    ).rejects.toThrow(/siteId/);
  });

  it('defaults status, digest state, and retained rows on create', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const scan = await BrandRadarScan.create(baseScan(accountId));
    const doc: BrandRadarScanDocument = scan.toObject();
    expect(doc.status).toBe('queued');
    expect(doc.digestState).toBe('pending');
    expect(doc.retainedRowCount).toBe(0);
    expect(doc.retainedRowIds).toEqual([]);
    expect(doc.language).toBeNull();
    expect(doc.locationCode).toBeNull();
    expect(doc.priorScanId).toBeNull();
    expect(doc.mentionSummaryId).toBeNull();
    expect(doc.terminalAt).toBeNull();
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.updatedAt).toBeInstanceOf(Date);
  });

  it('rejects a brand query over 200 characters', async () => {
    const accountId = new mongoose.Types.ObjectId();
    await expect(
      BrandRadarScan.create({
        ...baseScan(accountId),
        brandQuery: 'x'.repeat(BRAND_RADAR_QUERY_MAX_LENGTH + 1),
      }),
    ).rejects.toThrow();
  });

  it('rejects a non-sha256 query hash and an unknown status', async () => {
    const accountId = new mongoose.Types.ObjectId();
    await expect(
      BrandRadarScan.create({ ...baseScan(accountId), queryHash: 'nope' }),
    ).rejects.toThrow();
    await expect(
      BrandRadarScan.create({ ...baseScan(accountId), status: 'exploded' }),
    ).rejects.toThrow();
  });

  it('rejects more retained row ids than the 1000-row ceiling', async () => {
    const accountId = new mongoose.Types.ObjectId();
    await expect(
      BrandRadarScan.create({
        ...baseScan(accountId),
        retainedRowIds: Array.from(
          { length: BRAND_RADAR_MAX_RETAINED_ROWS + 1 },
          (_unused, index) => `row-${index}`,
        ),
      }),
    ).rejects.toThrow(/brandRadar\.errors\.tooManyRows/);
  });

  it('rejects an undeclared field (strict: throw)', async () => {
    const accountId = new mongoose.Types.ObjectId();
    await expect(
      BrandRadarScan.create({ ...baseScan(accountId), competitorQueries: ['x'] }),
    ).rejects.toThrow();
  });

  it('lowercases and bounds the ISO-639-1 language code', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const scan = await BrandRadarScan.create({
      ...baseScan(accountId),
      language: 'EN',
      locationCode: 2840,
    });
    expect(scan.language).toBe('en');
    expect(scan.locationCode).toBe(2840);
    await expect(
      BrandRadarScan.create({ ...baseScan(accountId), language: 'eng' }),
    ).rejects.toThrow();
    await expect(
      BrandRadarScan.create({ ...baseScan(accountId), locationCode: 0 }),
    ).rejects.toThrow();
  });
});

/** Deterministic aggregates + the cited digest live on the same doc. */
describe('aggregate + digest fields', () => {
  it('defaults every aggregate to an honest zero and the digest to empty', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const scan = await BrandRadarScan.create(baseScan(accountId));

    expect(scan.mentionCount).toBe(0);
    expect(scan.sentimentDistribution.positive).toBe(0);
    expect(scan.sentimentDistribution.neutral).toBe(0);
    expect(scan.sentimentDistribution.negative).toBe(0);
    expect(scan.sentimentDistribution.unknown).toBe(0);
    expect(scan.topDomains).toHaveLength(0);
    // Absent, not zero — the first scan of a series has no comparison.
    expect(scan.trendVsPrevious).toBeNull();
    expect(scan.digestSentences).toHaveLength(0);
  });

  it('stores a cited sentence and defaults a sentence with no cited ids', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const scan = await BrandRadarScan.create({
      ...baseScan(accountId),
      mentionCount: 2,
      sentimentDistribution: { positive: 50, neutral: 50, negative: 0, unknown: 0 },
      topDomains: [{ domain: 'example.com', count: 2 }],
      trendVsPrevious: -1,
      digestSentences: [
        { text: 'Coverage skews positive.', citedRowIds: ['651f1a2b3c4d5e6f708192aa'] },
        { text: 'Sentence written without a citation array.' },
      ],
    });

    expect(scan.trendVsPrevious).toBe(-1);
    expect(scan.topDomains[0]?.toObject()).toEqual({ domain: 'example.com', count: 2 });
    expect(scan.digestSentences[0]?.citedRowIds).toEqual(['651f1a2b3c4d5e6f708192aa']);
    expect(scan.digestSentences[1]?.citedRowIds).toEqual([]);
  });

  it('defaults halt to null, stores a valid halt, and rejects unknown values', async () => {
    const accountId = new mongoose.Types.ObjectId();
    const scan = await BrandRadarScan.create(baseScan(accountId));
    expect(scan.halt ?? null).toBeNull();

    scan.halt = { stage: 'summary', reason: 'cost_ceiling' };
    await scan.save();
    const reread = await BrandRadarScan.findById(scan._id);
    expect(reread?.halt?.stage).toBe('summary');
    expect(reread?.halt?.reason).toBe('cost_ceiling');

    await expect(
      BrandRadarScan.create({
        ...baseScan(accountId),
        halt: { stage: 'not-a-stage', reason: 'cost_ceiling' },
      }),
    ).rejects.toThrow();
    await expect(
      BrandRadarScan.create({
        ...baseScan(accountId),
        halt: { stage: 'summary', reason: 'because reasons' },
      }),
    ).rejects.toThrow();
  });

  it('refuses more than twenty digest sentences and over-long sentence text', async () => {
    const accountId = new mongoose.Types.ObjectId();
    await expect(
      BrandRadarScan.create({
        ...baseScan(accountId),
        digestSentences: Array.from(
          { length: BRAND_RADAR_MAX_DIGEST_SENTENCES + 1 },
          (_, index) => ({ text: `Sentence ${index}.`, citedRowIds: [] }),
        ),
      }),
    ).rejects.toThrow();

    await expect(
      BrandRadarScan.create({
        ...baseScan(accountId),
        digestSentences: [
          { text: 'x'.repeat(BRAND_RADAR_DIGEST_TEXT_MAX_LENGTH + 1), citedRowIds: [] },
        ],
      }),
    ).rejects.toThrow();
  });
});

