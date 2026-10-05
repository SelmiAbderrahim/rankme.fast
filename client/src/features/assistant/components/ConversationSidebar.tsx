import { useId, useState } from 'react';
import { ChevronDown, Globe, MessageSquarePlus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';
import { siteLabel } from '@shared/lib/siteLabel';
import type { Site } from '@features/sites';
import type { ChatConversation } from '../types';

interface ConversationSidebarProps {
  conversations: ChatConversation[];
  /** Loaded sites, used to name each conversation's site context. */
  sites: Site[];
  activeConversationId: string | null;
  disabled?: boolean;
  onNew: () => void;
  onSelect: (conversationId: string) => void;
  onDelete: (conversationId: string) => Promise<string | null>;
}

/** Persistent conversation navigation with an explicit destructive confirmation. */
export function ConversationSidebar({
  conversations,
  sites,
  activeConversationId,
  disabled = false,
  onNew,
  onSelect,
  onDelete,
}: ConversationSidebarProps) {
  const { t, i18n } = useTranslation(['assistant', 'common']);
  const [deleteTarget, setDeleteTarget] = useState<ChatConversation | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Small screens only (below `lg` the list stacks above the thread): the list
  // starts collapsed so the thread and composer are not pushed off-screen. At
  // `lg` and up the list is always shown and the toggle is hidden.
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const formatDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(date);
  };

  const openDelete = (conversation: ChatConversation) => {
    setDeleteError(null);
    setDeleteTarget(conversation);
  };

  const handleDelete = async (conversationId: string) => {
    setDeleting(true);
    const error = await onDelete(conversationId);
    setDeleting(false);
    if (error) {
      setDeleteError(error);
    } else {
      setDeleteTarget(null);
    }
  };

  return (
    <aside className="flex min-h-0 min-w-0 flex-col rounded-xl border bg-card shadow-sm">
      <div className="border-b p-4">
        <h2 className="font-semibold">{t('assistant:sidebar.title')}</h2>
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full"
          disabled={disabled}
          onClick={onNew}
        >
          <MessageSquarePlus aria-hidden="true" />
          {t('assistant:sidebar.new')}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="mt-2 w-full justify-between lg:hidden"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded
            ? t('assistant:sidebar.hideList')
            : t('assistant:sidebar.showList', { count: conversations.length })}
          <ChevronDown
            aria-hidden="true"
            className={cn(expanded && 'rotate-180')}
          />
        </Button>
      </div>
      {/*
        A plain scroll container, not the Radix ScrollArea: its viewport wraps
        children in a `display: table; min-width: 100%` div that sizes to the
        widest title, so `truncate` never engages and the Delete buttons are
        pushed past the card border.
      */}
      <div
        id={listId}
        data-slot="conversation-scroll"
        className={cn(
          'max-h-56 min-h-0 min-w-0 flex-1 overflow-y-auto lg:block lg:max-h-none',
          !expanded && 'hidden',
        )}
      >
        <nav className="flex min-w-0 flex-col gap-1 p-2" aria-label={t('assistant:sidebar.label')}>
          {conversations.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {t('assistant:sidebar.empty')}
            </p>
          ) : (
            conversations.map((conversation) => {
              const title = conversation.title || t('assistant:sidebar.untitled');
              const active = conversation.id === activeConversationId;
              // A linked site is named by its label (name or domain); an
              // unlinked conversation is general guidance. A linked site that is
              // not in the loaded list yet shows no label rather than a wrong one.
              const linkedSite = conversation.siteId
                ? sites.find((site) => site.id === conversation.siteId)
                : undefined;
              const contextLabel = conversation.siteId
                ? linkedSite && siteLabel(linkedSite)
                : t('assistant:context.none');
              return (
                <div
                  key={conversation.id}
                  className="flex min-w-0 items-center gap-1 rounded-lg border border-s-4 border-transparent data-[active=true]:border-primary data-[active=true]:bg-accent"
                  data-active={active ? 'true' : 'false'}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 justify-start px-3 py-2 text-start"
                    disabled={disabled}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => {
                      setExpanded(false);
                      onSelect(conversation.id);
                    }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate font-medium', active && 'font-semibold')}>
                        {title}
                      </span>
                      {contextLabel ? (
                        <span
                          className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
                          data-slot="conversation-site"
                        >
                          <Globe aria-hidden="true" className="size-3 shrink-0" />
                          <span className="truncate">{contextLabel}</span>
                        </span>
                      ) : null}
                      <span className="block truncate text-xs text-muted-foreground">
                        {formatDate(conversation.lastMessageAt)}
                      </span>
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="me-1 shrink-0 text-destructive hover:text-destructive focus-visible:text-destructive"
                    disabled={disabled}
                    aria-label={t('assistant:sidebar.deleteLabel', { title })}
                    onClick={() => openDelete(conversation)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              );
            })
          )}
        </nav>
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('assistant:sidebar.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('assistant:sidebar.deleteDescription', {
                title: deleteTarget?.title || t('assistant:sidebar.untitled'),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <Alert variant="destructive">
              <AlertDescription>{deleteError}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common:cancel')}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              loading={deleting}
              loadingLabel={t('assistant:sidebar.deleting')}
              onClick={() => void handleDelete(deleteTarget!.id)}
            >
              {t('common:delete')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
