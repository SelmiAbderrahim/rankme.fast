/**
 * Covers the live `callChatAiSdk` seam — asserts the exact `streamText`
 * options (retries off, telemetry content excluded, step-bounded tool loop)
 * and that the returned iterable IS the SDK's fullStream.
 */
import { describe, expect, it, vi } from 'vitest';
import type * as AiModule from 'ai';

const mocks = vi.hoisted(() => ({
  streamText: vi.fn(),
}));

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof AiModule>();
  return { ...actual, streamText: mocks.streamText };
});

import { callChatAiSdk, type RawChatStreamPart } from './chat-runtime.js';
import type { AiSdkProviderAdapter } from './types.js';

describe('callChatAiSdk', () => {
  it('wraps streamText().fullStream with retries off and bounded steps', async () => {
    const fullStream = (async function* (): AsyncGenerator<RawChatStreamPart> {
      yield { type: 'text-delta', text: 'hi' };
    })();
    mocks.streamText.mockReturnValue({ fullStream });

    const languageModel = { modelId: 'x' } as unknown as AiSdkProviderAdapter['languageModel'];
    const execute = vi.fn(async () => ({ ok: true, structuredContent: {} }));
    const iterable = callChatAiSdk({
      adapter: {
        provider: 'glm',
        model: 'glm-model',
        languageModel,
        inputCostMicrosPerMillion: 10,
        outputCostMicrosPerMillion: 20,
      },
      system: 'system text',
      messages: [
        { role: 'user', text: 'hello' },
        { role: 'assistant', text: 'previous reply' },
      ],
      tools: {
        list_sites: {
          description: 'List sites',
          jsonSchema: { type: 'object', properties: {} },
          execute,
        },
      },
      maxOutputTokens: 2_048,
      temperature: 0,
      maxSteps: 5,
      signal: new AbortController().signal,
      telemetryEnabled: false,
      functionId: 'chat.v1',
    });

    expect(iterable).toBe(fullStream);
    expect(mocks.streamText).toHaveBeenCalledTimes(1);
    const options = mocks.streamText.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.model).toBe(languageModel);
    expect(options.system).toBe('system text');
    expect(options.messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'previous reply' },
    ]);
    expect(options.maxOutputTokens).toBe(2_048);
    expect(options.temperature).toBe(0);
    expect(options.maxRetries).toBe(0);
    expect(options.stopWhen).toBeDefined();
    expect(options.experimental_telemetry).toEqual({
      isEnabled: false,
      recordInputs: false,
      recordOutputs: false,
      functionId: 'chat.v1',
    });
    const tools = options.tools as Record<
      string,
      { execute: (args: unknown) => Promise<unknown> }
    >;
    await tools.list_sites!.execute({ a: 1 });
    expect(execute).toHaveBeenCalledWith({ a: 1 });
  });

  it('omits a provider-default temperature from streaming calls', () => {
    const fullStream = (async function* (): AsyncGenerator<RawChatStreamPart> {})();
    mocks.streamText.mockReturnValue({ fullStream });

    callChatAiSdk({
      adapter: {
        provider: 'kimi',
        model: 'kimi-k2.6',
        languageModel: { modelId: 'x' } as unknown as AiSdkProviderAdapter['languageModel'],
        inputCostMicrosPerMillion: 10,
        outputCostMicrosPerMillion: 20,
        temperatureHandling: 'provider-default',
        providerOptions: { moonshotai: { thinking: { type: 'disabled' } } },
      },
      system: 'system text',
      messages: [{ role: 'user', text: 'hello' }],
      tools: {},
      maxOutputTokens: 2_048,
      temperature: undefined,
      maxSteps: 5,
      signal: new AbortController().signal,
      telemetryEnabled: false,
      functionId: 'chat.v1',
    });

    const options = mocks.streamText.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(options).not.toHaveProperty('temperature');
    expect(options.providerOptions).toEqual({
      moonshotai: { thinking: { type: 'disabled' } },
    });
  });
});
