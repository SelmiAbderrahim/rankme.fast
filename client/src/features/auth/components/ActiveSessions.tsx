import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { authClient } from '../authClient';

interface SessionRow {
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * `/settings/security` — active-session (device) list + revoke panel.
 *
 * Backed entirely by Better Auth's core session endpoints: `listSessions`,
 * `revokeSession`, `revokeOtherSessions`. The current device is matched by the
 * session token from `useSession()` and can never revoke itself (a badge, not
 * a button) so a user can't lock themselves out of the page they're on.
 */
export const ActiveSessions = () => {
  const { t } = useTranslation('auth');
  const { data: sessionData } = authClient.useSession();
  const currentToken = sessionData?.session.token ?? '';

  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState('');
  const [busyToken, setBusyToken] = useState('');
  const [revokingAll, setRevokingAll] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    setSessions(null);
    const { data, error } = await authClient.listSessions();
    if (error || !data) {
      setLoadError(true);
      return;
    }
    setSessions(data as SessionRow[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (token: string) => {
    setActionError('');
    setBusyToken(token);
    const { error } = await authClient.revokeSession({ token });
    setBusyToken('');
    if (error) {
      setActionError(t('security.sessions.revokeError'));
      return;
    }
    await load();
  };

  const revokeOthers = async () => {
    setActionError('');
    setRevokingAll(true);
    const { error } = await authClient.revokeOtherSessions();
    setRevokingAll(false);
    if (error) {
      setActionError(t('security.sessions.revokeError'));
      return;
    }
    await load();
  };

  const others = (sessions ?? []).filter((s) => s.token !== currentToken);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-xl">{t('security.sessions.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{t('security.sessions.description')}</p>

          {actionError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          ) : null}

          {loadError ? (
            <div className="flex flex-col gap-2">
              <Alert variant="destructive" role="alert">
                <AlertDescription>{t('security.sessions.loadError')}</AlertDescription>
              </Alert>
              <Button type="button" variant="outline" onClick={() => void load()}>
                {t('security.sessions.retry')}
              </Button>
            </div>
          ) : sessions === null ? (
            <div className="flex flex-col gap-2" data-testid="sessions-loading">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {sessions.map((s) => {
                const isCurrent = s.token === currentToken;
                return (
                  <li
                    key={s.token}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="flex items-start gap-2">
                      <Monitor className="text-muted-foreground mt-0.5 size-4" aria-hidden />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {s.userAgent || t('security.sessions.unknownDevice')}
                        </span>
                        {s.ipAddress ? (
                          <span className="text-muted-foreground text-xs">
                            {t('security.sessions.ip', { ip: s.ipAddress })}
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
                        disabled={busyToken === s.token}
                        onClick={() => void revoke(s.token)}
                      >
                        {busyToken === s.token
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

          {others.length > 0 ? (
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
      </CardContent>
    </Card>
  );
};
