import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Checkbox } from '@shared/ui/checkbox';
import { authClient } from '../authClient';
import { useClearOnPresentationRefresh } from '@shared/i18n';

/**
 * `/two-factor` — the challenge screen Better Auth's client redirects to
 * after a primary-auth sign-in when the account has a verified second
 * factor. Users type the current TOTP code from their authenticator, or fall
 * back to a one-time backup code. On success Better Auth completes the
 * session and this screen navigates to the dashboard.
 */
export const TwoFactorChallenge = () => {
  const navigate = useNavigate();
  const { t } = useTranslation('auth');
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isBusy, setBusy] = useState(false);
  useClearOnPresentationRefresh(() => setErrorMessage(''));

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    if (!code) {
      setErrorMessage(t('twoFactor.invalidCode'));
      return;
    }
    setBusy(true);
    const result = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setBusy(false);
    if (result.error) {
      setErrorMessage(t('twoFactor.invalidCode'));
      setCode('');
      return;
    }
    navigate('/dashboard');
  };

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">{t('twoFactor.challenge.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <p className="text-muted-foreground text-sm">
              {useBackup ? t('twoFactor.challenge.backupBody') : t('twoFactor.challenge.totpBody')}
            </p>
            {errorMessage ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="two-factor-challenge-code">
                {useBackup ? t('twoFactor.backupCodeLabel') : t('twoFactor.codeLabel')}
              </Label>
              <Input
                id="two-factor-challenge-code"
                inputMode={useBackup ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="two-factor-challenge-trust"
                checked={trustDevice}
                onCheckedChange={(v) => setTrustDevice(Boolean(v))}
              />
              <Label htmlFor="two-factor-challenge-trust" className="text-sm">
                {t('twoFactor.challenge.trustDevice')}
              </Label>
            </div>
            <Button type="submit" disabled={isBusy} className="w-full">
              {isBusy ? t('twoFactor.challenge.submitting') : t('twoFactor.challenge.submit')}
            </Button>
            <Button
              type="button"
              variant="link"
              className="px-0"
              onClick={() => {
                setUseBackup((v) => !v);
                setErrorMessage('');
                setCode('');
              }}
            >
              {useBackup ? t('twoFactor.codeLabel') : t('twoFactor.backupCodeToggle')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
