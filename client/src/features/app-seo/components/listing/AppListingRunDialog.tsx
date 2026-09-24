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
import type { AppListingRunResponse } from '../../listing-types';

export function AppListingRunDialog({
  open,
  preview,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  preview: AppListingRunResponse | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('appSeoListing');
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('preview.title')}</DialogTitle>
          <DialogDescription>{t('preview.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={busy}
            loadingLabel={t('preview.running')}
            disabled={!preview}
            onClick={onConfirm}
          >
            {t('preview.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
