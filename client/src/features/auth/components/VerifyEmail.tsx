import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { appHref } from '@shared/navigation/appHref';
import { authClient } from '../authClient';
import { messageForAuthError } from '../errorMessage';
import { authSuccessHref } from '../intent';
import { useAuthSession } from '../useAuthSession';
import { useClearOnPresentationRefresh } from '@shared/i18n';

/**
 * Verification lobby. The emailed link is consumed by the SERVER
 * (`/api/auth/verify-email` → auto-sign-in → redirect to the callback), so
 * this screen only has two jobs: tell the user to check their inbox, and
 * resend the link. A failed server-side verification bounces back here with
 * `?error=` in the query.
 */
export const VerifyEmail = () => {
  const [searchParams] = useSearchParams();
  const { t } = useTranslation(['auth', 'errors']);
  const { user } = useAuthSession();

  const [email, setEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  useClearOnPresentationRefresh(() => {
    setErrorMessage('');
    setMessage('');
  });

  const linkFailed = searchParams.get('error') !== null;
  const sessionEmail = user?.email ?? '';

  const onResend = async () => {
    const target = sessionEmail || email;
    if (!target) return;
    setResending(true);
    setMessage('');
    setErrorMessage('');
    const { error } = await authClient.sendVerificationEmail({
      email: target,
      callbackURL: appHref(authSuccessHref(searchParams)),
    });
    if (error) {
      setErrorMessage(messageForAuthError(error, t));
    } else {
      setMessage(t('verify.resent'));
    }
    setResending(false);
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">{t('verify.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {linkFailed ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{t('verify.failed')}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-muted-foreground text-sm">{t('verify.instructions')}</p>
          )}

          {errorMessage ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
          {message ? (
            <Alert role="status" aria-live="polite">
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}

          {sessionEmail ? null : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="verify-email">{t('verify.emailLabel')}</Label>
              <Input
                id="verify-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          )}

          <Button
            type="button"
            onClick={() => void onResend()}
            disabled={resending}
            className="w-full"
          >
            {resending ? t('verify.resending') : t('verify.resend')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
