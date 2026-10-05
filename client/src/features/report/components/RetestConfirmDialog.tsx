/**
 * Whole-report retest confirmation.
 *
 * The shipped report-level Retest CTA keeps its mutation route
 * (`POST /sites/:siteId/audits` via the `startRetest` thunk) but now shares
 * the SAME spend-preview presentation as the Actions-item retest
 * (`RetestPreviewCard` from the actions feature public API — a read).
 * Cancelling never mutates; one confirm click drives exactly one mutation
 * route. The page-cap picker travels into the dialog so the crawl-cost
 * bound is chosen alongside the preview.
 */
import type { ReactNode } from 'react';
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
import { RetestPreviewCard } from '@features/actions';

export interface RetestConfirmDialogProps {
  /**
   * `first` = the site has no audit yet (nothing to retest); `retest` = a
   * fresh audit over an existing report. Only the wording differs — both
   * start exactly one site audit through the same mutation.
   */
  variant?: 'first' | 'retest';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The shipped page-cap Select, rendered inside the confirmation. */
  pageCapPicker: ReactNode;
  confirming: boolean;
  error: string;
  onConfirm: () => void;
}

export const RetestConfirmDialog = ({
  variant = 'retest',
  open,
  onOpenChange,
  pageCapPicker,
  confirming,
  error,
  onConfirm,
}: RetestConfirmDialogProps) => {
  const { t } = useTranslation(['report', 'actions']);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="report-retest-dialog">
        <DialogHeader>
          <DialogTitle>
            {variant === 'first' ? t('report:firstAudit.title') : t('report:retest.dialogTitle')}
          </DialogTitle>
          <DialogDescription>
            {variant === 'first'
              ? t('report:firstAudit.description')
              : t('actions:retest.description')}
          </DialogDescription>
        </DialogHeader>
        <RetestPreviewCard firstRun={variant === 'first'} />
        {pageCapPicker}
        {error ? (
          <Alert
            variant="destructive"
            role="alert"
            data-testid="report-retest-dialog-error"
          >
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={confirming}
          >
            {t('common:cancel')}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            loading={confirming}
            loadingLabel={t('actions:retest.starting')}
            data-testid="report-retest-confirm"
          >
            {variant === 'first' ? t('report:firstAudit.confirm') : t('actions:retest.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
