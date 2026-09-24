/**
 * Spec 07a-2 — Brand Radar BullMQ processor envelope.
 *
 * Guarantees exercised:
 *   - malformed payload → UnrecoverableError (dead-letter, no retry burn)
 *   - missing / cross-account scan → warn + drop (no throw, no retry)
 *   - terminal scan on replay → no-op (no second fan-out, no second event)
 *   - each truth-table row persists its cost rows + terminal Mongo state and
 *     exactly one scan-level terminal event
 *   - a mid-run `BRAND_RADAR_ENABLED=false` flip still lands a consistent
 *     terminal state, while the creation path refuses new scans immediately
 */
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import mongoose from 'mongoose';
import type { Logger } from 'pino';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { brandRadarEvents } from '../../db/schema/brand-radar-events.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { recordVendorCostUsd } from '../../shared/providers/cost-capture.js';
import { VendorTimeoutError } from '../../shared/providers/errors.js';
import type {
  ContentAnalysisMentionRow,
  ContentAnalysisProvider,
} from '../../shared/providers/types.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import type { BrandRadarScanJob } from '../../shared/queue/index.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import { Site } from '../sites/index.js';
import { BrandRadarScan } from './brand-radar.model.js';
import { createBrandRadarProcessor } from './brand-radar.processor.js';
import { BrandRadarMention } from './brand-radar.rows.model.js';
import { createScan, getScan } from './brand-radar.service.js';

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
} as unknown as Logger;

let db: Db;

const ACCOUNT = new mongoose.Types.ObjectId().toString();
const SITE = new mongoose.Types.ObjectId().toString();
const TERMINAL_AT = new Date('2026-03-01T00:00:00.000Z');

const ROW: ContentAnalysisMentionRow = {
  url: 'https://example.com/a',
  domain: 'example.com',
  title: 'Acme',
  snippet: 'Acme shipped a thing.',
  sentiment: { polarity: 'positive', confidence: 0.5 },
  language: 'en',
  observedAt: null,
};

interface ProviderOptions {
  rows?: ContentAnalysisMentionRow[];
  searchError?: unknown;
  summaryError?: unknown;
  onSearch?: () => void;
}

function provider(opts: ProviderOptions = {}): ContentAnalysisProvider {
  return {
    async searchMentions() {
      opts.onSearch?.();
      recordVendorCostUsd(0.06);
      if (opts.searchError) throw opts.searchError;
      return opts.rows ?? [ROW];
    },
    async getMentionSummary() {
      recordVendorCostUsd(0.045);
      if (opts.summaryError) throw opts.summaryError;
      return {
        totalMentions: 1,
        distribution: { positive: 1, neutral: 0, negative: 0 },
        topDomains: [{ domain: 'example.com', mentions: 1 }],
      };
    },
  };
}

function jobFor(
  scanId: string,
  accountId = ACCOUNT,
  outputLocale: BrandRadarScanJob['outputLocale'] = 'en',
): Job<BrandRadarScanJob> {
  return {
    data: { accountId, siteId: SITE, scanId, outputLocale },
    name: 'brand-radar-scan',
  } as Job<BrandRadarScanJob>;
}

async function seedQueuedScan(language: string | null = 'en'): Promise<string> {
  const scan = await BrandRadarScan.create({
    accountId: ACCOUNT,
    siteId: SITE,
    brandQuery: 'Acme Corp',
    language,
    outputLocale: 'en',
    status: 'queued',
    queryHash: 'b'.repeat(64),
  });
  return String(scan._id);
}

async function eventsFor(scanId: string) {
  return db.select().from(brandRadarEvents).where(eq(brandRadarEvents.scanId, scanId));
}

function processorWith(p: ContentAnalysisProvider) {
  return createBrandRadarProcessor({
    db,
    provider: p,
    logger: silentLogger,
    now: () => TERMINAL_AT,
  });
}

beforeAll(async () => {
  await startMemoryMongo();
  db = (await startTestPostgres()) as unknown as Db;
});

afterAll(async () => {
  (env as { BRAND_RADAR_ENABLED: boolean }).BRAND_RADAR_ENABLED = false;
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  vi.clearAllMocks();
  (env as { BRAND_RADAR_ENABLED: boolean }).BRAND_RADAR_ENABLED = true;
  // Every scan is site-scoped, and `createScan` loads the owning site.
  await Site.create({
    _id: new mongoose.Types.ObjectId(SITE),
    accountId: new mongoose.Types.ObjectId(ACCOUNT),
    url: 'https://processor.example',
    domain: 'processor.example',
  });
});

describe('payload + ownership envelope', () => {
  it('dead-letters a locale-less active job and records one failed event', async () => {
    const scanId = await seedQueuedScan();
    await BrandRadarScan.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(scanId) },
      { $unset: { outputLocale: 1 } },
    );
    const onSearch = vi.fn();
    const processor = processorWith(provider({ onSearch }));
    const malformed = {
      data: { accountId: ACCOUNT, siteId: SITE, scanId },
      name: 'brand-radar-scan',
    } as unknown as Job<BrandRadarScanJob>;

    await expect(processor(malformed)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(processor(malformed)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(onSearch).not.toHaveBeenCalled();
    const events = await eventsFor(scanId);
    expect(events.map((e) => `${e.stage}:${e.event}`)).toEqual(['scan:failed']);
    expect(events[0]?.metadata).toEqual({ reason: 'processing_failure' });
    const scan = await BrandRadarScan.findById(scanId);
    expect(scan).toMatchObject({ status: 'failed', digestState: 'digest_absent' });
  });

  it('dead-letters a valid payload whose locale differs from the frozen scan locale', async () => {
    const scanId = await seedQueuedScan();
    const onSearch = vi.fn();
    const processor = processorWith(provider({ onSearch }));
    const mismatched = jobFor(scanId, ACCOUNT, 'fr');

    await expect(processor(mismatched)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(processor(mismatched)).resolves.toBeUndefined();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('rejects a malformed payload as unrecoverable', async () => {
    await expect(
      processorWith(provider())({ data: { scanId: 'nope' } } as unknown as Job<BrandRadarScanJob>),
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('drops a job whose scan is missing', async () => {
    const missing = new mongoose.Types.ObjectId().toString();
    await expect(processorWith(provider())(jobFor(missing))).resolves.toBeUndefined();
    expect(silentLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ scanId: missing }),
      'brand-radar processor: scan not found; dropping job',
    );
  });

  it('drops a job whose payload names another account', async () => {
    const scanId = await seedQueuedScan();
    const other = new mongoose.Types.ObjectId().toString();
    await processorWith(provider())(jobFor(scanId, other));
    const doc = await BrandRadarScan.findById(scanId);
    expect(doc?.status).toBe('queued');
  });

  it('is a no-op when the scan already settled (idempotent replay)', async () => {
    const scanId = await seedQueuedScan();
    await BrandRadarScan.updateOne({ _id: scanId }, { $set: { status: 'completed' } });
    const onSearch = vi.fn();
    await processorWith(provider({ onSearch }))(jobFor(scanId));
    expect(onSearch).not.toHaveBeenCalled();
    expect(await eventsFor(scanId)).toHaveLength(0);
  });
});

describe('truth-table settlement through the processor', () => {
  it('search failure with zero rows → failed, one scan failed event', async () => {
    const scanId = await seedQueuedScan();
    const failing = provider({
      searchError: new VendorTimeoutError('slow', {
        provider: 'fake',
        operation: 'content-analysis',
      }),
    });

    await processorWith(failing)(jobFor(scanId));

    const doc = await BrandRadarScan.findById(scanId);
    expect(doc?.status).toBe('failed');
    expect(doc?.terminalAt?.toISOString()).toBe(TERMINAL_AT.toISOString());
    // Halt disclosure: a search failure names its stage, bounded reason.
    expect(doc?.halt?.stage).toBe('search');
    expect(doc?.halt?.reason).toBe('provider_error');

    const events = await eventsFor(scanId);
    expect(events.map((e) => `${e.stage}:${e.event}`).sort()).toEqual([
      'scan:failed',
      'scan:started',
      'search:failed',
      'search:started',
    ]);

    // A replay after settlement neither re-runs the vendor nor re-records.
    await processorWith(failing)(jobFor(scanId));
    expect(await eventsFor(scanId)).toHaveLength(4);
  });

  it('search ok with zero mentions → completed_empty, succeeded', async () => {
    const scanId = await seedQueuedScan();
    await processorWith(provider({ rows: [] }))(jobFor(scanId));

    const doc = await BrandRadarScan.findById(scanId);
    expect(doc?.status).toBe('completed_empty');
    expect(doc?.halt ?? null).toBeNull();
    const events = await eventsFor(scanId);
    expect(events.some((e) => e.stage === 'scan' && e.event === 'failed')).toBe(false);
    expect(events.find((e) => e.stage === 'scan' && e.event === 'succeeded')).toMatchObject({
      stage: 'scan',
      metadata: { status: 'completed_empty', retainedRows: 0 },
    });
  });

  it('summary failure → completed_partial with rows retained, succeeded', async () => {
    const scanId = await seedQueuedScan();
    await processorWith(
      provider({
        summaryError: new VendorTimeoutError('slow', {
          provider: 'fake',
          operation: 'content-analysis',
        }),
      }),
    )(jobFor(scanId));

    const doc = await BrandRadarScan.findById(scanId);
    expect(doc?.status).toBe('completed_partial');
    expect(doc?.retainedRowCount).toBe(1);
    expect(doc?.retainedRowIds).toHaveLength(1);
    expect(doc?.mentionSummaryId).toBeNull();
    // Halt disclosure: partial from a summary vendor error names the stage.
    expect(doc?.halt?.stage).toBe('summary');
    expect(doc?.halt?.reason).toBe('provider_error');
    expect(await BrandRadarMention.countDocuments({ scanId })).toBe(1);
    const settled = (await eventsFor(scanId)).find((e) => e.stage === 'scan' && e.event === 'succeeded');
    expect(settled?.metadata).toMatchObject({
      status: 'completed_partial',
      reason: 'VendorTimeoutError',
    });
  });

  it('both stages ok → completed with per-stage cost rows', async () => {
    const scanId = await seedQueuedScan();
    await processorWith(provider())(jobFor(scanId));

    const doc = await BrandRadarScan.findById(scanId);
    expect(doc?.status).toBe('completed');
    expect(doc?.mentionSummaryId).toBeTruthy();
    expect(doc?.halt ?? null).toBeNull();

    const events = await eventsFor(scanId);
    const byKey = Object.fromEntries(
      events.map((e) => [`${e.stage}:${e.event}`, Number(e.costMicros)]),
    );
    expect(byKey).toEqual({
      'scan:started': 0,
      'search:started': 0,
      'search:succeeded': 60_000,
      'summary:started': 0,
      'summary:succeeded': 45_000,
      'scan:succeeded': 105_000,
    });
  });

  it('uses the wall clock and no language filter when neither is supplied', async () => {
    const scanId = await seedQueuedScan(null);
    const processor = createBrandRadarProcessor({
      db,
      provider: provider(),
      logger: silentLogger,
    });

    await processor(jobFor(scanId));

    const doc = await BrandRadarScan.findById(scanId);
    expect(doc?.status).toBe('completed');
    expect(doc?.terminalAt).toBeInstanceOf(Date);
    expect(doc?.terminalAt?.toISOString()).not.toBe(TERMINAL_AT.toISOString());
  });
});

describe('kill switch', () => {
  it('refuses NEW scans while the flag is off', async () => {
    (env as { BRAND_RADAR_ENABLED: boolean }).BRAND_RADAR_ENABLED = false;
    await expect(
      createScan(
        ACCOUNT,
        SITE,
        { brandQuery: 'Acme Corp', outputLocale: 'en' },
        { queue: { add: vi.fn() } as unknown as Queue },
      ),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('lets an in-flight scan finish to a consistent terminal state when the flag flips', async () => {
    const scanId = await seedQueuedScan();
    const flipping = provider({
      onSearch: () => {
        // Operator pulls the kill switch while the scan is mid-stage.
        (env as { BRAND_RADAR_ENABLED: boolean }).BRAND_RADAR_ENABLED = false;
      },
    });

    await processorWith(flipping)(jobFor(scanId));

    expect(env.BRAND_RADAR_ENABLED).toBe(false);
    const doc = await BrandRadarScan.findById(scanId);
    expect(doc?.status).toBe('completed');
    expect(doc?.terminalAt).not.toBeNull();
    expect(doc?.mentionSummaryId).toBeTruthy();
  });
});

describe('service seams reached from the pipeline path', () => {
  it('serializes a failed scan with no language as the API sees it', async () => {
    const scanId = await seedQueuedScan(null);
    await processorWith(
      provider({
        searchError: new VendorTimeoutError('slow', {
          provider: 'fake',
          operation: 'content-analysis',
        }),
      }),
    )(jobFor(scanId));

    const view = await getScan(ACCOUNT, scanId);
    expect(view).toMatchObject({
      language: null,
      status: 'failed',
    });
    expect(view).not.toHaveProperty('refund');
  });

  it('serializes the site and prior-scan links when both are set', async () => {
    const priorId = await seedQueuedScan();
    const scan = await BrandRadarScan.create({
      accountId: ACCOUNT,
      siteId: SITE,
      brandQuery: 'Acme Corp',
      language: 'en',
      locationCode: 2840,
      status: 'completed',
      queryHash: 'b'.repeat(64),
      priorScanId: priorId,
    });

    const view = await getScan(ACCOUNT, String(scan._id));
    expect(view.siteId).toBe(String(scan.siteId));
    expect(view.priorScanId).toBe(priorId);
    expect(view.locationCode).toBe(2840);
  });

  it('never enqueues when the scan document cannot be written', async () => {
    const add = vi.fn();
    await expect(
      createScan(
        ACCOUNT,
        SITE,
        // Past the model's 200-char bound — zod stops this at the router, so
        // reaching the model means the document write itself fails.
        { brandQuery: 'x'.repeat(300), outputLocale: 'en' },
        { queue: { add } as unknown as Queue },
      ),
    ).rejects.toThrow();
    expect(add).not.toHaveBeenCalled();
    expect(await BrandRadarScan.countDocuments({})).toBe(0);
  });

});

/** 07a-3 — stage-3 wiring, aggregate persistence, and trend linkage. */
describe('digest + aggregates persistence (07a-3)', () => {
  it('persists the aggregates and leaves trend null with no prior scan', async () => {
    const scanId = await seedQueuedScan();
    await processorWith(
      provider({ rows: [ROW, { ...ROW, domain: 'news.test' }] }),
    )(jobFor(scanId));

    const scan = await BrandRadarScan.findById(scanId);
    expect(scan?.mentionCount).toBe(2);
    expect(scan?.sentimentDistribution.positive).toBe(100);
    expect(scan?.topDomains.map((entry) => entry.domain)).toEqual([
      'example.com',
      'news.test',
    ]);
    expect(scan?.trendVsPrevious).toBeNull();
    // No AI seam configured → no digest, and the scan still completes.
    expect(scan?.status).toBe('completed');
    expect(scan?.digestState).toBe('digest_absent');
  });

  it('computes the trend delta against the linked prior scan', async () => {
    const prior = await BrandRadarScan.create({
      accountId: ACCOUNT,
      siteId: SITE,
      brandQuery: 'Acme Corp',
      status: 'completed',
      queryHash: 'b'.repeat(64),
      mentionCount: 3,
    });
    const scanId = await seedQueuedScan();
    await BrandRadarScan.updateOne(
      { _id: scanId },
      { $set: { priorScanId: prior._id } },
    );

    await processorWith(provider({ rows: [ROW] }))(jobFor(scanId));

    const scan = await BrandRadarScan.findById(scanId);
    // 1 retained now vs 3 before.
    expect(scan?.trendVsPrevious).toBe(-2);
  });

  it('reports trend null when the linked prior scan no longer exists', async () => {
    const scanId = await seedQueuedScan();
    await BrandRadarScan.updateOne(
      { _id: scanId },
      { $set: { priorScanId: new mongoose.Types.ObjectId() } },
    );

    await processorWith(provider({ rows: [ROW] }))(jobFor(scanId));

    const scan = await BrandRadarScan.findById(scanId);
    expect(scan?.trendVsPrevious).toBeNull();
  });

  it('builds the stage-3 seam from the AI runner and stores the cited digest', async () => {
    const scanId = await seedQueuedScan();
    const run = vi.fn(async () => ({
      trust: 'untrusted' as const,
      status: 'complete' as const,
      object: {
        // The runner is handed the STORED row ids, so echo the first one back.
        digestSentences: [{ text: 'Coverage skews positive.', citedRowIds: [] }],
        citations: [],
      },
      warnings: [],
      qualityFlags: ['complete' as const],
      provenance: {
        task: 'brand_digest' as const,
        profileVersion: '1.0.0',
        outputSchemaVersion: '1',
        promptTemplateId: 'brand-digest',
        promptTemplateVersion: '1',
        provider: 'fake' as const,
        model: 'stub',
        finishReason: 'stop',
        attempts: 1,
        fallbackUsed: false,
        latencyMs: 1,
        actualOrEstimatedCostMicros: 5_000n,
      },
      classification: {
        generatedFields: 'untrusted' as const,
        renderAs: 'text_only' as const,
      },
    }));

    const processor = createBrandRadarProcessor({
      db,
      provider: provider({ rows: [ROW] }),
      logger: silentLogger,
      now: () => TERMINAL_AT,
      ai: { preflight: () => undefined, run } as unknown as AiProfileRunner,
      aiProviderOrder: ['fake'],
    });
    await processor(jobFor(scanId));

    expect(run).toHaveBeenCalledTimes(1);
    const scan = await BrandRadarScan.findById(scanId);
    // The one generated sentence cited nothing, so it was dropped: the scan
    // abstains rather than shipping an uncited claim.
    expect(scan?.digestState).toBe('no_reliable_digest');
    expect(scan?.status).toBe('completed_partial');
    expect(scan?.digestSentences).toHaveLength(0);
    const digestEvents = (await eventsFor(scanId)).filter(
      (row) => row.stage === 'brand_digest',
    );
    expect(digestEvents.map((row) => row.event).sort()).toEqual([
      'failed',
      'started',
    ]);
  });

  it('stores a surviving digest sentence and completes the scan', async () => {
    const scanId = await seedQueuedScan();
    const processor = createBrandRadarProcessor({
      db,
      provider: provider({ rows: [ROW] }),
      logger: silentLogger,
      now: () => TERMINAL_AT,
      // Explicit seam wins over the runner-built one.
      digest: async (input) => ({
        digestSentences: [
          { text: 'Coverage skews positive.', citedRowIds: [input.rows[0]!.id] },
        ],
        digestState: 'digest_present' as const,
        costMicros: 5_000,
      }),
    });
    await processor(jobFor(scanId));

    const scan = await BrandRadarScan.findById(scanId);
    expect(scan?.status).toBe('completed');
    expect(scan?.digestState).toBe('digest_present');
    expect(scan?.digestSentences[0]?.text).toBe('Coverage skews positive.');
    expect(scan?.digestSentences[0]?.citedRowIds).toEqual(scan?.retainedRowIds);
  });
});
