/**
 * Actions-item retest confirmation.
 *
 * Shown only when the API advertises retest capability on the action
 * (`retest.available`). Displays the shared audit retest preview
 * (`RetestPreviewCard`), then enqueues through
 * `POST /sites/:siteId/actions/:actionId/retest` — exactly one mutation
 * route per confirm. Provider and server errors surface as the server's
 * localized message verbatim. After a successful enqueue the dialog links
 * to the shipped report progress surface; the action is never marked
 * completed automatically.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
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
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  selectActionError,
  selectActionPending,
} from '../store/selectors';
import { submitRetestAction } from '../store/thunks';
import { clearActionErrors } from '../store/slice';
import { newActionClientKey } from './StateChangeDialog';
import { RetestPreviewCard } from './RetestPreviewCard';

export interface RetestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  siteId: string;
  actionId: string;
  /** Server-localized action title, rendered verbatim as inert text. */
  actionTitle: string;
}

export function RetestDialog({
  open,
  onOpenChange,
  siteId,
  actionId,
  actionTitle,
}: RetestDialogProps) {
  const { t } = useTranslation('actions');
  const dispatch = useAppDispatch();
  const pending = useAppSelector(selectActionPending('retest', actionId));
  const error = useAppSelector(selectActionError('retest', actionId));
  const [queued, setQueued] = useState(false);
  const [clientKey, setClientKey] = useState(() => newActionClientKey());

  useEffect(() => {
    if (open) {
      setQueued(false);
      setClientKey(newActionClientKey());
      dispatch(clearActionErrors(actionId));
    }
  }, [open, actionId, dispatch]);

  // Double-submit prevention lives on the Button primitive: `loading`
  // disables the control the moment the dispatch fires.
  const confirm = async () => {
    const result = await dispatch(
      submitRetestAction({ siteId, actionId, clientKey }),
    );
    if (submitRetestAction.fulfilled.match(result)) {
      setQueued(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="action-retest-dialog">
        <DialogHeader>
          <DialogTitle>{t('retest.title')}</DialogTitle>
          <DialogDescription>{t('retest.description')}</DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium" data-testid="action-retest-title">
          {actionTitle}
        </p>
        {queued ? (
          <div className="flex flex-col items-start gap-3">
            <Alert role="status" data-testid="action-retest-queued">
              <AlertDescription>{t('retest.queued')}</AlertDescription>
            </Alert>
            <Button asChild variant="link" className="h-auto px-0">
              <Link to="?tab=report" data-testid="action-retest-progress-link">
                {t('retest.viewProgress')}
                <ArrowRight aria-hidden="true" className="rtl:rotate-180" />
              </Link>
            </Button>
          </div>
        ) : (
          <RetestPreviewCard />
        )}
        {error ? (
          <Alert variant="destructive" role="alert" data-testid="action-retest-error">
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
            {queued ? t('history.close') : t('common:cancel')}
          </Button>
          {queued ? null : (
            <Button
              type="button"
              onClick={() => void confirm()}
              loading={pending}
              loadingLabel={t('retest.starting')}
              data-testid="action-retest-confirm"
            >
              {t('retest.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
