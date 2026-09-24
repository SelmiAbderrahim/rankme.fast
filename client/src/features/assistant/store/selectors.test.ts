import { describe, expect, it } from 'vitest';
import type { AssistantClientError, ChatConversation, ChatMessage } from '../types';
import {
  initialAssistantState,
  type AssistantState,
} from './slice';
import {
  selectActiveAssistantMessages,
  selectActiveConversation,
  selectActiveConversationId,
  selectAssistantAccessError,
  selectAssistantConversations,
  selectAssistantCreateError,
  selectAssistantCreateStatus,
  selectAssistantDeleteError,
  selectAssistantDeleting,
  selectAssistantDetailError,
  selectAssistantDetailStatus,
  selectAssistantIsStreaming,
  selectAssistantListError,
  selectAssistantListStatus,
  selectAssistantMessages,
  selectAssistantState,
  selectAssistantStream,
} from './selectors';

const error: AssistantClientError = {
  kind: 'generic',
  message: 'failed',
  status: null,
  retryAfterMs: null,
  code: null,
};

const conversation: ChatConversation = {
  id: 'c1',
  siteId: null,
  title: 'Conversation',
  locale: 'en',
  lastMessageAt: '2026-08-02T10:00:00.000Z',
  messageCount: 1,
  createdAt: '2026-08-02T10:00:00.000Z',
};

const message: ChatMessage = {
  id: 'm1',
  role: 'user',
  status: 'complete',
  responseLocale: null,
  parts: [{ type: 'text', text: 'Hello' }],
  tokens: null,
  createdAt: '2026-08-02T10:00:00.000Z',
};

const populated = (overrides: Partial<AssistantState> = {}) => ({
  assistant: {
    ...initialAssistantState,
    conversations: [conversation],
    listStatus: 'succeeded' as const,
    activeConversationId: 'c1',
    messagesByConversation: { c1: [message] },
    detailStatus: { c1: 'succeeded' as const },
    detailError: { c1: error },
    createStatus: 'loading' as const,
    deleting: { c1: true },
    deleteError: { c1: error },
    stream: { ...initialAssistantState.stream, status: 'connecting' as const },
    ...overrides,
  },
});

describe('assistant selectors', () => {
  it('falls back to initial state before the lazy slice materializes', () => {
    const state = {};
    expect(selectAssistantState(state)).toBe(initialAssistantState);
    expect(selectAssistantConversations(state)).toEqual([]);
    expect(selectAssistantListStatus(state)).toBe('idle');
    expect(selectAssistantListError(state)).toBeNull();
    expect(selectActiveConversationId(state)).toBeNull();
    expect(selectActiveConversation(state)).toBeUndefined();
    expect(selectAssistantMessages(null)(state)).toEqual([]);
    expect(selectAssistantMessages('missing')(state)).toEqual([]);
    expect(selectActiveAssistantMessages(state)).toEqual([]);
    expect(selectAssistantDetailStatus(null)(state)).toBe('idle');
    expect(selectAssistantDetailStatus('missing')(state)).toBe('idle');
    expect(selectAssistantDetailError(null)(state)).toBeNull();
    expect(selectAssistantDetailError('missing')(state)).toBeNull();
    expect(selectAssistantCreateStatus(state)).toBe('idle');
    expect(selectAssistantCreateError(state)).toBeNull();
    expect(selectAssistantDeleting(null)(state)).toBe(false);
    expect(selectAssistantDeleting('missing')(state)).toBe(false);
    expect(selectAssistantDeleteError(null)(state)).toBeNull();
    expect(selectAssistantDeleteError('missing')(state)).toBeNull();
    expect(selectAssistantStream(state)).toBe(initialAssistantState.stream);
    expect(selectAssistantIsStreaming(state)).toBe(false);
    expect(selectAssistantAccessError(state)).toBeNull();
  });

  it('reads active conversation, messages, request state, and per-row state', () => {
    const state = populated({ createError: error });
    expect(selectAssistantConversations(state)).toEqual([conversation]);
    expect(selectActiveConversation(state)).toEqual(conversation);
    expect(selectAssistantMessages('c1')(state)).toEqual([message]);
    expect(selectActiveAssistantMessages(state)).toEqual([message]);
    expect(selectAssistantDetailStatus('c1')(state)).toBe('succeeded');
    expect(selectAssistantDetailError('c1')(state)).toBe(error);
    expect(selectAssistantCreateStatus(state)).toBe('loading');
    expect(selectAssistantCreateError(state)).toBe(error);
    expect(selectAssistantDeleting('c1')(state)).toBe(true);
    expect(selectAssistantDeleteError('c1')(state)).toBe(error);
    expect(selectAssistantIsStreaming(state)).toBe(true);
    expect(selectAssistantAccessError(state)).toBe(error);
    expect(
      selectActiveAssistantMessages(
        populated({ messagesByConversation: {} }),
      ),
    ).toEqual([]);
  });

  it('treats streaming as live and prioritizes list, create, then stream errors', () => {
    const listError = { ...error, message: 'list' };
    const createError = { ...error, message: 'create' };
    const streamError = { ...error, message: 'stream' };
    expect(
      selectAssistantIsStreaming(
        populated({ stream: { ...initialAssistantState.stream, status: 'streaming' } }),
      ),
    ).toBe(true);
    expect(
      selectAssistantAccessError(
        populated({
          listError,
          createError,
          stream: { ...initialAssistantState.stream, error: streamError },
        }),
      ),
    ).toBe(listError);
    expect(
      selectAssistantAccessError(
        populated({
          listError: null,
          createError,
          stream: { ...initialAssistantState.stream, error: streamError },
        }),
      ),
    ).toBe(createError);
    expect(
      selectAssistantAccessError(
        populated({
          listError: null,
          createError: null,
          stream: { ...initialAssistantState.stream, error: streamError },
        }),
      ),
    ).toBe(streamError);
  });
});
