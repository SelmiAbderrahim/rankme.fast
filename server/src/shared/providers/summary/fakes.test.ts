import { describe, expect, it } from 'vitest';
import { VendorAuthError } from '../errors.js';
import { SUPPORTED_LOCALES } from '../../i18n/locales.js';
import {
  buildFakeGeneratedPrompts,
  createFakeSummaryProvider,
  FAKE_SUMMARY_RESULT,
} from './fakes.js';
import type { GeneratePromptsInput } from './types.js';

function generateInput(overrides: Partial<GeneratePromptsInput> = {}): GeneratePromptsInput {
  return {
    siteDomain: 'example.com',
    locale: 'en',
    count: 5,
    seeds: { keywords: [], titles: [], competitors: [], gscQueries: [] },
    ...overrides,
  };
}

describe('createFakeSummaryProvider', () => {
  it('returns the default result', async () => {
    const provider = createFakeSummaryProvider();
    const result = await provider.summarize({
      findings: [],
      locale: 'en',
      siteDomain: 'example.com',
    });
    expect(result).toEqual(FAKE_SUMMARY_RESULT);
  });

  it('accepts a canned result override', async () => {
    const canned = { summary: 'canned', truncated: true, model: 'x' };
    const provider = createFakeSummaryProvider({ result: canned });
    await expect(
      provider.summarize({ findings: [], locale: 'en', siteDomain: 'x.com' }),
    ).resolves.toEqual(canned);
  });

  it('rejects when failure is injected', async () => {
    const err = new VendorAuthError('nope', {
      provider: 'anthropic',
      operation: 'messages',
    });
    const provider = createFakeSummaryProvider({ failure: err });
    await expect(
      provider.summarize({ findings: [], locale: 'en', siteDomain: 'x.com' }),
    ).rejects.toBe(err);
    await expect(provider.generatePrompts(generateInput())).rejects.toBe(err);
  });

  it('generates one deterministic question per seed, in seed order, capped at count', async () => {
    const provider = createFakeSummaryProvider();
    await expect(
      provider.generatePrompts(
        generateInput({
          count: 3,
          seeds: {
            keywords: ['seo audit'],
            titles: ['uptime monitoring'],
            competitors: ['rival.example', 'other.example'],
            gscQueries: ['how do i fix crawl errors'],
          },
        }),
      ),
    ).resolves.toEqual({
      prompts: [
        {
          promptText: 'I need help with how do i fix crawl errors — where should I start',
          funnelStage: 'awareness',
          promptType: 'problemFirst',
          intent: 'informational',
          branded: false,
          evidenceSource: 'gsc',
          evidenceRef: 'how do i fix crawl errors',
        },
        {
          promptText: 'what is the best seo audit',
          funnelStage: 'consideration',
          promptType: 'categoryDiscovery',
          intent: 'commercial',
          branded: false,
          evidenceSource: 'keyword',
          evidenceRef: 'seo audit',
        },
        {
          promptText: 'is uptime monitoring worth paying for',
          funnelStage: 'decision',
          promptType: 'pricingCommercial',
          intent: 'commercial',
          branded: false,
          evidenceSource: 'title',
          evidenceRef: 'uptime monitoring',
        },
      ],
      model: 'fake-summary-model',
    });
  });

  it('falls back to a generic domain question when no seeds exist', () => {
    expect(buildFakeGeneratedPrompts(generateInput({ count: 2 }))).toEqual([
      {
        promptText: 'what is the best tool for my team',
        funnelStage: 'awareness',
        promptType: 'categoryDiscovery',
        intent: 'informational',
        branded: false,
        evidenceSource: 'llmSynthesis',
        evidenceRef: 'example.com',
      },
    ]);
  });

  it('authors the seedless fallback in every locale and keeps the domain reference exact', () => {
    const fallbacks = SUPPORTED_LOCALES.map((locale) => {
      const [prompt] = buildFakeGeneratedPrompts(generateInput({ locale, count: 1 }));
      expect(prompt?.evidenceRef).toBe('example.com');
      return prompt?.promptText;
    });
    expect(new Set(fallbacks).size).toBe(SUPPORTED_LOCALES.length);
  });

  it('authors deterministic prompt prose in all seven locales without changing source tokens', () => {
    const sourceTokens = [
      'Exact-GSC_Token',
      'Exact-Keyword_Token',
      'Exact-Title_Token',
      'Exact-Rival.example',
    ];
    const prompts = SUPPORTED_LOCALES.map((locale) => {
      const localized = buildFakeGeneratedPrompts(generateInput({
        locale,
        count: 4,
        seeds: {
          gscQueries: [sourceTokens[0]!],
          keywords: [sourceTokens[1]!],
          titles: [sourceTokens[2]!],
          competitors: [sourceTokens[3]!],
        },
      }));
      expect(localized.map((prompt) => prompt.evidenceRef)).toEqual(sourceTokens);
      localized.forEach((prompt) => expect(prompt.promptText).toContain(prompt.evidenceRef));
      return localized.map((prompt) => prompt.promptText).join('|');
    });
    expect(new Set(prompts).size).toBe(SUPPORTED_LOCALES.length);
  });

  it('deduplicates repeated seed prompts case-insensitively', () => {
    const prompts = buildFakeGeneratedPrompts(
      generateInput({
        count: 5,
        seeds: {
          keywords: [],
          titles: [],
          competitors: [],
          gscQueries: ['Duplicate Query', 'duplicate query'],
        },
      }),
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.evidenceRef).toBe('Duplicate Query');
  });

  it('accepts a canned generated override', async () => {
    const canned = {
      prompts: [
        {
          promptText: 'override question',
          funnelStage: 'awareness' as const,
          promptType: 'problemFirst' as const,
          intent: 'informational' as const,
          branded: false,
          evidenceSource: 'llmSynthesis' as const,
          evidenceRef: 'override',
        },
      ],
      model: 'x',
    };
    const provider = createFakeSummaryProvider({ generated: canned });
    await expect(provider.generatePrompts(generateInput())).resolves.toEqual(canned);
  });
});
