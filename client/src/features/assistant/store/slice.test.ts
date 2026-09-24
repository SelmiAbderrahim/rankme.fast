import { describe, expect, it } from 'vitest';
import type { AssistantClientError, ChatConversation, ChatMessage } from '../types';
import {
  assistantReducer,
  clearAssistantErrors,
  initialAssistantState,
  resetAssistant,
  setActiveConversationId,
} from './slice';
import { presentationLocaleChanged } from '@shared/i18n';
import {
  createAssistantConversationThunk,
  deleteAssistantConversationThunk,
  deltaAppended,
  loadAssistantConversation,
  loadAssistantConversations,
  messageFinished,
  sendAssistantMessage,
  streamErrored,
  streamMetaReceived,
  toolCallReceived,
  toolResultReceived,
} from './thunks';

const error: AssistantClientError = {
  kind: 'generic',
  message: 'failed',
  status: null,
  retryAfterMs: null,
  code: null,
};

const conversation = (id: string, title = ''): ChatConversation => ({
  id,
  siteId: null,
  title,
  locale: 'en',
  lastMessageAt: '2026-08-02T10:00:00.000Z',
  messageCount: 0,
  createdAt: '2026-08-02T10:00:00.000Z',
});

const message = (id: string): ChatMessage => ({
  id,
  role: 'user',
  status: 'complete',
  responseLocale: null,
  parts: [{ type: 'text', text: 'stored' }],
  tokens: null,
  createdAt: '2026-08-02T10:00:00.000Z',
});

const abortError = { name: 'AbortError', message: 'Aborted' };

describe('assistant slice request lifecycle', () => {
  it('selects, clears errors, and resets the feature state', () => {
    let state = assistantReducer(
      undefined,
      loadAssistantConversations.rejected(null, 'list', undefined, error),
    );
    state = assistantReducer(
      state,
      createAssistantConversationThunk.rejected(null, 'create', undefined, error),
    );
    state = assistantReducer(
      state,
      sendAssistantMessage.pending('stream', { conversationId: 'c1', text: 'x' }),
    );
    state = assistantReducer(
      state,
      streamErrored({ requestId: 'stream', conversationId: 'c1', error }),
    );
    state = assistantReducer(state, setActiveConversationId('c1'));
    expect(state.activeConversationId).toBe('c1');
    expect(state.listError).toBe(error);
    expect(state.createError).toBe(error);
    expect(state.stream.error).toBe(error);

    state = assistantReducer(state, clearAssistantErrors());
    expect(state.listError).toBeNull();
    expect(state.createError).toBeNull();
    expect(state.stream.error).toBeNull();
    expect(assistantReducer(state, resetAssistant())).toEqual(initialAssistantState);
  });

  it('covers list loading, active-id retention/replacement, empty lists, and aborts', () => {
    let state = assistantReducer(
      undefined,
      loadAssistantConversations.pending('r1', undefined),
    );
    expect(state).toMatchObject({ listStatus: 'loading', listError: null });

    state = assistantReducer(
      state,
      loadAssistantConversations.fulfilled([], 'r1', undefined),
    );
    expect(state.activeConversationId).toBeNull();

    state = assistantReducer(
      state,
      loadAssistantConversations.fulfilled(
        [conversation('c1'), conversation('c2')],
        'r2',
        undefined,
      ),
    );
    expect(state.activeConversationId).toBe('c1');

    state = assistantReducer(state, setActiveConversationId('c2'));
    state = assistantReducer(
      state,
      loadAssistantConversations.fulfilled(
        [conversation('c1'), conversation('c2')],
        'r3',
        undefined,
      ),
    );
    expect(state.activeConversationId).toBe('c2');

    state = assistantReducer(
      state,
      loadAssistantConversations.fulfilled([conversation('c1')], 'r4', undefined),
    );
    expect(state.activeConversationId).toBe('c1');

    state = assistantReducer(
      state,
      loadAssistantConversations.rejected(abortError, 'r5', undefined),
    );
    expect(state.listStatus).toBe('idle');
    expect(state.listError).toBeNull();

    state = assistantReducer(
      state,
      loadAssistantConversations.rejected(null, 'r6', undefined),
    );
    expect(state).toMatchObject({ listStatus: 'failed', listError: null });
  });

  it('loads detail, creates conversations, and handles abort/error branches', () => {
    let state = assistantReducer(
      undefined,
      loadAssistantConversation.pending('detail-1', { conversationId: 'c1' }),
    );
    expect(state.detailStatus.c1).toBe('loading');

    state = assistantReducer(
      state,
      loadAssistantConversation.fulfilled(
        { conversation: conversation('c1', 'Loaded'), messages: [message('m1')] },
        'detail-1',
        { conversationId: 'c1' },
      ),
    );
    expect(state.conversations[0]?.title).toBe('Loaded');
    expect(state.messagesByConversation.c1).toHaveLength(1);

    state = assistantReducer(
      state,
      loadAssistantConversation.fulfilled(
        { conversation: conversation('c1', 'Updated'), messages: [] },
        'detail-2',
        { conversationId: 'c1' },
      ),
    );
    expect(state.conversations).toHaveLength(1);
    expect(state.conversations[0]?.title).toBe('Updated');

    state = assistantReducer(
      state,
      loadAssistantConversation.rejected(abortError, 'detail-3', {
        conversationId: 'c1',
      }),
    );
    expect(state.detailStatus.c1).toBe('idle');
    state = assistantReducer(
      state,
      loadAssistantConversation.rejected(null, 'detail-4', {
        conversationId: 'c1',
      }),
    );
    expect(state.detailError.c1).toBeNull();

    state = assistantReducer(
      state,
      createAssistantConversationThunk.pending('create-1', undefined),
    );
    expect(state.createStatus).toBe('loading');
    state = assistantReducer(
      state,
      createAssistantConversationThunk.fulfilled(
        conversation('c2'),
        'create-1',
        undefined,
      ),
    );
    expect(state.activeConversationId).toBe('c2');
    expect(state.messagesByConversation.c2).toEqual([]);
    expect(state.detailStatus.c2).toBe('succeeded');
    expect(state.detailError.c2).toBeNull();

    state = assistantReducer(
      state,
      createAssistantConversationThunk.rejected(abortError, 'create-2', undefined),
    );
    expect(state.createStatus).toBe('idle');
    state = assistantReducer(
      state,
      createAssistantConversationThunk.rejected(null, 'create-3', undefined),
    );
    expect(state).toMatchObject({ createStatus: 'failed', createError: null });
  });

  it('deletes active/non-active conversations and records only non-abort errors', () => {
    let state = assistantReducer(
      undefined,
      loadAssistantConversations.fulfilled(
        [conversation('c1'), conversation('c2')],
        'seed',
        undefined,
      ),
    );
    state = assistantReducer(
      state,
      loadAssistantConversation.fulfilled(
        { conversation: conversation('c2'), messages: [message('m2')] },
        'detail',
        { conversationId: 'c2' },
      ),
    );
    state = assistantReducer(
      state,
      deleteAssistantConversationThunk.pending('delete-1', { conversationId: 'c2' }),
    );
    expect(state.deleting.c2).toBe(true);
    state = assistantReducer(
      state,
      deleteAssistantConversationThunk.fulfilled(
        { conversationId: 'c2' },
        'delete-1',
        { conversationId: 'c2' },
      ),
    );
    expect(state.activeConversationId).toBe('c1');
    expect(state.messagesByConversation.c2).toBeUndefined();

    state = assistantReducer(
      state,
      deleteAssistantConversationThunk.fulfilled(
        { conversationId: 'missing' },
        'delete-2',
        { conversationId: 'missing' },
      ),
    );
    expect(state.activeConversationId).toBe('c1');

    state = assistantReducer(
      state,
      deleteAssistantConversationThunk.pending('delete-3', { conversationId: 'c1' }),
    );
    state = assistantReducer(
      state,
      deleteAssistantConversationThunk.rejected(
        abortError,
        'delete-3',
        { conversationId: 'c1' },
      ),
    );
    expect(state.deleteError.c1).toBeNull();

    state = assistantReducer(
      state,
      deleteAssistantConversationThunk.rejected(
        null,
        'delete-4',
        { conversationId: 'c1' },
        error,
      ),
    );
    expect(state.deleteError.c1).toBe(error);

    state = assistantReducer(
      state,
      deleteAssistantConversationThunk.rejected(
        { name: 'Error', message: 'failed' },
        'delete-4-no-payload',
        { conversationId: 'c1' },
      ),
    );
    expect(state.deleteError.c1).toBeNull();

    state = assistantReducer(
      state,
      deleteAssistantConversationThunk.fulfilled(
        { conversationId: 'c1' },
        'delete-5',
        { conversationId: 'c1' },
      ),
    );
    expect(state.activeConversationId).toBeNull();
  });
});

describe('assistant presentation-locale invalidation', () => {
  it('clears transient errors without changing accepted history or stream state', () => {
    const accepted = message('accepted');
    const seeded = {
      ...initialAssistantState,
      listError: error,
      detailError: { c1: error },
      createError: error,
      deleteError: { c1: error },
      messagesByConversation: { c1: [accepted] },
      stream: { ...initialAssistantState.stream, status: 'succeeded' as const, error },
    };

    const next = assistantReducer(
      seeded,
      presentationLocaleChanged({
        locale: 'ar',
        generation: 1,
        refreshGeneration: 1,
        reason: 'language-changed',
      }),
    );

    expect(next).toMatchObject({
      listError: null,
      detailError: {},
      createError: null,
      deleteError: {},
      stream: { status: 'succeeded', error: null },
    });
    expect(next.messagesByConversation.c1).toEqual([accepted]);
  });
});

describe('assistant slice stream actions', () => {
  const start = (title = '') => {
    let state = assistantReducer(
      undefined,
      loadAssistantConversations.fulfilled([conversation('c1', title)], 'seed', undefined),
    );
    state = assistantReducer(
      state,
      loadAssistantConversation.fulfilled(
        { conversation: conversation('c1', title), messages: [message('stored')] },
        'detail',
        { conversationId: 'c1' },
      ),
    );
    return assistantReducer(
      state,
      sendAssistantMessage.pending('stream-1', {
        conversationId: 'c1',
        text: 'Prompt',
      }),
    );
  };

  it('ignores every stale event and current-request events for another conversation', () => {
    let state = start();
    const snapshot = state;
    state = assistantReducer(
      state,
      streamMetaReceived({
        requestId: 'stale',
        conversationId: 'c1',
        userMessageId: 'u1',
        assistantMessageId: 'a1',
        responseLocale: 'en',
        userText: 'x',
        createdAt: 'now',
      }),
    );
    state = assistantReducer(
      state,
      deltaAppended({ requestId: 'stale', conversationId: 'c1', text: 'x' }),
    );
    state = assistantReducer(
      state,
      toolCallReceived({
        requestId: 'stale',
        conversationId: 'c1',
        toolCallId: 'tc',
        toolName: 'list_sites',
        args: {},
      }),
    );
    state = assistantReducer(
      state,
      toolResultReceived({
        requestId: 'stale',
        conversationId: 'c1',
        toolCallId: 'tc',
        toolName: 'list_sites',
        ok: true,
        structuredContent: {},
      }),
    );
    state = assistantReducer(
      state,
      messageFinished({
        requestId: 'stale',
        conversationId: 'c1',
        status: 'complete',
        finishReason: 'stop',
        tokens: { input: 1, output: 1 },
      }),
    );
    state = assistantReducer(
      state,
      streamErrored({ requestId: 'stale', conversationId: 'c1', error }),
    );
    state = assistantReducer(
      state,
      deltaAppended({
        requestId: 'stream-1',
        conversationId: 'other',
        text: 'x',
      }),
    );
    expect(state).toEqual(snapshot);
  });

  it('appends into an existing message list, keeps an existing title, and finalizes an abort', () => {
    let state = start('Existing title');
    state = assistantReducer(
      state,
      deltaAppended({
        requestId: 'stream-1',
        conversationId: 'c1',
        text: 'before meta',
      }),
    );
    state = assistantReducer(
      state,
      streamMetaReceived({
        requestId: 'stream-1',
        conversationId: 'c1',
        userMessageId: 'u1',
        assistantMessageId: 'a1',
        responseLocale: 'fr',
        userText: 'Prompt',
        createdAt: '2026-08-02T11:00:00.000Z',
      }),
    );
    state = assistantReducer(
      state,
      deltaAppended({ requestId: 'stream-1', conversationId: 'c1', text: 'one' }),
    );
    state = assistantReducer(
      state,
      deltaAppended({ requestId: 'stream-1', conversationId: 'c1', text: ' two' }),
    );
    state = assistantReducer(
      state,
      toolCallReceived({
        requestId: 'stream-1',
        conversationId: 'c1',
        toolCallId: 'tc1',
        toolName: 'list_sites',
        args: {},
      }),
    );
    state = assistantReducer(
      state,
      toolResultReceived({
        requestId: 'stream-1',
        conversationId: 'c1',
        toolCallId: 'tc1',
        toolName: 'list_sites',
        ok: false,
        structuredContent: { error: 'no' },
      }),
    );
    state = assistantReducer(
      state,
      messageFinished({
        requestId: 'stream-1',
        conversationId: 'c1',
        status: 'aborted',
        finishReason: 'aborted',
        tokens: { input: null, output: null },
      }),
    );

    expect(state.conversations[0]).toMatchObject({
      title: 'Existing title',
      lastMessageAt: '2026-08-02T11:00:00.000Z',
    });
    expect(state.stream.status).toBe('aborted');
    expect(state.messagesByConversation.c1?.at(-1)).toMatchObject({
      id: 'a1',
      status: 'aborted',
      parts: [
        { type: 'text', text: 'one two' },
        { type: 'tool_call' },
        { type: 'tool_result', ok: false },
      ],
    });
  });

  it('handles missing streamed messages for tool/final/error actions', () => {
    let state = start();
    state = assistantReducer(
      state,
      toolCallReceived({
        requestId: 'stream-1',
        conversationId: 'c1',
        toolCallId: 'tc1',
        toolName: 'list_sites',
        args: {},
      }),
    );
    state = assistantReducer(
      state,
      toolResultReceived({
        requestId: 'stream-1',
        conversationId: 'c1',
        toolCallId: 'tc1',
        toolName: 'list_sites',
        ok: true,
        structuredContent: {},
        errorCode: 'none',
      }),
    );
    state = assistantReducer(
      state,
      messageFinished({
        requestId: 'stream-1',
        conversationId: 'c1',
        status: 'complete',
        finishReason: 'stop',
        tokens: { input: 1, output: 1 },
      }),
    );
    expect(state.stream.status).toBe('succeeded');

    state = assistantReducer(
      state,
      streamErrored({ requestId: 'stream-1', conversationId: 'c1', error }),
    );
    expect(state.stream).toMatchObject({ status: 'error', error });
  });

  it('handles fulfilled/rejected completion, abort, fallback error, and stale lifecycle actions', () => {
    let state = start();
    state = assistantReducer(
      state,
      sendAssistantMessage.fulfilled(
        {
          conversationId: 'c1',
          responseLocale: 'en',
          outcome: 'complete',
          finishReason: 'stop',
          tokens: null,
        },
        'stale',
        { conversationId: 'c1', text: 'x' },
      ),
    );
    state = assistantReducer(
      state,
      sendAssistantMessage.rejected(
        null,
        'stale',
        { conversationId: 'c1', text: 'x' },
        error,
      ),
    );
    expect(state.stream.requestId).toBe('stream-1');

    state = assistantReducer(
      state,
      streamErrored({ requestId: 'stream-1', conversationId: 'c1', error }),
    );
    state = assistantReducer(
      state,
      sendAssistantMessage.rejected(
        null,
        'stream-1',
        { conversationId: 'c1', text: 'Prompt' },
      ),
    );
    expect(state.stream).toMatchObject({ status: 'error', requestId: null, error });

    state = start();
    state = assistantReducer(
      state,
      streamMetaReceived({
        requestId: 'stream-1',
        conversationId: 'c1',
        userMessageId: 'u1',
        assistantMessageId: 'a1',
        responseLocale: 'ar',
        userText: 'Prompt',
        createdAt: 'now',
      }),
    );
    state = assistantReducer(
      state,
      sendAssistantMessage.rejected(abortError, 'stream-1', {
        conversationId: 'c1',
        text: 'Prompt',
      }),
    );
    expect(state.stream.status).toBe('aborted');
    expect(state.messagesByConversation.c1?.at(-1)?.status).toBe('aborted');

    state = start();
    state = assistantReducer(
      state,
      sendAssistantMessage.rejected(abortError, 'stream-1', {
        conversationId: 'c1',
        text: 'Prompt',
      }),
    );
    expect(state.stream.status).toBe('aborted');
  });
});
