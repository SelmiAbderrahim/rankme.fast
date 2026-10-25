import { useCallback, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Monitor } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@shared/ui/alert-dialog';
import { RelativeTime } from '@shared/components/RelativeTime';
import { isolateText } from '@shared/lib/bidi';
import { authClient } from '../authClient';
import { parseUserAgent } from '../userAgent';
import { SessionReauth } from './SessionReauth';
import type { AuthClientError } from '../errorMessage';

interface SessionRow {
  id: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
}

const revokeSessionById = (sessionId: string) => authClient.$fetch<{ status: boolean }>('/revoke-session', {
  method: 'POST', body: { sessionId },
});

/**
 * `/settings/security` — active-session (device) list + revoke panel.
 *
 * Better Auth owns the session list and revocation. The current device is
 * identified by session id and cannot revoke itself from this panel.
 */
export const ActiveSessions = ({ hasPassword = true }: { hasPassword?: boolean } = {}) => {
  const { t } = useTranslation(['auth', 'common']);
  const { data: sessionData } = authClient.useSession();
  const currentId = sessionData?.session.id ?? '';
  const email = sessionData?.user.email ?? '';

  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loadError, setLoadError] = useState<AuthClientError | null>(null);
  const [actionError, setActionError] = useState<AuthClientError | null>(null);
  const [busyId, setBusyId] = useState('');
  const [revokingAll, setRevokingAll] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<SessionRow | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const revokeTrigger = useRef<HTMLButtonElement | null>(null);
  const listHeading = useRef<HTMLHeadingElement | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setSessions(null);
    try {
      const { data, error } = await authClient.listSessions();
      if (error || !data) {
        setLoadError(error ?? {});
        return;
      }
      setSessions(data as SessionRow[]);
    } catch {
      setLoadError({});
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    setActionError(null);
    setBusyId(id);
    try {
      const { error } = await revokeSessionById(id);
      if (error) setActionError(error);
      else await load();
    } catch {
      setActionError({});
    } finally {
      setBusyId('');
      setConfirmOpen(false);
    }
  };

  const revokeOthers = async () => {
    setActionError(null);
    setRevokingAll(true);
    try {
      const { error } = await authClient.revokeOtherSessions();
      if (error) setActionError(error);
      else await load();
    } catch {
      setActionError({});
    } finally {
      setRevokingAll(false);
    }
  };

  const deviceLabel = (userAgent: string | null | undefined): string => {
    if (!userAgent) return t('security.sessions.unknownDevice');
    const { browser, os } = parseUserAgent(userAgent);
    if (browser && os) return t('security.sessions.device', { browser, os });
    const known = browser ?? os;
    if (known) return known;
    return t('security.sessions.unknownDevice');
  };

  /** The stored time is refreshed about once a day, so other devices read by calendar day. */
  const lastActiveAt = (s: SessionRow): string | number | null => {
    const raw = s.updatedAt ?? s.createdAt;
    if (raw === undefined || raw === null) return null;
    return Number.isNaN(new Date(raw).getTime()) ? null : (raw as string | number);
  };

  const others = (sessions ?? []).filter((s) => s.id !== currentId);
  const needsReauth = loadError?.code === 'SESSION_NOT_FRESH' || actionError?.code === 'SESSION_NOT_FRESH';
  const afterReauth = async () => {
    const previousId = currentId;
    setActionError(null);
    if (previousId) await revokeSessionById(previousId).catch(() => undefined);
    await load();
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl"><h2 ref={listHeading} tabIndex={-1}>{t('security.sessions.title')}</h2></CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{t('security.sessions.description')}</p>

          {actionError && !needsReauth ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{t('security.sessions.revokeError')}</AlertDescription>
            </Alert>
          ) : null}

          {needsReauth ? (
            <SessionReauth email={email} hasPassword={hasPassword} onConfirmed={afterReauth} />
          ) : loadError ? (
            <div className="flex flex-col gap-2">
              <Alert variant="destructive" role="alert">
                <AlertDescription>{t('security.sessions.loadError')}</AlertDescription>
              </Alert>
              {(!loadError.status || loadError.status >= 500) ? <Button type="button" variant="outline" onClick={() => void load()}>
                {t('security.sessions.retry')}
              </Button> : null}
            </div>
          ) : sessions === null ? (
            <div className="flex flex-col gap-2" data-testid="sessions-loading">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {sessions.map((s) => {
                const isCurrent = s.id === currentId;
                const activeAt = lastActiveAt(s);
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="flex items-start gap-2">
                      <Monitor className="text-muted-foreground mt-0.5 size-4" aria-hidden />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {deviceLabel(s.userAgent)}
                        </span>
                        {s.ipAddress ? (
                          <span className="text-muted-foreground text-xs">
                            {t('security.sessions.ip', { ip: isolateText(s.ipAddress) })}
                          </span>
                        ) : null}
                        {isCurrent || activeAt !== null ? (
                          <span className="text-muted-foreground text-xs" data-testid="session-last-active">
                            {isCurrent ? (
                              t('security.sessions.activeNow')
                            ) : (
                              <Trans
                                t={t}
                                i18nKey="security.sessions.lastActive"
                                components={{ when: <RelativeTime value={activeAt!} granularity="day" /> }}
                              />
                            )}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {isCurrent ? (
                      <Badge variant="secondary">{t('security.sessions.current')}</Badge>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyId === s.id}
                        onClick={(event) => { revokeTrigger.current = event.currentTarget; setConfirmTarget(s); setConfirmOpen(true); }}
                      >
                        {busyId === s.id
                          ? t('security.sessions.revoking')
                          : t('security.sessions.revoke')}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {sessions !== null && !loadError && others.length === 0 ? (
            <Empty className="w-full">
              <EmptyHeader>
                <EmptyTitle>{t('security.sessions.emptyTitle')}</EmptyTitle>
                <EmptyDescription>{t('security.sessions.empty')}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}

          {others.length > 0 && !needsReauth ? (
            <Button
              type="button"
              variant="outline"
              disabled={revokingAll}
              onClick={() => void revokeOthers()}
            >
              {revokingAll
                ? t('security.sessions.revokingAll')
                : t('security.sessions.revokeAll')}
            </Button>
          ) : null}
        </div>
        {confirmTarget ? <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!busyId) setConfirmOpen(open); }}>
          <AlertDialogContent onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (revokeTrigger.current?.isConnected) revokeTrigger.current.focus();
            else listHeading.current?.focus();
          }}>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('security.sessions.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('security.sessions.confirmDescription', {
                device: isolateText(deviceLabel(confirmTarget.userAgent)),
              })}</AlertDialogDescription>
            </AlertDialogHeader>
            {confirmTarget.ipAddress ? <p className="text-muted-foreground text-sm">{t('security.sessions.ip', { ip: isolateText(confirmTarget.ipAddress) })}</p> : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busyId !== ''}>{t('common:cancel')}</AlertDialogCancel>
              <Button type="button" variant="destructive" loading={busyId !== ''}
                loadingLabel={t('security.sessions.revoking')}
                onClick={() => void revoke(confirmTarget.id)}>{t('security.sessions.confirm')}</Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog> : null}
      </CardContent>
    </Card>
  );
};
