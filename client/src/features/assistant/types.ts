/**
 * Wire types for the AI Assistant. These mirror
 * `server/src/modules/chat/chat.schema.ts`; client-only streaming state lives
 * in `store/slice.ts` so the transport contract stays exact.
 */
import type { SupportedLocale } from '@shared/i18n';

export type ChatMessageRole = 'user' | 'assistant';
export type ChatMessageStatus = 'complete' | 'error' | 'aborted';

export type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; toolCallId: string; toolName: string; args: unknown }
  | {
      type: 'tool_result';
      toolCallId: string;
      toolName: string;
      ok: boolean;
      structuredContent: Record<string, unknown>;
      errorCode?: string;
    };

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  status: ChatMessageStatus;
  responseLocale: SupportedLocale | null;
  parts: ChatMessagePart[];
  tokens: { input: number | null; output: number | null } | null;
  createdAt: string;
}

export interface ChatConversation {
  id: string;
  siteId: string | null;
  title: string;
  locale: string;
  lastMessageAt: string;
  messageCount: number;
  createdAt: string;
}

export interface CreateConversationResponse {
  conversation: ChatConversation;
}

export interface ListConversationsResponse {
  conversations: ChatConversation[];
}

export interface ConversationDetailResponse {
  conversation: ChatConversation;
  messages: ChatMessage[];
}

export interface DeleteConversationResponse {
  ok: boolean;
}

export interface ChatStreamMeta {
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  responseLocale: SupportedLocale;
}

export interface ChatStreamDelta {
  text: string;
}

export interface ChatStreamToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ChatStreamToolResult {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  structuredContent: Record<string, unknown>;
  errorCode?: string;
}

export interface ChatStreamDone {
  finishReason: string;
  tokens: { input: number | null; output: number | null };
}

export interface ChatStreamError {
  code: string;
  messageKey: string;
  message: string;
}

export type AssistantErrorKind =
  | 'forbidden'
  | 'rate_limited'
  | 'unavailable'
  | 'stream'
  | 'generic';

/** Serializable error shape stored in Redux (never store an Error instance). */
export interface AssistantClientError {
  kind: AssistantErrorKind;
  message: string;
  status: number | null;
  retryAfterMs: number | null;
  code: string | null;
}

export interface SendAssistantMessageResult {
  conversationId: string;
  responseLocale: SupportedLocale;
  outcome: 'complete' | 'aborted';
  finishReason: string | null;
  tokens: { input: number | null; output: number | null } | null;
}
