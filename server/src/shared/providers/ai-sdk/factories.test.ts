import { describe, expect, it } from 'vitest';
import { createAnthropicAiSdkAdapter } from './anthropic.js';
import { createDeepSeekAiSdkAdapter } from './deepseek.js';
import { createGlmAiSdkAdapter, transformGlmRequestBody } from './glm.js';
import { createGoogleAiSdkAdapter } from './google.js';
import { createKimiAiSdkAdapter } from './kimi.js';
import { createOpenAiSdkAdapter } from './openai.js';
import { callAiSdk } from './executor.js';

const config = {
  apiKey: 'synthetic-test-key',
  model: 'configured-model',
  inputCostMicrosPerMillion: 100,
  outputCostMicrosPerMillion: 200,
};

describe('AI SDK provider factories', () => {
  it.each([
    ['glm', () => createGlmAiSdkAdapter({ ...config, baseUrl: 'https://glm.example/v1' })],
    ['deepseek', () => createDeepSeekAiSdkAdapter(config)],
    ['kimi', () => createKimiAiSdkAdapter(config)],
    ['openai', () => createOpenAiSdkAdapter(config)],
    ['google', () => createGoogleAiSdkAdapter(config)],
    ['anthropic', () => createAnthropicAiSdkAdapter(config)],
  ] as const)('creates the %s model from configured values', (provider, create) => {
    const adapter = create();
    expect(adapter).toMatchObject({
      provider,
      model: 'configured-model',
      inputCostMicrosPerMillion: 100,
      outputCostMicrosPerMillion: 200,
    });
    expect(adapter.temperatureHandling).toBe(
      provider === 'kimi' ? 'provider-default' : undefined,
    );
    expect(adapter.providerOptions).toEqual(
      provider === 'kimi'
        ? { moonshotai: { thinking: { type: 'disabled' } } }
        : undefined,
    );
    expect(typeof adapter.languageModel).toBe('object');
    if (typeof adapter.languageModel === 'object' && 'modelId' in adapter.languageModel) {
      expect(adapter.languageModel.modelId).toBe('configured-model');
      expect(adapter.languageModel.provider).toContain(provider === 'kimi' ? 'moonshot' : provider);
    }
  });

  it.each([
    ['glm', () => createGlmAiSdkAdapter({ ...config, baseUrl: 'https://glm.example/v1', fetch: fetchFn })],
    ['deepseek', () => createDeepSeekAiSdkAdapter({ ...config, fetch: fetchFn })],
    ['kimi', () => createKimiAiSdkAdapter({ ...config, fetch: fetchFn })],
    ['openai', () => createOpenAiSdkAdapter({ ...config, fetch: fetchFn })],
    ['google', () => createGoogleAiSdkAdapter({ ...config, fetch: fetchFn })],
    ['anthropic', () => createAnthropicAiSdkAdapter({ ...config, fetch: fetchFn })],
  ] as const)('threads an injected fetch through the confined %s factory', (_provider, create) => {
    const adapter = create();
    expect(typeof adapter.languageModel).toBe('object');
  });

  async function fetchFn(): Promise<Response> {
    return new Response('{}');
  }

  it('uses Z.ai JSON mode and places the schema in the system message', async () => {
    let body: Record<string, unknown> = {};
    const adapter = createGlmAiSdkAdapter({
      ...config,
      baseUrl: 'https://glm.example/v1',
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          id: 'synthetic',
          created: 0,
          model: config.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{"ok":true}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    });
    const schema = {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    };

    await expect(
      callAiSdk({
        adapter,
        jsonSchema: schema,
        system: 'Return the requested object.',
        prompt: 'Synthetic input.',
        maxOutputTokens: 20,
        temperature: 0,
        signal: new AbortController().signal,
        telemetryEnabled: false,
        functionId: 'glm-json-mode-test',
      }),
    ).resolves.toMatchObject({ object: { ok: true } });

    expect(body.response_format).toEqual({ type: 'json_object' });
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages.find((message) => message.role === 'system')?.content).toContain(
      JSON.stringify(schema),
    );
  });

  it('omits Kimi temperature while retaining native structured output', async () => {
    let body: Record<string, unknown> = {};
    const adapter = createKimiAiSdkAdapter({
      ...config,
      model: 'kimi-k2.6',
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({
          id: 'synthetic',
          created: 0,
          model: 'kimi-k2.6',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{"ok":true}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
      },
    });

    await expect(
      callAiSdk({
        adapter,
        jsonSchema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
        },
        system: 'Return the requested object.',
        prompt: 'Synthetic input.',
        maxOutputTokens: 128,
        temperature: undefined,
        signal: new AbortController().signal,
        telemetryEnabled: false,
        functionId: 'kimi-native-structured-output-test',
      }),
    ).resolves.toMatchObject({ object: { ok: true } });

    expect(body).not.toHaveProperty('temperature');
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.response_format).toMatchObject({ type: 'json_schema' });
  });
});

describe('transformGlmRequestBody', () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };

  it.each([
    ['no response_format at all', { messages: [] }],
    ['a null response_format', { response_format: null, messages: [] }],
    ['a plain json_object response_format', { response_format: { type: 'json_object' } }],
    [
      'a json_schema response_format with no json_schema object',
      { response_format: { type: 'json_schema' } },
    ],
    [
      'a json_schema response_format whose json_schema carries no schema',
      { response_format: { type: 'json_schema', json_schema: { name: 'result' } } },
    ],
  ])('passes the body through unchanged for %s', (_case, args) => {
    expect(transformGlmRequestBody(args)).toBe(args);
  });

  it('prepends a system message carrying the schema when the body has none', () => {
    const transformed = transformGlmRequestBody({
      response_format: { type: 'json_schema', json_schema: { schema } },
      messages: [{ role: 'user', content: 'Synthetic input.' }],
    });

    expect(transformed.response_format).toEqual({ type: 'json_object' });
    const messages = transformed.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain(JSON.stringify(schema));
    expect(messages[1]).toEqual({ role: 'user', content: 'Synthetic input.' });
  });

  it('creates the message list when the body carries no messages array', () => {
    const transformed = transformGlmRequestBody({
      response_format: { type: 'json_schema', json_schema: { schema } },
    });

    const messages = transformed.messages as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('system');
  });

  it('appends to a non-string system content and skips non-record messages', () => {
    const transformed = transformGlmRequestBody({
      response_format: { type: 'json_schema', json_schema: { schema } },
      messages: ['not-a-record', { role: 'system', content: 42 }],
    });

    const messages = transformed.messages as Array<unknown>;
    expect(messages[0]).toBe('not-a-record');
    expect(messages[1]).toEqual({
      role: 'system',
      content: `\nReturn only JSON matching this schema exactly:\n${JSON.stringify(schema)}`,
    });
  });
});
