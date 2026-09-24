import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { ApiError } from '@shared/api/client';
import { useAuthSession } from '../useAuthSession';
import {
  cancelAccountDeletion,
  deleteAccount,
  getAccountDeletionStatus,
} from '../api';
import { useClearOnPresentationRefresh } from '@shared/i18n';

/**
 * `/settings/security` — danger-zone account deletion.
 *
 * Calls the legal data-rights endpoint (`POST /api/legal/delete-account`),
 * which schedules a grace-period soft-delete + purge — the account is
 * recoverable by signing back in until the purge date. A type-your-email
 * confirmation arms the destructive action so it can't fire by accident.
 */
export const DeleteAccount = () => {
  const { t, i18n } = useTranslation('auth');
  const { user } = useAuthSession();
  const email = user?.email ?? '';
  const userId = user?.id;

  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [scheduledDate, setScheduledDate] = useState<string | null>(null);
  useClearOnPresentationRefresh(() => setErrorMessage(''));

  const formatDate = useCallback((value: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
      new Date(value),
    ), [i18n.language]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void getAccountDeletionStatus()
      .then((status) => {
        if (active && status.cancellable && status.scheduledAt) {
          setScheduledDate(formatDate(status.scheduledAt));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // Language changes should reformat a persisted purge date on the next
    // status read; user identity is the stable request authority.
  }, [userId, formatDate]);

  const armed = email !== '' && typed.trim().toLowerCase() === email.trim().toLowerCase();

  const submit = async () => {
    setErrorMessage('');
    setBusy(true);
    try {
      const result = await deleteAccount();
      setScheduledDate(formatDate(result.purgeAt));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setErrorMessage(t('security.deletion.alreadyScheduled'));
      } else {
        setErrorMessage(t('security.deletion.error'));
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelScheduled = async () => {
    setErrorMessage('');
    setBusy(true);
    try {
      await cancelAccountDeletion();
      setScheduledDate(null);
      setConfirming(false);
      setTyped('');
    } catch {
      setErrorMessage(t('security.deletion.cancelError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-destructive/50 w-full">
      <CardHeader>
        <CardTitle className="text-destructive text-xl">{t('security.deletion.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {scheduledDate ? (
            <>
              <Alert role="status">
                <AlertDescription>
                  {t('security.deletion.scheduled', { date: scheduledDate })}
                </AlertDescription>
              </Alert>
              {errorMessage ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void cancelScheduled()}
              >
                {busy
                  ? t('security.deletion.cancelling')
                  : t('security.deletion.cancelScheduled')}
              </Button>
            </>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">{t('security.deletion.description')}</p>

              {errorMessage ? (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              ) : null}

              {confirming ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="delete-confirm">{t('security.deletion.confirmLabel')}</Label>
                  <p className="text-muted-foreground text-sm">
                    {t('security.deletion.confirmPrompt', { email })}
                  </p>
                  <Input
                    id="delete-confirm"
                    type="email"
                    autoComplete="off"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={!armed || busy}
                      onClick={() => void submit()}
                    >
                      {busy ? t('security.deletion.deleting') : t('security.deletion.delete')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setConfirming(false);
                        setTyped('');
                        setErrorMessage('');
                      }}
                    >
                      {t('security.deletion.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-destructive"
                    onClick={() => setConfirming(true)}
                  >
                    {t('security.deletion.delete')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
