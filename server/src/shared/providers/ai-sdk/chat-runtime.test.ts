import { describe, expect, it, vi } from 'vitest';
import {
  AiBudgetRefusalError,
  AiInvalidInputError,
  AiProvidersExhaustedError,
  AiTimeoutError,
} from '../ai-generation.js';
import type { AiChatStreamEvent, AiChatStreamInput } from '../ai-chat.js';
import type { AiAttemptBatch } from './runtime.js';
import {
  buildChatSdkTools,
  createAiSdkChatProvider,
  type AiChatSdkCall,
  type AiSdkChatRuntimeConfig,
  type RawChatStreamPart,
} from './chat-runtime.js';
import type { AiSdkProviderAdapter } from './types.js';

function adapter(provider: 'glm' | 'deepseek' | 'kimi', rate = 10): AiSdkProviderAdapter {
  return {
    provider,
    model: `${provider}-model`,
    languageModel: {} as AiSdkProviderAdapter['languageModel'],
    inputCostMicrosPerMillion: rate,
    outputCostMicrosPerMillion: rate * 2,
  };
}

function baseInput(overrides: Partial<AiChatStreamInput> = {}): AiChatStreamInput {
  return {
    messages: [{ role: 'user', text: 'hello' }],
    responseLocale: 'en',
    systemInstruction: { id: 'chat', version: 'v1', text: 'system text' },
    tools: {},
    maxOutputTokens: 100,
    temperature: { mode: 'deterministic' },
    maxSteps: 5,
    maxCostMicros: 1_000_000n,
    usage: { accountId: 'account-1', siteId: 'site-1', jobId: null },
    task: 'runtime.contract',
    correlationId: 'corr-1',
    ...overrides,
  };
}

function partsCall(...perAdapter: Array<RawChatStreamPart[] | Error>): AiChatSdkCall {
  let index = 0;
  return (input) => {
    const script = perAdapter[index];
    index += 1;
    void input;
    return (async function* () {
      if (script instanceof Error) throw script;
      for (const part of script ?? []) yield part;
    })();
  };
}

const FINISH: RawChatStreamPart = {
  type: 'finish',
  finishReason: 'stop',
  totalUsage: { inputTokens: 1_000, outputTokens: 500 },
};

function config(
  call: AiChatSdkCall,
  overrides: Partial<AiSdkChatRuntimeConfig> = {},
): AiSdkChatRuntimeConfig {
  return {
    adapters: [adapter('glm'), adapter('deepseek', 100)],
    maxAttempts: 2,
    totalTimeoutMs: 60_000,
    telemetryEnabled: false,
    call,
    ...overrides,
  };
}

async function collect(iterable: AsyncIterable<AiChatStreamEvent>) {
  const events: AiChatStreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('createAiSdkChatProvider', () => {
  it('rejects an unsupported response locale before calling a vendor', async () => {
    const call = vi.fn(partsCall([FINISH]));
    const provider = createAiSdkChatProvider(config(call));

    await expect(
      collect(provider.streamChat(baseInput({
        responseLocale: 'pt' as AiChatStreamInput['responseLocale'],
      }))),
    ).rejects.toBeInstanceOf(AiInvalidInputError);
    expect(call).not.toHaveBeenCalled();
  });

  it('uses provider-default sampling for constrained streaming models', async () => {
    const call = vi.fn<AiChatSdkCall>(partsCall([FINISH]));
    const kimi = {
      ...adapter('kimi'),
      temperatureHandling: 'provider-default' as const,
    };
    const provider = createAiSdkChatProvider(
      config(call, { adapters: [kimi], maxAttempts: 1 }),
    );

    await collect(provider.streamChat(baseInput({
      temperature: { mode: 'creative', value: 0.4 },
    })));

    expect(call).toHaveBeenCalledWith(expect.objectContaining({
      adapter: kimi,
      temperature: undefined,
    }));
  });

  it('streams deltas + tool events and persists the success attempt BEFORE finish', async () => {
    const order: string[] = [];
    const persistAttempts = vi.fn(async (batch: AiAttemptBatch) => {
      order.push(`persist:${batch.attempts.length}`);
    });
    const provider = createAiSdkChatProvider(
      config(
        partsCall([
          { type: 'text-delta', text: 'Hel' },
          { type: 'text-delta', text: 'lo' },
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'list_sites',
            input: { locale: 'en' },
          },
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'list_sites',
            output: { ok: true, structuredContent: { sites: [] } },
          },
          { type: 'reasoning-delta', text: 'ignored' },
          FINISH,
        ]),
        { persistAttempts },
      ),
    );

    const events: AiChatStreamEvent[] = [];
    for await (const event of provider.streamChat(baseInput())) {
      order.push(event.type);
      events.push(event);
    }

    expect(events.map((e) => e.type)).toEqual([
      'text_delta',
      'text_delta',
      'tool_call',
      'tool_result',
      'finish',
    ]);
    expect(events[3]).toMatchObject({ ok: true, structuredContent: { sites: [] } });
    const finish = events.at(-1);
    expect(finish).toMatchObject({
      type: 'finish',
      provider: 'glm',
      model: 'glm-model',
      finishReason: 'stop',
      tokens: { input: 1_000, output: 500 },
    });
    // 1000 in × 10µ/M + 500 out × 20µ/M rounds up to 1µ + 1µ = 2µ.
    if (finish?.type === 'finish') {
      expect(finish.actualOrEstimatedCostMicros).toBe(2n);
    }
    // Persistence happened before the finish event reached the consumer.
    expect(order.indexOf('persist:1')).toBeLessThan(order.indexOf('finish'));
    const batch = persistAttempts.mock.calls[0]![0];
    expect(batch.attempts[0]).toMatchObject({
      status: 'success',
      costSource: 'actual',
      provider: 'glm',
    });
    expect(batch.accountId).toBe('account-1');
    expect(batch.siteId).toBe('site-1');
  });

  it('falls over to the next adapter when the first fails before any content', async () => {
    const persistAttempts = vi.fn(async (_batch: AiAttemptBatch) => {});
    let tick = 0;
    const provider = createAiSdkChatProvider(
      config(
        partsCall(new Error('socket reset'), [
          { type: 'text-delta', text: 'ok' },
          FINISH,
        ]),
        { persistAttempts, now: () => (tick += 5) },
      ),
    );
    const events = await collect(provider.streamChat(baseInput()));
    expect(events.at(-1)).toMatchObject({ type: 'finish', provider: 'deepseek' });
    const batch = persistAttempts.mock.calls[0]![0] as AiAttemptBatch;
    expect(batch.attempts).toHaveLength(2);
    expect(batch.attempts[0]).toMatchObject({
      provider: 'glm',
      status: 'availability',
      costSource: 'estimated',
    });
    expect(batch.attempts[1]).toMatchObject({ provider: 'deepseek', status: 'success' });
  });

  it('never fails over after the first emitted content — the error terminates the stream', async () => {
    let calls = 0;
    const call: AiChatSdkCall = () => {
      calls += 1;
      return (async function* () {
        yield { type: 'text-delta', text: 'partial' } as RawChatStreamPart;
        throw new Error('mid-stream drop');
      })();
    };
    const provider = createAiSdkChatProvider(config(call));
    const events: AiChatStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of provider.streamChat(baseInput())) events.push(event);
      })(),
    ).rejects.toMatchObject({ code: 'provider_transport' });
    expect(events).toEqual([{ type: 'text_delta', text: 'partial' }]);
    expect(calls).toBe(1);
  });

  it('maps a mid-stream error part through normalizeAiSdkError', async () => {
    const provider = createAiSdkChatProvider(
      config(
        partsCall(
          [{ type: 'error', error: new Error('vendor said no') }],
          [{ type: 'text-delta', text: 'ok' }, FINISH],
        ),
      ),
    );
    // No content reached the consumer → the error is retryable → failover.
    const events = await collect(provider.streamChat(baseInput()));
    expect(events.at(-1)).toMatchObject({ type: 'finish', provider: 'deepseek' });
  });

  it('a stream that ends without a finish part is a transport failure', async () => {
    const provider = createAiSdkChatProvider(
      config(partsCall([], new Error('down'))),
    );
    await expect(collect(provider.streamChat(baseInput()))).rejects.toBeInstanceOf(
      AiProvidersExhaustedError,
    );
  });

  it('throws request_cancelled for a pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = createAiSdkChatProvider(config(partsCall([FINISH])));
    await expect(
      collect(provider.streamChat(baseInput({ signal: controller.signal }))),
    ).rejects.toMatchObject({ code: 'request_cancelled' });
  });

  it('an abort mid-stream surfaces request_cancelled, not the transport error', async () => {
    const controller = new AbortController();
    const call: AiChatSdkCall = () =>
      (async function* () {
        yield { type: 'text-delta', text: 'a' } as RawChatStreamPart;
        controller.abort();
        throw new Error('socket closed by abort');
      })();
    const provider = createAiSdkChatProvider(config(call));
    await expect(
      collect(provider.streamChat(baseInput({ signal: controller.signal }))),
    ).rejects.toBeInstanceOf(AiInvalidInputError);
  });

  it('an abandoned generator persists an estimated-cost attempt from finally', async () => {
    const persistAttempts = vi.fn(async (_batch: AiAttemptBatch) => {});
    const call: AiChatSdkCall = () =>
      (async function* () {
        yield { type: 'text-delta', text: 'a' } as RawChatStreamPart;
        yield { type: 'text-delta', text: 'b' } as RawChatStreamPart;
        yield FINISH;
      })();
    const provider = createAiSdkChatProvider(config(call, { persistAttempts }));
    const iterator = provider.streamChat(baseInput())[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.(undefined);
    expect(persistAttempts).toHaveBeenCalledTimes(1);
    const batch = persistAttempts.mock.calls[0]![0] as AiAttemptBatch;
    expect(batch.attempts).toHaveLength(1);
    expect(batch.attempts[0]).toMatchObject({
      status: 'invalid_input',
      errorCode: 'request_cancelled',
      costSource: 'estimated',
    });
    expect(batch.attempts[0]!.actualOrEstimatedCostMicros).toBeGreaterThan(0n);
  });

  it('trips the account budget circuit before any adapter call', async () => {
    const persistAttempts = vi.fn(async (_batch: AiAttemptBatch) => {});
    const call = vi.fn();
    const provider = createAiSdkChatProvider(
      config(call as unknown as AiChatSdkCall, {
        persistAttempts,
        spendGuard: {
          windowMs: 3_600_000,
          limitMicros: 1_000n,
          getAccountSpendMicros: async () => 1_000n,
        },
      }),
    );
    await expect(collect(provider.streamChat(baseInput()))).rejects.toBeInstanceOf(
      AiBudgetRefusalError,
    );
    expect(call).not.toHaveBeenCalled();
    // Exactly one batch — the finally path must never double-persist.
    expect(persistAttempts).toHaveBeenCalledTimes(1);
    const batch = persistAttempts.mock.calls[0]![0] as AiAttemptBatch;
    expect(batch.attempts[0]).toMatchObject({ status: 'budget_circuit_open' });
  });

  it('a throwing spend guard rejects without persisting an empty batch', async () => {
    const persistAttempts = vi.fn(async (_batch: AiAttemptBatch) => {});
    const provider = createAiSdkChatProvider(
      config(partsCall([FINISH]), {
        persistAttempts,
        spendGuard: {
          windowMs: 3_600_000,
          limitMicros: 1_000n,
          getAccountSpendMicros: async () => {
            throw new Error('pg down');
          },
        },
      }),
    );
    await expect(collect(provider.streamChat(baseInput()))).rejects.toThrow('pg down');
    expect(persistAttempts).not.toHaveBeenCalled();
  });

  it('a persistence failure with no error callback is swallowed silently', async () => {
    const provider = createAiSdkChatProvider(
      config(partsCall([FINISH]), {
        persistAttempts: async () => {
          throw new Error('pg down');
        },
      }),
    );
    const events = await collect(provider.streamChat(baseInput()));
    expect(events.at(-1)?.type).toBe('finish');
  });

  it('defaults to the live seam and wall clock when call/now are omitted', async () => {
    const provider = createAiSdkChatProvider({
      adapters: [],
      maxAttempts: 1,
      totalTimeoutMs: 1_000,
      telemetryEnabled: false,
    });
    await expect(collect(provider.streamChat(baseInput()))).rejects.toBeInstanceOf(
      AiProvidersExhaustedError,
    );
  });

  it('an under-limit spend guard lets the stream run', async () => {
    const provider = createAiSdkChatProvider(
      config(partsCall([FINISH]), {
        spendGuard: {
          windowMs: 3_600_000,
          limitMicros: 1_000_000n,
          getAccountSpendMicros: async () => 0n,
        },
      }),
    );
    const events = await collect(provider.streamChat(baseInput()));
    expect(events.at(-1)?.type).toBe('finish');
  });

  it('budget-skips adapters whose estimate exceeds the remaining request budget', async () => {
    const persistAttempts = vi.fn(async (_batch: AiAttemptBatch) => {});
    // deepseek's 100/200 rates make its estimate exceed the 1-micro budget;
    // glm at 10/20 also exceeds it → all skipped → budget refusal.
    const provider = createAiSdkChatProvider(
      config(partsCall([FINISH]), { persistAttempts }),
    );
    await expect(
      collect(provider.streamChat(baseInput({ maxCostMicros: 0n }))),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof AiBudgetRefusalError &&
        error.code === 'request_budget_exhausted',
    );
    const batch = persistAttempts.mock.calls[0]![0] as AiAttemptBatch;
    expect(batch.attempts.every((a) => a.status === 'budget_skipped')).toBe(true);
  });

  it('falls back to the configured estimate when finish carries no usage', async () => {
    const persistAttempts = vi.fn(async (_batch: AiAttemptBatch) => {});
    const provider = createAiSdkChatProvider(
      config(partsCall([{ type: 'finish', finishReason: 'stop' }]), { persistAttempts }),
    );
    const events = await collect(provider.streamChat(baseInput()));
    const finish = events.at(-1);
    expect(finish).toMatchObject({ type: 'finish', tokens: { input: null, output: null } });
    const batch = persistAttempts.mock.calls[0]![0] as AiAttemptBatch;
    expect(batch.attempts[0]).toMatchObject({ status: 'success', costSource: 'estimated' });
    if (finish?.type === 'finish') {
      expect(finish.actualOrEstimatedCostMicros).toBe(
        batch.attempts[0]!.configuredEstimateCostMicros,
      );
    }
  });

  it('a persistence failure invokes onPersistenceError and never breaks the stream', async () => {
    const onPersistenceError = vi.fn();
    const provider = createAiSdkChatProvider(
      config(partsCall([FINISH]), {
        persistAttempts: async () => {
          throw new Error('pg down');
        },
        onPersistenceError,
      }),
    );
    const events = await collect(provider.streamChat(baseInput()));
    expect(events.at(-1)?.type).toBe('finish');
    expect(onPersistenceError).toHaveBeenCalledWith('ai_usage_event_write_failed');
  });

  it('exhausts every retryable adapter into AiProvidersExhaustedError with the last cause', async () => {
    const provider = createAiSdkChatProvider(
      config(partsCall(new Error('a down'), new Error('b down'))),
    );
    await expect(collect(provider.streamChat(baseInput()))).rejects.toBeInstanceOf(
      AiProvidersExhaustedError,
    );
  });

  it('a non-retryable failure stops the adapter loop immediately', async () => {
    let calls = 0;
    const call: AiChatSdkCall = () => {
      calls += 1;
      return (async function* () {
        yield { type: 'error', error: { name: 'x' } } as RawChatStreamPart;
      })();
    };
    // A 401-shaped APICallError would be cleaner, but a plain object maps to
    // provider_transport (retryable) — so drive non-retryable via a thrown
    // AiInvalidInputError from the error part instead.
    const invalidCall: AiChatSdkCall = () => {
      calls += 1;
      return (async function* () {
        yield {
          type: 'error',
          error: new AiInvalidInputError('invalid_generation_input'),
        } as RawChatStreamPart;
      })();
    };
    void call;
    const provider = createAiSdkChatProvider(config(invalidCall));
    await expect(collect(provider.streamChat(baseInput()))).rejects.toMatchObject({
      code: 'invalid_generation_input',
    });
    expect(calls).toBe(1);
  });

  it('the global deadline surfaces global_deadline_exceeded', async () => {
    vi.useFakeTimers();
    try {
      const call: AiChatSdkCall = (input) =>
        (async function* () {
          await new Promise<void>((resolve) => {
            input.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          throw new Error('aborted transport');
          yield FINISH;
        })();
      const provider = createAiSdkChatProvider(
        config(call, { totalTimeoutMs: 1_000 }),
      );
      const pending = collect(provider.streamChat(baseInput()));
      const expectation = expect(pending).rejects.toBeInstanceOf(AiTimeoutError);
      await vi.advanceTimersByTimeAsync(1_001);
      await expectation;
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects maxAttempts across the adapter loop', async () => {
    let calls = 0;
    const call: AiChatSdkCall = () => {
      calls += 1;
      return (async function* () {
        throw new Error('down');
        yield FINISH;
      })();
    };
    const provider = createAiSdkChatProvider(config(call, { maxAttempts: 1 }));
    await expect(collect(provider.streamChat(baseInput()))).rejects.toBeInstanceOf(
      AiProvidersExhaustedError,
    );
    expect(calls).toBe(1);
  });

  it('wraps a foreign tool-result output defensively', async () => {
    const provider = createAiSdkChatProvider(
      config(
        partsCall([
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'list_sites',
            output: 'raw string',
          },
          FINISH,
        ]),
      ),
    );
    const events = await collect(provider.streamChat(baseInput()));
    expect(events[0]).toMatchObject({
      type: 'tool_result',
      ok: true,
      structuredContent: { value: 'raw string' },
    });
  });

  it('maps a tool-error part to an ok:false tool_result', async () => {
    const provider = createAiSdkChatProvider(
      config(
        partsCall([
          { type: 'tool-error', toolCallId: 'c1', toolName: 'list_sites', error: 'x' },
          FINISH,
        ]),
      ),
    );
    const events = await collect(provider.streamChat(baseInput()));
    expect(events[0]).toMatchObject({
      type: 'tool_result',
      ok: false,
      structuredContent: { error: { code: 'tool_failed' } },
    });
  });
});

describe('coverage edges', () => {
  it('handles parts with missing optional fields, creative temperature, tools in the estimate, and sparse usage context', async () => {
    const persistAttempts = vi.fn(async (_batch: AiAttemptBatch) => {});
    const seen: Array<Record<string, unknown>> = [];
    const call: AiChatSdkCall = (input) => {
      seen.push({ temperature: input.temperature });
      return (async function* (): AsyncGenerator<RawChatStreamPart> {
        yield { type: 'text-delta' };
        yield { type: 'tool-call', input: { x: 1 } };
        yield {
          type: 'tool-result',
          output: { ok: false, structuredContent: { error: { code: 'nope' } } },
        };
        yield { type: 'tool-error' };
        yield { type: 'finish' };
      })();
    };
    const provider = createAiSdkChatProvider(config(call, { persistAttempts }));
    const events = await collect(
      provider.streamChat(
        baseInput({
          temperature: { mode: 'creative', value: 0.7 },
          usage: { accountId: 'account-1', jobId: 'job-9' },
          tools: {
            list_sites: {
              description: 'List sites',
              jsonSchema: { type: 'object' },
              execute: async () => ({ ok: true, structuredContent: {} }),
            },
          },
        }),
      ),
    );
    expect(seen[0]?.temperature).toBe(0.7);
    expect(events[0]).toEqual({ type: 'text_delta', text: '' });
    expect(events[1]).toMatchObject({ type: 'tool_call', toolCallId: '', toolName: '' });
    expect(events[2]).toMatchObject({ type: 'tool_result', ok: false });
    expect(events[3]).toMatchObject({ type: 'tool_result', ok: false, toolCallId: '' });
    const finish = events.at(-1);
    expect(finish).toMatchObject({ type: 'finish', finishReason: 'unknown' });
    const batch = persistAttempts.mock.calls[0]![0] as AiAttemptBatch;
    expect(batch.siteId).toBeNull();
    expect(batch.jobId).toBe('job-9');
  });

  it('wraps a tool-result whose output object lacks the outcome shape', async () => {
    const provider = createAiSdkChatProvider(
      config(
        partsCall([
          { type: 'tool-result', toolCallId: 'c', toolName: 't', output: { ok: 'yes' } },
          { type: 'tool-result', toolCallId: 'c', toolName: 't', output: { other: 1 } },
          { type: 'tool-result', toolCallId: 'c', toolName: 't' },
          FINISH,
        ]),
      ),
    );
    const events = await collect(provider.streamChat(baseInput()));
    expect(events[0]).toMatchObject({ structuredContent: { value: { ok: 'yes' } } });
    expect(events[1]).toMatchObject({ structuredContent: { value: { other: 1 } } });
    expect(events[2]).toMatchObject({ structuredContent: { value: null } });
  });

  it('an empty adapter list exhausts with no cause', async () => {
    const provider = createAiSdkChatProvider(
      config(partsCall([FINISH]), { adapters: [] }),
    );
    await expect(collect(provider.streamChat(baseInput()))).rejects.toBeInstanceOf(
      AiProvidersExhaustedError,
    );
  });
});

describe('buildChatSdkTools', () => {
  it('wraps chat tools as ai-sdk tool entries whose execute returns the outcome', async () => {
    const execute = vi.fn(async () => ({ ok: true, structuredContent: { hi: 1 } }));
    const tools = buildChatSdkTools({
      list_sites: {
        description: 'List sites',
        jsonSchema: { type: 'object', properties: {} },
        execute,
      },
    });
    expect(Object.keys(tools)).toEqual(['list_sites']);
    const built = tools.list_sites as unknown as {
      description: string;
      execute: (args: unknown) => Promise<unknown>;
    };
    expect(built.description).toBe('List sites');
    await expect(built.execute({ a: 1 })).resolves.toEqual({
      ok: true,
      structuredContent: { hi: 1 },
    });
    expect(execute).toHaveBeenCalledWith({ a: 1 });
  });
});
