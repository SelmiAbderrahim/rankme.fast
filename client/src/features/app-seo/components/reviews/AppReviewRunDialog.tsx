import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import type { StartAppReviewRunResponse } from '../../reviews-types';

export function AppReviewRunDialog({
  open,
  preview,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  preview: StartAppReviewRunResponse | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('appSeoReviews');
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialog.title')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('dialog.bound')}</p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button
            loading={busy}
            loadingLabel={t('dialog.confirming')}
            disabled={!preview}
            onClick={onConfirm}
          >
            {t('dialog.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
