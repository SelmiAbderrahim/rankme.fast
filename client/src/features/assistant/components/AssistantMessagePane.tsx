import { Bot, MessageCircleQuestion, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/ui/empty';
import { ScrollArea } from '@shared/ui/scroll-area';
import { Skeleton } from '@shared/ui/skeleton';
import { isRtl } from '@shared/i18n';
import type { AssistantClientError, ChatMessage, ChatMessagePart } from '../types';
import type { AssistantLoadStatus } from '../store/slice';
import { AssistantMarkdown } from './AssistantMarkdown';
import { AssistantToolCard } from './AssistantToolCard';

interface AssistantMessagePaneProps {
  messages: ChatMessage[];
  loadStatus: AssistantLoadStatus;
  error: AssistantClientError | null;
  streaming: boolean;
  assistantMessageId: string | null;
  onPromptSelect: (prompt: string) => void;
  onRetry?: () => void;
}

type ToolCallPart = Extract<ChatMessagePart, { type: 'tool_call' }>;
type ToolResultPart = Extract<ChatMessagePart, { type: 'tool_result' }>;

function MessageParts({ parts, role }: { parts: ChatMessagePart[]; role: ChatMessage['role'] }) {
  const callIds = new Set(
    parts
      .filter((part): part is ToolCallPart => part.type === 'tool_call')
      .map((part) => part.toolCallId),
  );

  return parts.map((part, index) => {
    if (part.type === 'text') {
      // Assistant replies are markdown; what the user typed is literal text.
      return role === 'assistant' ? (
        <AssistantMarkdown key={`text-${index}`} text={part.text} />
      ) : (
        <p key={`text-${index}`} className="whitespace-pre-wrap break-words">
          {part.text}
        </p>
      );
    }
    if (part.type === 'tool_call') {
      const result = parts.find(
        (candidate): candidate is ToolResultPart =>
          candidate.type === 'tool_result' && candidate.toolCallId === part.toolCallId,
      );
      return <AssistantToolCard key={`call-${part.toolCallId}-${index}`} call={part} result={result} />;
    }
    if (callIds.has(part.toolCallId)) return null;
    const syntheticCall: ToolCallPart = {
      type: 'tool_call',
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      args: null,
    };
    return (
      <AssistantToolCard
        key={`result-${part.toolCallId}-${index}`}
        call={syntheticCall}
        result={part}
      />
    );
  });
}

function StreamingCaret() {
  const { t } = useTranslation('assistant');
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <span aria-hidden="true" className="inline-block h-4 w-px bg-foreground" />
      <span className="sr-only">{t('messages.streaming')}</span>
    </span>
  );
}

function ConversationLoading() {
  const { t } = useTranslation('assistant');
  return (
    <div className="space-y-4 p-6" role="status" aria-label={t('messages.loading')}>
      <Skeleton className="h-16 w-2/3" />
      <Skeleton className="ms-auto h-20 w-1/2" />
      <Skeleton className="h-24 w-3/4" />
    </div>
  );
}

function ConversationEmpty({ onPromptSelect }: { onPromptSelect: (prompt: string) => void }) {
  const { t } = useTranslation('assistant');
  const prompts = [
    t('empty.prompts.audit'),
    t('empty.prompts.rank'),
    t('empty.prompts.sites'),
  ];
  return (
    <Empty className="m-4 min-h-80 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageCircleQuestion aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{t('empty.title')}</EmptyTitle>
        <EmptyDescription>{t('empty.description')}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('empty.examples')}
        </p>
        <div className="flex w-full flex-col gap-2">
          {prompts.map((prompt) => (
            <Button
              key={prompt}
              type="button"
              variant="outline"
              className="h-auto justify-start whitespace-normal text-start"
              onClick={() => onPromptSelect(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </div>
      </EmptyContent>
    </Empty>
  );
}

/** Scrollable message log with escaped bubbles and paired tool executions. */
export function AssistantMessagePane({
  messages,
  loadStatus,
  error,
  streaming,
  assistantMessageId,
  onPromptSelect,
  onRetry,
}: AssistantMessagePaneProps) {
  const { t } = useTranslation(['assistant', 'common']);
  const hasStreamingMessage = Boolean(
    assistantMessageId && messages.some((message) => message.id === assistantMessageId),
  );

  if (loadStatus === 'loading') return <ConversationLoading />;

  return (
    <ScrollArea className="min-h-80 flex-1">
      <div
        className="flex min-h-80 flex-col justify-end gap-6 p-4 sm:p-6"
        role="log"
        aria-live="polite"
        aria-label={t('assistant:messages.label')}
      >
        {messages.length === 0 && !streaming ? (
          <ConversationEmpty onPromptSelect={onPromptSelect} />
        ) : null}

        {messages.map((message) => {
          const outgoing = message.role === 'user';
          const Icon = outgoing ? UserRound : Bot;
          return (
            <article
              key={message.id}
              lang={message.responseLocale ?? undefined}
              dir={
                message.responseLocale
                  ? isRtl(message.responseLocale)
                    ? 'rtl'
                    : 'ltr'
                  : undefined
              }
              className={`flex items-start gap-3 ${outgoing ? 'justify-end' : 'justify-start'}`}
              aria-label={t(`assistant:messages.${message.role}`)}
            >
              {!outgoing ? (
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
              ) : null}
              <div
                className={`space-y-3 text-sm ${
                  outgoing
                    ? 'max-w-[85%] rounded-xl bg-primary px-4 py-3 text-primary-foreground shadow-sm sm:max-w-[75%]'
                    : 'min-w-0 flex-1 pt-1 text-foreground'
                }`}
              >
                <MessageParts parts={message.parts} role={message.role} />
                {streaming && message.id === assistantMessageId ? <StreamingCaret /> : null}
              </div>
            </article>
          );
        })}

        {streaming && !hasStreamingMessage ? (
          <div className="flex items-start gap-3" data-testid="assistant-connecting-bubble">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card">
              <Bot aria-hidden="true" className="size-4" />
            </span>
            <div className="pt-1 text-sm text-foreground">
              <StreamingCaret />
            </div>
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>{t('assistant:states.error.title')}</AlertTitle>
            <AlertDescription>
              <p>{error.message}</p>
              {onRetry ? (
                <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                  {t('common:retry')}
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </ScrollArea>
  );
}
