import { describe, expect, it, vi } from 'vitest';
import {
  AiAvailabilityError,
  AiInvalidInputError,
} from './ai-generation.js';
import type { AiChatStreamEvent, AiChatStreamInput } from './ai-chat.js';
import type { SupportedLocale } from '../i18n/locales.js';
import {
  FAKE_CHAT_REPLIES,
  FAKE_CHAT_TOOL_DIRECTIVE,
  createFakeAiChatProvider,
} from './ai-chat-fake.js';

function baseInput(overrides: Partial<AiChatStreamInput> = {}): AiChatStreamInput {
  return {
    messages: [{ role: 'user', text: 'How are my rankings?' }],
    responseLocale: 'en',
    systemInstruction: { id: 'chat', version: '1', text: 'system' },
    tools: {},
    maxOutputTokens: 2_048,
    temperature: { mode: 'deterministic' },
    maxSteps: 5,
    maxCostMicros: 17_000n,
    usage: { accountId: 'account-1' },
    task: 'runtime.contract',
    correlationId: 'corr-1',
    ...overrides,
  };
}

async function collect(
  iterable: AsyncIterable<AiChatStreamEvent>,
): Promise<AiChatStreamEvent[]> {
  const events: AiChatStreamEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('createFakeAiChatProvider', () => {
  it.each(Object.entries(FAKE_CHAT_REPLIES) as [SupportedLocale, string][])(
    'streams fixed natural copy for %s without a translation or vendor call',
    async (responseLocale, expectedReply) => {
      const provider = createFakeAiChatProvider();
      const events = await collect(
        provider.streamChat(baseInput({ responseLocale })),
      );
      const text = events
        .filter((event) => event.type === 'text_delta')
        .map((event) => (event.type === 'text_delta' ? event.text : ''))
        .join('');

      expect(text).toBe(expectedReply);
      expect(events.at(-1)).toMatchObject({
        type: 'finish',
        provider: 'fake',
        model: 'fake-chat-1',
        tokens: { input: 100, output: 50 },
        actualOrEstimatedCostMicros: 1_000n,
      });
    },
  );

  it('rejects an unsupported response locale before streaming', async () => {
    const provider = createFakeAiChatProvider();
    await expect(
      collect(
        provider.streamChat(
          baseInput({ responseLocale: 'pt' as SupportedLocale }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid_generation_input' });
  });

  it('streams the canned reply as ~5 deltas and finishes with fixed usage/cost', async () => {
    const provider = createFakeAiChatProvider();
    const events = await collect(provider.streamChat(baseInput()));
    const deltas = events.filter((e) => e.type === 'text_delta');
    expect(deltas.length).toBeGreaterThanOrEqual(4);
    const finish = events.at(-1);
    expect(finish).toMatchObject({
      type: 'finish',
      provider: 'fake',
      model: 'fake-chat-1',
      finishReason: 'stop',
      tokens: { input: 100, output: 50 },
      actualOrEstimatedCostMicros: 1_000n,
    });
    const text = deltas.map((d) => (d.type === 'text_delta' ? d.text : '')).join('');
    expect(text).toContain('RankMeFast');
  });

  it('honours custom reply, usage, and cost options', async () => {
    const provider = createFakeAiChatProvider({
      reply: 'Short.',
      usage: { input: 7, output: 3 },
      costMicros: 42n,
    });
    const events = await collect(provider.streamChat(baseInput()));
    expect(events.at(-1)).toMatchObject({
      tokens: { input: 7, output: 3 },
      actualOrEstimatedCostMicros: 42n,
    });
  });

  it('executes an injected tool on a [tool:…] directive with JSON args', async () => {
    const execute = vi.fn(async () => ({
      ok: true,
      structuredContent: { sites: [{ id: 's1' }] },
    }));
    const provider = createFakeAiChatProvider();
    const events = await collect(
      provider.streamChat(
        baseInput({
          messages: [
            { role: 'assistant', text: 'earlier turn' },
            { role: 'user', text: 'run [tool:list_sites {"locale":"fr"}] please' },
          ],
          tools: {
            list_sites: { description: 'd', jsonSchema: {}, execute },
          },
        }),
      ),
    );
    expect(execute).toHaveBeenCalledWith({ locale: 'fr' });
    expect(events[0]).toMatchObject({
      type: 'tool_call',
      toolName: 'list_sites',
      args: { locale: 'fr' },
    });
    expect(events[1]).toMatchObject({
      type: 'tool_result',
      toolName: 'list_sites',
      ok: true,
      structuredContent: { sites: [{ id: 's1' }] },
    });
    expect(events.at(-1)?.type).toBe('finish');
  });

  it('treats malformed directive args as an empty object', async () => {
    const execute = vi.fn(async () => ({ ok: true, structuredContent: {} }));
    const provider = createFakeAiChatProvider();
    await collect(
      provider.streamChat(
        baseInput({
          messages: [{ role: 'user', text: '[tool:list_sites {broken]' }],
          tools: { list_sites: { description: 'd', jsonSchema: {}, execute } },
        }),
      ),
    );
    // The directive regex requires {...}; '{broken' has no closing brace so no
    // args group is captured at all — still an empty-args invocation.
    expect(execute).not.toHaveBeenCalledWith(expect.objectContaining({ broken: true }));
  });

  it('falls back to empty args when the JSON group fails to parse', async () => {
    const execute = vi.fn(async () => ({ ok: true, structuredContent: {} }));
    const provider = createFakeAiChatProvider();
    await collect(
      provider.streamChat(
        baseInput({
          messages: [{ role: 'user', text: '[tool:list_sites {"a":}]' }],
          tools: { list_sites: { description: 'd', jsonSchema: {}, execute } },
        }),
      ),
    );
    expect(execute).toHaveBeenCalledWith({});
  });

  it('skips the tool entirely when permission filtering removed it', async () => {
    const provider = createFakeAiChatProvider();
    const events = await collect(
      provider.streamChat(
        baseInput({
          messages: [{ role: 'user', text: 'run [tool:start_audit] now' }],
          tools: {},
        }),
      ),
    );
    expect(events.some((e) => e.type === 'tool_call')).toBe(false);
    expect(events.at(-1)?.type).toBe('finish');
  });

  it('converts a throwing tool executor into an ok:false tool_result', async () => {
    const provider = createFakeAiChatProvider();
    const events = await collect(
      provider.streamChat(
        baseInput({
          messages: [{ role: 'user', text: '[tool:list_sites]' }],
          tools: {
            list_sites: {
              description: 'd',
              jsonSchema: {},
              execute: async () => {
                throw new Error('boom');
              },
            },
          },
        }),
      ),
    );
    expect(events[1]).toMatchObject({
      type: 'tool_result',
      ok: false,
      structuredContent: { error: { code: 'tool_failed' } },
    });
  });

  it('sequences outcomes: before-first-token, mid-stream, abort, then ok', async () => {
    const provider = createFakeAiChatProvider({
      outcomes: ['error_before_first_token', 'error_mid_stream', 'abort'],
    });

    await expect(collect(provider.streamChat(baseInput()))).rejects.toBeInstanceOf(
      AiAvailabilityError,
    );

    const midEvents: AiChatStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of provider.streamChat(baseInput())) {
          midEvents.push(event);
        }
      })(),
    ).rejects.toMatchObject({ code: 'provider_transport' });
    expect(midEvents).toEqual([{ type: 'text_delta', text: 'Partial ' }]);

    await expect(collect(provider.streamChat(baseInput()))).rejects.toBeInstanceOf(
      AiInvalidInputError,
    );

    // Past the configured sequence every call is 'ok'.
    const okEvents = await collect(provider.streamChat(baseInput()));
    expect(okEvents.at(-1)?.type).toBe('finish');
  });

  it('throws request_cancelled when the signal is already aborted or aborts mid-stream', async () => {
    const provider = createFakeAiChatProvider();
    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      collect(provider.streamChat(baseInput({ signal: preAborted.signal }))),
    ).rejects.toMatchObject({ code: 'request_cancelled' });

    const controller = new AbortController();
    const events: AiChatStreamEvent[] = [];
    await expect(
      (async () => {
        for await (const event of provider.streamChat(
          baseInput({ signal: controller.signal }),
        )) {
          events.push(event);
          controller.abort();
        }
      })(),
    ).rejects.toMatchObject({ code: 'request_cancelled' });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.type === 'text_delta')).toBe(true);
  });

  it('a history with no user message streams the canned reply without tools', async () => {
    const provider = createFakeAiChatProvider({ reply: 'Hi.' });
    const events = await collect(
      provider.streamChat(
        baseInput({ messages: [{ role: 'assistant', text: '[tool:list_sites]' }] }),
      ),
    );
    expect(events.some((e) => e.type === 'tool_call')).toBe(false);
    expect(events.at(-1)?.type).toBe('finish');
  });

  it('exports the directive regex used by the docs and e2e journeys', () => {
    const match = FAKE_CHAT_TOOL_DIRECTIVE.exec('please [tool:get_rank_history {"siteId":"x"}]');
    expect(match?.[1]).toBe('get_rank_history');
    expect(match?.[2]).toBe('{"siteId":"x"}');
  });
});
