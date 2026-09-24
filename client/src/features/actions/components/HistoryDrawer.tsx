/**
 * On-demand action history drawer.
 *
 * Uses the shared responsive `Sheet` pattern (same primitive the audience
 * research evidence drawer ships). History loads only when the drawer opens
 * — a stored-data read that never reserves units or calls a vendor. Entries
 * show state, an actor-safe display label (never the raw account id), time
 * and the bounded note verbatim as inert text.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@shared/ui/sheet';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip } from '@shared/ui/status-chip';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  selectActionError,
  selectActionHistory,
  selectActionPending,
} from '../store/selectors';
import { loadActionHistory } from '../store/thunks';
import { ACTION_STATE_TONES } from './tones';
import {
  presentationRequestIdentity,
  usePresentationRefreshSignal,
} from '@shared/i18n';

export interface HistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  actionId: string;
  /** Server-localized action title, rendered verbatim as inert text. */
  actionTitle: string;
}

export function HistoryDrawer({
  open,
  onOpenChange,
  siteId,
  actionId,
  actionTitle,
}: HistoryDrawerProps) {
  const { t, i18n } = useTranslation('actions');
  const presentation = usePresentationRefreshSignal();
  const dispatch = useAppDispatch();
  const entries = useAppSelector(
    selectActionHistory(actionId, presentation.locale),
  );
  const pending = useAppSelector(
    selectActionPending('history', actionId, presentation.locale),
  );
  const error = useAppSelector(
    selectActionError('history', actionId, presentation.locale),
  );

  // On-demand load, exactly once per open: a failure parks on the error
  // state (manual retry only) instead of re-dispatching in a loop.
  useEffect(() => {
    if (open && entries === undefined && !pending && !error) {
      void dispatch(
        loadActionHistory({
          siteId,
          actionId,
          presentationLocale: presentation.locale,
          presentationGeneration: presentation.generation,
        }),
      );
    }
  }, [
    open,
    entries,
    pending,
    error,
    dispatch,
    presentation.generation,
    presentation.locale,
    presentation.refreshGeneration,
    siteId,
    actionId,
  ]);

  const formatTime = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-xl overflow-y-auto"
        data-testid="action-history-drawer"
      >
        <SheetHeader>
          <SheetTitle>{t('history.title')}</SheetTitle>
          <SheetDescription>{actionTitle}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 p-4">
          {pending ? (
            <div className="flex flex-col gap-2" aria-busy="true" data-testid="action-history-loading">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : error ? (
            <Alert variant="destructive" role="alert" data-testid="action-history-error">
              <AlertDescription className="flex flex-col items-start gap-2">
                {error}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void dispatch(
                      loadActionHistory({
                        siteId,
                        actionId,
                        ...presentationRequestIdentity(),
                      }),
                    )
                  }
                >
                  {t('common:retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : entries !== undefined && entries.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="action-history-empty">
              {t('history.empty')}
            </p>
          ) : entries !== undefined ? (
            <ol className="flex flex-col gap-3">
              {entries.map((entry) => (
                <li
                  key={entry.ordinal}
                  className="border-border flex flex-col gap-1.5 rounded-md border p-3"
                  data-testid="action-history-entry"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone={ACTION_STATE_TONES[entry.newState]} dot>
                      {t(`state.${entry.newState}`)}
                    </StatusChip>
                    {entry.priorState ? (
                      <span className="text-muted-foreground text-xs">
                        {t('history.from', {
                          state: t(`state.${entry.priorState}`),
                        })}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t('history.actor')} · {formatTime(entry.createdAt)}
                  </p>
                  {entry.note ? (
                    <p className="text-sm" data-testid="action-history-note">
                      {entry.note}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
