import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  AssistantClientError,
  ChatConversation,
  ChatMessage,
} from '../types';
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
import { presentationLocaleChanged } from '@shared/i18n/requestIdentity';
import type { SupportedLocale } from '@shared/i18n';

export type AssistantLoadStatus = 'idle' | 'loading' | 'succeeded' | 'failed';
export type AssistantStreamStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'succeeded'
  | 'error'
  | 'aborted';

export interface AssistantStreamState {
  status: AssistantStreamStatus;
  requestId: string | null;
  conversationId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  responseLocale: SupportedLocale | null;
  lastPrompt: string;
  finishReason: string | null;
  tokens: { input: number | null; output: number | null } | null;
  error: AssistantClientError | null;
}

export interface AssistantState {
  conversations: ChatConversation[];
  listStatus: AssistantLoadStatus;
  listError: AssistantClientError | null;
  activeConversationId: string | null;
  messagesByConversation: Record<string, ChatMessage[] | undefined>;
  detailStatus: Record<string, AssistantLoadStatus | undefined>;
  detailError: Record<string, AssistantClientError | null | undefined>;
  createStatus: AssistantLoadStatus;
  createError: AssistantClientError | null;
  deleting: Record<string, boolean | undefined>;
  deleteError: Record<string, AssistantClientError | null | undefined>;
  stream: AssistantStreamState;
}

export const initialAssistantStreamState: AssistantStreamState = {
  status: 'idle',
  requestId: null,
  conversationId: null,
  userMessageId: null,
  assistantMessageId: null,
  responseLocale: null,
  lastPrompt: '',
  finishReason: null,
  tokens: null,
  error: null,
};

export const initialAssistantState: AssistantState = {
  conversations: [],
  listStatus: 'idle',
  listError: null,
  activeConversationId: null,
  messagesByConversation: {},
  detailStatus: {},
  detailError: {},
  createStatus: 'idle',
  createError: null,
  deleting: {},
  deleteError: {},
  stream: initialAssistantStreamState,
};

function upsertConversation(
  state: AssistantState,
  conversation: ChatConversation,
): void {
  const index = state.conversations.findIndex((item) => item.id === conversation.id);
  if (index === -1) {
    state.conversations.unshift(conversation);
  } else {
    state.conversations[index] = conversation;
  }
}

function messagesFor(
  state: AssistantState,
  conversationId: string,
): ChatMessage[] {
  const existing = state.messagesByConversation[conversationId];
  if (existing) return existing;
  state.messagesByConversation[conversationId] = [];
  return state.messagesByConversation[conversationId]!;
}

function streamedAssistantMessage(state: AssistantState): ChatMessage | undefined {
  const conversationId = state.stream.conversationId;
  const messageId = state.stream.assistantMessageId;
  if (!conversationId || !messageId) return undefined;
  return state.messagesByConversation[conversationId]?.find(
    (message) => message.id === messageId,
  );
}

const isCurrentStream = (
  state: AssistantState,
  requestId: string,
  conversationId: string,
): boolean =>
  state.stream.requestId === requestId &&
  state.stream.conversationId === conversationId;

const slice = createSlice({
  name: 'assistant',
  initialState: initialAssistantState,
  reducers: {
    resetAssistant: () => initialAssistantState,
    setActiveConversationId: (state, action: PayloadAction<string | null>) => {
      state.activeConversationId = action.payload;
    },
    clearAssistantErrors: (state) => {
      state.listError = null;
      state.createError = null;
      state.stream.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadAssistantConversations.pending, (state) => {
        state.listStatus = 'loading';
        state.listError = null;
      })
      .addCase(loadAssistantConversations.fulfilled, (state, action) => {
        state.listStatus = 'succeeded';
        state.conversations = action.payload;
        if (
          state.activeConversationId === null ||
          !action.payload.some((item) => item.id === state.activeConversationId)
        ) {
          state.activeConversationId = action.payload[0]?.id ?? null;
        }
      })
      .addCase(loadAssistantConversations.rejected, (state, action) => {
        state.listStatus = action.meta.aborted ? 'idle' : 'failed';
        if (!action.meta.aborted) state.listError = action.payload ?? null;
      })
      .addCase(loadAssistantConversation.pending, (state, action) => {
        const id = action.meta.arg.conversationId;
        state.detailStatus[id] = 'loading';
        state.detailError[id] = null;
      })
      .addCase(loadAssistantConversation.fulfilled, (state, action) => {
        const id = action.meta.arg.conversationId;
        state.detailStatus[id] = 'succeeded';
        state.messagesByConversation[id] = action.payload.messages;
        upsertConversation(state, action.payload.conversation);
      })
      .addCase(loadAssistantConversation.rejected, (state, action) => {
        const id = action.meta.arg.conversationId;
        state.detailStatus[id] = action.meta.aborted ? 'idle' : 'failed';
        if (!action.meta.aborted) state.detailError[id] = action.payload ?? null;
      })
      .addCase(createAssistantConversationThunk.pending, (state) => {
        state.createStatus = 'loading';
        state.createError = null;
      })
      .addCase(createAssistantConversationThunk.fulfilled, (state, action) => {
        state.createStatus = 'succeeded';
        upsertConversation(state, action.payload);
        state.activeConversationId = action.payload.id;
        state.messagesByConversation[action.payload.id] = [];
        state.detailStatus[action.payload.id] = 'succeeded';
        state.detailError[action.payload.id] = null;
      })
      .addCase(createAssistantConversationThunk.rejected, (state, action) => {
        state.createStatus = action.meta.aborted ? 'idle' : 'failed';
        if (!action.meta.aborted) state.createError = action.payload ?? null;
      })
      .addCase(deleteAssistantConversationThunk.pending, (state, action) => {
        const id = action.meta.arg.conversationId;
        state.deleting[id] = true;
        state.deleteError[id] = null;
      })
      .addCase(deleteAssistantConversationThunk.fulfilled, (state, action) => {
        const id = action.payload.conversationId;
        delete state.deleting[id];
        delete state.deleteError[id];
        delete state.messagesByConversation[id];
        delete state.detailStatus[id];
        delete state.detailError[id];
        state.conversations = state.conversations.filter((item) => item.id !== id);
        if (state.activeConversationId === id) {
          state.activeConversationId = state.conversations[0]?.id ?? null;
        }
      })
      .addCase(deleteAssistantConversationThunk.rejected, (state, action) => {
        const id = action.meta.arg.conversationId;
        delete state.deleting[id];
        if (!action.meta.aborted) state.deleteError[id] = action.payload ?? null;
      })
      .addCase(sendAssistantMessage.pending, (state, action) => {
        state.stream = {
          ...initialAssistantStreamState,
          status: 'connecting',
          requestId: action.meta.requestId,
          conversationId: action.meta.arg.conversationId,
          lastPrompt: action.meta.arg.text,
        };
      })
      .addCase(streamMetaReceived, (state, action) => {
        if (!isCurrentStream(state, action.payload.requestId, action.payload.conversationId)) {
          return;
        }
        state.stream.status = 'streaming';
        state.stream.userMessageId = action.payload.userMessageId;
        state.stream.assistantMessageId = action.payload.assistantMessageId;
        state.stream.responseLocale = action.payload.responseLocale;

        const messages = messagesFor(state, action.payload.conversationId);
        messages.push(
          {
            id: action.payload.userMessageId,
            role: 'user',
            status: 'complete',
            responseLocale: null,
            parts: [{ type: 'text', text: action.payload.userText }],
            tokens: null,
            createdAt: action.payload.createdAt,
          },
          {
            id: action.payload.assistantMessageId,
            role: 'assistant',
            status: 'complete',
            responseLocale: action.payload.responseLocale,
            parts: [],
            tokens: null,
            createdAt: action.payload.createdAt,
          },
        );

        const conversation = state.conversations.find(
          (item) => item.id === action.payload.conversationId,
        );
        if (conversation) {
          if (conversation.title.length === 0) {
            conversation.title = action.payload.userText.slice(0, 120);
          }
          conversation.lastMessageAt = action.payload.createdAt;
        }
      })
      .addCase(deltaAppended, (state, action) => {
        if (!isCurrentStream(state, action.payload.requestId, action.payload.conversationId)) {
          return;
        }
        const message = streamedAssistantMessage(state);
        if (!message) return;
        const lastPart = message.parts.at(-1);
        if (lastPart?.type === 'text') {
          lastPart.text += action.payload.text;
        } else {
          message.parts.push({ type: 'text', text: action.payload.text });
        }
      })
      .addCase(toolCallReceived, (state, action) => {
        if (!isCurrentStream(state, action.payload.requestId, action.payload.conversationId)) {
          return;
        }
        streamedAssistantMessage(state)?.parts.push({
          type: 'tool_call',
          toolCallId: action.payload.toolCallId,
          toolName: action.payload.toolName,
          args: action.payload.args,
        });
      })
      .addCase(toolResultReceived, (state, action) => {
        if (!isCurrentStream(state, action.payload.requestId, action.payload.conversationId)) {
          return;
        }
        streamedAssistantMessage(state)?.parts.push({
          type: 'tool_result',
          toolCallId: action.payload.toolCallId,
          toolName: action.payload.toolName,
          ok: action.payload.ok,
          structuredContent: action.payload.structuredContent,
          ...(action.payload.errorCode
            ? { errorCode: action.payload.errorCode }
            : {}),
        });
      })
      .addCase(messageFinished, (state, action) => {
        if (!isCurrentStream(state, action.payload.requestId, action.payload.conversationId)) {
          return;
        }
        const message = streamedAssistantMessage(state);
        if (message) {
          message.status = action.payload.status;
          message.tokens = action.payload.tokens;
        }
        state.stream.status =
          action.payload.status === 'complete' ? 'succeeded' : 'aborted';
        state.stream.finishReason = action.payload.finishReason;
        state.stream.tokens = action.payload.tokens;
      })
      .addCase(streamErrored, (state, action) => {
        if (!isCurrentStream(state, action.payload.requestId, action.payload.conversationId)) {
          return;
        }
        const message = streamedAssistantMessage(state);
        if (message) message.status = 'error';
        state.stream.status = 'error';
        state.stream.error = action.payload.error;
      })
      .addCase(sendAssistantMessage.fulfilled, (state, action) => {
        if (state.stream.requestId !== action.meta.requestId) return;
        if (action.payload.outcome === 'aborted') state.stream.status = 'aborted';
        state.stream.requestId = null;
      })
      .addCase(sendAssistantMessage.rejected, (state, action) => {
        if (state.stream.requestId !== action.meta.requestId) return;
        if (action.meta.aborted) {
          const message = streamedAssistantMessage(state);
          if (message) message.status = 'aborted';
          state.stream.status = 'aborted';
        } else {
          state.stream.status = 'error';
          state.stream.error = action.payload ?? state.stream.error;
        }
        state.stream.requestId = null;
      })
      .addCase(presentationLocaleChanged, (state) => {
        // History and accepted stream content are immutable artifacts. Only
        // presentation-localized transient errors are invalidated.
        state.listError = null;
        state.detailError = {};
        state.createError = null;
        state.deleteError = {};
        state.stream.error = null;
      });
  },
});

export const {
  clearAssistantErrors,
  resetAssistant,
  setActiveConversationId,
} = slice.actions;
export const assistantReducer = slice.reducer;
