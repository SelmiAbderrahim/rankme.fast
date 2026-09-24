/**
 * Accessible confirmation dialog for the four action state transitions
 * (Plan / Dismiss / Complete / Reopen). One shared implementation for the
 * Actions panel AND the report finding controls:
 *
 *   - restates the action title + target-state consequences as inert text;
 *   - optional bounded note (≤ 500 chars) with a live counter;
 *   - carries the caller's `expectedVersion` + a fresh idempotency
 *     `clientKey` per open;
 *   - disables while pending (double-submit prevention);
 *   - on 409, shows localized guidance + a reload affordance that refetches
 *     through the caller — the dialog never synthesizes state locally.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Label } from '@shared/ui/label';
import { Textarea } from '@shared/ui/textarea';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  selectActionConflict,
  selectActionError,
  selectActionPending,
} from '../store/selectors';
import { submitActionState } from '../store/thunks';
import { clearActionErrors } from '../store/slice';
import type { ActionState } from '../types';

export const ACTION_NOTE_MAX_LENGTH = 500;

export interface StateChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  actionId: string;
  /** Server-localized action title, rendered verbatim as inert text. */
  actionTitle: string;
  targetState: ActionState;
  expectedVersion: number;
  /**
   * Invoked after a 409 when the user asks to reload — the caller refetches
   * the authoritative row (list read, no spend) so `expectedVersion` updates.
   */
  onConflictReload: () => void;
  /**
   * Radix `onCloseAutoFocus` passthrough. The dialog mounts without a Radix
   * DialogTrigger (the card renders plain buttons and conditionally mounts
   * the dialog), so Radix has no trigger of its own to restore focus to —
   * the card supplies the restore target through this hook. Radix fires it
   * at the END of its close teardown (after any exit animation), which is
   * the only moment a manual `.focus()` sticks in a real browser.
   */
  onCloseAutoFocus?: (event: Event) => void;
}

export function newActionClientKey(): string {
  return crypto.randomUUID();
}

export function StateChangeDialog({
  open,
  onOpenChange,
  siteId,
  actionId,
  actionTitle,
  targetState,
  expectedVersion,
  onConflictReload,
  onCloseAutoFocus,
}: StateChangeDialogProps) {
  const { t } = useTranslation('actions');
  const dispatch = useAppDispatch();
  const [note, setNote] = useState('');
  const [clientKey, setClientKey] = useState(() => newActionClientKey());

  const pending = useAppSelector(selectActionPending('state', actionId));
  const error = useAppSelector(selectActionError('state', actionId));
  const conflict = useAppSelector(selectActionConflict(actionId));

  // Fresh note + idempotency key per dialog open; stale errors are cleared
  // so a previous attempt's message never leaks into a new confirmation.
  useEffect(() => {
    if (open) {
      setNote('');
      setClientKey(newActionClientKey());
      dispatch(clearActionErrors(actionId));
    }
  }, [open, actionId, dispatch]);

  // Double-submit prevention lives on the Button primitive: `loading`
  // disables the control the moment the dispatch fires.
  const confirm = async () => {
    const trimmed = note.trim();
    const result = await dispatch(
      submitActionState({
        siteId,
        actionId,
        state: targetState,
        expectedVersion,
        clientKey,
        ...(trimmed.length > 0 ? { note: trimmed } : {}),
      }),
    );
    if (submitActionState.fulfilled.match(result)) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="action-state-dialog"
        {...(onCloseAutoFocus ? { onCloseAutoFocus } : {})}
      >
        <DialogHeader>
          <DialogTitle>{t(`stateDialog.titles.${targetState}`)}</DialogTitle>
          <DialogDescription>
            {t(`stateDialog.consequences.${targetState}`)}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium" data-testid="action-state-dialog-title">
          {actionTitle}
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`action-note-${actionId}`}>
            {t('stateDialog.noteLabel')}
          </Label>
          <Textarea
            id={`action-note-${actionId}`}
            value={note}
            maxLength={ACTION_NOTE_MAX_LENGTH}
            onChange={(event) =>
              setNote(event.target.value.slice(0, ACTION_NOTE_MAX_LENGTH))
            }
            rows={3}
            data-testid="action-state-note"
          />
          <p className="text-muted-foreground text-xs" aria-live="polite">
            {t('stateDialog.noteCount', {
              used: note.length,
              max: ACTION_NOTE_MAX_LENGTH,
            })}
          </p>
        </div>
        {conflict ? (
          <Alert variant="destructive" role="alert" data-testid="action-state-conflict">
            <AlertDescription className="flex flex-col items-start gap-2">
              {t('stateDialog.conflict')}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onConflictReload}
                data-testid="action-state-conflict-reload"
              >
                {t('stateDialog.conflictReload')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : error ? (
          <Alert variant="destructive" role="alert" data-testid="action-state-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {t('common:cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void confirm()}
            loading={pending}
            loadingLabel={t('stateDialog.saving')}
            data-testid="action-state-confirm"
          >
            {t('stateDialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
