import { useState } from 'react';
import { MessageSquarePlus, Trash2 } from 'lucide-react';
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
import { ScrollArea } from '@shared/ui/scroll-area';
import type { ChatConversation } from '../types';

interface ConversationSidebarProps {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  disabled?: boolean;
  onNew: () => void;
  onSelect: (conversationId: string) => void;
  onDelete: (conversationId: string) => Promise<string | null>;
}

/** Persistent conversation navigation with an explicit destructive confirmation. */
export function ConversationSidebar({
  conversations,
  activeConversationId,
  disabled = false,
  onNew,
  onSelect,
  onDelete,
}: ConversationSidebarProps) {
  const { t, i18n } = useTranslation(['assistant', 'common']);
  const [deleteTarget, setDeleteTarget] = useState<ChatConversation | null>(null);
  const [deleting, setDeleting] = useState(false);
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
    <aside className="flex min-h-0 flex-col rounded-xl border bg-card shadow-sm">
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
      </div>
      <ScrollArea className="max-h-56 min-h-0 flex-1 lg:max-h-none">
        <nav className="flex flex-col gap-1 p-2" aria-label={t('assistant:sidebar.label')}>
          {conversations.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              {t('assistant:sidebar.empty')}
            </p>
          ) : (
            conversations.map((conversation) => {
              const title = conversation.title || t('assistant:sidebar.untitled');
              const active = conversation.id === activeConversationId;
              return (
                <div
                  key={conversation.id}
                  className="flex items-center gap-1 rounded-lg border border-transparent data-[active=true]:border-border data-[active=true]:bg-accent"
                  data-active={active ? 'true' : 'false'}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 justify-start px-3 py-2 text-start"
                    disabled={disabled}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => onSelect(conversation.id)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(conversation.lastMessageAt)}
                      </span>
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="me-1 text-destructive hover:text-destructive focus-visible:text-destructive"
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
      </ScrollArea>

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
