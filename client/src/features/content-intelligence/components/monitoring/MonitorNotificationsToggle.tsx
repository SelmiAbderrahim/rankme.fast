import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Switch } from '@shared/ui/switch';
import { Label } from '@shared/ui/label';
import { Skeleton } from '@shared/ui/skeleton';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  loadMonitorNotificationPref,
  updateMonitorNotificationPref,
} from '../../store/thunks';
import {
  selectMonitorNotificationError,
  selectMonitorNotificationLoading,
  selectMonitorNotificationPref,
  selectMonitorNotificationSaving,
} from '../../store/selectors';

/**
 * `emailMonitorChange` opt-out toggle for material-change alerts. Reads and
 * writes the shared `/users/notifications` preference endpoint scoped to the
 * one channel this sub-view owns — the full settings surface still governs
 * every other channel.
 */
export function MonitorNotificationsToggle() {
  const { t } = useTranslation('contentIntelligence');
  const dispatch = useAppDispatch();
  const pref = useAppSelector(selectMonitorNotificationPref);
  const loading = useAppSelector(selectMonitorNotificationLoading);
  const saving = useAppSelector(selectMonitorNotificationSaving);
  const error = useAppSelector(selectMonitorNotificationError);

  useEffect(() => {
    const promise = dispatch(loadMonitorNotificationPref());
    return () => promise.abort();
  }, [dispatch]);

  const onToggle = (next: boolean) => {
    void dispatch(updateMonitorNotificationPref({ value: next }));
  };

  return (
    <Card data-testid="monitor-notifications">
      <CardHeader>
        <CardTitle>{t('monitoring.notifications.title')}</CardTitle>
        <CardDescription>{t('monitoring.notifications.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <Alert variant="destructive" role="alert" data-testid="monitor-notifications-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {loading && pref === null ? (
          <Skeleton className="h-8 w-2/3" data-testid="monitor-notifications-skeleton" />
        ) : (
          <div className="border-border flex items-center justify-between gap-4 rounded-md border px-4 py-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="monitor-notify-toggle" className="text-sm font-medium">
                {t('monitoring.notifications.label')}
              </Label>
              <p className="text-muted-foreground text-sm">
                {t('monitoring.notifications.hint')}
              </p>
            </div>
            <Switch
              id="monitor-notify-toggle"
              aria-label={t('monitoring.notifications.label')}
              checked={pref === true}
              disabled={saving}
              onCheckedChange={onToggle}
              data-testid="monitor-notifications-switch"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
