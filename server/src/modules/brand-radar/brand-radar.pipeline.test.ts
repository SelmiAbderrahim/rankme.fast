/**
 * Brand Radar pipeline: rolling ceiling + terminal truth table.
 *
 * Every row of the terminal truth table this file owns is a
 * test here (the AI rows land elsewhere), plus the ceiling probe at its exact
 * boundary and the storage bounds (≤1000 rows, ≤300-char snippet,
 * output-encoded text).
 */
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VendorQuotaError,
  VendorTimeoutError,
} from '../../shared/providers/errors.js';
import { recordVendorCostUsd } from '../../shared/providers/cost-capture.js';
import { createFakeContentAnalysisProvider } from '../../shared/providers/fakes.js';
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
import {
  BRAND_RADAR_CEILING_REASON,
  BRAND_RADAR_RUN_BUDGET_MICROS,
  BRAND_RADAR_STAGE_WORST_CASE_MICROS,
  canAffordStage,
  normalizeBrandRadarHalt,
  runBrandRadarPipeline,
  type BrandRadarPipelineTerminal,
} from './brand-radar.pipeline.js';
import {
  BrandRadarMention,
  BrandRadarMentionSummary,
  clipMentionText,
  encodeMentionText,
  persistMentionRows,
  persistMentionSummary,
} from './brand-radar.rows.model.js';

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

interface StubOptions {
  rows?: ContentAnalysisMentionRow[];
  summary?: ContentAnalysisMentionSummary;
  searchError?: unknown;
  summaryError?: unknown;
  searchCostUsd?: number;
  summaryCostUsd?: number;
}

function stubProvider(opts: StubOptions = {}): {
  provider: ContentAnalysisProvider;
  searchCalls: unknown[];
  summaryCalls: unknown[];
} {
  const searchCalls: unknown[] = [];
  const summaryCalls: unknown[] = [];
  return {
    searchCalls,
    summaryCalls,
    provider: {
      async searchMentions(input) {
        searchCalls.push(input);
        if (opts.searchCostUsd !== undefined) {
          recordVendorCostUsd(opts.searchCostUsd);
        }
        if (opts.searchError) throw opts.searchError;
        return opts.rows ?? [mentionRow()];
      },
      async getMentionSummary(input) {
        summaryCalls.push(input);
        if (opts.summaryCostUsd !== undefined) {
          recordVendorCostUsd(opts.summaryCostUsd);
        }
        if (opts.summaryError) throw opts.summaryError;
        return opts.summary ?? SUMMARY;
      },
    },
  };
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

describe('rolling ceiling probe', () => {
  it('pins the frozen budget and per-stage worst cases', () => {
    expect(BRAND_RADAR_RUN_BUDGET_MICROS).toBe(150_000);
    expect(BRAND_RADAR_STAGE_WORST_CASE_MICROS).toEqual({
      search: 60_000,
      summary: 60_000,
      brand_digest: 20_000,
    });
  });

  it('affords a stage at the exact boundary and halts one micro past it', () => {
    expect(canAffordStage(0, 'search')).toBe(true);
    expect(canAffordStage(90_000, 'summary')).toBe(true);
    expect(canAffordStage(90_001, 'summary')).toBe(false);
    expect(canAffordStage(130_000, 'brand_digest')).toBe(true);
    expect(canAffordStage(130_001, 'brand_digest')).toBe(false);
  });
});

describe('publisher country', () => {
  it('passes the ISO country to both provider calls', async () => {
    const { provider, searchCalls, summaryCalls } = stubProvider();
    await runBrandRadarPipeline({ ...input, countryCode: 'FR' }, { provider });
    expect(searchCalls[0]).toMatchObject({ query: 'Acme Corp', countryCode: 'FR' });
    expect(summaryCalls[0]).toMatchObject({ query: 'Acme Corp', countryCode: 'FR' });
  });
});

describe('terminal truth table', () => {
  it('search VendorError, zero rows → failed', async () => {
    const { provider, summaryCalls } = stubProvider({
      searchError: new VendorTimeoutError('boom', {
        provider: 'fake',
        operation: 'content-analysis',
      }),
    });
    const result = await runBrandRadarPipeline(input, { provider });

    expect(result.status).toBe('failed');
    expect(result.retainedRowIds).toEqual([]);
    expect(result.mentionSummaryId).toBeNull();
    expect(result.terminal).toEqual({
      status: 'failed',
      totalCostMicros: 0,
      reason: 'VendorTimeoutError',
      haltedStage: 'search',
    });
    expect(summaryCalls).toHaveLength(0);
    expect(result.costEvents.map((e) => [e.stage, e.event])).toEqual([
      ['search', 'started'],
      ['search', 'failed'],
    ]);
    expect(await BrandRadarMention.countDocuments()).toBe(0);
  });

  it('non-provider throw still terminates failed with an UnknownError code', async () => {
    const { provider } = stubProvider({ searchError: new Error('nope') });
    const result = await runBrandRadarPipeline(input, { provider });
    expect(result.terminal.reason).toBe('UnknownError');
  });

  it('search ok with zero mentions → completed_empty, no summary call', async () => {
    const { provider, summaryCalls } = stubProvider({ rows: [] });
    const result = await runBrandRadarPipeline(input, { provider });

    expect(result.status).toBe('completed_empty');
    expect(result.terminal.reason).toBeNull();
    expect(result.terminal.haltedStage).toBeNull();
    expect(summaryCalls).toHaveLength(0);
    expect(result.retainedRowIds).toEqual([]);
  });

  it('search ok, summary VendorError → completed_partial with rows retained', async () => {
    const { provider } = stubProvider({
      summaryError: new VendorQuotaError('slow down', {
        provider: 'fake',
        operation: 'content-analysis',
      }),
    });
    const result = await runBrandRadarPipeline(input, { provider });

    expect(result.status).toBe('completed_partial');
    expect(result.retainedRowIds).toHaveLength(1);
    expect(result.mentionSummaryId).toBeNull();
    expect(result.terminal).toMatchObject({
      reason: 'VendorQuotaError',
      haltedStage: 'summary',
    });
    expect(result.costEvents.map((e) => [e.stage, e.event])).toEqual([
      ['search', 'started'],
      ['search', 'succeeded'],
      ['summary', 'started'],
      ['summary', 'failed'],
    ]);
  });

  it('ceiling halt before summary → completed_partial, summary never dispatched', async () => {
    // 90_001 + 60_000 = 150_001 > 150_000 → the stage-2 probe halts.
    const { provider, summaryCalls } = stubProvider({ searchCostUsd: 0.090001 });
    const result = await runBrandRadarPipeline(input, { provider });

    expect(summaryCalls).toHaveLength(0);
    expect(result.status).toBe('completed_partial');
    expect(result.retainedRowIds).toHaveLength(1);
    expect(result.terminal).toEqual({
      status: 'completed_partial',
      totalCostMicros: 90_001,
      reason: BRAND_RADAR_CEILING_REASON,
      haltedStage: 'summary',
    });
    expect(result.costEvents.at(-1)).toEqual({
      stage: 'summary',
      event: 'halted',
      costMicros: 0,
      metadata: { reason: BRAND_RADAR_CEILING_REASON, spentMicros: 90_001 },
    });
  });

  it('stage-1 spend of exactly 90_000 still affords the summary stage', async () => {
    const { provider, summaryCalls } = stubProvider({ searchCostUsd: 0.09 });
    const result = await runBrandRadarPipeline(input, { provider });
    expect(summaryCalls).toHaveLength(1);
    expect(result.status).toBe('completed');
    expect(result.terminal.totalCostMicros).toBe(90_000);
  });

  it('search ok + summary ok → completed with a persisted summary', async () => {
    const { provider, searchCalls } = stubProvider({
      searchCostUsd: 0.06,
      summaryCostUsd: 0.045,
    });
    const result = await runBrandRadarPipeline(input, { provider });

    expect(result.status).toBe('completed');
    expect(result.terminal).toEqual({
      status: 'completed',
      totalCostMicros: 105_000,
      reason: null,
      haltedStage: null,
    });
    expect(searchCalls[0]).toEqual({ query: 'Acme Corp', language: 'en', limit: 1000 });
    expect(result.costEvents).toEqual([
      { stage: 'search', event: 'started', costMicros: 0, metadata: { rowLimit: 1000 } },
      {
        stage: 'search',
        event: 'succeeded',
        costMicros: 60_000,
        metadata: { retainedRows: 1 },
      },
      { stage: 'summary', event: 'started', costMicros: 0, metadata: {} },
      {
        stage: 'summary',
        event: 'succeeded',
        costMicros: 45_000,
        metadata: { totalMentions: 2 },
      },
    ]);
    const stored = await BrandRadarMentionSummary.findById(result.mentionSummaryId);
    expect(stored?.totalMentions).toBe(2);
    expect(stored?.topDomains.map((d) => d.domain)).toEqual(['example.com']);
  });

  it('omits the language filter when the scan has none', async () => {
    const { provider, searchCalls } = stubProvider();
    await runBrandRadarPipeline({ ...input, language: null }, { provider });
    expect(searchCalls[0]).toEqual({ query: 'Acme Corp', limit: 1000 });
  });

  it('a provider that reports no cost records zero, not null', async () => {
    const result = await runBrandRadarPipeline(input, {
      provider: createFakeContentAnalysisProvider(),
    });
    expect(result.status).toBe('completed');
    expect(result.terminal.totalCostMicros).toBe(0);
  });
});

describe('storage bounds', () => {
  it('clamps the requested row limit into 1..1000', async () => {
    const low = stubProvider();
    await runBrandRadarPipeline({ ...input, rowLimit: 0 }, { provider: low.provider });
    expect(low.searchCalls[0]).toMatchObject({ limit: 1 });

    const high = stubProvider();
    await runBrandRadarPipeline({ ...input, rowLimit: 5_000 }, { provider: high.provider });
    expect(high.searchCalls[0]).toMatchObject({ limit: 1000 });
  });

  it('retains at most 1000 rows even when the vendor returns more', async () => {
    const rows = Array.from({ length: 1_005 }, (_, i) =>
      mentionRow({ url: `https://example.com/${i}` }),
    );
    const { provider } = stubProvider({ rows });
    const result = await runBrandRadarPipeline(input, { provider });
    expect(result.retainedRowIds).toHaveLength(1000);
    expect(await BrandRadarMention.countDocuments()).toBe(1000);
  });

  it('clips the snippet to 300 chars and output-encodes stored text', async () => {
    const { provider } = stubProvider({
      rows: [
        mentionRow({
          title: '<script>alert(1)</script>Acme',
          snippet: `${'x'.repeat(400)}<iframe src=evil>`,
        }),
      ],
    });
    const result = await runBrandRadarPipeline(input, { provider });
    const stored = await BrandRadarMention.findById(result.retainedRowIds[0]);
    expect(stored?.snippet).toHaveLength(300);
    expect(stored?.snippet).not.toContain('<');
    expect(stored?.snippet).not.toContain('>');
    expect(stored?.title).toBe('script alert(1) /script Acme');
  });

  it('falls back to the URL host, then to "unknown", for a missing domain', async () => {
    const { provider } = stubProvider({
      rows: [
        mentionRow({ domain: '', url: 'https://Forum.Example.org/t/1' }),
        mentionRow({ domain: '', url: 'not-a-url' }),
      ],
    });
    const result = await runBrandRadarPipeline(input, { provider });
    const stored = await BrandRadarMention.find({
      _id: { $in: result.retainedRowIds },
    }).sort({ createdAt: 1, _id: 1 });
    expect(stored.map((row) => row.domain)).toEqual(['forum.example.org', 'unknown']);
  });

  it('returns an empty id list when there is nothing to persist', async () => {
    expect(
      await persistMentionRows({ accountId: ACCOUNT, scanId: SCAN, rows: [] }),
    ).toEqual([]);
    expect(await BrandRadarMention.countDocuments()).toBe(0);
  });

  it('falls back to the URL host when the row omits the domain entirely', async () => {
    const ids = await persistMentionRows({
      accountId: ACCOUNT,
      scanId: SCAN,
      rows: [
        {
          url: 'https://No-Domain.example/a',
          title: 't',
          snippet: 's',
          sentiment: { polarity: 'neutral', confidence: null },
          language: null,
          observedAt: null,
        } as unknown as ContentAnalysisMentionRow,
      ],
    });
    expect((await BrandRadarMention.findById(ids[0]))?.domain).toBe('no-domain.example');
  });

  it('normalizes polarity, confidence, language, and observedAt', async () => {
    const { provider } = stubProvider({
      rows: [
        mentionRow({
          sentiment: { polarity: null, confidence: 2 },
          language: null,
          observedAt: 'never',
        }),
        mentionRow({
          sentiment: { polarity: 'negative', confidence: Number.NaN },
          observedAt: null,
        }),
      ],
    });
    const result = await runBrandRadarPipeline(input, { provider });
    const [first, second] = await BrandRadarMention.find({
      _id: { $in: result.retainedRowIds },
    }).sort({ createdAt: 1, _id: 1 });
    expect(first).toMatchObject({
      polarity: 'neutral',
      confidence: 1,
      language: null,
      observedAt: null,
    });
    expect(second).toMatchObject({ polarity: 'negative', confidence: null, observedAt: null });
  });

  it('clamps the stored summary to non-negative integers and ≤50 domains', async () => {
    const id = await persistMentionSummary({
      accountId: ACCOUNT,
      scanId: SCAN,
      summary: {
        totalMentions: -5,
        distribution: { positive: 1.7, neutral: -2, negative: 0 },
        topDomains: Array.from({ length: 60 }, (_, i) => ({
          domain: `D${i}.example.com`,
          mentions: i,
        })),
      },
    });
    const stored = await BrandRadarMentionSummary.findById(id);
    expect(stored?.totalMentions).toBe(0);
    expect(stored?.distribution).toMatchObject({ positive: 1, neutral: 0, negative: 0 });
    expect(stored?.topDomains).toHaveLength(50);
    expect(stored?.topDomains[0]?.domain).toBe('d0.example.com');
  });

  it('upserts the summary rather than duplicating it per replay', async () => {
    const first = await persistMentionSummary({
      accountId: ACCOUNT,
      scanId: SCAN,
      summary: SUMMARY,
    });
    const second = await persistMentionSummary({
      accountId: ACCOUNT,
      scanId: SCAN,
      summary: { ...SUMMARY, totalMentions: 9 },
    });
    expect(second).toBe(first);
    expect(await BrandRadarMentionSummary.countDocuments()).toBe(1);
  });

  it('accepts a summary with absent optional shape fields', async () => {
    const id = await persistMentionSummary({
      accountId: ACCOUNT,
      scanId: SCAN,
      summary: {} as unknown as ContentAnalysisMentionSummary,
    });
    const stored = await BrandRadarMentionSummary.findById(id);
    expect(stored?.totalMentions).toBe(0);
    expect(stored?.topDomains).toEqual([]);
  });

  it('handles rows whose optional text fields are absent', async () => {
    const { provider } = stubProvider({
      rows: [
        {
          url: 'https://example.com/a',
          domain: 'example.com',
        } as unknown as ContentAnalysisMentionRow,
      ],
    });
    const result = await runBrandRadarPipeline(input, { provider });
    const stored = await BrandRadarMention.findById(result.retainedRowIds[0]);
    expect(stored).toMatchObject({ title: '', snippet: '', polarity: 'neutral' });
  });

  it('leaves no angle bracket behind, however deeply a marker is nested', () => {
    let nested = '<script>x</script>';
    for (let i = 0; i < 11; i += 1) nested = `<scr${nested}ipt>`;
    const encoded = encodeMentionText(nested);
    expect(encoded).not.toContain('<');
    expect(encoded).not.toContain('>');
  });

  it('drops control characters and collapses whitespace', () => {
    expect(clipMentionText('a b \t c', 10)).toBe('a b c');
  });
});

describe('injected persistence seams', () => {
  it('uses the injected row/summary writers when supplied', async () => {
    const persistRows = vi.fn().mockResolvedValue(['row-1']);
    const persistSummary = vi.fn().mockResolvedValue('summary-1');
    const { provider } = stubProvider();
    const result = await runBrandRadarPipeline(input, {
      provider,
      persistRows,
      persistSummary,
    });
    expect(result.retainedRowIds).toEqual(['row-1']);
    expect(result.mentionSummaryId).toBe('summary-1');
    expect(persistRows).toHaveBeenCalledTimes(1);
    expect(persistSummary).toHaveBeenCalledTimes(1);
  });
});

describe('normalizeBrandRadarHalt', () => {
  const terminal = (
    overrides: Partial<BrandRadarPipelineTerminal>,
  ): BrandRadarPipelineTerminal => ({
    status: 'completed_partial',
    totalCostMicros: 0,
    reason: 'VendorTimeoutError',
    haltedStage: 'summary',
    ...overrides,
  });

  it('maps a clean terminal (null reason) to null', () => {
    expect(
      normalizeBrandRadarHalt(terminal({ reason: null, haltedStage: null })),
    ).toBeNull();
  });

  it('maps a reason with no halted stage to null (defensive)', () => {
    expect(
      normalizeBrandRadarHalt(terminal({ haltedStage: null })),
    ).toBeNull();
  });

  it('maps the ceiling reason to cost_ceiling on the halted stage', () => {
    expect(
      normalizeBrandRadarHalt(
        terminal({ reason: BRAND_RADAR_CEILING_REASON, haltedStage: 'summary' }),
      ),
    ).toEqual({ stage: 'summary', reason: 'cost_ceiling' });
  });

  it('maps digest_absent and no_reliable_digest to digest_failed', () => {
    expect(
      normalizeBrandRadarHalt(
        terminal({ reason: 'digest_absent', haltedStage: 'brand_digest' }),
      ),
    ).toEqual({ stage: 'brand_digest', reason: 'digest_failed' });
    expect(
      normalizeBrandRadarHalt(
        terminal({ reason: 'no_reliable_digest', haltedStage: 'brand_digest' }),
      ),
    ).toEqual({ stage: 'brand_digest', reason: 'digest_failed' });
  });

  it('maps every other reason code to provider_error, never raw text', () => {
    expect(
      normalizeBrandRadarHalt(
        terminal({ reason: 'VendorTimeoutError', haltedStage: 'search' }),
      ),
    ).toEqual({ stage: 'search', reason: 'provider_error' });
    expect(
      normalizeBrandRadarHalt(
        terminal({ reason: 'UnknownError', haltedStage: 'summary' }),
      ),
    ).toEqual({ stage: 'summary', reason: 'provider_error' });
  });
});
