import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import QRCode from 'qrcode';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { authClient } from '../authClient';
import { useAuthSession } from '../useAuthSession';
import { useClearOnPresentationRefresh } from '@shared/i18n';

type EnrolState = {
  totpURI: string;
  qrDataUrl: string;
  backupCodes: string[];
};

/**
 * `/settings/security` — two-factor enrolment + disable panel.
 *
 * Better Auth owns the crypto: `twoFactor.enable` returns an otpauth URI +
 * one-time backup codes; the code we render here is a purely visual layer
 * on top of that. Enrolment is two-phase:
 *   1. `enable(password)` — generates the secret + codes (returned once).
 *   2. `verifyTotp(code)` — the user types the first code from their app;
 *      only then does the account gain a verified factor.
 * Disable requires the current password (Better Auth's contract).
 */
export const TwoFactorSettings = () => {
  const { t } = useTranslation('auth');
  const { user } = useAuthSession();
  const twoFactorEnabled = Boolean(
    (user as { twoFactorEnabled?: boolean } | null)?.twoFactorEnabled,
  );

  const [password, setPassword] = useState('');
  const [enrolState, setEnrolState] = useState<EnrolState | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isBusy, setBusy] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  useClearOnPresentationRefresh(() => setErrorMessage(''));

  const resetState = () => {
    setPassword('');
    setEnrolState(null);
    setVerifyCode('');
    setDisableCode('');
    setErrorMessage('');
    setShowDisable(false);
  };

  const startEnrol = async () => {
    setErrorMessage('');
    if (!password) {
      setErrorMessage(t('twoFactor.passwordRequired'));
      return;
    }
    setBusy(true);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setBusy(false);
    if (error || !data) {
      setErrorMessage(t('twoFactor.invalidCode'));
      return;
    }
    let qrDataUrl = '';
    try {
      qrDataUrl = await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 });
    } catch {
      qrDataUrl = '';
    }
    setEnrolState({ totpURI: data.totpURI, qrDataUrl, backupCodes: data.backupCodes });
    setPassword('');
  };

  const verifyEnrolment = async () => {
    if (!verifyCode) {
      setErrorMessage(t('twoFactor.invalidCode'));
      return;
    }
    setBusy(true);
    const { error } = await authClient.twoFactor.verifyTotp({ code: verifyCode });
    setBusy(false);
    if (error) {
      setErrorMessage(t('twoFactor.invalidCode'));
      return;
    }
    toast.success(t('twoFactor.enabled'));
    resetState();
  };

  const disable = async () => {
    if (!disableCode) {
      setErrorMessage(t('twoFactor.invalidCode'));
      return;
    }
    setBusy(true);
    // Better Auth accepts either a valid TOTP code (via verifyTotp) OR a
    // password on `/two-factor/disable`. We route through `disable` with the
    // code as the password field ONLY when the account has a credential
    // account — the simple, safe path is: ask the user for a current TOTP
    // code via verifyTotp, then call disable with an empty password if the
    // plugin allows it. We use disable(password) here — the input we ask for
    // is the account password to match Better Auth's disable contract.
    const { error } = await authClient.twoFactor.disable({ password: disableCode });
    setBusy(false);
    if (error) {
      setErrorMessage(t('twoFactor.invalidCode'));
      return;
    }
    toast.success(t('twoFactor.disabled'));
    resetState();
  };

  const copy = async (text: string, message: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(message);
    } catch {
      // Some browsers block clipboard without user gesture — silently swallow.
    }
  };

  const downloadCodes = (codes: string[]) => {
    const blob = new Blob([codes.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rankmefast-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl">
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-5" aria-hidden />
            {t('twoFactor.title')}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{t('twoFactor.description')}</p>

          <p
            className={twoFactorEnabled ? 'text-success text-sm' : 'text-muted-foreground text-sm'}
            data-testid="two-factor-status"
          >
            {twoFactorEnabled ? (
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="size-4" aria-hidden /> {t('twoFactor.statusOn')}
              </span>
            ) : (
              t('twoFactor.statusOff')
            )}
          </p>

          {errorMessage ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          {twoFactorEnabled ? (
            <div className="flex flex-col gap-2">
              {showDisable ? (
                <>
                  <p className="text-muted-foreground text-sm">{t('twoFactor.confirmDisable')}</p>
                  <Label htmlFor="two-factor-disable-code">{t('twoFactor.passwordLabel')}</Label>
                  <Input
                    id="two-factor-disable-code"
                    type="password"
                    autoComplete="current-password"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={isBusy}
                      onClick={disable}
                    >
                      {isBusy ? t('twoFactor.disabling') : t('twoFactor.disable')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setShowDisable(false);
                        setDisableCode('');
                        setErrorMessage('');
                      }}
                    >
                      {t('twoFactor.cancel')}
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowDisable(true)}
                >
                  {t('twoFactor.disable')}
                </Button>
              )}
            </div>
          ) : enrolState ? (
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="font-semibold">{t('twoFactor.step1Title')}</h3>
                <p className="text-muted-foreground text-sm">{t('twoFactor.step1Body')}</p>
                {enrolState.qrDataUrl ? (
                  <img
                    src={enrolState.qrDataUrl}
                    alt=""
                    width={220}
                    height={220}
                    className="mt-2 rounded-md border"
                  />
                ) : null}
                <div className="mt-2 flex flex-col gap-1">
                  <Label htmlFor="two-factor-manual-secret">{t('twoFactor.manualSecret')}</Label>
                  <Input
                    id="two-factor-manual-secret"
                    readOnly
                    value={extractSecret(enrolState.totpURI)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void copy(
                        extractSecret(enrolState.totpURI),
                        t('twoFactor.secretCopied'),
                      )
                    }
                  >
                    {t('twoFactor.copySecret')}
                  </Button>
                </div>
              </div>

              <div>
                <h3 className="font-semibold">{t('twoFactor.step2Title')}</h3>
                <p className="text-muted-foreground text-sm">{t('twoFactor.step2Body')}</p>
                <ul className="mt-2 grid grid-cols-2 gap-1 font-mono text-sm">
                  {enrolState.backupCodes.map((code) => (
                    <li key={code}>{code}</li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      void copy(enrolState.backupCodes.join('\n'), t('twoFactor.codesCopied'))
                    }
                  >
                    {t('twoFactor.copyCodes')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => downloadCodes(enrolState.backupCodes)}
                  >
                    {t('twoFactor.downloadCodes')}
                  </Button>
                </div>
              </div>

              <div>
                <h3 className="font-semibold">{t('twoFactor.step3Title')}</h3>
                <p className="text-muted-foreground text-sm">{t('twoFactor.step3Body')}</p>
                <div className="mt-2 flex flex-col gap-2">
                  <Label htmlFor="two-factor-verify-code">{t('twoFactor.codeLabel')}</Label>
                  <Input
                    id="two-factor-verify-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button type="button" disabled={isBusy} onClick={verifyEnrolment}>
                      {isBusy ? t('twoFactor.verifying') : t('twoFactor.verify')}
                    </Button>
                    <Button type="button" variant="outline" onClick={resetState}>
                      {t('twoFactor.cancel')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="two-factor-enrol-password">{t('twoFactor.passwordLabel')}</Label>
              <Input
                id="two-factor-enrol-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button type="button" disabled={isBusy} onClick={startEnrol}>
                {isBusy ? t('twoFactor.enabling') : t('twoFactor.enable')}
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

/** otpauth://totp/RankMeFast:user?secret=BASE32&issuer=RankMeFast — pull the secret. */
export const extractSecret = (uri: string): string => {
  const match = /[?&]secret=([^&]+)/i.exec(uri);
  return match?.[1] ?? '';
};
