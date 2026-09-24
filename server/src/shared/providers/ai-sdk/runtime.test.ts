import { z } from 'zod';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import {
  AiAuthError,
  AiAvailabilityError,
  AiBudgetRefusalError,
  AiInvalidInputError,
  AiMalformedOutputError,
  AiProvidersExhaustedError,
  AiQuotaError,
  AiSafetyError,
  AiTimeoutError,
  type AiProviderKey,
  type GenerateStructuredInput,
} from '../ai-generation.js';
import { createOpenAiSdkAdapter } from './openai.js';
import {
  calculateAiCostMicros,
  createAiSdkGenerationProvider,
  estimateAiAttemptCostMicros,
  type AiSdkRuntimeConfig,
} from './runtime.js';
import type { AiSdkCall, AiSdkCallResult } from './executor.js';
import type { AiSdkProviderAdapter } from './types.js';

const outputSchema = z.object({ ok: z.boolean() });

function request(
  overrides: Partial<GenerateStructuredInput<{ ok: boolean }>> = {},
): GenerateStructuredInput<{ ok: boolean }> {
  return {
    task: 'runtime.contract',
    jsonSchema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    validationSchema: outputSchema,
    systemInstruction: { id: 'runtime.contract', version: 'v1', text: 'safe system' },
    sanitizedInput: 'bounded input',
    locale: 'en',
    maxOutputTokens: 10,
    temperature: { mode: 'deterministic' },
    correlationId: 'correlation-1',
    maxCostMicros: 1_000_000n,
    usage: { accountId: 'account-1', siteId: 'site-1', jobId: 'job-1' },
    ...overrides,
  };
}

function adapter(
  provider: AiProviderKey,
  inputRate = 1_000_000,
  outputRate = 1_000_000,
): AiSdkProviderAdapter {
  const base = createOpenAiSdkAdapter({
    apiKey: 'synthetic-key',
    model: `${provider}-model`,
    inputCostMicrosPerMillion: inputRate,
    outputCostMicrosPerMillion: outputRate,
  });
  return { ...base, provider, model: `${provider}-model` };
}

const success: AiSdkCallResult = {
  object: { ok: true },
  finishReason: 'stop',
  tokens: { input: 20, output: 4, cachedInput: 2, reasoning: 1 },
  warnings: [],
};

function provider(
  adapters: readonly AiSdkProviderAdapter[],
  call: AiSdkCall,
  overrides: Partial<AiSdkRuntimeConfig> = {},
) {
  return createAiSdkGenerationProvider({
    adapters,
    call,
    maxAttempts: adapters.length || 1,
    totalTimeoutMs: 1_000,
    telemetryEnabled: false,
    ...overrides,
  });
}

describe('AI SDK ordered generation runtime', () => {
  it('uses the production generateText executor with a deterministic SDK model', async () => {
    const model = new MockLanguageModelV3({
      provider: 'fixture',
      modelId: 'fixture-model',
      doGenerate: {
        content: [{ type: 'text', text: '{"ok":true}' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      },
    });
    const configured = adapter('glm');
    const result = await createAiSdkGenerationProvider({
      adapters: [{ ...configured, languageModel: model }],
      maxAttempts: 1,
      totalTimeoutMs: 1_000,
      telemetryEnabled: false,
    }).generateStructured(request());
    expect(result).toMatchObject({ provider: 'glm', object: { ok: true } });
  });

  it('calculates ceiling-rounded actual and configured costs in bigint micros', () => {
    const rates = adapter('glm', 1, 2);
    expect(calculateAiCostMicros({ input: 1, output: 1 }, rates)).toBe(2n);
    expect(calculateAiCostMicros({ input: null, output: 1 }, rates)).toBeNull();
    expect(estimateAiAttemptCostMicros(1_000_000, 500_000, rates)).toBe(2n);
  });

  it('returns the first success with actual usage and untrusted classification', async () => {
    const call = vi.fn<AiSdkCall>().mockResolvedValue(success);
    const result = await provider([adapter('glm')], call).generateStructured(request());
    expect(result).toMatchObject({
      trust: 'untrusted',
      object: { ok: true },
      provider: 'glm',
      model: 'glm-model',
      actualCostMicros: 24n,
      actualOrEstimatedCostMicros: 24n,
      warnings: [],
    });
    expect(result.attempts).toHaveLength(1);
    expect(call).toHaveBeenCalledWith(expect.objectContaining({
      temperature: 0,
      telemetryEnabled: false,
      functionId: 'runtime.contract.v1',
    }));
  });

  it('uses provider-default sampling for models that reject requested temperatures', async () => {
    const call = vi.fn<AiSdkCall>().mockResolvedValue(success);
    const kimi = {
      ...adapter('kimi'),
      temperatureHandling: 'provider-default' as const,
    };

    await provider([kimi], call).generateStructured(request({
      temperature: { mode: 'creative', value: 0.4 },
    }));

    expect(call).toHaveBeenCalledWith(expect.objectContaining({
      adapter: kimi,
      temperature: undefined,
    }));
  });

  it('continues through every retryable order transition and succeeds', async () => {
    const call = vi.fn<AiSdkCall>()
      .mockRejectedValueOnce(new AiTimeoutError())
      .mockRejectedValueOnce(new AiQuotaError())
      .mockRejectedValueOnce(new AiAvailabilityError())
      .mockRejectedValueOnce(new AiMalformedOutputError())
      .mockResolvedValueOnce(success);
    const adapters = (['glm', 'deepseek', 'kimi', 'openai', 'google'] as const).map(
      (key) => adapter(key),
    );
    const result = await provider(adapters, call).generateStructured(request());
    expect(result.provider).toBe('google');
    expect(result.attempts.map((attempt) => attempt.status)).toEqual([
      'timeout', 'quota', 'availability', 'malformed_output', 'success',
    ]);
    expect(result.attempts.map((attempt) => attempt.errorCode).join(',')).not.toContain(
      'raw prose',
    );
  });

  it('treats Zod mismatch after JSON Schema output as retryable malformed output', async () => {
    const call = vi.fn<AiSdkCall>()
      .mockResolvedValueOnce({ ...success, object: { ok: 'not-boolean' } })
      .mockResolvedValueOnce(success);
    const result = await provider(
      [adapter('glm'), adapter('deepseek')],
      call,
    ).generateStructured(request());
    expect(result.provider).toBe('deepseek');
    expect(result.attempts[0]).toMatchObject({
      status: 'malformed_output',
      errorCode: 'provider_malformed_output',
    });
  });

  it.each([
    [new AiAuthError(), AiAuthError, 'auth'],
    [new AiSafetyError(), AiSafetyError, 'safety'],
    [new AiInvalidInputError(), AiInvalidInputError, 'invalid_input'],
    [new AiBudgetRefusalError(), AiBudgetRefusalError, 'budget_refusal'],
  ] as const)('stops immediately on a non-retryable failure', async (error, errorClass, status) => {
    const call = vi.fn<AiSdkCall>().mockRejectedValue(error);
    const persist = vi.fn<NonNullable<AiSdkRuntimeConfig['persistAttempts']>>();
    await expect(
      provider([adapter('glm'), adapter('deepseek')], call, { persistAttempts: persist })
        .generateStructured(request()),
    ).rejects.toBeInstanceOf(errorClass);
    expect(call).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0]?.[0].attempts[0]?.status).toBe(status);
  });

  it('honors the call-attempt limit independently of provider order', async () => {
    const call = vi.fn<AiSdkCall>().mockRejectedValue(new AiAvailabilityError());
    await expect(
      provider([adapter('glm'), adapter('deepseek'), adapter('kimi')], call, {
        maxAttempts: 2,
      }).generateStructured(request()),
    ).rejects.toBeInstanceOf(AiProvidersExhaustedError);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('reports no-provider state without making a call', async () => {
    const call = vi.fn<AiSdkCall>();
    await expect(provider([], call).generateStructured(request())).rejects.toBeInstanceOf(
      AiProvidersExhaustedError,
    );
    expect(call).not.toHaveBeenCalled();
  });

  it('skips an unaffordable provider and uses the next affordable provider', async () => {
    const call = vi.fn<AiSdkCall>().mockResolvedValue(success);
    const result = await provider(
      [adapter('glm', 100_000_000, 100_000_000), adapter('deepseek', 1, 1)],
      call,
    ).generateStructured(request({ maxCostMicros: 1_000n }));
    expect(result.provider).toBe('deepseek');
    expect(result.attempts[0]?.status).toBe('budget_skipped');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('refuses before calls when every provider exceeds the request budget', async () => {
    const call = vi.fn<AiSdkCall>();
    await expect(
      provider([adapter('glm', 100_000_000, 100_000_000)], call)
        .generateStructured(request({ maxCostMicros: 1n })),
    ).rejects.toBeInstanceOf(AiBudgetRefusalError);
    expect(call).not.toHaveBeenCalled();
  });

  it('uses the conservative configured estimate when usage is missing', async () => {
    const call = vi.fn<AiSdkCall>().mockResolvedValue({
      ...success,
      tokens: { input: null, output: null, cachedInput: null, reasoning: null },
    });
    const result = await provider([adapter('glm')], call).generateStructured(request());
    expect(result.actualCostMicros).toBeNull();
    expect(result.actualOrEstimatedCostMicros).toBeGreaterThan(0n);
    expect(result.warnings).toContain('usage_estimated');
    expect(result.attempts[0]?.costSource).toBe('estimated');
  });

  it('trips the account circuit before any provider call and records it', async () => {
    const call = vi.fn<AiSdkCall>();
    const persist = vi.fn<NonNullable<AiSdkRuntimeConfig['persistAttempts']>>();
    await expect(provider([adapter('glm')], call, {
      spendGuard: {
        windowMs: 60_000,
        limitMicros: 100n,
        getAccountSpendMicros: vi.fn().mockResolvedValue(100n),
      },
      persistAttempts: persist,
    }).generateStructured(request())).rejects.toMatchObject({
      code: 'account_budget_circuit_open',
    });
    expect(call).not.toHaveBeenCalled();
    expect(persist.mock.calls[0]?.[0].attempts[0]?.status).toBe('budget_circuit_open');
  });

  it('continues when account spend remains below the circuit limit', async () => {
    const call = vi.fn<AiSdkCall>().mockResolvedValue(success);
    await expect(provider([adapter('glm')], call, {
      spendGuard: {
        windowMs: 60_000,
        limitMicros: 100n,
        getAccountSpendMicros: vi.fn().mockResolvedValue(99n),
      },
    }).generateStructured(request())).resolves.toMatchObject({ provider: 'glm' });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('does not repeat paid generation when usage persistence fails', async () => {
    const call = vi.fn<AiSdkCall>().mockResolvedValue(success);
    const alert = vi.fn();
    const result = await provider([adapter('glm')], call, {
      persistAttempts: vi.fn().mockRejectedValue(new Error('db unavailable')),
      onPersistenceError: alert,
    }).generateStructured(request());
    expect(result.object).toEqual({ ok: true });
    expect(call).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('ai_usage_event_write_failed');
  });

  it('maps the total deadline to a non-retryable global deadline', async () => {
    const call: AiSdkCall = ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new AiTimeoutError()), { once: true });
    });
    await expect(provider([adapter('glm'), adapter('deepseek')], call, {
      totalTimeoutMs: 5,
    }).generateStructured(request())).rejects.toMatchObject({
      code: 'global_deadline_exceeded',
      retryable: false,
    });
  });

  it('stops a caller cancellation and validates bounded inputs before calls', async () => {
    const controller = new AbortController();
    controller.abort();
    const call = vi.fn<AiSdkCall>().mockResolvedValue(success);
    await expect(
      provider([adapter('glm')], call).generateStructured(request({ signal: controller.signal })),
    ).rejects.toMatchObject({ code: 'request_cancelled' });
    await expect(
      provider([adapter('glm')], call).generateStructured(request({ maxOutputTokens: 0 })),
    ).rejects.toBeInstanceOf(AiInvalidInputError);
    expect(call).not.toHaveBeenCalled();
  });

  it('honors cancellation and deadline signals even when a call resolves after abort', async () => {
    const caller = new AbortController();
    const cancelCall: AiSdkCall = async () => {
      caller.abort();
      return success;
    };
    await expect(provider([adapter('glm')], cancelCall).generateStructured(
      request({ signal: caller.signal }),
    )).rejects.toMatchObject({ code: 'request_cancelled' });

    vi.useFakeTimers();
    try {
      const lateCall: AiSdkCall = ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve(success), { once: true });
      });
      const pending = provider([adapter('glm')], lateCall, {
        totalTimeoutMs: 5,
      }).generateStructured(request());
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'global_deadline_exceeded',
      });
      await vi.advanceTimersByTimeAsync(5);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('normalizes an unexpected adapter failure and tolerates a missing persistence alert hook', async () => {
    const invalidCall = vi.fn<AiSdkCall>().mockRejectedValue(new Error('raw adapter prose'));
    await expect(provider([adapter('glm')], invalidCall).generateStructured(request()))
      .rejects.toMatchObject({ code: 'invalid_generation_input' });

    const result = await provider([adapter('glm')], vi.fn<AiSdkCall>().mockResolvedValue(success), {
      persistAttempts: vi.fn().mockRejectedValue(new Error('db unavailable')),
    }).generateStructured(request());
    expect(result.object).toEqual({ ok: true });
  });

  it('applies the creative temperature and deduplicates only fixed warning codes', async () => {
    const call = vi.fn<AiSdkCall>().mockResolvedValue({
      ...success,
      tokens: { input: null, output: null, cachedInput: null, reasoning: null },
      warnings: ['provider_warning_suppressed', 'provider_warning_suppressed'],
    });
    const result = await provider([adapter('glm')], call).generateStructured(request({
      temperature: { mode: 'creative', value: 0.4 },
    }));
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.4 }));
    expect(result.warnings).toEqual(['provider_warning_suppressed', 'usage_estimated']);
    expect(JSON.stringify(result.warnings)).not.toContain('vendor prose');
  });

  it('rejects a request whose bounded input plus output exceeds the profile total ceiling', async () => {
    const call = vi.fn<AiSdkCall>().mockResolvedValue(success);
    await expect(provider([adapter('glm')], call).generateStructured(request({
      maxOutputTokens: 10,
      maxTotalTokens: 10,
      sanitizedInput: 'bounded but non-empty input',
    }))).rejects.toBeInstanceOf(AiInvalidInputError);
    expect(call).not.toHaveBeenCalled();
  });
});
