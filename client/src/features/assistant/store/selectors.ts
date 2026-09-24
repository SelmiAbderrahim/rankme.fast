import type { RootState } from '@app/store';
import {
  initialAssistantState,
  type AssistantState,
} from './slice';

type AssistantRootState = RootState | { assistant?: AssistantState };

/**
 * Lazy-route reducers materialize on the next Redux action after injection,
 * so eager readers must always have the feature's own initial-state fallback.
 */
export function selectAssistantState(state: AssistantRootState): AssistantState {
  return state.assistant ?? initialAssistantState;
}

export const selectAssistantConversations = (state: AssistantRootState) =>
  selectAssistantState(state).conversations;

export const selectAssistantListStatus = (state: AssistantRootState) =>
  selectAssistantState(state).listStatus;

export const selectAssistantListError = (state: AssistantRootState) =>
  selectAssistantState(state).listError;

export const selectActiveConversationId = (state: AssistantRootState) =>
  selectAssistantState(state).activeConversationId;

export const selectActiveConversation = (state: AssistantRootState) => {
  const assistant = selectAssistantState(state);
  return assistant.conversations.find(
    (conversation) => conversation.id === assistant.activeConversationId,
  );
};

export function selectAssistantMessages(conversationId: string | null | undefined) {
  return (state: AssistantRootState) =>
    conversationId
      ? (selectAssistantState(state).messagesByConversation[conversationId] ?? [])
      : [];
}

export const selectActiveAssistantMessages = (state: AssistantRootState) => {
  const assistant = selectAssistantState(state);
  const id = assistant.activeConversationId;
  return id ? (assistant.messagesByConversation[id] ?? []) : [];
};

export function selectAssistantDetailStatus(
  conversationId: string | null | undefined,
) {
  return (state: AssistantRootState) =>
    conversationId
      ? (selectAssistantState(state).detailStatus[conversationId] ?? 'idle')
      : 'idle';
}

export function selectAssistantDetailError(
  conversationId: string | null | undefined,
) {
  return (state: AssistantRootState) =>
    conversationId
      ? (selectAssistantState(state).detailError[conversationId] ?? null)
      : null;
}

export const selectAssistantCreateStatus = (state: AssistantRootState) =>
  selectAssistantState(state).createStatus;

export const selectAssistantCreateError = (state: AssistantRootState) =>
  selectAssistantState(state).createError;

export function selectAssistantDeleting(
  conversationId: string | null | undefined,
) {
  return (state: AssistantRootState) =>
    conversationId
      ? Boolean(selectAssistantState(state).deleting[conversationId])
      : false;
}

export function selectAssistantDeleteError(
  conversationId: string | null | undefined,
) {
  return (state: AssistantRootState) =>
    conversationId
      ? (selectAssistantState(state).deleteError[conversationId] ?? null)
      : null;
}

export const selectAssistantStream = (state: AssistantRootState) =>
  selectAssistantState(state).stream;

export const selectAssistantIsStreaming = (state: AssistantRootState) => {
  const status = selectAssistantState(state).stream.status;
  return status === 'connecting' || status === 'streaming';
};

export const selectAssistantAccessError = (state: AssistantRootState) => {
  const assistant = selectAssistantState(state);
  return assistant.listError ?? assistant.createError ?? assistant.stream.error;
};
