import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '@shared/components/PageHeader';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Switch } from '@shared/ui/switch';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Skeleton } from '@shared/ui/skeleton';
import {
  loadNotificationPreferences,
  toggleNotificationPreference,
} from '../store/thunks';
import { clearSettingsMessages, settingsReducer } from '../store/slice';
import {
  selectNotificationPreferences,
  selectNotificationsLoadError,
  selectNotificationsLoaded,
  selectNotificationsLoading,
  selectNotificationsSaveError,
} from '../store/selectors';
import { NOTIFICATION_CHANNELS, type NotificationChannel } from '../types';

// Silence tree-shake dead-code by referencing the reducer type; the actual
// registration lives in @app/store.
void settingsReducer;

/**
 * `/settings/notifications` — four toggles for the non-transactional email
 * channels. Security email (password reset, verification, password change)
 * is not listed here because it cannot be disabled.
 */
export const NotificationPreferences = () => {
  const { t } = useTranslation(['settings', 'common']);
  const dispatch = useAppDispatch();
  const preferences = useAppSelector(selectNotificationPreferences);
  const loading = useAppSelector(selectNotificationsLoading);
  const loaded = useAppSelector(selectNotificationsLoaded);
  const loadError = useAppSelector(selectNotificationsLoadError);
  const saveError = useAppSelector(selectNotificationsSaveError);

  useEffect(() => {
    if (!loaded && !loading) {
      void dispatch(loadNotificationPreferences());
    }
  }, [dispatch, loaded, loading]);

  useEffect(() => {
    if (saveError) toast.error(saveError);
  }, [saveError]);

  const handleToggle = (channel: NotificationChannel, value: boolean) => {
    dispatch(clearSettingsMessages());
    void dispatch(toggleNotificationPreference({ channel, value }));
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-6">
      <PageHeader
        icon={APP_PAGE_ICONS.notifications}
        title={t('settings:notifications.title')}
        description={t('settings:notifications.description')}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t('settings:notifications.emailHeading')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <Alert variant="destructive" role="alert" className="mb-4">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : null}

          {loading && !preferences ? (
            <div
              className="flex flex-col gap-4"
              aria-busy="true"
              aria-label={t('settings:notifications.loading')}
              data-testid="notification-preferences-skeleton"
            >
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ) : preferences ? (
            <ul className="flex flex-col gap-4">
              {NOTIFICATION_CHANNELS.map((channel) => {
                const inputId = `notif-${channel}`;
                return (
                  <li
                    key={channel}
                    className="flex items-start justify-between gap-4 rounded-md border border-border px-4 py-3"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <Label htmlFor={inputId} className="text-sm font-medium">
                        {t(`settings:notifications.channels.${channel}.label`)}
                      </Label>
                      <p className="text-muted-foreground text-sm">
                        {t(`settings:notifications.channels.${channel}.description`)}
                      </p>
                    </div>
                    <Switch
                      id={inputId}
                      aria-label={t(`settings:notifications.channels.${channel}.label`)}
                      checked={preferences[channel]}
                      onCheckedChange={(next) => handleToggle(channel, next)}
                    />
                  </li>
                );
              })}
            </ul>
          ) : null}

          <p className="text-muted-foreground mt-6 text-sm">
            {t('settings:notifications.securityNote')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
