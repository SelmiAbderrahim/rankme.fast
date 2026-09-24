/**
 * Spec 07a-3 — Brand Radar pipeline stage 3 (`brand_digest`).
 *
 * The rows this sub-prompt adds to the spec 07a truth table:
 *
 *   search ok, ≥1 row, summary ok, AI ok              → `completed`
 *   search ok, ≥1 row, summary ok, every sentence dropped
 *                                                     → `completed_partial`
 *                                                       (`no_reliable_digest`)
 *   search ok, ≥1 row, summary ok, AI VendorError     → `completed_partial`
 *                                                       (`digest_absent`)
 *   search ok, ≥1 row, summary ok, AI budget-halt     → `completed_partial`
 *                                                       (`digest_absent`)
 *
 * None of them fails the scan — the retained mentions are on disk.
 * Also pins the stage-3 rolling-ceiling probe at its exact boundary and the
 * deterministic aggregates computed over the STORED rows.
 */
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordVendorCostUsd } from '../../shared/providers/cost-capture.js';
import type {
  ContentAnalysisMentionRow,
  ContentAnalysisMentionSummary,
  ContentAnalysisProvider,
} from '../../shared/providers/types.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import type { BrandRadarDigestResult } from './brand-radar.digest.js';
import { runBrandRadarPipeline } from './brand-radar.pipeline.js';

const ACCOUNT = new mongoose.Types.ObjectId().toString();
const SCAN = new mongoose.Types.ObjectId().toString();
const SITE = new mongoose.Types.ObjectId().toString();

function mentionRow(
  overrides: Partial<ContentAnalysisMentionRow> = {},
): ContentAnalysisMentionRow {
  return {
    url: 'https://example.com/post',
    domain: 'example.com',
    title: 'Acme in the news',
    snippet: 'Acme shipped a thing.',
    sentiment: { polarity: 'positive', confidence: 0.8 },
    language: 'en',
    observedAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

const SUMMARY: ContentAnalysisMentionSummary = {
  totalMentions: 2,
  distribution: { positive: 1, neutral: 1, negative: 0 },
  topDomains: [{ domain: 'example.com', mentions: 2 }],
};

function stubProvider(opts: {
  rows?: ContentAnalysisMentionRow[];
  searchCostUsd?: number;
  summaryCostUsd?: number;
}): ContentAnalysisProvider {
  return {
    async searchMentions() {
      if (opts.searchCostUsd !== undefined) recordVendorCostUsd(opts.searchCostUsd);
      return opts.rows ?? [mentionRow()];
    },
    async getMentionSummary() {
      if (opts.summaryCostUsd !== undefined) recordVendorCostUsd(opts.summaryCostUsd);
      return SUMMARY;
    },
  };
}

function digestReturning(result: BrandRadarDigestResult) {
  return vi.fn(async () => result);
}

const input = {
  accountId: ACCOUNT,
  siteId: SITE,
  scanId: SCAN,
  brandQuery: 'Acme Corp',
  language: 'en' as string | null,
  outputLocale: 'en' as const,
};

beforeAll(startMemoryMongo);
afterAll(stopMemoryMongo);
beforeEach(clearCollections);

describe('stage 3 dispatch', () => {
  it('runs the digest over the STORED rows and completes when a sentence survives', async () => {
    const digest = vi.fn(
      async (digestInput: { rows: ReadonlyArray<{ id: string }> }) => ({
        digestSentences: [
          { text: 'Coverage skews positive.', citedRowIds: [digestInput.rows[0]!.id] },
        ],
        digestState: 'digest_present' as const,
        costMicros: 6_000,
      }),
    );

    const result = await runBrandRadarPipeline(input, {
      provider: stubProvider({ rows: [mentionRow(), mentionRow({ domain: 'news.test' })] }),
      digest,
    });

    expect(result.status).toBe('completed');
    expect(result.digestState).toBe('digest_present');
    expect(result.digestSentences).toHaveLength(1);
    expect(result.terminal.reason).toBeNull();
    expect(result.terminal.haltedStage).toBeNull();

    // The digest saw stored rows: real Mongo ids, normalized domains, and the
    // stored summary — never the vendor envelope.
    const passed = digest.mock.calls[0]?.[0] as unknown as {
      rows: Array<{ id: string; domain: string }>;
      summary: ContentAnalysisMentionSummary | null;
    };
    expect(passed.rows.map((row) => row.domain)).toEqual(['example.com', 'news.test']);
    expect(passed.rows.map((row) => row.id)).toEqual(result.retainedRowIds);
    expect(passed.summary).toEqual(SUMMARY);
  });

  it('computes the deterministic aggregates over the stored rows', async () => {
    const result = await runBrandRadarPipeline(input, {
      provider: stubProvider({
        rows: [
          mentionRow(),
          mentionRow({ domain: 'news.test', sentiment: { polarity: null, confidence: null } }),
          mentionRow({ domain: 'news.test', sentiment: { polarity: 'negative', confidence: 1 } }),
          mentionRow({ domain: 'blog.test', sentiment: { polarity: 'negative', confidence: 1 } }),
        ],
      }),
      digest: digestReturning({
        digestSentences: [],
        digestState: 'no_reliable_digest',
        costMicros: 3_000,
      }),
    });

    expect(result.aggregates.mentionCount).toBe(4);
    // A null vendor polarity is stored as `neutral` (07a-2 normalization), so
    // the distribution never invents an `unknown` share for a stored row.
    expect(result.aggregates.sentimentDistribution).toEqual({
      positive: 25,
      neutral: 25,
      negative: 50,
      unknown: 0,
    });
    expect(result.aggregates.topDomains).toEqual([
      { domain: 'news.test', count: 2 },
      { domain: 'blog.test', count: 1 },
      { domain: 'example.com', count: 1 },
    ]);
  });

  it('settles completed_partial + no_reliable_digest when every sentence is dropped', async () => {
    const result = await runBrandRadarPipeline(input, {
      provider: stubProvider({}),
      digest: digestReturning({
        digestSentences: [],
        digestState: 'no_reliable_digest',
        costMicros: 4_000,
      }),
    });

    expect(result.status).toBe('completed_partial');
    expect(result.digestState).toBe('no_reliable_digest');
    expect(result.terminal.reason).toBe('no_reliable_digest');
    expect(result.terminal.haltedStage).toBe('brand_digest');
    expect(result.terminal.totalCostMicros).toBe(4_000);
    const digestEvent = result.costEvents.filter(
      (event) => event.stage === 'brand_digest' && event.event === 'failed',
    )[0];
    expect(digestEvent?.costMicros).toBe(4_000);
    expect(digestEvent?.metadata).toEqual({
      digestState: 'no_reliable_digest',
      sentences: 0,
    });
  });

  it('settles completed_partial + digest_absent when the AI pass errored out', async () => {
    const result = await runBrandRadarPipeline(input, {
      provider: stubProvider({}),
      digest: digestReturning({
        digestSentences: [],
        digestState: 'digest_absent',
        costMicros: null,
      }),
    });

    expect(result.status).toBe('completed_partial');
    expect(result.digestState).toBe('digest_absent');
    expect(result.terminal.reason).toBe('digest_absent');
    expect(result.terminal.haltedStage).toBe('brand_digest');
    // A failed generation books nothing.
    expect(result.terminal.totalCostMicros).toBe(0);
  });

  it('never dispatches stage 3 when no AI seam is configured', async () => {
    const result = await runBrandRadarPipeline(input, { provider: stubProvider({}) });

    expect(result.status).toBe('completed');
    expect(result.digestState).toBe('digest_absent');
    expect(result.digestSentences).toEqual([]);
    expect(
      result.costEvents.filter((event) => event.stage === 'brand_digest'),
    ).toEqual([]);
  });
});

describe('stage 3 rolling ceiling', () => {
  it('halts one micro past the boundary without calling the model', async () => {
    const digest = digestReturning({
      digestSentences: [{ text: 'Never reached.', citedRowIds: ['x'] }],
      digestState: 'digest_present',
      costMicros: 20_000,
    });

    // 0.070001 + 0.060000 USD = 130_001 micros spent; 130_001 + 20_000 > 150_000.
    const result = await runBrandRadarPipeline(input, {
      provider: stubProvider({ searchCostUsd: 0.070001, summaryCostUsd: 0.06 }),
      digest,
    });

    expect(result.terminal.totalCostMicros).toBe(130_001);
    expect(digest).not.toHaveBeenCalled();
    expect(result.status).toBe('completed_partial');
    expect(result.digestState).toBe('digest_absent');
    expect(result.terminal.reason).toBe('cost_ceiling');
    expect(result.terminal.haltedStage).toBe('brand_digest');
    expect(result.mentionSummaryId).not.toBeNull();
    const halted = result.costEvents.filter(
      (event) => event.stage === 'brand_digest' && event.event === 'halted',
    )[0];
    expect(halted?.metadata).toEqual({
      reason: 'cost_ceiling',
      spentMicros: 130_001,
    });
  });

  it('dispatches at the exact boundary', async () => {
    const digest = digestReturning({
      digestSentences: [{ text: 'Ran.', citedRowIds: ['x'] }],
      digestState: 'digest_present',
      costMicros: 0,
    });

    const result = await runBrandRadarPipeline(input, {
      provider: stubProvider({ searchCostUsd: 0.07, summaryCostUsd: 0.06 }),
      digest,
    });

    expect(result.terminal.totalCostMicros).toBe(130_000);
    expect(digest).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('completed');
  });

  it('carries the aggregates through a ceiling halt before the summary', async () => {
    const digest = digestReturning({
      digestSentences: [],
      digestState: 'digest_absent',
      costMicros: null,
    });

    // 0.090001 USD leaves no room for the 60_000-micro summary stage.
    const result = await runBrandRadarPipeline(input, {
      provider: stubProvider({ searchCostUsd: 0.090001 }),
      digest,
    });

    expect(result.status).toBe('completed_partial');
    expect(result.terminal.reason).toBe('cost_ceiling');
    expect(result.aggregates.mentionCount).toBe(1);
    expect(result.digestState).toBe('digest_absent');
    expect(digest).not.toHaveBeenCalled();
  });
});
