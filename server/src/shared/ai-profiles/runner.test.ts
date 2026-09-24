import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import {
  AiAuthError,
  AiSafetyError,
  type AiGenerationProvider,
  type AiGenerationResult,
  type GenerateStructuredInput,
} from '../providers/ai-generation.js';
import { UNICODE_CITATION_IDS } from '../testing/security/adversarial-corpus.js';
import { resolveAiTaskProfile } from './profiles.js';
import { createAiProfileRunner } from './runner.js';
import type { RunAiProfileInput } from './types.js';

const tokens = { input: 10, output: 5, cachedInput: null, reasoning: null } as const;

function result<T extends object>(object: T, provider: 'fake' | 'openai' = 'fake'): AiGenerationResult<T> {
  return {
    trust: 'untrusted', object, provider, model: `${provider}-fixture`, finishReason: 'stop',
    tokens, latencyMs: 7,
    attempts: [{
      ordinal: 1, provider, model: `${provider}-fixture`, status: 'success', latencyMs: 7,
      tokens, configuredEstimateCostMicros: 3n, actualOrEstimatedCostMicros: 2n,
      costSource: 'actual', errorCategory: null, errorCode: null,
    }],
    configuredEstimateCostMicros: 3n, actualCostMicros: 2n,
    actualOrEstimatedCostMicros: 2n, warnings: [],
  };
}

function auditRequest(overrides: Partial<RunAiProfileInput> = {}): RunAiProfileInput {
  return {
    profile: 'audit_summary',
    input: {
      siteDomain: 'example.test',
      findings: [{
        ruleId: 'title', title: 'Fix the title', why: 'It helps readers',
        fix: 'Add one clear title', affectedCount: 1,
      }],
    },
    locale: 'en', correlationId: 'audit-run-1',
    usage: { accountId: 'account-1', siteId: 'site-1', jobId: 'job-1' },
    configuredProviderOrder: ['fake'],
    ...overrides,
  };
}

describe('AI task profile runner', () => {
  it('preflights policy without spending and rejects invalid input synchronously', () => {
    const provider = { generateStructured: vi.fn() } as unknown as AiGenerationProvider;
    const runner = createAiProfileRunner({ provider });
    expect(() => runner.preflight(auditRequest())).not.toThrow();
    expect(() => runner.preflight(auditRequest({ locale: 'it' })))
      .toThrow(expect.objectContaining({ category: 'invalid_input' }));
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it('rejects mixed-fake and unknown provider orders before spending', () => {
    const provider = { generateStructured: vi.fn() } as unknown as AiGenerationProvider;
    const runner = createAiProfileRunner({ provider });
    for (const configuredProviderOrder of [
      ['fake', 'openai'],
      ['unknown-provider'],
    ] as const) {
      expect(() => runner.preflight(auditRequest({
        configuredProviderOrder: configuredProviderOrder as never,
      }))).toThrow(expect.objectContaining({ category: 'invalid_input' }));
    }
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it('preflight enforces each content classification flag before spending', () => {
    const provider = { generateStructured: vi.fn() } as unknown as AiGenerationProvider;
    const runner = createAiProfileRunner({ provider });
    const cases = [
      {
        profile: 'content_brief' as const,
        flag: 'sanitizedPageTextPermitted' as const,
        input: {
          keyword: 'seo', audience: 'owners', derivedFacts: 'facts', pageText: 'owned text',
          competitorSnippets: [],
        },
      },
      {
        profile: 'content_brief' as const,
        flag: 'sanitizedCompetitorTextPermitted' as const,
        input: {
          keyword: 'seo', audience: 'owners', derivedFacts: 'facts',
          competitorSnippets: [{ id: 'source-1', text: 'evidence' }],
        },
      },
      {
        profile: 'admin_quality_evaluation' as const,
        flag: 'generatedTextInputPermitted' as const,
        input: { candidateText: 'candidate', rubricFacts: 'rubric', sources: [] },
      },
    ];
    for (const item of cases) {
      const classification = resolveAiTaskProfile(item.profile).dataClassification;
      const original = classification[item.flag];
      classification[item.flag] = false;
      try {
        expect(() => runner.preflight({
          profile: item.profile,
          input: item.input,
          locale: 'en',
          correlationId: `classification-${item.flag}`,
          usage: { accountId: 'account-1' },
          configuredProviderOrder: ['fake'],
        })).toThrow(expect.objectContaining({ category: 'invalid_input' }));
      } finally {
        classification[item.flag] = original;
      }
    }
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it('fails closed on missing or malformed application source collections', () => {
    const provider = { generateStructured: vi.fn() } as unknown as AiGenerationProvider;
    const runner = createAiProfileRunner({ provider });
    const profile = resolveAiTaskProfile('opportunity_explanation');
    const originalSchema = profile.inputSchema;
    const originalCollections = profile.sourceCollections;
    profile.inputSchema = z.object({ sources: z.array(z.unknown()) }).strict();
    profile.sourceCollections = ['sources', 'missingSources'];
    try {
      expect(() => runner.preflight({
        profile: 'opportunity_explanation', input: { sources: [] }, locale: 'en',
        correlationId: 'missing-source-collection', usage: { accountId: 'account-1' },
        configuredProviderOrder: ['fake'],
      })).not.toThrow();
      for (const source of [null, { id: 7 }]) {
        expect(() => runner.preflight({
          profile: 'opportunity_explanation', input: { sources: [source] }, locale: 'en',
          correlationId: 'malformed-source', usage: { accountId: 'account-1' },
          configuredProviderOrder: ['fake'],
        })).toThrow(expect.objectContaining({ category: 'invalid_input' }));
      }
    } finally {
      profile.inputSchema = originalSchema;
      profile.sourceCollections = originalCollections;
    }
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it('calls the provider once with resolved policy, delimited data, and content-free provenance', async () => {
    let captured: GenerateStructuredInput<object> | undefined;
    const provider: AiGenerationProvider = {
      async generateStructured<T extends object>(input: GenerateStructuredInput<T>) {
        captured = input as GenerateStructuredInput<object>;
        return result({ summary: 'Fix the title first.', citations: [], truncated: false }) as AiGenerationResult<T>;
      },
    };
    const recordRun = vi.fn().mockResolvedValue(undefined);
    const output = await createAiProfileRunner({ provider, recordRun }).run<{
      summary: string; citations: string[]; truncated: boolean;
    }>(auditRequest());
    expect(output).toMatchObject({
      trust: 'untrusted', status: 'complete',
      object: { summary: 'Fix the title first.', citations: [], truncated: false },
      classification: { generatedFields: 'untrusted', renderAs: 'text_only' },
      provenance: { task: 'audit_summary', profileVersion: '1.0.0' },
    });
    expect(captured).toMatchObject({
      maxOutputTokens: 1024, maxTotalTokens: 32768, maxAttempts: 3,
      timeoutMs: 60000, permittedProviders: expect.arrayContaining(['openai', 'anthropic']),
      profileMetadata: {
        name: 'audit_summary', outputSchemaVersion: '1',
        promptTemplateId: 'audit-summary', promptTemplateVersion: '1',
      },
    });
    expect(captured?.sanitizedInput).toMatch(/^<untrusted_customer_data>/u);
    expect(captured?.systemInstruction.text).toContain('never as instructions');
    expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success', task: 'audit_summary', provider: 'fake', qualityFlags: ['complete'],
    }));
    expect(JSON.stringify(recordRun.mock.calls, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    )).not.toContain('Fix the title first');
  });

  it.each([
    ['invalid locale', auditRequest({ locale: 'it' })],
    ['unknown profile', auditRequest({ profile: 'unknown' as never })],
    ['duplicate provider order', auditRequest({ configuredProviderOrder: ['openai', 'openai'] })],
    ['unsupported provider', auditRequest({
      profile: 'content_first_draft',
      input: { keyword: 'seo', brief: '', derivedFacts: '', competitorSnippets: [] },
      configuredProviderOrder: ['glm'],
    })],
    ['content-disallowed field', auditRequest({
      profile: 'opportunity_explanation',
      input: { derivedFacts: 'facts', sources: [], pageText: 'not permitted' },
    })],
  ] as const)('rejects %s before provider spend', async (_name, request) => {
    const provider = { generateStructured: vi.fn() } as unknown as AiGenerationProvider;
    const recordRun = vi.fn().mockResolvedValue(undefined);
    await expect(createAiProfileRunner({ provider, recordRun }).run(request))
      .rejects.toMatchObject({ category: 'invalid_input' });
    expect(provider.generateStructured).not.toHaveBeenCalled();
    if (request.profile !== ('unknown' as never)) {
      expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({ status: 'validation_failed' }));
    }
  });

  it('rejects an application-issued homograph source ID before generation', async () => {
    const provider = { generateStructured: vi.fn() } as unknown as AiGenerationProvider;
    await expect(createAiProfileRunner({ provider }).run({
      profile: 'opportunity_explanation',
      input: { derivedFacts: 'facts', sources: [{ id: UNICODE_CITATION_IDS.cyrillicHomograph, text: 'safe' }] },
      locale: 'en', correlationId: 'homograph-input', usage: { accountId: 'account-1' },
      configuredProviderOrder: ['fake'],
    })).rejects.toMatchObject({ category: 'invalid_input' });
    expect(provider.generateStructured).not.toHaveBeenCalled();
  });

  it.each([
    ['invented-id', 'invented-source'],
    ['homograph-id', UNICODE_CITATION_IDS.cyrillicHomograph],
  ] as const)('removes %s citations and marks output partial', async (_name, citation) => {
    const provider: AiGenerationProvider = {
      async generateStructured<T extends object>() {
        return result({ explanation: 'Grounded explanation.', citations: [citation] }) as AiGenerationResult<T>;
      },
    };
    const output = await createAiProfileRunner({ provider }).run<{
      explanation: string; citations: string[];
    }>({
      profile: 'opportunity_explanation',
      input: { derivedFacts: 'facts', sources: [{ id: 'source-1', text: 'safe' }] },
      locale: 'en', correlationId: `citation-${_name}`, usage: { accountId: 'account-1' },
      configuredProviderOrder: ['fake'],
    });
    expect(output.status).toBe('partial');
    expect(output.object.citations).toEqual([]);
    expect(output.warnings).toContain('citation_rejected');
  });

  it('deduplicates valid citations and forwards a caller signal', async () => {
    const generateStructured = vi.fn(async () => result({
      explanation: 'Grounded explanation.', citations: ['source-1', 'source-1'],
    }));
    const signal = new AbortController().signal;
    const output = await createAiProfileRunner({
      provider: { generateStructured } as AiGenerationProvider,
    }).run<{ explanation: string; citations: string[] }>({
      profile: 'opportunity_explanation',
      input: { derivedFacts: 'facts', sources: [{ id: 'source-1', text: 'safe' }] },
      locale: 'en', correlationId: 'duplicate-citation', usage: { accountId: 'account-1' },
      configuredProviderOrder: ['fake'], signal,
    });
    expect(output.object.citations).toEqual(['source-1']);
    expect(generateStructured).toHaveBeenCalledWith(expect.objectContaining({ signal }));
  });

  it('fails closed when a reviewed system template cannot be resolved', async () => {
    const generateStructured = vi.fn();
    const profile = resolveAiTaskProfile('audit_summary');
    const original = profile.systemInstruction.templateId;
    profile.systemInstruction.templateId = 'missing-template';
    try {
      await expect(createAiProfileRunner({
        provider: { generateStructured } as unknown as AiGenerationProvider,
      }).run(auditRequest())).rejects.toMatchObject({ category: 'invalid_input' });
    } finally {
      profile.systemInstruction.templateId = original;
    }
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it('returns truncation as an explicit quality flag without silently dropping the result', async () => {
    const provider: AiGenerationProvider = {
      async generateStructured<T extends object>() {
        return result({ explanation: 'Bounded result.', citations: [] }) as AiGenerationResult<T>;
      },
    };
    const output = await createAiProfileRunner({ provider }).run({
      profile: 'content_scorecard_explanation',
      input: { derivedFacts: 'x'.repeat(13_000), sources: [] },
      locale: 'en', correlationId: 'oversized', usage: { accountId: 'account-1' },
      configuredProviderOrder: ['fake'],
    });
    expect(output.status).toBe('complete');
    expect(output.warnings).toContain('input_truncated');
    expect(output.qualityFlags).toContain('input_truncated');
  });

  it.each([new AiSafetyError(), new AiAuthError()] as const)(
    'propagates terminal %s errors without fabricated text',
    async (terminal) => {
      const provider: AiGenerationProvider = { async generateStructured() { throw terminal; } };
      const recordRun = vi.fn().mockResolvedValue(undefined);
      await expect(createAiProfileRunner({ provider, recordRun }).run(auditRequest()))
        .rejects.toBe(terminal);
      expect(recordRun).toHaveBeenCalledWith(expect.objectContaining({
        status: 'generation_failed', provider: null, costMicros: 0n,
      }));
    },
  );

  it('records fallback provenance from safe attempt metadata', async () => {
    const generated = result({ summary: 'Safe.', citations: [], truncated: false }, 'openai');
    generated.attempts = [
      { ...generated.attempts[0]!, ordinal: 1, provider: 'google', status: 'timeout', errorCategory: 'timeout', errorCode: 'provider_timeout' },
      { ...generated.attempts[0]!, ordinal: 2, provider: 'openai' },
    ];
    const provider: AiGenerationProvider = {
      async generateStructured<T extends object>() { return generated as AiGenerationResult<T>; },
    };
    const output = await createAiProfileRunner({ provider }).run(auditRequest({
      configuredProviderOrder: ['google', 'openai'],
    }));
    expect(output.provenance.fallbackUsed).toBe(true);
    expect(output.qualityFlags).toContain('provider_fallback');
  });

  it('never repeats a successful generation when the profile event write fails', async () => {
    const generateStructured = vi.fn();
    const provider: AiGenerationProvider = {
      async generateStructured<T extends object>() {
        generateStructured();
        return result({ summary: 'Safe.', citations: [], truncated: false }) as AiGenerationResult<T>;
      },
    };
    const onRecordError = vi.fn();
    const output = await createAiProfileRunner({
      provider,
      recordRun: vi.fn().mockRejectedValue(new Error('database unavailable')),
      onRecordError,
    }).run(auditRequest());
    expect(output.status).toBe('complete');
    expect(generateStructured).toHaveBeenCalledTimes(1);
    expect(onRecordError).toHaveBeenCalledWith('ai_profile_usage_event_write_failed');
  });

  const suggestionRow = (
    promptText: string,
    over: Partial<{ promptType: string; branded: boolean; evidenceRef: string }> = {},
  ) => ({
    promptText,
    funnelStage: 'consideration',
    promptType: 'problemFirst',
    intent: 'commercial',
    branded: false,
    evidenceSource: 'keyword',
    evidenceRef: 'audit tool',
    ...over,
  });

  const runSuggestions = async (prompts: object[], count = 4) =>
    createAiProfileRunner({
      provider: {
        async generateStructured<T extends object>() {
          return result({ prompts, citations: [] }) as AiGenerationResult<T>;
        },
      },
    }).run<{ prompts: { promptText: string }[]; citations: string[] }>({
      profile: 'ai_visibility_prompt_suggestions',
      input: {
        siteDomain: 'example.test',
        count,
        keywords: ['audit tool'],
        titles: [],
        competitors: [],
        gscQueries: ['how do i audit my site'],
      },
      locale: 'en',
      correlationId: 'prompt-invariants',
      usage: { accountId: 'account-1' },
      configuredProviderOrder: ['fake'],
    });

  it('removes prompt suggestions that violate the domain invariant and caps requested count', async () => {
    const output = await runSuggestions(
      [
        suggestionRow('buy example.test now'),
        suggestionRow('best audit tool'),
        suggestionRow('another safe prompt'),
      ],
      1,
    );
    expect(output.status).toBe('partial');
    expect(output.object.prompts.map((row) => row.promptText)).toEqual(['best audit tool']);
    expect(output.warnings).toContain('task_invariant_rejected');
  });

  it('drops suggestions whose evidenceRef is not one of the supplied seeds', async () => {
    const output = await runSuggestions([
      suggestionRow('grounded question', { evidenceRef: 'how do i audit my site' }),
      suggestionRow('invented question', { evidenceRef: 'never supplied' }),
    ]);
    expect(output.object.prompts.map((row) => row.promptText)).toEqual(['grounded question']);
    expect(output.warnings).toContain('task_invariant_rejected');
  });

  it('caps categoryDiscovery at 35% of the requested count', async () => {
    // ceiling = floor(4 * 0.35) = 1, so only the first "best X" row survives.
    const output = await runSuggestions([
      suggestionRow('best a', { promptType: 'categoryDiscovery' }),
      suggestionRow('best b', { promptType: 'categoryDiscovery' }),
      suggestionRow('best c', { promptType: 'categoryDiscovery' }),
      suggestionRow('problem d'),
    ]);
    expect(output.object.prompts.map((row) => row.promptText)).toEqual(['best a', 'problem d']);
    expect(output.warnings).toContain('task_invariant_rejected');
  });

  it('caps branded suggestions at 35% of the requested count', async () => {
    const output = await runSuggestions([
      suggestionRow('branded a', { branded: true }),
      suggestionRow('branded b', { branded: true }),
      suggestionRow('unbranded c'),
    ]);
    expect(output.object.prompts.map((row) => row.promptText)).toEqual([
      'branded a',
      'unbranded c',
    ]);
  });

  it('drops case-insensitive duplicate suggestions', async () => {
    const output = await runSuggestions([
      suggestionRow('Same Question'),
      suggestionRow('same question'),
    ]);
    expect(output.object.prompts).toHaveLength(1);
  });

  it('keeps a fully compliant suggestion set intact', async () => {
    const output = await runSuggestions([
      suggestionRow('problem a'),
      suggestionRow('problem b', { evidenceRef: 'how do i audit my site' }),
    ]);
    expect(output.object.prompts).toHaveLength(2);
    expect(output.warnings).not.toContain('task_invariant_rejected');
  });

  it('drops hostile disavow annotations that cite a row the rubric did not flag', async () => {
    const provider: AiGenerationProvider = {
      async generateStructured<T extends object>() {
        return result({
          rationales: [
            {
              rowId: 'unknown-row',
              rationale: 'Invented domain should not survive.',
              citations: ['unknown-row'],
            },
            {
              rowId: 'row-1',
              rationale: 'This one cites its stored row.',
              citations: ['row-1'],
            },
            {
              rowId: 'row-1',
              rationale: 'Duplicate attempts cannot replace the first.',
              citations: ['row-1'],
            },
          ],
          citations: [],
        }) as AiGenerationResult<T>;
      },
    };
    const output = await createAiProfileRunner({ provider }).run<{
      rationales: Array<{ rowId: string; rationale: string; citations: string[] }>;
      citations: string[];
    }>({
      profile: 'disavow_rationale',
      input: {
        rows: [
          {
            id: 'row-1',
            domain: 'flagged.example',
            spamScore: 75,
            band: 'toxic',
            isBroken: false,
            dofollow: true,
            rubricVersion: 'toxicity-rubric-v1',
          },
        ],
      },
      locale: 'en',
      correlationId: 'disavow-hostile',
      usage: { accountId: 'account-1' },
      configuredProviderOrder: ['fake'],
    });
    expect(output.object.rationales).toEqual([
      {
        rowId: 'row-1',
        rationale: 'This one cites its stored row.',
        citations: ['row-1'],
      },
    ]);
    expect(output.warnings).toContain('task_invariant_rejected');
    expect(JSON.stringify(output.object)).not.toContain('unknown-row');
  });

  it('drops disavow annotations with non-canonical row or citation ids', async () => {
    const provider: AiGenerationProvider = {
      async generateStructured<T extends object>() {
        return result({
          rationales: [
            {
              rowId: 'Bad Row',
              rationale: 'A malformed row id cannot enter the result.',
              citations: ['row-1'],
            },
            {
              rowId: 'row-1',
              rationale: 'A malformed citation cannot enter the result.',
              citations: ['Bad Citation'],
            },
            {
              rowId: 'row-1',
              rationale: 'A different canonical citation cannot enter the result.',
              citations: ['row-2'],
            },
            {
              rowId: 'row-1',
              rationale: 'The canonical stored-row citation survives.',
              citations: ['row-1'],
            },
          ],
          citations: [],
        }) as AiGenerationResult<T>;
      },
    };
    const output = await createAiProfileRunner({ provider }).run<{
      rationales: Array<{ rowId: string; rationale: string; citations: string[] }>;
      citations: string[];
    }>({
      profile: 'disavow_rationale',
      input: {
        rows: [
          {
            id: 'row-1',
            domain: 'flagged.example',
            spamScore: 75,
            band: 'toxic',
            isBroken: false,
            dofollow: true,
            rubricVersion: 'toxicity-rubric-v1',
          },
        ],
      },
      locale: 'en',
      correlationId: 'disavow-canonical-ids',
      usage: { accountId: 'account-1' },
      configuredProviderOrder: ['fake'],
    });
    expect(output.object.rationales).toEqual([
      {
        rowId: 'row-1',
        rationale: 'The canonical stored-row citation survives.',
        citations: ['row-1'],
      },
    ]);
    expect(output.warnings).toContain('task_invariant_rejected');
  });

  it('rejects a hostile disavow output that tries to change a stored rubric band', async () => {
    const provider: AiGenerationProvider = {
      async generateStructured<T extends object>() {
        return result({
          rationales: [
            {
              rowId: 'row-1',
              rationale: 'Attempted band rewrite.',
              citations: ['row-1'],
              band: 'clean',
            },
          ],
          citations: [],
        }) as AiGenerationResult<T>;
      },
    };
    await expect(
      createAiProfileRunner({ provider }).run({
        profile: 'disavow_rationale',
        input: {
          rows: [
            {
              id: 'row-1',
              domain: 'flagged.example',
              spamScore: 75,
              band: 'toxic',
              isBroken: false,
              dofollow: true,
              rubricVersion: 'toxicity-rubric-v1',
            },
          ],
        },
        locale: 'en',
        correlationId: 'disavow-band-rewrite',
        usage: { accountId: 'account-1' },
        configuredProviderOrder: ['fake'],
      }),
    ).rejects.toMatchObject({ name: 'AiMalformedOutputError' });
  });
});
