import { describe, expect, it, vi } from 'vitest';
import { envSchema, type Env } from '../../config/env.js';
import { db } from '../../db/client.js';
import { createAiChatProviderFromEnv } from './ai-chat-registry.js';
import type { AiChatSdkCall, RawChatStreamPart } from './ai-sdk/chat-runtime.js';
import type { AiChatStreamEvent, AiChatStreamInput } from './ai-chat.js';
import {
  getChatAiProvider,
  setChatAiProvider,
} from '../../modules/chat/index.js';

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
    AI_PROVIDER_ORDER: 'glm,deepseek',
    AI_MAX_ATTEMPTS: '2',
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
    ...overrides,
  });
}

function input(): AiChatStreamInput {
  return {
    messages: [{ role: 'user', text: 'hello' }],
    responseLocale: 'en',
    systemInstruction: { id: 'chat', version: 'v1', text: 'system' },
    tools: {},
    maxOutputTokens: 64,
    temperature: { mode: 'deterministic' },
    maxSteps: 3,
    maxCostMicros: 1_000n,
    usage: { accountId: 'account-1' },
    task: 'runtime.contract',
    correlationId: 'chat-registry-fixture',
  };
}

async function collect(iterable: AsyncIterable<AiChatStreamEvent>) {
  const events: AiChatStreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('AI chat provider registry', () => {
  it('boots the default fake chat provider without keys', async () => {
    const provider = createAiChatProviderFromEnv(parseEnv(baseEnv));
    const events = await collect(provider.streamChat(input()));
    expect(events.at(-1)).toMatchObject({ type: 'finish', provider: 'fake' });
  });

  it('builds the streaming runtime over the shared adapter order in ai-sdk mode', async () => {
    const seen: string[] = [];
    const call: AiChatSdkCall = ({ adapter }) => {
      seen.push(adapter.provider);
      return (async function* (): AsyncGenerator<RawChatStreamPart> {
        if (adapter.provider !== 'deepseek') throw new Error('down');
        yield { type: 'text-delta', text: 'live' };
        yield {
          type: 'finish',
          finishReason: 'stop',
          totalUsage: { inputTokens: 1, outputTokens: 1 },
        };
      })();
    };
    const provider = createAiChatProviderFromEnv(liveEnv(), { db: null, call });
    const events = await collect(provider.streamChat(input()));
    expect(events.at(-1)).toMatchObject({ type: 'finish', provider: 'deepseek' });
    expect(seen).toEqual(['glm', 'deepseek']);
  });

  it('fails loudly when ai-sdk mode has no enabled ordered provider', () => {
    const configured = liveEnv();
    expect(() =>
      createAiChatProviderFromEnv({
        ...configured,
        GLM_ENABLED: false,
        DEEPSEEK_ENABLED: false,
      }),
    ).toThrow(/at least one enabled/);
  });

  it('constructs the database-backed usage store + spend guard without making a call', () => {
    const withStore = createAiChatProviderFromEnv(liveEnv(), { db });
    const withoutStore = createAiChatProviderFromEnv(liveEnv(), { db: null });
    expect(withStore).toHaveProperty('streamChat');
    expect(withoutStore).toHaveProperty('streamChat');
  });

  it('routes a custom persistence-error callback through the runtime config', async () => {
    const onPersistenceError = vi.fn();
    const call: AiChatSdkCall = () =>
      (async function* (): AsyncGenerator<RawChatStreamPart> {
        yield {
          type: 'finish',
          finishReason: 'stop',
          totalUsage: { inputTokens: 1, outputTokens: 1 },
        };
      })();
    const provider = createAiChatProviderFromEnv(liveEnv(), {
      db: null,
      call,
      onPersistenceError,
    });
    // No usage store when db is null → persistence path is a no-op; the
    // callback simply threads through construction.
    await collect(provider.streamChat(input()));
    expect(onPersistenceError).not.toHaveBeenCalled();
  });
});

describe('chat holders', () => {
  it('loud-throw before set, return after set, and reset to null', () => {
    setChatAiProvider(null);
    expect(() => getChatAiProvider()).toThrow(/Chat AI provider not initialized/);
    const provider = createAiChatProviderFromEnv(parseEnv(baseEnv));
    setChatAiProvider(provider);
    expect(getChatAiProvider()).toBe(provider);
    setChatAiProvider(null);
  });
});
