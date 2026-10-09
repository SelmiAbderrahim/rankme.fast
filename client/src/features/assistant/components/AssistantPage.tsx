import { useEffect, useRef, useState } from 'react';
import { useStore } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
  loadSites,
  selectSites,
  selectSitesError,
  selectSitesLoaded,
  selectSitesLoading,
} from '@features/sites';
import { PageHeader } from '@shared/components/PageHeader';
import { DocsLink } from '@shared/docs/DocsLink';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import type { RootState } from '@app/store';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { Card } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import {
  clearAssistantErrors,
  setActiveConversationId,
} from '../store/slice';
import {
  selectActiveConversation,
  selectActiveConversationId,
  selectAssistantConversations,
  selectAssistantCreateError,
  selectAssistantCreateStatus,
  selectAssistantDetailError,
  selectAssistantDetailStatus,
  selectAssistantListError,
  selectAssistantListStatus,
  selectAssistantMessages,
  selectAssistantStream,
} from '../store/selectors';
import {
  createAssistantConversationThunk,
  deleteAssistantConversationThunk,
  loadAssistantConversation,
  loadAssistantConversations,
  sendAssistantMessage,
  stopAssistantStream,
} from '../store/thunks';
import { AssistantComposer } from './AssistantComposer';
import { AssistantMessagePane } from './AssistantMessagePane';
import { AssistantSiteSelector } from './AssistantSiteSelector';
import { AssistantUnavailableCard } from './AssistantUnavailableCard';
import { ConversationSidebar } from './ConversationSidebar';

function AssistantPageLoading() {
  const { t } = useTranslation('assistant');
  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]" role="status" aria-label={t('loading')}>
      <Skeleton className="h-72 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function AssistantPageHeader() {
  const { t } = useTranslation('assistant');
  return (
    <PageHeader
      icon={APP_PAGE_ICONS.assistant}
      title={t('title')}
      titleId="assistant-title"
      description={t('description')}
      supportingContent={<DocsLink slug="ai-assistant" labelKey="docsLink.openGuide" />}
    />
  );
}

/** Full Assistant workspace: persistent conversations, streaming, and tools. */
export function AssistantPage() {
  const dispatch = useAppDispatch();
  const conversations = useAppSelector(selectAssistantConversations);
  const listStatus = useAppSelector(selectAssistantListStatus);
  const listError = useAppSelector(selectAssistantListError);
  const activeConversationId = useAppSelector(selectActiveConversationId);
  const activeConversation = useAppSelector(selectActiveConversation);
  const messages = useAppSelector(selectAssistantMessages(activeConversationId));
  const detailStatus = useAppSelector(selectAssistantDetailStatus(activeConversationId));
  const detailError = useAppSelector(selectAssistantDetailError(activeConversationId));
  const createStatus = useAppSelector(selectAssistantCreateStatus);
  const createError = useAppSelector(selectAssistantCreateError);
  const stream = useAppSelector(selectAssistantStream);
  const sites = useAppSelector(selectSites);
  const sitesLoading = useAppSelector(selectSitesLoading);
  const sitesLoaded = useAppSelector(selectSitesLoaded);
  const sitesError = useAppSelector(selectSitesError);
  const store = useStore<RootState>();
  const [draft, setDraftState] = useState('');
  // The latest draft for async code that outlives the render it started in.
  const draftRef = useRef('');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);

  const streaming = stream.status === 'connecting' || stream.status === 'streaming';

  useEffect(() => {
    if (listStatus === 'idle') void dispatch(loadAssistantConversations());
  }, [dispatch, listStatus]);

  useEffect(() => {
    if (
      listStatus === 'succeeded' &&
      !sitesLoaded &&
      !sitesLoading &&
      !sitesError
    ) {
      void dispatch(loadSites({}));
    }
  }, [dispatch, listStatus, sitesError, sitesLoaded, sitesLoading]);

  useEffect(() => {
    if (activeConversationId && detailStatus === 'idle') {
      void dispatch(loadAssistantConversation({ conversationId: activeConversationId }));
    }
  }, [activeConversationId, detailStatus, dispatch]);

  useEffect(() => () => {
    stopAssistantStream();
  }, []);

  const setDraft = (value: string) => {
    draftRef.current = value;
    setDraftState(value);
  };

  // A suggestion fills the composer, then moves focus (which also scrolls it
  // into view) so the click visibly does something even when the box sits
  // below the thread.
  const selectPrompt = (prompt: string) => {
    setDraft(prompt);
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.scrollIntoView({ block: 'nearest' });
  };

  const sendText = async (text: string, forcedConversationId?: string) => {
    dispatch(clearAssistantErrors());
    // Sending from the composer clears it at once; the text comes back below
    // if the server never confirmed the message. A retry of an earlier prompt
    // leaves whatever the user is typing now untouched.
    const fromComposer = draftRef.current.trim() === text;
    if (fromComposer) setDraft('');
    const restoreDraft = () => {
      if (fromComposer) setDraft(text);
    };

    let conversationId = forcedConversationId ?? activeConversationId;
    if (!conversationId) {
      const created = await dispatch(
        createAssistantConversationThunk(
          selectedSiteId ? { siteId: selectedSiteId } : undefined,
        ),
      );
      if (!createAssistantConversationThunk.fulfilled.match(created)) {
        restoreDraft();
        return;
      }
      conversationId = created.payload.id;
    }

    const sent = await dispatch(sendAssistantMessage({ conversationId, text }));
    // The server saves the message on its `meta` frame. A Stop or failure
    // before that withdraws the bubble from the thread, so the text returns to
    // the composer to edit and re-send; once saved it lives in the thread.
    const confirmed = sendAssistantMessage.fulfilled.match(sent)
      ? sent.payload.accepted
      : selectAssistantStream(store.getState()).userMessageId !== null;
    if (!confirmed) restoreDraft();
  };

  const handleNew = () => {
    dispatch(clearAssistantErrors());
    dispatch(setActiveConversationId(null));
    setSelectedSiteId(null);
    setDraft('');
  };

  const handleSelect = (conversationId: string) => {
    dispatch(clearAssistantErrors());
    dispatch(setActiveConversationId(conversationId));
    setDraft('');
  };

  const handleDelete = async (conversationId: string): Promise<string | null> => {
    const action = await dispatch(
      deleteAssistantConversationThunk({ conversationId }),
    );
    return deleteAssistantConversationThunk.fulfilled.match(action)
      ? null
      : action.payload!.message;
  };

  const retryList = () => {
    dispatch(clearAssistantErrors());
    void dispatch(loadAssistantConversations());
  };

  const retryDetail = (conversationId: string) => {
    void dispatch(loadAssistantConversation({ conversationId }));
  };

  const retryStream = () => {
    if (stream.conversationId && stream.lastPrompt) {
      void sendText(stream.lastPrompt, stream.conversationId);
    } else if (draft.trim()) {
      void sendText(draft.trim());
    }
  };

  if (listStatus === 'idle' || listStatus === 'loading') {
    return (
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6" aria-labelledby="assistant-title">
        <AssistantPageHeader />
        <AssistantPageLoading />
      </section>
    );
  }

  if (listStatus === 'failed') {
    return (
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6" aria-labelledby="assistant-title">
        <AssistantPageHeader />
        <Card className="p-6">
          <AssistantMessagePane
            messages={[]}
            loadStatus="failed"
            error={listError}
            streaming={false}
            assistantMessageId={null}
            onPromptSelect={selectPrompt}
            onRetry={retryList}
          />
        </Card>
      </section>
    );
  }

  const activeError = stream.error ?? createError;
  const activeUnavailable = activeError?.kind === 'unavailable';
  const paneError = activeUnavailable ? null : (detailError ?? activeError);
  const paneRetry = detailError && activeConversationId
    ? () => retryDetail(activeConversationId)
    : activeError ? retryStream : undefined;
  const resolvedDetailStatus = activeConversationId && detailStatus === 'idle'
    ? 'loading'
    : detailStatus;
  const composerDisabled =
    detailStatus === 'loading' || detailStatus === 'failed' || activeUnavailable;

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6" aria-labelledby="assistant-title">
      <AssistantPageHeader />

      {/*
        From `lg` the workspace is a bounded-height region (viewport minus the
        app chrome and page header): the thread scrolls inside it and the
        composer stays pinned at its bottom, visible without scrolling the
        page. Below `lg` the sidebar stacks above the thread and the composer
        sticks to the viewport instead (see the Card below).
      */}
      <div
        data-slot="assistant-workspace"
        className="grid min-h-96 grid-cols-[minmax(0,1fr)] gap-4 lg:h-[max(32rem,calc(100dvh-18rem))] lg:grid-cols-[16rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]"
      >
        <ConversationSidebar
          conversations={conversations}
          sites={sites}
          activeConversationId={activeConversationId}
          disabled={streaming}
          onNew={handleNew}
          onSelect={handleSelect}
          onDelete={handleDelete}
        />

        {/* `overflow-clip` (not hidden) below `lg` so the composer can stick to the viewport. */}
        <Card className="min-h-96 min-w-0 gap-0 overflow-hidden py-0 max-lg:overflow-clip lg:min-h-0">
          <div className="border-b p-4">
            <AssistantSiteSelector
              sites={sites}
              activeConversation={activeConversation}
              selectedSiteId={selectedSiteId}
              loading={sitesLoading}
              disabled={streaming || createStatus === 'loading'}
              sitesUnavailable={Boolean(sitesError)}
              onChange={setSelectedSiteId}
            />
          </div>

          {activeUnavailable ? (
            <div className="flex flex-1 items-center p-4 sm:p-6">
              <AssistantUnavailableCard onRetry={retryStream} />
            </div>
          ) : (
            <AssistantMessagePane
              messages={messages}
              loadStatus={resolvedDetailStatus}
              error={paneError}
              streaming={streaming}
              assistantMessageId={stream.assistantMessageId}
              onPromptSelect={selectPrompt}
              onRetry={paneRetry}
            />
          )}

          {!activeUnavailable ? (
            <AssistantComposer
              draft={draft}
              disabled={composerDisabled}
              creating={createStatus === 'loading'}
              streaming={streaming}
              textareaRef={composerRef}
              onDraftChange={setDraft}
              onSend={(text) => void sendText(text)}
              onStop={() => {
                stopAssistantStream();
              }}
            />
          ) : null}
        </Card>
      </div>
    </section>
  );
}
