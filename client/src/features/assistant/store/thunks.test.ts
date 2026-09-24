import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';
import { changeLanguage, initI18n } from '@shared/i18n';
import type { ChatConversation, ChatMessage } from '../types';
import { assistantReducer } from './slice';
import {
  createAssistantConversationThunk,
  deleteAssistantConversationThunk,
  loadAssistantConversation,
  loadAssistantConversations,
  sendAssistantMessage,
  stopAssistantStream,
} from './thunks';

const api = vi.hoisted(() => ({
  assistantMessageStreamPath: vi.fn(
    (id: string) => `/chat/conversations/${encodeURIComponent(id)}/messages`,
  ),
  assistantMessageStreamUrl: vi.fn(
    (id: string) => `/api/chat/conversations/${encodeURIComponent(id)}/messages`,
  ),
  createAssistantConversation: vi.fn(),
  deleteAssistantConversation: vi.fn(),
  getAssistantConversation: vi.fn(),
  getAssistantCsrfToken: vi.fn(),
  listAssistantConversations: vi.fn(),
}));

vi.mock('../api', () => api);

const conversation: ChatConversation = {
  id: 'c1',
  siteId: null,
  title: '',
  locale: 'en',
  lastMessageAt: '2026-08-02T10:00:00.000Z',
  messageCount: 0,
  createdAt: '2026-08-02T10:00:00.000Z',
};

const storedMessage: ChatMessage = {
  id: 'stored',
  role: 'user',
  status: 'complete',
  responseLocale: null,
  parts: [{ type: 'text', text: 'Stored' }],
  tokens: null,
  createdAt: '2026-08-02T10:00:00.000Z',
};

const makeStore = () =>
  configureStore({ reducer: { assistant: assistantReducer } });

const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

function streamResponse(chunks: string[], responseLocale = 'en'): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encode(chunk));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Content-Language': responseLocale,
      },
    },
  );
}

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const successfulFrames = () => [
  frame('meta', {
    conversationId: 'c1',
    userMessageId: 'u1',
    assistantMessageId: 'a1',
    responseLocale: 'en',
  }),
  frame('delta', { text: 'Hello' }),
  frame('delta', { text: ' there' }),
  frame('tool_call', { toolCallId: 'tc1', toolName: 'list_sites', args: {} }),
  frame('tool_result', {
    toolCallId: 'tc1',
    toolName: 'list_sites',
    ok: true,
    structuredContent: { sites: [{ id: 's1' }] },
    errorCode: 'none',
  }),
  frame('tool_result', {
    toolCallId: 'tc2',
    toolName: 'list_sites',
    ok: true,
    structuredContent: { sites: [] },
  }),
  frame('delta', { text: 'Done.' }),
  frame('unknown_event', { ignored: true }),
  frame('done', { finishReason: 'stop', tokens: { input: 10, output: 4 } }),
];

beforeEach(async () => {
  vi.restoreAllMocks();
  for (const mock of Object.values(api)) mock.mockClear();
  api.assistantMessageStreamUrl.mockImplementation(
    (id: string) => `/api/chat/conversations/${encodeURIComponent(id)}/messages`,
  );
  api.assistantMessageStreamPath.mockImplementation(
    (id: string) => `/chat/conversations/${encodeURIComponent(id)}/messages`,
  );
  api.getAssistantCsrfToken.mockResolvedValue('csrf-token');
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  expect(stopAssistantStream()).toBe(false);
});

describe('assistant JSON thunks', () => {
  it('loads the list and a detail, then creates and deletes a conversation', async () => {
    api.listAssistantConversations.mockResolvedValue({ conversations: [conversation] });
    api.getAssistantConversation.mockResolvedValue({
      conversation: { ...conversation, title: 'Loaded' },
      messages: [storedMessage],
    });
    api.createAssistantConversation.mockResolvedValue({
      conversation: { ...conversation, id: 'c2', siteId: 's1' },
    });
    api.deleteAssistantConversation.mockResolvedValue({ ok: true });
    const store = makeStore();

    await store.dispatch(loadAssistantConversations());
    await store.dispatch(loadAssistantConversation({ conversationId: 'c1' }));
    await store.dispatch(createAssistantConversationThunk({ siteId: 's1' }));
    await store.dispatch(deleteAssistantConversationThunk({ conversationId: 'c2' }));

    expect(api.listAssistantConversations).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(api.getAssistantConversation).toHaveBeenCalledWith('c1', {
      signal: expect.any(AbortSignal),
    });
    expect(api.createAssistantConversation).toHaveBeenCalledWith(
      { siteId: 's1' },
      { signal: expect.any(AbortSignal) },
    );
    expect(api.deleteAssistantConversation).toHaveBeenCalledWith('c2', {
      signal: expect.any(AbortSignal),
    });
    expect(store.getState().assistant.conversations.map((item) => item.id)).toEqual([
      'c1',
    ]);
    expect(store.getState().assistant.messagesByConversation.c1).toEqual([
      storedMessage,
    ]);
  });

  it('normalizes every JSON API rejection into serializable assistant errors', async () => {
    const failure = new ApiError('no', 503, null);
    api.listAssistantConversations.mockRejectedValue(failure);
    api.getAssistantConversation.mockRejectedValue(failure);
    api.createAssistantConversation.mockRejectedValue(failure);
    api.deleteAssistantConversation.mockRejectedValue(failure);
    const store = makeStore();

    const actions = await Promise.all([
      store.dispatch(loadAssistantConversations()),
      store.dispatch(loadAssistantConversation({ conversationId: 'c1' })),
      store.dispatch(createAssistantConversationThunk(undefined)),
      store.dispatch(deleteAssistantConversationThunk({ conversationId: 'c1' })),
    ]);

    for (const action of actions) {
      expect(action.meta.requestStatus).toBe('rejected');
      expect(action.payload).toMatchObject({ kind: 'unavailable', status: 503 });
    }
  });
});

describe('assistant streaming thunk', () => {
  it('sends the cookie+CSRF request and reduces progressive text and tool events', async () => {
    const chunks = successfulFrames();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(streamResponse([chunks[0]!, chunks.slice(1, 5).join(''), chunks.slice(5).join('')]));
    const store = makeStore();
    await store.dispatch(loadAssistantConversations.fulfilled([conversation], 'seed'));

    const action = await store.dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Show my sites' }),
    );

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(action.payload).toMatchObject({
      conversationId: 'c1',
      outcome: 'complete',
      finishReason: 'stop',
      tokens: { input: 10, output: 4 },
    });
    expect(api.getAssistantCsrfToken).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    const fetchCall = fetchSpy.mock.calls[0]!;
    expect(fetchCall[0]).toBe('/api/chat/conversations/c1/messages');
    expect(fetchCall[1]).toEqual(expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ text: 'Show my sites' }),
      signal: expect.any(AbortSignal),
    }));
    const headers = fetchCall[1]?.headers as Headers;
    expect(headers.get('Accept')).toBe('text/event-stream');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('x-csrf-token')).toBe('csrf-token');
    expect(headers.get('x-lang')).toBe('en');

    const state = store.getState().assistant;
    expect(state.stream).toMatchObject({
      status: 'succeeded',
      requestId: null,
      conversationId: 'c1',
      userMessageId: 'u1',
      assistantMessageId: 'a1',
      responseLocale: 'en',
      finishReason: 'stop',
      tokens: { input: 10, output: 4 },
      error: null,
    });
    expect(state.conversations[0]).toMatchObject({
      id: 'c1',
      title: 'Show my sites',
    });
    expect(state.messagesByConversation.c1).toMatchObject([
      {
        id: 'u1',
        role: 'user',
        responseLocale: null,
        parts: [{ type: 'text', text: 'Show my sites' }],
      },
      {
        id: 'a1',
        role: 'assistant',
        status: 'complete',
        responseLocale: 'en',
        tokens: { input: 10, output: 4 },
        parts: [
          { type: 'text', text: 'Hello there' },
          { type: 'tool_call', toolCallId: 'tc1', toolName: 'list_sites', args: {} },
          {
            type: 'tool_result',
            toolCallId: 'tc1',
            toolName: 'list_sites',
            ok: true,
            structuredContent: { sites: [{ id: 's1' }] },
            errorCode: 'none',
          },
          {
            type: 'tool_result',
            toolCallId: 'tc2',
            toolName: 'list_sites',
            ok: true,
            structuredContent: { sites: [] },
          },
          { type: 'text', text: 'Done.' },
        ],
      },
    ]);
  });

  it('keeps an accepted turn pinned while the interface switches locale', async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Content-Language': 'en',
        },
      },
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response);
    const store = makeStore();
    await store.dispatch(loadAssistantConversations.fulfilled([conversation], 'seed'));

    const pending = store.dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Keep this turn' }),
    );
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const requestSignal = fetchSpy.mock.calls[0]?.[1]?.signal;

    streamController.enqueue(encode(frame('meta', {
      conversationId: 'c1',
      userMessageId: 'u-switch',
      assistantMessageId: 'a-switch',
      responseLocale: 'en',
    })));
    streamController.enqueue(encode(frame('delta', { text: 'Pinned English' })));
    await vi.waitFor(() =>
      expect(store.getState().assistant.messagesByConversation.c1?.[1]?.parts)
        .toContainEqual({ type: 'text', text: 'Pinned English' }),
    );

    await changeLanguage('ar');
    expect(requestSignal?.aborted).toBe(false);
    streamController.enqueue(encode(frame('done', {
      finishReason: 'stop',
      tokens: { input: 2, output: 2 },
    })));
    streamController.close();

    const action = await pending;
    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/chat/conversations/c1/messages');
    expect(store.getState().assistant.conversations[0]?.locale).toBe('en');
    expect(store.getState().assistant.messagesByConversation.c1?.[1]?.parts)
      .toContainEqual({ type: 'text', text: 'Pinned English' });
    expect(store.getState().assistant.messagesByConversation.c1?.[1]?.responseLocale)
      .toBe('en');

    fetchSpy.mockResolvedValueOnce(
      streamResponse(
        [
          frame('meta', {
            conversationId: 'c1',
            userMessageId: 'u-ar',
            assistantMessageId: 'a-ar',
            responseLocale: 'ar',
          }),
          frame('delta', { text: 'رد عربي جديد' }),
          frame('done', {
            finishReason: 'stop',
            tokens: { input: 3, output: 3 },
          }),
        ],
        'ar',
      ),
    );
    const next = await store.dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'الدور التالي' }),
    );

    expect(next.payload).toMatchObject({
      outcome: 'complete',
      responseLocale: 'ar',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const nextHeaders = fetchSpy.mock.calls[1]?.[1]?.headers as Headers;
    expect(nextHeaders.get('x-lang')).toBe('ar');
    expect(store.getState().assistant.messagesByConversation.c1?.[3]).toMatchObject({
      id: 'a-ar',
      responseLocale: 'ar',
      parts: [{ type: 'text', text: 'رد عربي جديد' }],
    });
  });

  it('rejects missing, unsupported, or mismatched stream locale metadata', async () => {
    const validFrames = [
      frame('meta', {
        conversationId: 'c1',
        userMessageId: 'u1',
        assistantMessageId: 'a1',
        responseLocale: 'en',
      }),
      frame('done', {
        finishReason: 'stop',
        tokens: { input: 1, output: 1 },
      }),
    ];
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(
      new Response(validFrames.join(''), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    fetchSpy.mockResolvedValueOnce(streamResponse(validFrames, 'fr'));
    fetchSpy.mockResolvedValueOnce(
      streamResponse([
        frame('meta', {
          conversationId: 'c1',
          userMessageId: 'u2',
          assistantMessageId: 'a2',
          responseLocale: 'pt',
        }),
      ]),
    );
    fetchSpy.mockResolvedValueOnce(
      streamResponse([
        frame('meta', {
          conversationId: 'c1',
          userMessageId: 'u3',
          assistantMessageId: 'a3',
          responseLocale: 'ar',
        }),
      ]),
    );

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const action = await makeStore().dispatch(
        sendAssistantMessage({ conversationId: 'c1', text: `Attempt ${attempt}` }),
      );
      expect(action.meta.requestStatus).toBe('rejected');
    }
  });

  it('surfaces an SSE error event without replacing its localized message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamResponse([
        frame('meta', {
          conversationId: 'c1',
          userMessageId: 'u1',
          assistantMessageId: 'a1',
          responseLocale: 'en',
        }),
        frame('error', {
          code: 'budget_circuit_open',
          messageKey: 'chat.errors.generationFailed',
          message: 'Please try later.',
        }),
      ]),
    );
    const store = makeStore();

    const action = await store.dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Hello' }),
    );

    expect(action.meta.requestStatus).toBe('rejected');
    expect(action.payload).toMatchObject({
      kind: 'stream',
      message: 'Please try later.',
      code: 'budget_circuit_open',
    });
    expect(store.getState().assistant.stream).toMatchObject({
      status: 'error',
      requestId: null,
      error: { code: 'budget_circuit_open' },
    });
    expect(store.getState().assistant.messagesByConversation.c1?.[1]).toMatchObject({
      status: 'error',
    });
  });

  it('maps pre-stream JSON refusals and tolerates malformed refusal JSON', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            message: 'Assistant is switched off.',
            details: { feature: 'assistant' },
          },
        }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const firstStore = makeStore();
    const first = await firstStore.dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Hello' }),
    );
    expect(first.payload).toMatchObject({
      kind: 'unavailable',
      message: 'Assistant is switched off.',
      status: 503,
    });

    fetchSpy.mockResolvedValueOnce(
      new Response('{', {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const secondStore = makeStore();
    const second = await secondStore.dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Again' }),
    );
    expect(second.payload).toMatchObject({ kind: 'generic', status: 500 });

    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const thirdStore = makeStore();
    const third = await thirdStore.dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Once more' }),
    );
    expect(third.payload).toMatchObject({ kind: 'rate_limited', status: 429 });
  });

  it('maps a raw network failure and a CSRF refusal before the stream opens', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('offline'));
    const networkStore = makeStore();
    const network = await networkStore.dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Hello' }),
    );
    expect(network.payload).toMatchObject({ kind: 'generic', status: 0 });
    expect((network.payload as { message: string }).message).toContain('Network request');

    api.getAssistantCsrfToken.mockRejectedValueOnce(new ApiError('csrf', 403, null));
    const csrfStore = makeStore();
    const csrf = await csrfStore.dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Hello' }),
    );
    expect(csrf.payload).toMatchObject({ kind: 'forbidden', status: 403 });
  });

  it('normalizes a raw TypeError raised before the stream request opens', async () => {
    api.getAssistantCsrfToken.mockRejectedValueOnce(new TypeError('offline'));

    const action = await makeStore().dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Hello' }),
    );

    expect(action.payload).toMatchObject({ kind: 'generic', status: 0 });
    expect((action.payload as { message: string }).message).toContain('Network request');
  });

  it.each([
    ['non-object JSON', 'event: delta\ndata: []\n\n'],
    ['bad delta field', frame('delta', { text: 3 })],
    [
      'conversation mismatch',
      frame('meta', {
        conversationId: 'other',
        userMessageId: 'u1',
        assistantMessageId: 'a1',
        responseLocale: 'en',
      }),
    ],
    [
      'bad tool result',
      frame('tool_result', {
        toolCallId: 'tc1',
        toolName: 'list_sites',
        ok: 'yes',
        structuredContent: {},
      }),
    ],
    [
      'bad optional error code',
      frame('tool_result', {
        toolCallId: 'tc1',
        toolName: 'list_sites',
        ok: false,
        structuredContent: {},
        errorCode: 3,
      }),
    ],
    [
      'missing stream error message key',
      frame('error', { code: 'failed', message: 'Localized message' }),
    ],
    ['bad token object', frame('done', { finishReason: 'stop', tokens: [] })],
    [
      'bad token value',
      frame('done', { finishReason: 'stop', tokens: { input: 'ten', output: 2 } }),
    ],
  ])('rejects malformed streamed protocol data: %s', async (_name, badFrame) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      streamResponse([
        frame('meta', {
          conversationId: 'c1',
          userMessageId: 'u1',
          assistantMessageId: 'a1',
          responseLocale: 'en',
        }),
        badFrame,
      ]),
    );
    const store = makeStore();

    const action = await store.dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Hello' }),
    );

    expect(action.meta.requestStatus).toBe('rejected');
    expect(action.payload).toMatchObject({ kind: 'stream', code: 'invalid_stream' });
  });

  it('rejects an incomplete stream whether meta or done is missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(
      streamResponse([
        frame('done', { finishReason: 'stop', tokens: { input: null, output: null } }),
      ]),
    );
    const withoutMeta = await makeStore().dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Hello' }),
    );
    expect(withoutMeta.payload).toMatchObject({
      kind: 'stream',
      code: 'incomplete_stream',
    });

    fetchSpy.mockResolvedValueOnce(
      streamResponse([
        frame('meta', {
          conversationId: 'c1',
          userMessageId: 'u1',
          assistantMessageId: 'a1',
          responseLocale: 'en',
        }),
      ]),
    );
    const withoutDone = await makeStore().dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Hello' }),
    );
    expect(withoutDone.payload).toMatchObject({
      kind: 'stream',
      code: 'incomplete_stream',
    });
  });

  it('rejects a successful response that is not a readable event stream', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValueOnce(
      new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const wrongType = await makeStore().dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Hello' }),
    );
    expect(wrongType.payload).toMatchObject({ kind: 'generic' });

    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const noBody = await makeStore().dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Hello' }),
    );
    expect(noBody.payload).toMatchObject({ kind: 'generic' });
  });

  it('Stop aborts the live fetch and resolves as an intentional abort', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, rejectPromise) => {
          init?.signal?.addEventListener('abort', () => {
            rejectPromise(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    const store = makeStore();
    const pending = store.dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Stop me' }),
    );
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    expect(stopAssistantStream()).toBe(true);
    const action = await pending;

    expect(action.meta.requestStatus).toBe('fulfilled');
    expect(action.payload).toMatchObject({ outcome: 'aborted' });
    expect(store.getState().assistant.stream.status).toBe('aborted');
    expect(stopAssistantStream()).toBe(false);
  });

  it('starting a new stream cancels the previous controller without clobbering the new result', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockImplementationOnce(
      (_input, init) =>
        new Promise<Response>((_resolve, rejectPromise) => {
          init?.signal?.addEventListener('abort', () => {
            rejectPromise(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );
    fetchSpy.mockResolvedValueOnce(streamResponse(successfulFrames()));
    const store = makeStore();
    const first = store.dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'First' }),
    );
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const second = store.dispatch(
      sendAssistantMessage({ conversationId: 'c1', text: 'Second' }),
    );

    const [firstAction, secondAction] = await Promise.all([first, second]);
    expect(firstAction.payload).toMatchObject({ outcome: 'aborted' });
    expect(secondAction.payload).toMatchObject({ outcome: 'complete' });
    expect(store.getState().assistant.stream).toMatchObject({
      status: 'succeeded',
      lastPrompt: 'Second',
    });
  });
});
