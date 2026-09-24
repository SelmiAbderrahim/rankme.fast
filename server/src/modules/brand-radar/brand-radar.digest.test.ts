/**
 * Spec 07a-3 — Brand Radar `brand_digest` pass.
 *
 * Covers citation-or-drop at the write boundary (uncited sentence, invented
 * id), the abstention terminal state, the sentence/citation bounds, and the
 * two truth-table rows this sub-prompt owns: an AI vendor error and a profile
 * cost-ceiling refusal both settle `digest_absent`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createAiProfileRunner,
  type AiProfileRunner,
} from '../../shared/ai-profiles/index.js';
import {
  AiBudgetRefusalError,
  type AiGenerationProvider,
  type GenerateStructuredInput,
} from '../../shared/providers/ai-generation.js';
import { createFakeAiGenerationProvider } from '../../shared/providers/ai-generation-fake.js';
import { VendorTimeoutError } from '../../shared/providers/errors.js';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../../shared/i18n/locales.js';
import type { ContentAnalysisMentionSummary } from '../../shared/providers/types.js';
import {
  BRAND_RADAR_DIGEST_MAX_SENTENCES,
  BRAND_RADAR_DIGEST_TEXT_MAX_CHARS,
  enforceDigestCitations,
  runBrandRadarDigest,
  type BrandRadarDigestSentence,
} from './brand-radar.digest.js';
import type { StoredMentionRow } from './brand-radar.rows.model.js';

const ACCOUNT = '651f1a2b3c4d5e6f70819200';
const SCAN = '651f1a2b3c4d5e6f70819201';
const SITE = '651f1a2b3c4d5e6f70819202';
const ROW_A = '651f1a2b3c4d5e6f708192aa';
const ROW_B = '651f1a2b3c4d5e6f708192bb';
const FAKE_ORDER = ['fake'] as const;

function storedRow(id: string, domain = 'example.com'): StoredMentionRow {
  return {
    id,
    url: `https://${domain}/story`,
    domain,
    title: 'Acme in the news',
    snippet: 'Acme shipped a thing.',
    polarity: 'positive',
    confidence: 0.9,
    language: 'en',
    observedAt: new Date('2026-02-01T00:00:00.000Z'),
  };
}

const SUMMARY: ContentAnalysisMentionSummary = {
  totalMentions: 2,
  distribution: { positive: 2, neutral: 0, negative: 0 },
  topDomains: [{ domain: 'example.com', mentions: 2 }],
};

/** Deterministic runner stub — the shape the real runner returns. */
function runnerReturning(
  digestSentences: BrandRadarDigestSentence[],
  costMicros = 6_100n,
): AiProfileRunner {
  return {
    preflight: () => undefined,
    run: vi.fn(async () => ({
      trust: 'untrusted' as const,
      status: 'complete' as const,
      object: { digestSentences, citations: [] },
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
        actualOrEstimatedCostMicros: costMicros,
      },
      classification: {
        generatedFields: 'untrusted' as const,
        renderAs: 'text_only' as const,
      },
    })) as AiProfileRunner['run'],
  };
}

function throwingRunner(error: Error): AiProfileRunner {
  return {
    preflight: () => undefined,
    run: vi.fn(async () => {
      throw error;
    }) as unknown as AiProfileRunner['run'],
  };
}

function digestInput(
  rows = [storedRow(ROW_A), storedRow(ROW_B, 'news.test')],
  outputLocale: SupportedLocale = 'en',
) {
  return { accountId: ACCOUNT, siteId: SITE, scanId: SCAN, outputLocale, rows, summary: SUMMARY };
}

describe('enforceDigestCitations', () => {
  const retained = new Set([ROW_A, ROW_B]);

  it('drops a sentence that cites nothing at all', () => {
    expect(
      enforceDigestCitations([{ text: 'Acme is discussed.', citedRowIds: [] }], retained),
    ).toEqual([]);
  });

  it('drops a sentence whole when any cited id is outside the retained set', () => {
    expect(
      enforceDigestCitations(
        [{ text: 'Acme is discussed.', citedRowIds: [ROW_A, 'invented-id'] }],
        retained,
      ),
    ).toEqual([]);
  });

  it('keeps a fully cited sentence and de-duplicates its ids', () => {
    expect(
      enforceDigestCitations(
        [{ text: 'Acme is discussed.', citedRowIds: [ROW_A, ROW_A, ROW_B] }],
        retained,
      ),
    ).toEqual([{ text: 'Acme is discussed.', citedRowIds: [ROW_A, ROW_B] }]);
  });

  it('clamps sentence text to the 300-character bound', () => {
    const kept = enforceDigestCitations(
      [{ text: 'x'.repeat(400), citedRowIds: [ROW_A] }],
      retained,
    );
    expect(kept[0]?.text).toHaveLength(BRAND_RADAR_DIGEST_TEXT_MAX_CHARS);
  });

  it('stops at twenty surviving sentences', () => {
    const sentences = Array.from({ length: 25 }, (_, index) => ({
      text: `Sentence ${index}.`,
      citedRowIds: [ROW_A],
    }));
    expect(enforceDigestCitations(sentences, retained)).toHaveLength(
      BRAND_RADAR_DIGEST_MAX_SENTENCES,
    );
  });
});

describe('runBrandRadarDigest', () => {
  it('passes every frozen output locale while keeping stored observations byte-stable', async () => {
    const seen: Array<{ locale: string; input: unknown }> = [];
    for (const outputLocale of SUPPORTED_LOCALES) {
      const rows = [storedRow(ROW_A, `source-${outputLocale}.example`)];
      const ai = runnerReturning([]);
      await runBrandRadarDigest(digestInput(rows, outputLocale), {
        ai,
        aiProviderOrder: FAKE_ORDER,
      });
      const call = vi.mocked(ai.run).mock.calls[0]?.[0] as
        | { locale: SupportedLocale; input: unknown }
        | undefined;
      seen.push({ locale: call?.locale ?? '', input: call?.input });
    }

    expect(seen.map((entry) => entry.locale)).toEqual(SUPPORTED_LOCALES);
    for (const outputLocale of SUPPORTED_LOCALES) {
      expect(JSON.stringify(seen.find((entry) => entry.locale === outputLocale)?.input)).toContain(
        `source-${outputLocale}.example`,
      );
    }
  });

  it('never calls the model when the scan retained no rows', async () => {
    const ai = runnerReturning([{ text: 'Anything.', citedRowIds: [ROW_A] }]);
    const result = await runBrandRadarDigest(
      { accountId: ACCOUNT, siteId: SITE, scanId: SCAN, outputLocale: 'en', rows: [], summary: SUMMARY },
      { ai, aiProviderOrder: FAKE_ORDER },
    );
    expect(result).toEqual({
      digestSentences: [],
      digestState: 'digest_absent',
      costMicros: null,
    });
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('reports digest_present when at least one sentence survives', async () => {
    const ai = runnerReturning([
      { text: 'Coverage skews positive.', citedRowIds: [ROW_A] },
      { text: 'Uncited claim.', citedRowIds: [] },
    ]);
    const result = await runBrandRadarDigest(digestInput(), {
      ai,
      aiProviderOrder: FAKE_ORDER,
    });
    expect(result.digestState).toBe('digest_present');
    expect(result.digestSentences).toEqual([
      { text: 'Coverage skews positive.', citedRowIds: [ROW_A] },
    ]);
    expect(result.costMicros).toBe(6_100);
  });

  it('abstains with no_reliable_digest when every sentence is dropped', async () => {
    const ai = runnerReturning([
      { text: 'Uncited claim.', citedRowIds: [] },
      { text: 'Fabricated citation.', citedRowIds: ['651f1a2b3c4d5e6f708192ff'] },
    ]);
    const result = await runBrandRadarDigest(digestInput(), {
      ai,
      aiProviderOrder: FAKE_ORDER,
    });
    expect(result.digestState).toBe('no_reliable_digest');
    expect(result.digestSentences).toEqual([]);
    // The pass DID run, so its cost is real and stays booked.
    expect(result.costMicros).toBe(6_100);
  });

  it('hands the model only stored, normalized mention material', async () => {
    const ai = runnerReturning([]);
    await runBrandRadarDigest(digestInput(), { ai, aiProviderOrder: FAKE_ORDER });
    const call = vi.mocked(ai.run).mock.calls[0]?.[0];
    expect(call?.profile).toBe('brand_digest');
    expect(call?.input).toEqual({
      mentions: [
        {
          id: ROW_A,
          domain: 'example.com',
          title: 'Acme in the news',
          snippet: 'Acme shipped a thing.',
          polarity: 'positive',
          observedAt: '2026-02-01T00:00:00.000Z',
        },
        {
          id: ROW_B,
          domain: 'news.test',
          title: 'Acme in the news',
          snippet: 'Acme shipped a thing.',
          polarity: 'positive',
          observedAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      summary: {
        totalMentions: 2,
        positive: 2,
        neutral: 0,
        negative: 0,
        topDomains: [{ domain: 'example.com', mentions: 2 }],
      },
    });
  });

  it('falls back to the retained row count when no summary was stored', async () => {
    const ai = runnerReturning([]);
    await runBrandRadarDigest(
      {
        accountId: ACCOUNT,
        siteId: SITE,
        scanId: SCAN,
        outputLocale: 'en',
        rows: [storedRow(ROW_A)],
        summary: null,
      },
      { ai, aiProviderOrder: FAKE_ORDER },
    );
    const call = vi.mocked(ai.run).mock.calls[0]?.[0] as {
      input: { summary: { totalMentions: number; topDomains: unknown[] } };
    };
    expect(call.input.summary.totalMentions).toBe(1);
    expect(call.input.summary.topDomains).toEqual([]);
  });

  it('passes a null observedAt straight through', async () => {
    const ai = runnerReturning([]);
    await runBrandRadarDigest(
      {
        accountId: ACCOUNT,
        siteId: SITE,
        scanId: SCAN,
        outputLocale: 'en',
        rows: [{ ...storedRow(ROW_A), observedAt: null }],
        summary: SUMMARY,
      },
      { ai, aiProviderOrder: FAKE_ORDER },
    );
    const call = vi.mocked(ai.run).mock.calls[0]?.[0] as {
      input: { mentions: Array<{ observedAt: string | null }> };
    };
    expect(call.input.mentions[0]?.observedAt).toBeNull();
  });

  it('settles digest_absent on an AI vendor error and books no cost', async () => {
    const result = await runBrandRadarDigest(digestInput(), {
      ai: throwingRunner(
        new VendorTimeoutError('digest timed out', {
          provider: 'fake',
          operation: 'brand_digest',
        }),
      ),
      aiProviderOrder: FAKE_ORDER,
    });
    expect(result).toEqual({
      digestSentences: [],
      digestState: 'digest_absent',
      costMicros: null,
    });
  });

  it('settles digest_absent on a profile cost-ceiling refusal through the real runner', async () => {
    const seen: Array<GenerateStructuredInput<object>> = [];
    const provider: AiGenerationProvider = {
      async generateStructured(input) {
        seen.push(input as GenerateStructuredInput<object>);
        throw new AiBudgetRefusalError();
      },
    };

    const result = await runBrandRadarDigest(digestInput(), {
      ai: createAiProfileRunner({ provider }),
      aiProviderOrder: FAKE_ORDER,
    });

    // The 20_000-micro ceiling lives inside the 150_000-micro run budget.
    expect(seen[0]?.maxCostMicros).toBe(20_000n);
    expect(result.digestState).toBe('digest_absent');
    expect(result.costMicros).toBeNull();
  });

  it('drives the keyless fake provider end to end through the real runner', async () => {
    const result = await runBrandRadarDigest(digestInput(), {
      ai: createAiProfileRunner({ provider: createFakeAiGenerationProvider() }),
      aiProviderOrder: FAKE_ORDER,
    });
    // The fake invents no citation it was not handed, so it either abstains or
    // returns fully-cited sentences — never an uncited one that survived.
    expect(['digest_present', 'no_reliable_digest']).toContain(result.digestState);
    for (const sentence of result.digestSentences) {
      expect(sentence.citedRowIds.length).toBeGreaterThan(0);
      for (const id of sentence.citedRowIds) {
        expect([ROW_A, ROW_B]).toContain(id);
      }
    }
  });
});
