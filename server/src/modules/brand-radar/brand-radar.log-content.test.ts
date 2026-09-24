/**
 * Spec 07a-4 — Brand Radar log-content guarantee.
 *
 * The redaction list in `config/logger.ts` is the safety net; this suite is the
 * primary guard. It drives the WHOLE pipeline (processor envelope → search →
 * summary → `brand_digest` AI pass → failure → reconciliation sweep) against
 * fakes through a REAL pino logger writing to an in-memory stream, then greps
 * every emitted byte for:
 *
 *   - the customer's brand query,
 *   - a retained mention snippet / title / URL (the vendor envelope),
 *   - the generated digest sentence text,
 *   - the AI prompt (system instruction + sanitized input) sent to the model.
 *
 * The AI prompt is captured separately and asserted to CONTAIN the snippet, so
 * the grep cannot pass vacuously: the content really did flow through the run,
 * it simply never reached a log sink.
 */
import type { Job, Queue } from 'bullmq';
import mongoose from 'mongoose';
import { pino, type Logger } from 'pino';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDACTION_PATHS } from '../../config/logger.js';
import type { Db } from '../../db/client.js';
import { createAiProfileRunner } from '../../shared/ai-profiles/index.js';
import type {
  AiGenerationProvider,
  AiGenerationResult,
  GenerateStructuredInput,
} from '../../shared/providers/ai-generation.js';
import { recordVendorCostUsd } from '../../shared/providers/cost-capture.js';
import { VendorTimeoutError } from '../../shared/providers/errors.js';
import type {
  ContentAnalysisMentionRow,
  ContentAnalysisProvider,
} from '../../shared/providers/types.js';
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
import { User } from '../users/users.model.js';
import { BrandRadarScan } from './brand-radar.model.js';
import { createBrandRadarProcessor } from './brand-radar.processor.js';
import { runBrandRadarReconciliationSweep } from './brand-radar.reconciliation.js';

/**
 * Sentinels. Every one is a value the run genuinely handles, written so a
 * substring grep cannot collide with an unrelated log token.
 */
const BRAND_QUERY = 'Zenith-Widgets-brand-query-sentinel';
const SNIPPET = 'snippet-sentinel-zenith-widgets-launch-coverage';
const TITLE = 'title-sentinel-zenith-in-the-press';
const MENTION_URL = 'https://vendor-envelope-sentinel.example.com/zenith';
const DIGEST_TEXT = 'digest-sentence-sentinel-about-zenith-widgets';
const CONTENT_SENTINELS = [BRAND_QUERY, SNIPPET, TITLE, MENTION_URL, DIGEST_TEXT];

const ACCOUNT = new mongoose.Types.ObjectId().toString();
const SITE = new mongoose.Types.ObjectId().toString();
const TERMINAL_AT = new Date('2026-03-01T00:00:00.000Z');
const RECON_NOW = new Date('2026-03-01T12:00:00.000Z');
const FAKE_ORDER = ['fake'] as const;

const ROW: ContentAnalysisMentionRow = {
  url: MENTION_URL,
  domain: 'vendor-envelope-sentinel.example.com',
  title: TITLE,
  snippet: SNIPPET,
  sentiment: { polarity: 'positive', confidence: 0.9 },
  language: 'en',
  observedAt: null,
};

let db: Db;
let sink: { logger: Logger; output: () => string };
let prompts: string[];

/** Real pino instance over an in-memory stream, built from the shipped paths. */
function captureLogger(): { logger: Logger; output: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    logger: pino(
      { level: 'trace', redact: { paths: [...REDACTION_PATHS], censor: '[redacted]' } },
      stream,
    ),
    output: () => chunks.join(''),
  };
}

/**
 * AI provider that records the prompt it was handed and answers with a
 * sentinel digest sentence citing the REAL retained row ids, so the digest
 * survives citation-or-drop and lands on the scan document.
 */
function capturingAiProvider(): AiGenerationProvider {
  return {
    async generateStructured<T extends object>(
      input: GenerateStructuredInput<T>,
    ): Promise<AiGenerationResult<T>> {
      prompts.push(input.sanitizedInput, JSON.stringify(input.systemInstruction));
      // The runner wraps the payload in `<untrusted_customer_data>` fences.
      const json = input.sanitizedInput.replace(/<\/?untrusted_customer_data>/gu, '');
      const mentions = (JSON.parse(json) as { mentions: { id: string }[] }).mentions;
      const parsed = input.validationSchema.parse({
        digestSentences: [
          { text: DIGEST_TEXT, citedRowIds: mentions.map((mention) => mention.id) },
        ],
        citations: [],
      });
      return {
        trust: 'untrusted',
        object: parsed,
        provider: 'fake',
        model: 'log-content-stub',
        finishReason: 'stop',
        tokens: { input: null, output: null, cachedInput: null, reasoning: null },
        latencyMs: 0,
        attempts: [],
        configuredEstimateCostMicros: 0n,
        actualCostMicros: 6_000n,
        actualOrEstimatedCostMicros: 6_000n,
        warnings: [],
      };
    },
  };
}

function provider(searchError?: unknown): ContentAnalysisProvider {
  return {
    async searchMentions() {
      recordVendorCostUsd(0.06);
      if (searchError) throw searchError;
      return [ROW];
    },
    async getMentionSummary() {
      recordVendorCostUsd(0.045);
      return {
        totalMentions: 1,
        distribution: { positive: 1, neutral: 0, negative: 0 },
        topDomains: [{ domain: ROW.domain, mentions: 1 }],
      };
    },
  };
}

function processorWith(p: ContentAnalysisProvider) {
  return createBrandRadarProcessor({
    db,
    provider: p,
    logger: sink.logger,
    now: () => TERMINAL_AT,
    ai: createAiProfileRunner({ provider: capturingAiProvider() }),
    aiProviderOrder: FAKE_ORDER,
  });
}

function jobFor(scanId: string, accountId = ACCOUNT): Job<BrandRadarScanJob> {
  return {
    data: { accountId, siteId: SITE, scanId, outputLocale: 'en' },
    name: 'brand-radar-scan',
  } as Job<BrandRadarScanJob>;
}

async function seedScan(
  status: 'queued' | 'running' | 'completed' = 'queued',
  updatedAt?: Date,
): Promise<string> {
  const scan = await BrandRadarScan.create({
    accountId: ACCOUNT,
    siteId: SITE,
    brandQuery: BRAND_QUERY,
    language: 'en',
    outputLocale: 'en',
    status,
    queryHash: 'd'.repeat(64),
  });
  if (updatedAt) {
    await BrandRadarScan.collection.updateOne(
      { _id: scan._id },
      { $set: { updatedAt } },
    );
  }
  return String(scan._id);
}

beforeAll(async () => {
  await startMemoryMongo();
  db = (await startTestPostgres()) as unknown as Db;
});

afterAll(async () => {
  await stopTestPostgres();
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
  await truncateAllTables();
  vi.clearAllMocks();
  sink = captureLogger();
  prompts = [];
  // Scans are site-scoped, so the reconciliation sweep runs under the account
  // + site work leases; both rows must exist for it to acquire them.
  await User.create({
    _id: new mongoose.Types.ObjectId(ACCOUNT),
    email: 'brand-radar-log-content@example.com',
    emailVerified: true,
  });
  await Site.create({
    _id: new mongoose.Types.ObjectId(SITE),
    accountId: new mongoose.Types.ObjectId(ACCOUNT),
    url: 'https://brand-log.example.com',
    domain: 'brand-log.example.com',
  });
});

describe('brand-radar log content', () => {
  it('leaks no query, snippet, digest sentence, vendor envelope, or AI prompt', async () => {
    // 1. Full success run: search → summary → brand_digest.
    const scanId = await seedScan();
    await processorWith(provider())(jobFor(scanId));
    const settled = await BrandRadarScan.findById(scanId);
    expect(settled?.status).toBe('completed');
    // The digest really was generated from the retained rows...
    expect(settled?.digestState).toBe('digest_present');
    expect(settled?.digestSentences[0]?.text).toBe(DIGEST_TEXT);
    // ...and the prompt really carried the mention text.
    expect(prompts.join('|')).toContain(SNIPPET);
    expect(prompts.join('|')).toContain(TITLE);

    // 2. Replay of a terminal scan → the info branch.
    await processorWith(provider())(jobFor(scanId));

    // 3. Missing scan → the warn branch.
    await processorWith(provider())(jobFor(new mongoose.Types.ObjectId().toString()));

    // 4. Failure branch: search dies with zero retained rows.
    const failedScanId = await seedScan();
    await processorWith(
      provider(
        new VendorTimeoutError('slow', {
          provider: 'fake',
          operation: 'content-analysis',
        }),
      ),
    )(jobFor(failedScanId));
    expect((await BrandRadarScan.findById(failedScanId))?.status).toBe('failed');

    // 5. Reconciliation: an orphaned scan (re-enqueue warn) and a
    //    stalled run (marked-failed warn).
    await seedScan('queued', new Date(RECON_NOW.getTime() - 20 * 60 * 1000));
    await seedScan('running', new Date(RECON_NOW.getTime() - 5 * 60 * 60 * 1000));
    const sweep = await runBrandRadarReconciliationSweep({
      db,
      logger: sink.logger,
      queue: {
        getJob: vi.fn().mockResolvedValue(null),
        add: vi.fn().mockResolvedValue({ id: 'job' }),
      } as unknown as Queue,
      now: () => RECON_NOW,
    });
    expect(sweep).toMatchObject({ reEnqueued: 1, markedFailed: 1 });

    // Every branch above emitted at least one line...
    const output = sink.output();
    expect(output).toContain('brand-radar processor: terminal scan on replay; no-op');
    expect(output).toContain('brand-radar processor: scan not found; dropping job');
    expect(output).toContain(
      'brand-radar processor: scan failed with no retained evidence',
    );
    expect(output).toContain(
      'brand-radar reconciliation: orphaned scan; re-enqueued',
    );
    expect(output).toContain('brand-radar reconciliation: stalled scan; marked failed');

    // ...and none of them carried customer or vendor content.
    for (const sentinel of CONTENT_SENTINELS) {
      expect(output).not.toContain(sentinel);
    }
    for (const prompt of prompts) {
      expect(output).not.toContain(prompt);
    }
  });

  it('keeps the three Brand Radar content fields on the redaction list', () => {
    for (const path of ['brandQuery', 'mentionSnippet', 'digestSentenceText']) {
      expect(REDACTION_PATHS).toContain(path);
      expect(REDACTION_PATHS).toContain(`*.${path}`);
    }
  });
});
