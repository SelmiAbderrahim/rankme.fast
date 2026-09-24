import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { appHref } from '@shared/navigation/appHref';
import { authClient } from '../authClient';
import { useAuthSession } from '../useAuthSession';
import { messageForAuthError, type AuthClientError } from '../errorMessage';
import { useClearOnPresentationRefresh } from '@shared/i18n';

const buildChangeEmailSchema = (currentEmail: string, msg: { invalid: string; sameAsCurrent: string }) =>
  z.object({
    newEmail: z
      .string()
      .trim()
      .min(1, msg.invalid)
      .email(msg.invalid)
      .refine((value) => value.toLowerCase() !== currentEmail.trim().toLowerCase(), {
        message: msg.sameAsCurrent,
      }),
  });

type ChangeEmailValues = { newEmail: string };

/**
 * Authenticated email-change form. Better Auth's `changeEmail` re-verifies
 * the NEW address before rewriting the account email — the old email keeps
 * working until the confirmation link is followed. The `callbackURL` is
 * derived from `VITE_APP_URL`, never hardcoded.
 */
export const ChangeEmail = () => {
  const { t } = useTranslation(['auth', 'errors']);
  const { user } = useAuthSession();
  const currentEmail = user?.email ?? '';
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingNewEmail, setPendingNewEmail] = useState<string | null>(null);
  useClearOnPresentationRefresh(() => setErrorMessage(''));

  const schema = buildChangeEmailSchema(currentEmail, {
    invalid: t('emailChange.invalidEmail'),
    sameAsCurrent: t('emailChange.sameAsCurrent'),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangeEmailValues>({
    resolver: zodResolver(schema),
    defaultValues: { newEmail: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setErrorMessage('');
    const target = values.newEmail.trim();
    const callbackURL = appHref('/settings/security');
    const result = await authClient.changeEmail({ newEmail: target, callbackURL });
    if (result.error) {
      const err = result.error as AuthClientError;
      // Duplicate email is treated identically to any generic rejection so
      // the UI never leaks whether the target address is already registered
      // to another account.
      if (
        err.code === 'EMAIL_ALREADY_EXISTS' ||
        err.code === 'EMAIL_TAKEN' ||
        err.code === 'EMAIL_UNAVAILABLE' ||
        err.status === 409
      ) {
        setErrorMessage(t('emailChange.unavailable'));
      } else {
        setErrorMessage(messageForAuthError(err, t));
      }
      return;
    }
    setPendingNewEmail(target);
    reset({ newEmail: '' });
  });

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl">{t('emailChange.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {errorMessage ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>
                <strong>{t('login.errorPrefix')}</strong> {errorMessage}
              </AlertDescription>
            </Alert>
          ) : null}

          {pendingNewEmail ? (
            <Alert role="status">
              <AlertDescription>
                {t('emailChange.pending', { email: pendingNewEmail })}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="change-email-current">{t('emailChange.currentEmail')}</Label>
            <Input
              id="change-email-current"
              type="email"
              value={currentEmail}
              readOnly
              aria-readonly="true"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="change-email-new">{t('emailChange.newEmail')}</Label>
            <Input
              id="change-email-new"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.newEmail}
              {...register('newEmail')}
            />
            {errors.newEmail ? (
              <p className="text-destructive text-sm">{errors.newEmail.message}</p>
            ) : null}
          </div>

          <Button
            type="submit"
            loading={isSubmitting}
            loadingLabel={t('emailChange.submitting')}
            className="w-full"
          >
            {t('emailChange.submit')}
          </Button>
          <p className="text-muted-foreground text-sm">{t('emailChange.hint')}</p>
        </form>
      </CardContent>
    </Card>
  );
};
