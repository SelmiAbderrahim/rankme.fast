import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { authClient } from '../authClient';
import { messageForAuthError } from '../errorMessage';
import { useClearOnPresentationRefresh } from '@shared/i18n';

const buildResetSchema = (msg: {
  password: string;
  passwordTooShort: string;
  confirm: string;
  mismatch: string;
}) =>
  z
    .object({
      password: z.string().min(1, msg.password).min(8, msg.passwordTooShort),
      passwordConfirm: z.string().min(1, msg.confirm),
    })
    .refine((values) => values.password === values.passwordConfirm, {
      message: msg.mismatch,
      path: ['passwordConfirm'],
    });

type ResetPasswordValues = z.infer<ReturnType<typeof buildResetSchema>>;

/**
 * Terminal step of the Better Auth reset flow. The emailed link hits the
 * server first (token pre-check), which redirects here with `?token=` — or
 * `?error=INVALID_TOKEN` when the link is stale.
 */
export const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation(['auth', 'errors']);
  const [errorMessage, setErrorMessage] = useState('');
  useClearOnPresentationRefresh(() => setErrorMessage(''));

  const token = searchParams.get('token');
  const linkInvalid = !token || searchParams.get('error') !== null;

  const resetPasswordSchema = buildResetSchema({
    password: t('passwordRequired', { ns: 'errors' }),
    passwordTooShort: t('passwordTooShort', { ns: 'errors' }),
    confirm: t('passwordConfirmRequired', { ns: 'errors' }),
    mismatch: t('passwordsMustMatch', { ns: 'errors' }),
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', passwordConfirm: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setErrorMessage('');
    const { error } = await authClient.resetPassword({
      newPassword: values.password,
      token: token as string,
    });
    if (error) {
      setErrorMessage(messageForAuthError(error, t));
      return;
    }
    navigate('/login');
  });

  if (linkInvalid) {
    return (
      <div className="mx-auto w-full max-w-md">
        <Card className="w-full">
          <CardHeader>
            <CardTitle className="text-2xl">{t('reset.newPasswordTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Alert variant="destructive" role="alert">
              <AlertDescription>{t('reset.invalidLink')}</AlertDescription>
            </Alert>
            <Button asChild variant="outline" className="w-full">
              <Link to="/forgot-password">{t('reset.requestNew')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">{t('reset.newPasswordTitle')}</CardTitle>
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="reset-password">{t('reset.newPassword')}</Label>
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.password}
                {...register('password')}
              />
              {errors.password ? (
                <p className="text-destructive text-sm">{errors.password.message}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="reset-password-confirm">{t('reset.confirmPassword')}</Label>
              <Input
                id="reset-password-confirm"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.passwordConfirm}
                {...register('passwordConfirm')}
              />
              {errors.passwordConfirm ? (
                <p className="text-destructive text-sm">{errors.passwordConfirm.message}</p>
              ) : null}
            </div>

            <Button
              type="submit"
              loading={isSubmitting}
              loadingLabel={t('reset.submitting')}
              className="w-full"
            >
              {t('reset.changeSubmit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
