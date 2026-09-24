import { useEffect, useState } from 'react';
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
  const [draft, setDraft] = useState('');
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

  const sendText = async (text: string, forcedConversationId?: string) => {
    dispatch(clearAssistantErrors());
    let conversationId = forcedConversationId ?? activeConversationId;
    if (!conversationId) {
      const created = await dispatch(
        createAssistantConversationThunk(
          selectedSiteId ? { siteId: selectedSiteId } : undefined,
        ),
      );
      if (!createAssistantConversationThunk.fulfilled.match(created)) return;
      conversationId = created.payload.id;
    }

    const sent = await dispatch(sendAssistantMessage({ conversationId, text }));
    if (sendAssistantMessage.fulfilled.match(sent) && draft.trim() === text) {
      setDraft('');
    }
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
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6" aria-labelledby="assistant-title">
        <AssistantPageHeader />
        <AssistantPageLoading />
      </main>
    );
  }

  if (listStatus === 'failed') {
    return (
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6" aria-labelledby="assistant-title">
        <AssistantPageHeader />
        <Card className="p-6">
          <AssistantMessagePane
            messages={[]}
            loadStatus="failed"
            error={listError}
            streaming={false}
            assistantMessageId={null}
            onPromptSelect={setDraft}
            onRetry={retryList}
          />
        </Card>
      </main>
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
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6" aria-labelledby="assistant-title">
      <AssistantPageHeader />

      <div className="grid min-h-96 gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <ConversationSidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          disabled={streaming}
          onNew={handleNew}
          onSelect={handleSelect}
          onDelete={handleDelete}
        />

        <Card className="min-h-96 gap-0 overflow-hidden py-0">
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
              onPromptSelect={setDraft}
              onRetry={paneRetry}
            />
          )}

          {!activeUnavailable ? (
            <AssistantComposer
              draft={draft}
              disabled={composerDisabled}
              creating={createStatus === 'loading'}
              streaming={streaming}
              onDraftChange={setDraft}
              onSend={(text) => void sendText(text)}
              onStop={() => {
                stopAssistantStream();
              }}
            />
          ) : null}
        </Card>
      </div>
    </main>
  );
}
