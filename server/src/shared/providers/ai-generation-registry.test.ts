import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { envSchema, type Env } from '../../config/env.js';
import { AiTimeoutError, type GenerateStructuredInput } from './ai-generation.js';
import { db } from '../../db/client.js';
import {
  createAiGenerationProviderFromEnv,
  getAiGenerationProvider,
  reportAiUsagePersistenceError,
} from './ai-generation-registry.js';
import type { AiSdkCall } from './ai-sdk/executor.js';

const baseEnv = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/x',
  DATABASE_URL: 'postgres://rankme:rankme@127.0.0.1:5432/x',
  BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  MASTER_ENCRYPTION_KEY: '0'.repeat(64),
};

function parseEnv(values: Record<string, unknown>): Env {
  const parsed = envSchema.parse(values);
  return { ...parsed, APP_URL: parsed.APP_URL ?? parsed.CLIENT_URL };
}

function liveEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    ...baseEnv,
    PROVIDER_AI: 'ai-sdk',
    AI_PROVIDER_ORDER: 'glm,deepseek,kimi,openai,google,anthropic',
    AI_MAX_ATTEMPTS: '6',
    GLM_ENABLED: 'true',
    GLM_API_KEY: 'glm-fixture',
    GLM_MODEL: 'glm-model',
    GLM_BASE_URL: 'https://glm.example.test/v1',
    GLM_INPUT_COST_MICROS_PER_MILLION: '1',
    GLM_OUTPUT_COST_MICROS_PER_MILLION: '1',
    DEEPSEEK_ENABLED: 'true',
    DEEPSEEK_API_KEY: 'deepseek-fixture',
    DEEPSEEK_MODEL: 'deepseek-model',
    DEEPSEEK_INPUT_COST_MICROS_PER_MILLION: '1',
    DEEPSEEK_OUTPUT_COST_MICROS_PER_MILLION: '1',
    KIMI_ENABLED: 'true',
    KIMI_API_KEY: 'kimi-fixture',
    KIMI_MODEL: 'kimi-model',
    KIMI_INPUT_COST_MICROS_PER_MILLION: '1',
    KIMI_OUTPUT_COST_MICROS_PER_MILLION: '1',
    OPENAI_ENABLED: 'true',
    OPENAI_API_KEY: 'openai-fixture',
    OPENAI_MODEL: 'openai-model',
    OPENAI_INPUT_COST_MICROS_PER_MILLION: '1',
    OPENAI_OUTPUT_COST_MICROS_PER_MILLION: '1',
    GOOGLE_ENABLED: 'true',
    GOOGLE_GENERATIVE_AI_API_KEY: 'google-fixture',
    GOOGLE_MODEL: 'google-model',
    GOOGLE_INPUT_COST_MICROS_PER_MILLION: '1',
    GOOGLE_OUTPUT_COST_MICROS_PER_MILLION: '1',
    ANTHROPIC_ENABLED: 'true',
    ANTHROPIC_API_KEY: 'anthropic-fixture',
    ANTHROPIC_MODEL: 'anthropic-model',
    ANTHROPIC_INPUT_COST_MICROS_PER_MILLION: '1',
    ANTHROPIC_OUTPUT_COST_MICROS_PER_MILLION: '1',
    ...overrides,
  });
}

function input(): GenerateStructuredInput<{ ok: boolean }> {
  return {
    task: 'runtime.contract',
    jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    validationSchema: z.object({ ok: z.boolean() }),
    systemInstruction: { id: 'registry', version: 'v1', text: 'synthetic' },
    sanitizedInput: 'synthetic',
    locale: 'en',
    maxOutputTokens: 10,
    temperature: { mode: 'deterministic' },
    correlationId: 'registry-fixture',
    maxCostMicros: 100n,
    usage: { accountId: 'account-1' },
  };
}

describe('AI generation provider registry', () => {
  it('boots the default fake without keys', async () => {
    const provider = createAiGenerationProviderFromEnv(parseEnv(baseEnv));
    await expect(provider.generateStructured(input())).resolves.toMatchObject({
      provider: 'fake',
      object: { ok: true },
    });
  });

  it('instantiates and traverses all six official/configured factories in exact order', async () => {
    const seen: string[] = [];
    const call: AiSdkCall = async ({ adapter }) => {
      seen.push(adapter.provider);
      if (adapter.provider !== 'anthropic') throw new AiTimeoutError();
      return {
        object: { ok: true },
        finishReason: 'stop',
        tokens: { input: 1, output: 1, cachedInput: null, reasoning: null },
        warnings: [],
      };
    };
    const provider = createAiGenerationProviderFromEnv(liveEnv(), { db: null, call });
    await expect(provider.generateStructured(input())).resolves.toMatchObject({
      provider: 'anthropic',
      model: 'anthropic-model',
    });
    expect(seen).toEqual(['glm', 'deepseek', 'kimi', 'openai', 'google', 'anthropic']);
    expect(provider).not.toHaveProperty('apiKey');
  });

  it('skips disabled providers deterministically', async () => {
    const configured = liveEnv({
      AI_PROVIDER_ORDER: 'glm,openai',
      AI_MAX_ATTEMPTS: '2',
      GLM_ENABLED: 'false',
      DEEPSEEK_ENABLED: 'false',
      KIMI_ENABLED: 'false',
      GOOGLE_ENABLED: 'false',
      ANTHROPIC_ENABLED: 'false',
    });
    const call = vi.fn<AiSdkCall>().mockResolvedValue({
      object: { ok: true },
      finishReason: 'stop',
      tokens: { input: 1, output: 1, cachedInput: null, reasoning: null },
      warnings: [],
    });
    const provider = createAiGenerationProviderFromEnv(configured, { db: null, call });
    await expect(provider.generateStructured(input())).resolves.toMatchObject({
      provider: 'openai',
    });
    expect(call.mock.calls[0]?.[0].adapter.provider).toBe('openai');
  });

  it('keeps a direct invalid startup invocation loud even before a vendor call', () => {
    const configured = liveEnv();
    expect(() => createAiGenerationProviderFromEnv({
      ...configured,
      GLM_API_KEY: undefined,
    })).toThrow(/GLM_API_KEY/);
    expect(() => createAiGenerationProviderFromEnv({
      ...configured,
      GLM_ENABLED: false,
      DEEPSEEK_ENABLED: false,
      KIMI_ENABLED: false,
      OPENAI_ENABLED: false,
      GOOGLE_ENABLED: false,
      ANTHROPIC_ENABLED: false,
    })).toThrow(/at least one enabled/);
  });

  it('constructs the default live executor and database-backed usage store without making a call', () => {
    const withoutStore = createAiGenerationProviderFromEnv(liveEnv(), { db: null });
    const withStore = createAiGenerationProviderFromEnv(liveEnv(), { db });
    expect(withoutStore).toHaveProperty('generateStructured');
    expect(withStore).toHaveProperty('generateStructured');
  });

  it('reports persistence failure through a fixed-code operational alert', async () => {
    const alert = vi.fn().mockResolvedValue({ delivered: true });
    await reportAiUsagePersistenceError('ai_usage_event_write_failed', alert);
    expect(alert).toHaveBeenCalledWith({
      subject: 'AI usage event persistence failed',
      body: { code: 'ai_usage_event_write_failed' },
    });
  });

  it('returns a stable keyless process singleton', () => {
    expect(getAiGenerationProvider()).toBe(getAiGenerationProvider());
  });
});
