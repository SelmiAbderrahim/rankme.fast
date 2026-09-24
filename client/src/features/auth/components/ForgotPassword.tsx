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
import { authClient } from '../authClient';
import { messageForAuthError } from '../errorMessage';
import { useClearOnPresentationRefresh } from '@shared/i18n';

const buildForgotSchema = (requiredEmail: string, invalidEmail: string) =>
  z.object({
    email: z.string().min(1, requiredEmail).email(invalidEmail),
  });

type ForgotPasswordValues = z.infer<ReturnType<typeof buildForgotSchema>>;

export const ForgotPassword = () => {
  const { t } = useTranslation(['auth', 'errors']);
  const [errorMessage, setErrorMessage] = useState('');
  const [sent, setSent] = useState(false);
  useClearOnPresentationRefresh(() => setErrorMessage(''));

  const forgotPasswordSchema = buildForgotSchema(
    t('emailRequired', { ns: 'errors' }),
    t('emailInvalid', { ns: 'errors' }),
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setErrorMessage('');
    const { error } = await authClient.requestPasswordReset({
      email: values.email,
      // Better Auth emails a server URL that verifies the token, then lands
      // the user here with `?token=` appended.
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) {
      setErrorMessage(messageForAuthError(error, t));
      return;
    }
    // The server answers 200 whether or not the address exists — never leak
    // which emails are registered.
    setSent(true);
  });

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">{t('reset.title')}</CardTitle>
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
            {sent ? (
              <Alert role="status" aria-live="polite">
                <AlertDescription>{t('reset.sent')}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="forgot-email">{t('login.email')}</Label>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                aria-invalid={!!errors.email}
                {...register('email')}
              />
              {errors.email ? (
                <p className="text-destructive text-sm">{errors.email.message}</p>
              ) : null}
            </div>
            <Button
              type="submit"
              loading={isSubmitting}
              loadingLabel={t('reset.submitting')}
              className="w-full"
            >
              {t('reset.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
