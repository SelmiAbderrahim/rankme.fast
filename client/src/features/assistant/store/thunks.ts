import { createAction, createAsyncThunk } from '@reduxjs/toolkit';
import { ApiError, apiFetch } from '@shared/api/client';
import { parseSseStream, type SseEvent } from '@shared/api/sse';
import {
  getPresentationLocaleSnapshot,
  isSupportedLocale,
  type SupportedLocale,
} from '@shared/i18n';
import {
  assistantMessageStreamPath,
  createAssistantConversation as createConversationApi,
  deleteAssistantConversation as deleteConversationApi,
  getAssistantConversation as getConversationApi,
  getAssistantCsrfToken,
  listAssistantConversations as listConversationsApi,
} from '../api';
import {
  assistantErrorMessage,
  assistantStreamError,
} from '../errorMessage';
import type {
  AssistantClientError,
  ChatConversation,
  ChatMessage,
  ChatStreamDelta,
  ChatStreamDone,
  ChatStreamError,
  ChatStreamMeta,
  ChatStreamToolCall,
  ChatStreamToolResult,
  ConversationDetailResponse,
  SendAssistantMessageResult,
} from '../types';

interface StreamActionBase {
  requestId: string;
  conversationId: string;
}

export const streamMetaReceived = createAction<
  StreamActionBase & ChatStreamMeta & { userText: string; createdAt: string }
>('assistant/streamMetaReceived');

export const deltaAppended = createAction<StreamActionBase & ChatStreamDelta>(
  'assistant/deltaAppended',
);

export const toolCallReceived = createAction<
  StreamActionBase & ChatStreamToolCall
>('assistant/toolCallReceived');

export const toolResultReceived = createAction<
  StreamActionBase & ChatStreamToolResult
>('assistant/toolResultReceived');

export const messageFinished = createAction<
  StreamActionBase &
    Pick<ChatStreamDone, 'finishReason' | 'tokens'> & {
      status: 'complete' | 'aborted';
    }
>('assistant/messageFinished');

export const streamErrored = createAction<
  StreamActionBase & { error: AssistantClientError }
>('assistant/streamErrored');

interface AssistantThunkConfig {
  rejectValue: AssistantClientError;
}

const reject = (error: unknown): AssistantClientError =>
  assistantErrorMessage(error);

export const loadAssistantConversations = createAsyncThunk<
  ChatConversation[],
  void,
  AssistantThunkConfig
>('assistant/loadConversations', async (_arg, { rejectWithValue, signal }) => {
  try {
    const response = await listConversationsApi({ signal });
    return response.conversations;
  } catch (error) {
    return rejectWithValue(reject(error));
  }
});

export const loadAssistantConversation = createAsyncThunk<
  ConversationDetailResponse,
  { conversationId: string },
  AssistantThunkConfig
>(
  'assistant/loadConversation',
  async ({ conversationId }, { rejectWithValue, signal }) => {
    try {
      return await getConversationApi(conversationId, { signal });
    } catch (error) {
      return rejectWithValue(reject(error));
    }
  },
);

export const createAssistantConversationThunk = createAsyncThunk<
  ChatConversation,
  { siteId?: string } | undefined,
  AssistantThunkConfig
>('assistant/createConversation', async (input, { rejectWithValue, signal }) => {
  try {
    const response = await createConversationApi(input ?? {}, { signal });
    return response.conversation;
  } catch (error) {
    return rejectWithValue(reject(error));
  }
});

export const deleteAssistantConversationThunk = createAsyncThunk<
  { conversationId: string },
  { conversationId: string },
  AssistantThunkConfig
>(
  'assistant/deleteConversation',
  async ({ conversationId }, { rejectWithValue, signal }) => {
    try {
      await deleteConversationApi(conversationId, { signal });
      return { conversationId };
    } catch (error) {
      return rejectWithValue(reject(error));
    }
  },
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRecord = (data: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(data);
  if (!isRecord(parsed)) throw new Error('assistant-stream-frame-not-object');
  return parsed;
};

const stringField = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string') throw new Error('assistant-stream-string-field-invalid');
  return value;
};

const localeField = (
  record: Record<string, unknown>,
  key: string,
): SupportedLocale => {
  const value = stringField(record, key);
  if (!isSupportedLocale(value)) {
    throw new Error('assistant-stream-locale-field-invalid');
  }
  return value;
};

const tokenField = (
  record: Record<string, unknown>,
  key: 'input' | 'output',
): number | null => {
  const value = record[key];
  if (value !== null && typeof value !== 'number') {
    throw new Error('assistant-stream-token-field-invalid');
  }
  return value;
};

const optionalStringField = (
  record: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error('assistant-stream-optional-string-field-invalid');
  }
  return value;
};

interface StreamAccumulator {
  sawMeta: boolean;
  failure: AssistantClientError | null;
  finishReason: string | null;
  tokens: ChatStreamDone['tokens'] | null;
}

function handleStreamEvent(
  event: SseEvent,
  input: {
    requestId: string;
    conversationId: string;
    text: string;
    responseLocale: SupportedLocale;
  },
  dispatch: (action: ReturnType<
    | typeof streamMetaReceived
    | typeof deltaAppended
    | typeof toolCallReceived
    | typeof toolResultReceived
    | typeof messageFinished
    | typeof streamErrored
  >) => unknown,
  accumulator: StreamAccumulator,
): void {
  if (!['meta', 'delta', 'tool_call', 'tool_result', 'done', 'error'].includes(event.event)) {
    return;
  }

  const data = parseRecord(event.data);
  const base = { requestId: input.requestId, conversationId: input.conversationId };

  if (event.event === 'meta') {
    const meta: ChatStreamMeta = {
      conversationId: stringField(data, 'conversationId'),
      userMessageId: stringField(data, 'userMessageId'),
      assistantMessageId: stringField(data, 'assistantMessageId'),
      responseLocale: localeField(data, 'responseLocale'),
    };
    if (meta.conversationId !== input.conversationId) {
      throw new Error('assistant-stream-conversation-mismatch');
    }
    if (meta.responseLocale !== input.responseLocale) {
      throw new Error('assistant-stream-locale-mismatch');
    }
    accumulator.sawMeta = true;
    dispatch(
      streamMetaReceived({
        ...base,
        ...meta,
        userText: input.text,
        createdAt: new Date().toISOString(),
      }),
    );
    return;
  }

  if (event.event === 'delta') {
    dispatch(deltaAppended({ ...base, text: stringField(data, 'text') }));
    return;
  }

  if (event.event === 'tool_call') {
    dispatch(
      toolCallReceived({
        ...base,
        toolCallId: stringField(data, 'toolCallId'),
        toolName: stringField(data, 'toolName'),
        args: data.args,
      }),
    );
    return;
  }

  if (event.event === 'tool_result') {
    if (typeof data.ok !== 'boolean' || !isRecord(data.structuredContent)) {
      throw new Error('assistant-stream-tool-result-invalid');
    }
    const errorCode = optionalStringField(data, 'errorCode');
    dispatch(
      toolResultReceived({
        ...base,
        toolCallId: stringField(data, 'toolCallId'),
        toolName: stringField(data, 'toolName'),
        ok: data.ok,
        structuredContent: data.structuredContent,
        ...(errorCode ? { errorCode } : {}),
      }),
    );
    return;
  }

  if (event.event === 'done') {
    if (!isRecord(data.tokens)) throw new Error('assistant-stream-tokens-invalid');
    const done: ChatStreamDone = {
      finishReason: stringField(data, 'finishReason'),
      tokens: {
        input: tokenField(data.tokens, 'input'),
        output: tokenField(data.tokens, 'output'),
      },
    };
    accumulator.finishReason = done.finishReason;
    accumulator.tokens = done.tokens;
    dispatch(messageFinished({ ...base, ...done, status: 'complete' }));
    return;
  }

  const streamError: ChatStreamError = {
    code: stringField(data, 'code'),
    messageKey: stringField(data, 'messageKey'),
    message: stringField(data, 'message'),
  };
  accumulator.failure = assistantStreamError(streamError.message, streamError.code);
  dispatch(streamErrored({ ...base, error: accumulator.failure }));
}

async function responseJsonOrNull(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

let activeStreamController: AbortController | null = null;

/** Abort the live SSE fetch. Returns false when no stream is active. */
export function stopAssistantStream(): boolean {
  if (activeStreamController === null) return false;
  activeStreamController.abort();
  return true;
}

export const sendAssistantMessage = createAsyncThunk<
  SendAssistantMessageResult,
  { conversationId: string; text: string },
  AssistantThunkConfig
>(
  'assistant/sendMessage',
  async (input, { dispatch, rejectWithValue, requestId, signal }) => {
    const responseLocale = getPresentationLocaleSnapshot().locale;
    activeStreamController?.abort();
    const controller = new AbortController();
    activeStreamController = controller;
    const combinedSignal = AbortSignal.any([signal, controller.signal]);
    const base = { requestId, conversationId: input.conversationId };
    const accumulator: StreamAccumulator = {
      sawMeta: false,
      failure: null,
      finishReason: null,
      tokens: null,
    };
    let streamOpened = false;

    try {
      const csrfToken = await getAssistantCsrfToken({ signal: combinedSignal });
      const streamPath = assistantMessageStreamPath(input.conversationId);
      const response = await apiFetch(streamPath, {
        method: 'POST',
        localeMode: 'artifact',
        locale: responseLocale,
        timeoutMs: null,
        signal: combinedSignal,
        headers: {
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify({ text: input.text }),
      });
      const contentType = response.headers.get('Content-Type') ?? '';
      const contentLanguage = response.headers.get('Content-Language');

      if (!response.ok) {
        const data = contentType.includes('application/json')
          ? await responseJsonOrNull(response)
          : null;
        throw new ApiError('Assistant stream request failed', response.status, data);
      }
      if (!contentType.includes('text/event-stream') || response.body === null) {
        throw new Error('assistant-stream-response-invalid');
      }
      if (
        !isSupportedLocale(contentLanguage) ||
        contentLanguage !== responseLocale
      ) {
        throw new Error('assistant-stream-content-language-invalid');
      }

      streamOpened = true;
      await parseSseStream(response.body, (event) => {
        handleStreamEvent(
          { ...event },
          { ...input, requestId, responseLocale },
          dispatch,
          accumulator,
        );
      });

      if (accumulator.failure) return rejectWithValue(accumulator.failure);
      if (!accumulator.sawMeta || accumulator.finishReason === null) {
        const error = assistantStreamError(null, 'incomplete_stream');
        dispatch(streamErrored({ ...base, error }));
        return rejectWithValue(error);
      }

      return {
        conversationId: input.conversationId,
        responseLocale,
        outcome: 'complete',
        finishReason: accumulator.finishReason,
        tokens: accumulator.tokens,
      };
    } catch (error) {
      if (combinedSignal.aborted) {
        dispatch(
          messageFinished({
            ...base,
            finishReason: 'aborted',
            tokens: accumulator.tokens ?? { input: null, output: null },
            status: 'aborted',
          }),
        );
        return {
          conversationId: input.conversationId,
          responseLocale,
          outcome: 'aborted',
          finishReason: null,
          tokens: accumulator.tokens,
        };
      }

      const normalized =
        error instanceof ApiError
          ? assistantErrorMessage(error)
          : streamOpened
            ? assistantStreamError(null, 'invalid_stream')
            : assistantErrorMessage(
                error instanceof TypeError
                  ? new ApiError('Assistant network request failed', 0, null, 'network')
                  : error,
              );
      dispatch(streamErrored({ ...base, error: normalized }));
      return rejectWithValue(normalized);
    } finally {
      if (activeStreamController === controller) activeStreamController = null;
    }
  },
);

export type { ChatMessage };
