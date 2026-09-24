import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { AiMalformedOutputError, AiQuotaError, AiTimeoutError, type AiProviderKey } from '../ai-generation.js';
import { loadFixture } from '../../testing/fixtures/load.js';
import { createAnthropicAiSdkAdapter } from './anthropic.js';
import { createDeepSeekAiSdkAdapter } from './deepseek.js';
import { createGlmAiSdkAdapter } from './glm.js';
import { createGoogleAiSdkAdapter } from './google.js';
import { createKimiAiSdkAdapter } from './kimi.js';
import { createOpenAiSdkAdapter } from './openai.js';
import { createAiSdkGenerationProvider, type AiSdkRuntimeConfig } from './runtime.js';
import type { AiSdkCall, AiSdkCallResult } from './executor.js';
import type { AiSdkProviderAdapter, AiSdkProviderFactoryConfig } from './types.js';

const rawResultSchema = z.object({
  output: z.unknown(),
  finishReason: z.literal('stop'),
  usage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cachedInputTokens: z.number().optional(),
    reasoningTokens: z.number().optional(),
  }),
  warnings: z.array(z.unknown()).optional(),
});
const quotaSchema = z.object({ statusCode: z.literal(429), code: z.string() });

const base: AiSdkProviderFactoryConfig = {
  apiKey: 'synthetic-fixture-key',
  model: 'fixture-model',
  inputCostMicrosPerMillion: 10,
  outputCostMicrosPerMillion: 20,
};

const factories: Readonly<Record<AiProviderKey, () => AiSdkProviderAdapter>> = {
  glm: () => createGlmAiSdkAdapter({ ...base, baseUrl: 'https://glm.example.test/v1' }),
  deepseek: () => createDeepSeekAiSdkAdapter(base),
  kimi: () => createKimiAiSdkAdapter(base),
  openai: () => createOpenAiSdkAdapter(base),
  google: () => createGoogleAiSdkAdapter(base),
  anthropic: () => createAnthropicAiSdkAdapter(base),
};

function request() {
  return {
    task: 'runtime.contract' as const,
    jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    validationSchema: z.object({ ok: z.boolean() }),
    systemInstruction: { id: 'contract', version: 'v1', text: 'synthetic' },
    sanitizedInput: 'synthetic',
    locale: 'en' as const,
    maxOutputTokens: 10,
    temperature: { mode: 'deterministic' as const },
    correlationId: 'contract-fixture',
    maxCostMicros: 1_000n,
    usage: { accountId: 'fixture-account' },
  };
}

function successCall(provider: AiProviderKey, kase: 'success' | 'malformed'): AiSdkCall {
  const fixture = rawResultSchema.parse(loadFixture(`ai-sdk-${provider}`, 'generate', kase).body);
  const result: AiSdkCallResult = {
    object: fixture.output,
    finishReason: fixture.finishReason,
    tokens: {
      input: fixture.usage.inputTokens,
      output: fixture.usage.outputTokens,
      cachedInput: fixture.usage.cachedInputTokens ?? null,
      reasoning: fixture.usage.reasoningTokens ?? null,
    },
    warnings: [],
  };
  return async () => result;
}

describe('six-provider AI SDK normalized fixture contract', () => {
  it.each(Object.keys(factories) as AiProviderKey[])(
    '%s normalizes success, timeout, malformed, and quota fixtures',
    async (providerKey) => {
      const adapter = factories[providerKey]();
      const persist = vi.fn<NonNullable<AiSdkRuntimeConfig['persistAttempts']>>();
      const makeRuntime = (call: AiSdkCall) => createAiSdkGenerationProvider({
        adapters: [adapter],
        maxAttempts: 1,
        totalTimeoutMs: 1_000,
        telemetryEnabled: false,
        call,
        persistAttempts: persist,
      });

      await expect(makeRuntime(successCall(providerKey, 'success')).generateStructured(request()))
        .resolves.toMatchObject({ provider: providerKey, object: { ok: true } });

      await expect(makeRuntime(successCall(providerKey, 'malformed')).generateStructured(request()))
        .rejects.toMatchObject({ code: 'all_providers_exhausted' });
      expect(persist.mock.calls.at(-1)?.[0].attempts[0]).toMatchObject({
        status: 'malformed_output',
        errorCode: 'provider_malformed_output',
      });

      expect(loadFixture(`ai-sdk-${providerKey}`, 'generate', 'timeout')).toMatchObject({
        timeout: true,
        status: 0,
        body: null,
      });
      await expect(makeRuntime(async () => { throw new AiTimeoutError(); }).generateStructured(request()))
        .rejects.toMatchObject({ code: 'all_providers_exhausted' });
      expect(persist.mock.calls.at(-1)?.[0].attempts[0]?.status).toBe('timeout');

      expect(quotaSchema.parse(loadFixture(`ai-sdk-${providerKey}`, 'generate', 'quota').body))
        .toMatchObject({ statusCode: 429 });
      await expect(makeRuntime(async () => { throw new AiQuotaError(); }).generateStructured(request()))
        .rejects.toMatchObject({ code: 'all_providers_exhausted' });
      expect(persist.mock.calls.at(-1)?.[0].attempts[0]?.status).toBe('quota');
    },
  );

  it('the malformed fixture represents the repository Zod mismatch boundary', () => {
    expect(() => z.object({ ok: z.boolean() }).parse(
      rawResultSchema.parse(loadFixture('ai-sdk-glm', 'generate', 'malformed').body).output,
    )).toThrow();
    expect(new AiMalformedOutputError().message).toBe('provider_malformed_output');
  });
});
