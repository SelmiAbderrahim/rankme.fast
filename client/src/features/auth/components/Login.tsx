import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
import { authSuccessHref, requiredPasswordChangeHref, verifyEmailHref } from '../intent';
import { AuthDivider, GoogleSignIn } from './SocialAuth';
import { useClearOnPresentationRefresh } from '@shared/i18n';

const buildLoginSchema = (requiredEmail: string, requiredPassword: string) =>
  z.object({
    email: z.string().min(1, requiredEmail),
    password: z.string().min(1, requiredPassword),
  });

type LoginFormValues = z.infer<ReturnType<typeof buildLoginSchema>>;

export const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation(['auth', 'errors']);
  const [errorMessage, setErrorMessage] = useState('');
  useClearOnPresentationRefresh(() => setErrorMessage(''));

  const loginSchema = buildLoginSchema(
    t('emailRequired', { ns: 'errors' }),
    t('passwordRequired', { ns: 'errors' }),
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setErrorMessage('');
    const { data, error } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
    });
    if (error) {
      setErrorMessage(messageForAuthError(error, t));
      return;
    }
    // Unverified accounts must confirm their email before the product shell.
    if (data.user.mustChangePassword) {
      navigate(requiredPasswordChangeHref(authSuccessHref(location.search)));
    } else if (data.user.provisionalAccount) {
      navigate('/team/invitations');
    } else if (!data.user.emailVerified) {
      navigate(verifyEmailHref(location.search));
    } else {
      navigate(authSuccessHref(location.search));
    }
  });

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">{t('login.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <GoogleSignIn />
          <AuthDivider />
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            {errorMessage ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>
                  <strong>{t('login.errorPrefix')}</strong> {errorMessage}
                </AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="login-email">{t('login.email')}</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                aria-invalid={!!errors.email}
                {...register('email')}
              />
              {errors.email ? (
                <p className="text-destructive text-sm">{errors.email.message}</p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="login-password">{t('login.password')}</Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.password}
                {...register('password')}
              />
              {errors.password ? (
                <p className="text-destructive text-sm">{errors.password.message}</p>
              ) : null}
            </div>
            <Button
              type="submit"
              loading={isSubmitting}
              loadingLabel={t('login.submitting')}
              className="w-full"
            >
              {t('login.submit')}
            </Button>
          </form>
          <Button asChild variant="link" className="px-0">
            <Link to="/forgot-password">{t('login.forgot')}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};
