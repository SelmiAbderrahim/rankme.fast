import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { appHref } from '@shared/navigation/appHref';
import { authClient, withInlineTwoFactor } from '../authClient';
import { PasswordInput } from './PasswordInput';

export interface SessionReauthProps {
  email: string;
  hasPassword: boolean;
  onConfirmed: () => void | Promise<void>;
}

/** Confirm a fresh session without leaving the action that asked for it. */
export const SessionReauth = ({ email, hasPassword, onConfirmed }: SessionReauthProps) => {
  const { t } = useTranslation('auth');
  const passwordId = useId();
  const codeId = useId();
  const errorId = useId();
  const passwordField = useRef<HTMLInputElement | null>(null);
  const codeField = useRef<HTMLInputElement | null>(null);
  const googleButton = useRef<HTMLButtonElement | null>(null);
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { (passwordField.current ?? googleButton.current)?.focus(); }, []);
  useEffect(() => { if (step === 'code') codeField.current?.focus(); }, [step]);

  const fail = (message: string) => {
    setError(message);
    setBusy(false);
  };

  const confirmPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!password) return fail(t('twoFactor.passwordRequired'));
    setError('');
    setBusy(true);
    try {
      const { data, error: signInError } = await withInlineTwoFactor(() =>
        authClient.signIn.email({ email, password, rememberMe: true }));
      if (signInError || !data) {
        fail(signInError?.status === 401 || signInError?.code === 'INVALID_EMAIL_OR_PASSWORD'
          ? t('change.wrongCurrent') : t('security.sessions.reauth.failed'));
        return;
      }
      setPassword('');
      if ((data as { twoFactorRedirect?: boolean }).twoFactorRedirect) {
        setStep('code');
        setBusy(false);
        return;
      }
      await onConfirmed();
      setBusy(false);
    } catch {
      fail(t('security.sessions.reauth.failed'));
    }
  };

  const confirmCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!code) return fail(t('twoFactor.invalidCode'));
    setError('');
    setBusy(true);
    try {
      const { error: codeError } = await authClient.twoFactor.verifyTotp({ code });
      if (codeError) return fail(t('twoFactor.invalidCode'));
      await onConfirmed();
      setBusy(false);
    } catch {
      fail(t('security.sessions.reauth.failed'));
    }
  };

  const confirmGoogle = async () => {
    setError('');
    setBusy(true);
    try {
      const { error: socialError } = await authClient.signIn.social({
        provider: 'google', callbackURL: appHref('/settings/security'),
      });
      if (socialError) fail(t('google.error'));
    } catch {
      fail(t('google.error'));
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="sessions-reauth">
      <Alert role="alert">
        <ShieldCheck aria-hidden="true" />
        <AlertTitle>{t('security.sessions.reauth.title')}</AlertTitle>
        <AlertDescription>{t('security.sessions.reauth.description')}</AlertDescription>
      </Alert>
      {!hasPassword ? (
        <Button ref={googleButton} type="button" variant="outline" className="self-start"
          disabled={busy} onClick={() => void confirmGoogle()}>
          {t('google.cta')}
        </Button>
      ) : step === 'password' ? (
        <form className="flex flex-col gap-2" onSubmit={(event) => void confirmPassword(event)} noValidate>
          <Label htmlFor={passwordId}>{t('twoFactor.passwordLabel')}</Label>
          <PasswordInput id={passwordId} ref={passwordField} value={password} disabled={busy}
            autoComplete="current-password" aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => setPassword(event.target.value)} />
          {error ? <p id={errorId} role="alert" className="text-destructive text-sm">{error}</p> : null}
          <Button type="submit" className="self-start" disabled={busy}>{busy
            ? t('security.sessions.reauth.confirming') : t('security.sessions.reauth.confirm')}</Button>
        </form>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={(event) => void confirmCode(event)} noValidate>
          <Label htmlFor={codeId}>{t('twoFactor.codeLabel')}</Label>
          <Input id={codeId} ref={codeField} value={code} inputMode="numeric" autoComplete="one-time-code"
            disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
            onChange={(event) => setCode(event.target.value.trim())} />
          {error ? <p id={errorId} role="alert" className="text-destructive text-sm">{error}</p> : null}
          <Button type="submit" className="self-start" disabled={busy}>{busy
            ? t('security.sessions.reauth.confirming') : t('security.sessions.reauth.confirm')}</Button>
        </form>
      )}
      {!hasPassword && error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
    </div>
  );
};
