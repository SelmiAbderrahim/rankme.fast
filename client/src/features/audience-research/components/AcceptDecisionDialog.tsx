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
  destinationRoutesToContentIntelligence,
  type AudienceResearchDestination,
  type RunResultSignal,
  type SignalDecisionResult,
} from '../types';

interface AcceptDecisionDialogProps {
  siteId: string;
  runId: string;
  signal: RunResultSignal;
  onClose: () => void;
  onOpenDeepLink: (deepLinkPath: string) => void;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Test/SSR fallback — namespaced so it never collides with a UUID.
  return `ik-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

const DESTINATION_TITLE_KEYS: Record<AudienceResearchDestination, string> = {
  content: 'signals.decision.acceptTitle.content',
  comparison_page: 'signals.decision.acceptTitle.comparison_page',
  product: 'signals.decision.acceptTitle.product',
  seo: 'signals.decision.acceptTitle.seo',
};

const DESTINATION_BODY_KEYS: Record<AudienceResearchDestination, string> = {
  content: 'signals.decision.acceptBody.content',
  comparison_page: 'signals.decision.acceptBody.comparison_page',
  product: 'signals.decision.acceptBody.product',
  seo: 'signals.decision.acceptBody.seo',
};

/**
 * Accept dialog. The destination is FIXED by the signal's `suggestedRoute`;
 * the client never asks the user to choose one (server-enforced rule). Copy
 * is split by destination so the user sees exactly which downstream surface
 * they are creating an entry in.
 */
export function AcceptDecisionDialog({
  siteId,
  runId,
  signal,
  onClose,
  onOpenDeepLink,
}: AcceptDecisionDialogProps) {
  const { t } = useTranslation('audienceResearch');
  const dispatch = useAppDispatch();

  const destination = signal.suggestedRoute as AudienceResearchDestination;
  const isCi = destinationRoutesToContentIntelligence(destination);

  const terminal = useAppSelector(selectSignalTerminalDecision(signal.signalId));
  const pending = useAppSelector(selectSignalDecisionPending(signal.signalId));
  const inFlight = useAppSelector(selectSignalDecisionInFlight(signal.signalId));
  const error = useAppSelector(selectSignalDecisionError(signal.signalId));
  const conflict = useAppSelector(selectSignalDecisionConflict(signal.signalId));

  // Reserve an idempotency key ONCE on open. Re-clicks reuse it so the
  // server's account+key unique index returns the same terminal row
  // (idempotent replay).
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

  const closeAndBail = useCallback(() => {
    onClose();
  }, [onClose]);

  const onConfirm = useCallback(async () => {
    if (!reservedKey) return;
    const action = await dispatch(
      decideSignal({
        siteId,
        runId,
        signalId: signal.signalId,
        decision: 'accepted',
        destination,
        idempotencyKey: reservedKey,
      }),
    );
    if (decideSignal.fulfilled.match(action)) {
      toast.success(t('signals.decision.acceptSuccess'));
      onClose();
    } else if (decideSignal.rejected.match(action) && action.payload?.status === 409) {
      // 409 — the server refreshed the signal with someone else's terminal
      // decision. The slice already set `conflict[signalId]=true`; close so
      // the user sees the refreshed card + banner in the panel.
      onClose();
    }
  }, [destination, dispatch, onClose, reservedKey, runId, signal.signalId, siteId, t]);

  const onOpenDeepLinkClick = useCallback(() => {
    if (terminal?.deepLinkPath) {
      onOpenDeepLink(terminal.deepLinkPath);
      onClose();
    }
  }, [onClose, onOpenDeepLink, terminal]);

  // `pending` is the RESERVED idempotency key (written at dialog open by
  // `ensureSignalIdempotencyKey`); only `inFlight` means a request is on the
  // wire. Treating the reservation as "submitting" disabled the confirm
  // button from the moment the dialog opened.
  const isSubmitting = inFlight;
  const alreadyDecided = Boolean(terminal);

  return (
    <Dialog open onOpenChange={(v) => (!v ? closeAndBail() : undefined)}>
      <DialogContent data-testid="audience-research-accept-dialog">
        <DialogHeader>
          <DialogTitle>{t(DESTINATION_TITLE_KEYS[destination])}</DialogTitle>
          <DialogDescription>
            {t(DESTINATION_BODY_KEYS[destination])}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <strong>{t('signals.decision.signalTitleLabel')}: </strong>
            {signal.title}
          </p>
          <p className="text-muted-foreground text-xs">
            {isCi
              ? t('signals.decision.destination.contentDetail')
              : t('signals.decision.destination.actionsDetail')}
          </p>
          {error && !conflict ? (
            <p
              role="alert"
              className="text-destructive text-xs"
              data-testid="accept-dialog-error"
            >
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={closeAndBail} type="button">
            {t('signals.decision.cancel')}
          </Button>
          {alreadyDecided &&
          terminal &&
          terminal.terminalDecision === 'accepted' ? (
            <Button
              type="button"
              onClick={onOpenDeepLinkClick}
              data-testid="accept-dialog-open-deep-link"
            >
              {isCi
                ? t('signals.decision.openRecommendation')
                : t('signals.decision.openAction')}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={isSubmitting || alreadyDecided}
              onClick={onConfirm}
              data-testid="accept-dialog-confirm"
              loading={isSubmitting}
              loadingLabel={t('signals.decision.submitting')}
            >
              {isCi
                ? t('signals.decision.confirmCi')
                : t('signals.decision.confirmActions')}
            </Button>
          )}
        </DialogFooter>
        <AcceptDialogTerminalGuard
          terminal={terminal}
          isCi={isCi}
          onOpenDeepLink={onOpenDeepLinkClick}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * When the dialog is reopened for an already-accepted signal (URL replay),
 * show the deep-link CTA instead of the confirm button. This is the same
 * "same-decision replay shows the existing result" behavior described in
 * */
function AcceptDialogTerminalGuard({
  terminal,
  isCi,
  onOpenDeepLink,
}: {
  terminal: SignalDecisionResult | undefined;
  isCi: boolean;
  onOpenDeepLink: () => void;
}) {
  const { t } = useTranslation('audienceResearch');
  if (!terminal || terminal.terminalDecision !== 'accepted') return null;
  if (!terminal.deepLinkPath) return null;
  return (
    <p className="text-muted-foreground text-xs" data-testid="accept-dialog-replay-hint">
      {isCi
        ? t('signals.decision.replayHintCi')
        : t('signals.decision.replayHintActions')}{' '}
      <button
        type="button"
        onClick={onOpenDeepLink}
        className="underline"
        data-testid="accept-dialog-replay-open"
      >
        {t('signals.decision.openExisting')}
      </button>
    </p>
  );
}
