import { apiClient, resolveApiUrl } from '@shared/api/client';
import type {
  ConversationDetailResponse,
  CreateConversationResponse,
  DeleteConversationResponse,
  ListConversationsResponse,
} from './types';

interface RequestSignal {
  signal?: AbortSignal;
}

export function createAssistantConversation(
  input: { siteId?: string } = {},
  init: RequestSignal = {},
): Promise<CreateConversationResponse> {
  return apiClient<CreateConversationResponse>('/chat/conversations', {
    method: 'POST',
    localeMode: 'artifact',
    body: input.siteId ? { siteId: input.siteId } : {},
    ...(init.signal ? { signal: init.signal } : {}),
  });
}

export function listAssistantConversations(
  init: RequestSignal = {},
): Promise<ListConversationsResponse> {
  return apiClient<ListConversationsResponse>('/chat/conversations', {
    method: 'GET',
    localeMode: 'artifact',
    ...(init.signal ? { signal: init.signal } : {}),
  });
}

export function getAssistantConversation(
  conversationId: string,
  init: RequestSignal = {},
): Promise<ConversationDetailResponse> {
  return apiClient<ConversationDetailResponse>(
    `/chat/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: 'GET',
      localeMode: 'artifact',
      ...(init.signal ? { signal: init.signal } : {}),
    },
  );
}

export function deleteAssistantConversation(
  conversationId: string,
  init: RequestSignal = {},
): Promise<DeleteConversationResponse> {
  return apiClient<DeleteConversationResponse>(
    `/chat/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: 'DELETE',
      localeMode: 'artifact',
      ...(init.signal ? { signal: init.signal } : {}),
    },
  );
}

/**
 * The SSE request cannot use `apiClient` because that helper buffers and
 * parses the entire response. It still needs the standard double-submit CSRF
 * token before opening the raw fetch stream.
 */
export async function getAssistantCsrfToken(
  init: RequestSignal = {},
): Promise<string> {
  const response = await apiClient<{ csrfToken: string }>('/security/csrf-token', {
    method: 'GET',
    ...(init.signal ? { signal: init.signal } : {}),
  });
  return response.csrfToken;
}

export function assistantMessageStreamUrl(conversationId: string): string {
  return resolveApiUrl(assistantMessageStreamPath(conversationId));
}

export function assistantMessageStreamPath(conversationId: string): string {
  return `/chat/conversations/${encodeURIComponent(conversationId)}/messages`;
}
