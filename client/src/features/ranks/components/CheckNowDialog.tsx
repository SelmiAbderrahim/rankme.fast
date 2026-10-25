import { useTranslation } from 'react-i18next';
import { isolateText } from '@shared/lib/bidi';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@shared/ui/alert-dialog';
import { Button } from '@shared/ui/button';
import type { Keyword } from '../types';

export type CheckNowTarget = { scope: 'site' } | { scope: 'keyword'; keyword: Keyword };

export interface CheckNowDialogProps {
  open: boolean;
  target: CheckNowTarget;
  confirming: boolean;
  onConfirm: (target: CheckNowTarget) => void;
  onCancel: () => void;
}

/** Confirm a check for the selected site or keyword. */
export function CheckNowDialog({ open, target, confirming, onConfirm, onCancel }: CheckNowDialogProps) {
  const { t } = useTranslation('ranks');
  return <AlertDialog open={open} onOpenChange={(next) => { if (!next && !confirming) onCancel(); }}>
    <AlertDialogContent data-testid="check-now-dialog">
      <AlertDialogHeader>
        <AlertDialogTitle>{t(target.scope === 'site' ? 'checkConfirm.siteTitle' : 'checkConfirm.keywordTitle')}</AlertDialogTitle>
        <AlertDialogDescription>{target.scope === 'site'
          ? t('checkConfirm.siteDescription')
          : t('checkConfirm.keywordDescription', { phrase: isolateText(target.keyword.phrase) })}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={confirming}>{t('common:cancel')}</AlertDialogCancel>
        <Button type="button" loading={confirming} loadingLabel={t('checkConfirm.starting')}
          onClick={() => onConfirm(target)} data-testid="check-now-confirm">
          {t(target.scope === 'site' ? 'checkConfirm.confirmSite' : 'checkConfirm.confirmKeyword')}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
