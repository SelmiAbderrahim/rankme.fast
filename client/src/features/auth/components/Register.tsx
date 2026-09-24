import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { messageForAuthError } from '../errorMessage';
import { authSuccessHref, verifyEmailHref } from '../intent';
import { AuthDivider, GoogleSignIn } from './SocialAuth';
import { useClearOnPresentationRefresh } from '@shared/i18n';

const buildRegisterSchema = (msg: {
  firstName: string;
  lastName: string;
  email: string;
  emailInvalid: string;
  password: string;
  passwordTooShort: string;
}) =>
  z.object({
    firstName: z.string().min(1, msg.firstName),
    lastName: z.string().min(1, msg.lastName),
    email: z.string().min(1, msg.email).email(msg.emailInvalid),
    // Mirrors Better Auth's server-side minimum so most violations are caught
    // inline before the round-trip.
    password: z.string().min(1, msg.password).min(8, msg.passwordTooShort),
  });

type RegisterFormValues = z.infer<ReturnType<typeof buildRegisterSchema>>;

export const Register = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation(['auth', 'errors']);
  const [errorMessage, setErrorMessage] = useState('');
  useClearOnPresentationRefresh(() => setErrorMessage(''));

  const registerSchema = buildRegisterSchema({
    firstName: t('firstNameRequired', { ns: 'errors' }),
    lastName: t('lastNameRequired', { ns: 'errors' }),
    email: t('emailRequired', { ns: 'errors' }),
    emailInvalid: t('emailInvalid', { ns: 'errors' }),
    password: t('passwordRequired', { ns: 'errors' }),
    passwordTooShort: t('passwordTooShort', { ns: 'errors' }),
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setErrorMessage('');
    const { error } = await authClient.signUp.email({
      name: `${values.firstName} ${values.lastName}`.trim(),
      email: values.email,
      password: values.password,
      // Where the emailed verification link drops the user after the server
      // confirms the address (autoSignInAfterVerification is on).
      callbackURL: appHref(authSuccessHref(location.search)),
    });
    if (error) {
      setErrorMessage(messageForAuthError(error, t));
      return;
    }
    // Signed up (and auto-signed-in) but unverified — the verify screen owns
    // the "check your inbox" story.
    navigate(verifyEmailHref(location.search));
  });

  return (
    <div className="mx-auto w-full max-w-md">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">{t('register.title')}</CardTitle>
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="register-first-name">{t('register.firstName')}</Label>
                <Input
                  id="register-first-name"
                  type="text"
                  autoComplete="given-name"
                  aria-invalid={!!errors.firstName}
                  {...register('firstName')}
                />
                {errors.firstName ? (
                  <p className="text-destructive text-sm">{errors.firstName.message}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="register-last-name">{t('register.lastName')}</Label>
                <Input
                  id="register-last-name"
                  type="text"
                  autoComplete="family-name"
                  aria-invalid={!!errors.lastName}
                  {...register('lastName')}
                />
                {errors.lastName ? (
                  <p className="text-destructive text-sm">{errors.lastName.message}</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="register-email">{t('register.email')}</Label>
              <Input
                id="register-email"
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
              <Label htmlFor="register-password">{t('register.password')}</Label>
              <Input
                id="register-password"
                type="password"
                autoComplete="new-password"
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
              loadingLabel={t('register.submitting')}
              className="w-full"
            >
              {t('register.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
