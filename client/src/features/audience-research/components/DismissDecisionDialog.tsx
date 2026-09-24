import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Button } from '@shared/ui/button';
import { Label } from '@shared/ui/label';
import { RadioGroup, RadioGroupItem } from '@shared/ui/radio-group';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { ensureSignalIdempotencyKey } from '../store/slice';
import { decideSignal } from '../store/thunks';
import {
  selectSignalDecisionConflict,
  selectSignalDecisionError,
  selectSignalDecisionInFlight,
  selectSignalDecisionPending,
  selectSignalTerminalDecision,
} from '../store/selectors';
import {
  AUDIENCE_RESEARCH_DISMISS_REASONS,
  type AudienceResearchDismissReason,
  type RunResultSignal,
} from '../types';

interface DismissDecisionDialogProps {
  siteId: string;
  runId: string;
  signal: RunResultSignal;
  onClose: () => void;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ik-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export function DismissDecisionDialog({
  siteId,
  runId,
  signal,
  onClose,
}: DismissDecisionDialogProps) {
  const { t } = useTranslation('audienceResearch');
  const dispatch = useAppDispatch();

  const terminal = useAppSelector(selectSignalTerminalDecision(signal.signalId));
  const pending = useAppSelector(selectSignalDecisionPending(signal.signalId));
  const inFlight = useAppSelector(selectSignalDecisionInFlight(signal.signalId));
  const error = useAppSelector(selectSignalDecisionError(signal.signalId));
  const conflict = useAppSelector(selectSignalDecisionConflict(signal.signalId));

  const [reason, setReason] = useState<AudienceResearchDismissReason>('not_relevant');
  const [reservedKey, setReservedKey] = useState<string>('');

  useEffect(() => {
    if (pending?.idempotencyKey) {
      setReservedKey(pending.idempotencyKey);
      return;
    }
    const key = newIdempotencyKey();
    setReservedKey(key);
    dispatch(
      ensureSignalIdempotencyKey({ signalId: signal.signalId, idempotencyKey: key }),
    );
  }, [dispatch, pending?.idempotencyKey, signal.signalId]);

  const onConfirm = useCallback(async () => {
    if (!reservedKey) return;
    const action = await dispatch(
      decideSignal({
        siteId,
        runId,
        signalId: signal.signalId,
        decision: 'dismissed',
        reason,
        idempotencyKey: reservedKey,
      }),
    );
    if (decideSignal.fulfilled.match(action)) {
      toast.success(t('signals.decision.dismissSuccess'));
      onClose();
    } else if (
      decideSignal.rejected.match(action) &&
      action.payload?.status === 409
    ) {
      onClose();
    }
  }, [dispatch, onClose, reason, reservedKey, runId, signal.signalId, siteId, t]);

  // `pending` is the RESERVED idempotency key (written at dialog open by
  // `ensureSignalIdempotencyKey`); only `inFlight` means a request is on the
  // wire — see AcceptDecisionDialog.
  const isSubmitting = inFlight;
  const closeAndBail = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <Dialog open onOpenChange={(v) => (!v ? closeAndBail() : undefined)}>
      <DialogContent data-testid="audience-research-dismiss-dialog">
        <DialogHeader>
          <DialogTitle>{t('signals.decision.dismissTitle')}</DialogTitle>
          <DialogDescription>
            {t('signals.decision.dismissBody')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <strong>{t('signals.decision.signalTitleLabel')}: </strong>
            {signal.title}
          </p>
          <RadioGroup
            value={reason}
            onValueChange={(v) => setReason(v as AudienceResearchDismissReason)}
            aria-label={t('signals.decision.reasonLabel')}
          >
            {AUDIENCE_RESEARCH_DISMISS_REASONS.map((r) => {
              const id = `dismiss-reason-${signal.signalId}-${r}`;
              return (
                <div key={r} className="flex items-center gap-2">
                  <RadioGroupItem
                    id={id}
                    value={r}
                    data-testid={`dismiss-reason-${r}`}
                  />
                  <Label htmlFor={id}>{t(`signals.decision.reasons.${r}`)}</Label>
                </div>
              );
            })}
          </RadioGroup>
          {error && !conflict ? (
            <p
              role="alert"
              className="text-destructive text-xs"
              data-testid="dismiss-dialog-error"
            >
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={closeAndBail} type="button">
            {t('signals.decision.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isSubmitting || Boolean(terminal)}
            onClick={onConfirm}
            data-testid="dismiss-dialog-confirm"
            loading={isSubmitting}
            loadingLabel={t('signals.decision.submitting')}
          >
            {t('signals.decision.confirmDismiss')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
