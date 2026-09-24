import { describe, expect, it, vi } from 'vitest';
import { createAiProfileRunner } from '../../ai-profiles/index.js';
import {
  AiAuthError,
  AiBudgetRefusalError,
  AiInvalidInputError,
  AiMalformedOutputError,
  AiQuotaError,
  AiSafetyError,
  AiTimeoutError,
  type AiGenerationProvider,
  type AiGenerationResult,
} from '../ai-generation.js';
import type { AiSdkCall } from '../ai-sdk/executor.js';
import {
  VendorAuthError,
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
  VendorUnavailableError,
} from '../errors.js';
import { FAKE_SUMMARY_RESULT } from './fakes.js';
import {
  createAnthropicProfileGenerationProvider,
  createFakeProfileSummaryProvider,
  createProfileSummaryProvider,
} from './profile.js';

const tokens = { input: 2, output: 1, cachedInput: null, reasoning: null } as const;

function generation<T extends object>(object: T): AiGenerationResult<T> {
  return {
    trust: 'untrusted', object, provider: 'anthropic', model: 'configured-model',
    finishReason: 'stop', tokens, latencyMs: 1,
    attempts: [{
      ordinal: 1, provider: 'anthropic', model: 'configured-model', status: 'success',
      latencyMs: 1, tokens, configuredEstimateCostMicros: 1n,
      actualOrEstimatedCostMicros: 1n, costSource: 'actual',
      errorCategory: null, errorCode: null,
    }],
    configuredEstimateCostMicros: 1n, actualCostMicros: 1n,
    actualOrEstimatedCostMicros: 1n, warnings: [],
  };
}

const summaryInput = {
  findings: [{ ruleId: 'title', title: 'Title', why: 'Why', fix: 'Fix', affectedCount: 1 }],
  locale: 'en' as const,
  siteDomain: 'example.test',
  usage: { accountId: 'account-1' },
  correlationId: 'summary-1',
};

describe('SummaryProvider profile compatibility adapter', () => {
  it('preserves deterministic fake summary and prompt behavior through the AI seam', async () => {
    const provider = createFakeProfileSummaryProvider();
    expect(() => provider.preflightSummarize?.(summaryInput)).not.toThrow();
    expect(() => provider.preflightGeneratePrompts?.({
      siteDomain: 'example.test', locale: 'en', count: 2,
      seeds: { keywords: ['seo audit'], titles: ['monitoring'], competitors: [], gscQueries: [] },
    })).not.toThrow();
    await expect(provider.summarize(summaryInput)).resolves.toEqual(FAKE_SUMMARY_RESULT);
    await expect(provider.generatePrompts({
      siteDomain: 'example.test', locale: 'en', count: 2,
      seeds: { keywords: ['seo audit'], titles: ['monitoring'], competitors: [], gscQueries: [] },
    })).resolves.toEqual({
      prompts: [
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
          promptText: 'is monitoring worth paying for',
          funnelStage: 'decision',
          promptType: 'pricingCommercial',
          intent: 'commercial',
          branded: false,
          evidenceSource: 'title',
          evidenceRef: 'monitoring',
        },
      ],
      model: 'fake-summary-model',
    });
  });

  it('records deterministic fake profile runs when a recorder is supplied', async () => {
    const recordRun = vi.fn().mockResolvedValue(undefined);
    const provider = createFakeProfileSummaryProvider(recordRun);
    await provider.summarize({ ...summaryInput, correlationId: 'recorded-fake' });
    expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({
      task: 'audit_summary', status: 'success', provider: 'fake',
    }));
  });

  it('routes AI Visibility sentiment through its task-specific profile', async () => {
    const ai: AiGenerationProvider = {
      async generateStructured<T extends object>() {
        return generation({ sentiment: 'positive', citations: [] }) as AiGenerationResult<T>;
      },
    };
    const provider = createProfileSummaryProvider({
      runner: createAiProfileRunner({ provider: ai }),
      providerOrder: ['anthropic'],
    });
    await expect(provider.summarize({
      findings: [{
        ruleId: 'ai-visibility-sentiment', title: 'classify', why: 'answer',
        fix: 'one word', affectedCount: 1,
      }],
      locale: 'en', siteDomain: 'example.test',
    })).resolves.toEqual({ summary: 'positive', truncated: false, model: 'configured-model' });
  });

  it('returns generated prompt output and model in non-fake mode', async () => {
    const ai: AiGenerationProvider = {
      async generateStructured<T extends object>() {
        return generation({
          prompts: [
            {
              promptText: 'best audit platform',
              funnelStage: 'consideration',
              promptType: 'comparison',
              intent: 'commercial',
              branded: false,
              evidenceSource: 'keyword',
              evidenceRef: 'audit',
            },
          ],
          citations: [],
        }) as AiGenerationResult<T>;
      },
    };
    const provider = createProfileSummaryProvider({
      runner: createAiProfileRunner({ provider: ai }),
      providerOrder: ['anthropic'],
    });
    await expect(provider.generatePrompts({
      siteDomain: 'example.test', locale: 'en', count: 1,
      seeds: { keywords: ['audit'], titles: [], competitors: [], gscQueries: [] },
    })).resolves.toEqual({
      prompts: [
        {
          promptText: 'best audit platform',
          funnelStage: 'consideration',
          promptType: 'comparison',
          intent: 'commercial',
          branded: false,
          evidenceSource: 'keyword',
          evidenceRef: 'audit',
        },
      ],
      model: 'configured-model',
    });
  });

  it.each([
    [new AiTimeoutError(), VendorTimeoutError],
    [new AiQuotaError(), VendorQuotaError],
    [new AiBudgetRefusalError(), VendorQuotaError],
    [new AiAuthError(), VendorAuthError],
    [new AiMalformedOutputError(), VendorMalformedError],
    [new AiInvalidInputError(), VendorMalformedError],
    [new AiSafetyError(), VendorUnavailableError],
  ] as const)('maps terminal runtime errors into the legacy provider taxonomy', async (error, mapped) => {
    const ai: AiGenerationProvider = { async generateStructured() { throw error; } };
    const provider = createProfileSummaryProvider({
      runner: createAiProfileRunner({ provider: ai }),
      providerOrder: ['anthropic'],
    });
    await expect(provider.summarize(summaryInput)).rejects.toBeInstanceOf(mapped);
  });

  it('preserves unknown programming errors and maps generate-prompts failures', async () => {
    const unknown = new Error('programming error');
    const provider = createProfileSummaryProvider({
      runner: createAiProfileRunner({
        provider: { async generateStructured() { throw unknown; } },
      }),
      providerOrder: ['anthropic'],
    });
    await expect(provider.summarize(summaryInput)).rejects.toBe(unknown);

    const invalidProvider = createProfileSummaryProvider({
      runner: createAiProfileRunner({
        provider: { async generateStructured() { throw new AiMalformedOutputError(); } },
      }),
      providerOrder: ['anthropic'],
    });
    await expect(invalidProvider.generatePrompts({
      siteDomain: 'example.test', locale: 'en', count: 1,
      seeds: { keywords: [], titles: [], competitors: [], gscQueries: [] },
    })).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('uses one Anthropic AI SDK adapter and preserves model/length normalization', async () => {
    const call = vi.fn<AiSdkCall>().mockResolvedValue({
      object: { summary: 'Structured summary.', citations: [], truncated: false },
      finishReason: 'length', tokens, warnings: [],
    });
    const ai = createAnthropicProfileGenerationProvider({
      apiKey: 'synthetic-key', model: 'configured-model',
      inputCostMicrosPerMillion: 1, outputCostMicrosPerMillion: 1,
      totalTimeoutMs: 1_000, telemetryEnabled: false, call,
    });
    const provider = createProfileSummaryProvider({
      runner: createAiProfileRunner({ provider: ai }),
      providerOrder: ['anthropic'],
    });
    await expect(provider.summarize(summaryInput)).resolves.toEqual({
      summary: 'Structured summary.', truncated: true, model: 'configured-model',
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]?.[0].adapter.provider).toBe('anthropic');
    expect(call.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal);
  });
});
