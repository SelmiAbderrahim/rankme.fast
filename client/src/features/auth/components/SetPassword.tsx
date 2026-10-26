import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Button } from '@shared/ui/button';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { authClient } from '../authClient';
import { messageForAuthError, type AuthClientError } from '../errorMessage';

/** A single-use emailed Better Auth proof establishes the first credential. */
export const SetPassword = ({ email }: { email: string }) => {
  const { t } = useTranslation(['auth', 'errors']);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<AuthClientError | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.requestPasswordReset({
        email, redirectTo: `${window.location.origin}/reset-password`,
      });
      if (result.error) setError(result.error);
      else setSent(true);
    } catch {
      setError({});
    } finally {
      setBusy(false);
    }
  };

  return <Card id="password-setup" className="scroll-mt-24">
    <CardHeader><CardTitle className="text-xl">{t('setupPassword.title')}</CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t('setupPassword.description')}</p>
      {error ? <Alert variant="destructive" role="alert"><AlertDescription>
        {messageForAuthError(error, t)}
      </AlertDescription></Alert> : null}
      {sent ? <p role="status">{t('setupPassword.sent')}</p> : null}
      <Button type="button" onClick={() => void send()} loading={busy} disabled={sent}
        loadingLabel={t('reset.submitting')}>
        {t('setupPassword.title')}
      </Button>
    </CardContent>
  </Card>;
};
