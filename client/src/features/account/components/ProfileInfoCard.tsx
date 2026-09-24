import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { authClient, useAuthSession } from '@features/auth';
import { Avatar, AvatarFallback, AvatarImage } from '@shared/ui/avatar';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Separator } from '@shared/ui/separator';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { StatusChip } from '@shared/ui/status-chip';
import { useClearOnPresentationRefresh } from '@shared/i18n';

const buildProfileSchema = (msg: { required: string; tooLong: string }) =>
  z.object({
    name: z.string().trim().min(1, msg.required).max(80, msg.tooLong),
  });

type ProfileValues = { name: string };

/** Two-letter avatar fallback from the display name (or email if unnamed). */
const initialsFor = (name: string, email: string): string => {
  const source = name.trim() || email;
  const words = source.split(/\s+/).filter(Boolean);
  const initials =
    words.length > 1
      ? words.slice(0, 2).map((word) => word.slice(0, 1)).join('')
      : source.slice(0, 2);
  return initials.toUpperCase();
};

/**
 * Profile tab — live identity (avatar, name, email, role, verification,
 * member-since) sourced from the Better Auth session, plus a display-name edit
 * form. `authClient.updateUser` rewrites the session name in place, so the
 * header re-renders without a manual refetch.
 */
export const ProfileInfoCard = () => {
  const { t, i18n } = useTranslation('account');
  const { user } = useAuthSession();
  const [errorMessage, setErrorMessage] = useState('');
  useClearOnPresentationRefresh(() => setErrorMessage(''));

  const schema = buildProfileSchema({
    required: t('profile.errors.nameRequired'),
    tooLong: t('profile.errors.nameTooLong'),
  });

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(schema),
    // `values` (not `defaultValues`) so the field tracks the live session name.
    values: { name: user?.name ?? '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setErrorMessage('');
    const result = await authClient.updateUser({ name: values.name.trim() });
    if (result.error) {
      setErrorMessage(t('profile.errors.saveFailed'));
      return;
    }
    toast.success(t('profile.saved'));
  });

  if (!user) return null;

  const name = user.name;
  const memberSince = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
  }).format(new Date(user.createdAt));

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl">{t('profile.title')}</CardTitle>
        <p className="text-muted-foreground text-sm">{t('profile.subtitle')}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex items-center gap-4">
          <Avatar size="lg">
            {user.image ? (
              <AvatarImage src={user.image} alt={t('profile.avatarAlt')} />
            ) : null}
            <AvatarFallback>{initialsFor(name, user.email)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-foreground truncate text-base font-semibold">
              {name || user.email}
            </span>
            <span className="text-muted-foreground truncate text-sm">{user.email}</span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{user.role}</Badge>
              <StatusChip tone={user.emailVerified ? 'success' : 'warning'} dot>
                {user.emailVerified ? t('profile.verified') : t('profile.unverified')}
              </StatusChip>
            </div>
          </div>
        </div>

        <p className="text-muted-foreground text-sm">
          {t('profile.memberSince', { date: memberSince })}
        </p>

        <Separator />

        <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
          {errorMessage ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="account-display-name">{t('profile.displayNameLabel')}</Label>
            <Input
              id="account-display-name"
              autoComplete="name"
              aria-invalid={!!errors.name}
              {...register('name')}
            />
            {errors.name ? (
              <p className="text-destructive text-sm">{errors.name.message}</p>
            ) : null}
            <p className="text-muted-foreground text-sm">{t('profile.displayNameHint')}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="account-email">{t('profile.emailLabel')}</Label>
            <Input id="account-email" type="email" value={user.email} readOnly aria-readonly="true" />
          </div>

          <Button
            type="submit"
            loading={isSubmitting}
            loadingLabel={t('profile.saving')}
            className="w-fit"
          >
            {t('profile.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
