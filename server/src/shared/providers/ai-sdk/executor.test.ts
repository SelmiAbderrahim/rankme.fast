import { APICallError, InvalidPromptError, LoadAPIKeyError, NoObjectGeneratedError } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiAuthError,
  AiAvailabilityError,
  AiInvalidInputError,
  AiMalformedOutputError,
  AiQuotaError,
  AiSafetyError,
  AiTimeoutError,
} from '../ai-generation.js';
import {
  buildAiSdkGenerateOptions,
  createAiSdkCall,
  normalizeAiSdkError,
  type AiSdkCallInput,
  type AiSdkGenerate,
} from './executor.js';
import { createOpenAiSdkAdapter } from './openai.js';

const adapter = createOpenAiSdkAdapter({
  apiKey: 'synthetic-key',
  model: 'configured-model',
  inputCostMicrosPerMillion: 100,
  outputCostMicrosPerMillion: 200,
});

const usage = {
  inputTokens: 10,
  inputTokenDetails: { noCacheTokens: 8, cacheReadTokens: 2, cacheWriteTokens: undefined },
  outputTokens: 4,
  outputTokenDetails: { textTokens: 3, reasoningTokens: 1 },
  totalTokens: 14,
};

function input(signal: AbortSignal = new AbortController().signal): AiSdkCallInput {
  return {
    adapter,
    jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
    system: 'private system instruction',
    prompt: 'private sanitized input',
    maxOutputTokens: 100,
    temperature: 0,
    signal,
    telemetryEnabled: true,
    functionId: 'runtime.contract.v1',
  };
}

const generate = vi.fn<AiSdkGenerate>();
const call = createAiSdkCall(generate);

beforeEach(() => generate.mockReset());

describe('AI SDK structured executor', () => {
  it('builds structured generateText options with retries off and telemetry content excluded', () => {
    expect(buildAiSdkGenerateOptions(input())).toMatchObject({
      model: adapter.languageModel,
      system: 'private system instruction',
      prompt: 'private sanitized input',
      maxOutputTokens: 100,
      temperature: 0,
      maxRetries: 0,
      experimental_telemetry: {
        isEnabled: true,
        recordInputs: false,
        recordOutputs: false,
        functionId: 'runtime.contract.v1',
      },
    });
    expect(buildAiSdkGenerateOptions(input()).output).toBeDefined();
  });

  it('omits temperature when an adapter requires the provider default', () => {
    const options = buildAiSdkGenerateOptions({ ...input(), temperature: undefined });
    expect(options).not.toHaveProperty('temperature');
  });

  it('normalizes success usage and suppresses provider warning prose', async () => {
    generate.mockResolvedValue({
      output: { ok: true },
      finishReason: 'stop',
      totalUsage: usage,
      warnings: [{ type: 'other', message: 'raw warning must be suppressed' }],
    });
    await expect(call(input())).resolves.toEqual({
      object: { ok: true },
      finishReason: 'stop',
      tokens: { input: 10, output: 4, cachedInput: 2, reasoning: 1 },
      warnings: ['provider_warning_suppressed'],
    });
  });

  it('normalizes missing usage, unknown finish reason, and no warnings', async () => {
    generate.mockResolvedValue({
      output: { ok: true },
      finishReason: 'future-reason',
      totalUsage: {
        inputTokens: undefined,
        inputTokenDetails: { cacheReadTokens: undefined },
        outputTokens: undefined,
        outputTokenDetails: { reasoningTokens: undefined },
      },
      warnings: undefined,
    });
    await expect(call(input())).resolves.toMatchObject({
      finishReason: 'unknown',
      tokens: { input: null, output: null, cachedInput: null, reasoning: null },
      warnings: ['finish_reason_normalized'],
    });
  });

  it('normalizes the tool-calls finish reason', async () => {
    generate.mockResolvedValue({
      output: { ok: true },
      finishReason: 'tool-calls',
      totalUsage: usage,
      warnings: [],
    });
    await expect(call(input())).resolves.toMatchObject({ finishReason: 'tool_calls' });
  });

  it('stops on a content-filter finish reason without returning content', async () => {
    generate.mockResolvedValue({
      output: { ok: false },
      finishReason: 'content-filter',
      totalUsage: usage,
      warnings: [],
    });
    await expect(call(input())).rejects.toBeInstanceOf(AiSafetyError);
  });

  it.each([
    [new LoadAPIKeyError({ message: 'raw key error' }), AiAuthError, 'provider_auth'],
    [new InvalidPromptError({ prompt: 'secret', message: 'bad prompt' }), AiInvalidInputError, 'invalid_generation_input'],
    [new APICallError({ message: 'auth prose', url: 'https://example.test', requestBodyValues: {}, statusCode: 401 }), AiAuthError, 'provider_auth'],
    [new APICallError({ message: 'forbidden prose', url: 'https://example.test', requestBodyValues: {}, statusCode: 403 }), AiAuthError, 'provider_auth'],
    [new APICallError({ message: 'timeout prose', url: 'https://example.test', requestBodyValues: {}, statusCode: 408 }), AiTimeoutError, 'provider_timeout'],
    [new APICallError({ message: 'quota prose', url: 'https://example.test', requestBodyValues: {}, statusCode: 429 }), AiQuotaError, 'provider_quota'],
    [new APICallError({ message: 'invalid prose', url: 'https://example.test', requestBodyValues: {}, statusCode: 422 }), AiInvalidInputError, 'invalid_generation_input'],
    [new APICallError({ message: 'down prose', url: 'https://example.test', requestBodyValues: {}, statusCode: 503 }), AiAvailabilityError, 'provider_unavailable'],
    [new APICallError({ message: 'network prose', url: 'https://example.test', requestBodyValues: {} }), AiAvailabilityError, 'provider_transport'],
  ] as const)('maps SDK/API errors to fixed safe errors', (error, errorClass, code) => {
    const normalized = normalizeAiSdkError(error, new AbortController().signal);
    expect(normalized).toBeInstanceOf(errorClass);
    expect(normalized.message).toBe(code);
    expect(normalized.message).not.toContain(error.message);
  });

  it('maps structured-output failure to malformed unless safety filtered', () => {
    const response = { id: 'synthetic', timestamp: new Date(), modelId: 'configured-model' };
    const malformed = new NoObjectGeneratedError({
      message: 'raw malformed object', response, usage, finishReason: 'stop',
    });
    expect(normalizeAiSdkError(malformed, new AbortController().signal)).toBeInstanceOf(
      AiMalformedOutputError,
    );
    const refusal = new NoObjectGeneratedError({
      message: 'raw refusal', response, usage, finishReason: 'content-filter',
    });
    expect(normalizeAiSdkError(refusal, new AbortController().signal)).toBeInstanceOf(
      AiSafetyError,
    );
  });

  it.each(['AbortError', 'TimeoutError'])('maps %s to timeout', (name) => {
    const error = new Error('raw abort prose');
    error.name = name;
    expect(normalizeAiSdkError(error, new AbortController().signal)).toBeInstanceOf(
      AiTimeoutError,
    );
  });

  it('maps unknown failures to transport availability and an aborted signal to timeout', () => {
    expect(
      normalizeAiSdkError(new Error('raw network prose'), new AbortController().signal),
    ).toBeInstanceOf(AiAvailabilityError);
    const controller = new AbortController();
    controller.abort();
    expect(normalizeAiSdkError(new Error('raw body'), controller.signal)).toBeInstanceOf(
      AiTimeoutError,
    );
    expect(normalizeAiSdkError({}, new AbortController().signal)).toBeInstanceOf(
      AiAvailabilityError,
    );
  });

  it('preserves already-normalized errors thrown by the generate seam', async () => {
    const rejectingCall = createAiSdkCall(async () => {
      throw new AiSafetyError();
    });
    await expect(rejectingCall(input())).rejects.toBeInstanceOf(AiSafetyError);
  });

  it('normalizes errors thrown by the generate seam', async () => {
    const rejectingCall = createAiSdkCall(async () => {
      throw new APICallError({
        message: 'raw quota prose',
        url: 'https://example.test',
        requestBodyValues: {},
        statusCode: 429,
      });
    });
    await expect(rejectingCall(input())).rejects.toBeInstanceOf(AiQuotaError);
  });
});
