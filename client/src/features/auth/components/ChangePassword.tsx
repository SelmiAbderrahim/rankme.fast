import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { authClient } from '../authClient';
import { messageForAuthError, type AuthClientError } from '../errorMessage';
import { useClearOnPresentationRefresh } from '@shared/i18n';

const buildChangeSchema = (msg: {
  currentRequired: string;
  newRequired: string;
  confirmRequired: string;
  tooShort: string;
  mismatch: string;
  sameAsCurrent: string;
}) =>
  z
    .object({
      currentPassword: z.string().min(1, msg.currentRequired),
      newPassword: z.string().min(1, msg.newRequired).min(8, msg.tooShort),
      confirmPassword: z.string().min(1, msg.confirmRequired),
    })
    .refine((values) => values.newPassword === values.confirmPassword, {
      message: msg.mismatch,
      path: ['confirmPassword'],
    })
    .refine((values) => values.newPassword !== values.currentPassword, {
      message: msg.sameAsCurrent,
      path: ['newPassword'],
    });

type ChangePasswordValues = z.infer<ReturnType<typeof buildChangeSchema>>;

/**
 * Authenticated password change form. Better Auth's `changePassword` verifies
 * the current password server-side (scrypt), rotates the hash, and — with
 * `revokeOtherSessions: true` — invalidates every OTHER session so a leaked
 * device is signed out. The confirmation email fires from a Better Auth
 * `after` hook on `/change-password` (server-side, not client-side).
 */
interface ChangePasswordProps {
  onSuccess?: () => void | Promise<void>;
}

export const ChangePassword = ({ onSuccess }: ChangePasswordProps = {}) => {
  const { t } = useTranslation(['auth', 'errors']);
  const [errorMessage, setErrorMessage] = useState('');
  useClearOnPresentationRefresh(() => setErrorMessage(''));
  const session = authClient.useSession();

  const schema = buildChangeSchema({
    currentRequired: t('change.currentRequired'),
    newRequired: t('change.newRequired'),
    confirmRequired: t('passwordConfirmRequired', { ns: 'errors' }),
    tooShort: t('passwordTooShort', { ns: 'errors' }),
    mismatch: t('passwordsMustMatch', { ns: 'errors' }),
    sameAsCurrent: t('change.sameAsCurrent'),
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setErrorMessage('');
    const result = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    });
    if (result.error) {
      const err = result.error as AuthClientError;
      // Wrong-current-password → inline, do NOT leak identity presence.
      if (err.code === 'INVALID_PASSWORD' || err.status === 400 || err.status === 401) {
        setErrorMessage(t('change.wrongCurrent'));
      } else {
        setErrorMessage(messageForAuthError(err, t));
      }
      // Clear password fields but keep no identifier populated.
      setValue('currentPassword', '');
      setValue('newPassword', '');
      setValue('confirmPassword', '');
      return;
    }
    toast.success(t('change.success'));
    reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
    if (onSuccess) {
      await session.refetch?.();
      await onSuccess();
    }
  });

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl">{t('change.title')}</CardTitle>
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
            <Label htmlFor="change-current">{t('change.currentPassword')}</Label>
            <Input
              id="change-current"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.currentPassword}
              {...register('currentPassword')}
            />
            {errors.currentPassword ? (
              <p className="text-destructive text-sm">{errors.currentPassword.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="change-new">{t('change.newPassword')}</Label>
            <Input
              id="change-new"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.newPassword}
              {...register('newPassword')}
            />
            {errors.newPassword ? (
              <p className="text-destructive text-sm">{errors.newPassword.message}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="change-confirm">{t('change.confirmPassword')}</Label>
            <Input
              id="change-confirm"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirmPassword}
              {...register('confirmPassword')}
            />
            {errors.confirmPassword ? (
              <p className="text-destructive text-sm">{errors.confirmPassword.message}</p>
            ) : null}
          </div>

          <Button
            type="submit"
            loading={isSubmitting}
            loadingLabel={t('change.submitting')}
            className="w-full"
          >
            {t('change.submit')}
          </Button>
          <p className="text-muted-foreground text-sm">{t('change.hint')}</p>
        </form>
      </CardContent>
    </Card>
  );
};
