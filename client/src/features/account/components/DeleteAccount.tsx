import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Alert, AlertDescription } from '@shared/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import { deleteAccountRequest, fetchCsrfToken } from '../api';
import { accountErrorMessage } from '../errorMessage';
import { useClearOnPresentationRefresh } from '@shared/i18n';

/**
 * Data & privacy — account deletion. Soft-delete: the server schedules a purge
 * after a grace period and returns the date. CSRF-protected, so we fetch a
 * double-submit token immediately before the mutating call.
 */
export const DeleteAccount = () => {
  const { t, i18n } = useTranslation('account');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  useClearOnPresentationRefresh(() => setErrorMessage(''));

  const onConfirm = async () => {
    setErrorMessage('');
    setBusy(true);
    try {
      const { csrfToken } = await fetchCsrfToken();
      const result = await deleteAccountRequest(csrfToken);
      setScheduledAt(result.scheduledAt);
      setOpen(false);
    } catch (err) {
      setErrorMessage(accountErrorMessage(err, 'account:privacy.delete.error'));
    } finally {
      setBusy(false);
    }
  };

  const formattedDate = scheduledAt
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
        new Date(scheduledAt),
      )
    : '';

  return (
    <Card className="w-full border-destructive/40">
      <CardHeader>
        <CardTitle className="text-xl">{t('privacy.delete.title')}</CardTitle>
        <p className="text-muted-foreground text-sm">{t('privacy.delete.description')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {scheduledAt ? (
          <Alert role="status">
            <AlertDescription>
              {t('privacy.delete.scheduled', { date: formattedDate })}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">{t('privacy.delete.warning')}</p>
            {errorMessage ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}
            <Button
              variant="destructive"
              className="w-fit"
              onClick={() => setOpen(true)}
            >
              {t('privacy.delete.button')}
            </Button>
          </>
        )}

        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('privacy.delete.dialogTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('privacy.delete.dialogBody')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>
                {t('privacy.delete.cancel')}
              </AlertDialogCancel>
              <Button
                variant="destructive"
                loading={busy}
                loadingLabel={t('privacy.delete.deleting')}
                onClick={onConfirm}
              >
                {t('privacy.delete.confirm')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};
