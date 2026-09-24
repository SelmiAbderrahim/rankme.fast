import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Minus } from 'lucide-react';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Label } from '@shared/ui/label';
import { Skeleton } from '@shared/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shared/ui/alert-dialog';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { appHref } from '@shared/navigation/appHref';
import {
  connectGoogle,
  disconnectGoogle,
  loadConnection,
  pollConnection,
  revokeGoogle,
  setGoogleProperty,
} from '../store/thunks';
import { setConnectError } from '../store/slice';
import { DocsLink } from '@shared/docs/DocsLink';
import { GSC_SCOPE, hasGa4Scope, hasGscScope } from '../lib/googleScopes';
import {
  GOOGLE_ERROR_QUERY_KEY,
  GOOGLE_LINKED_QUERY_KEY,
  startGoogleLink,
} from '../lib/googleLink';
import {
  selectGoogleConnectError,
  selectGoogleConnecting,
  selectGoogleConnection,
  selectGoogleConnectionSiteId,
  selectGoogleDisconnectError,
  selectGoogleDisconnecting,
  selectGoogleError,
  selectGoogleLoaded,
  selectGoogleLoading,
  selectGoogleMessage,
  selectGoogleProperties,
  selectGoogleSettingProperty,
  selectGoogleSetPropertyError,
  selectGoogleRevokeError,
  selectGoogleRevoking,
} from '../store/selectors';

const RECONNECT_QUERY_KEY = GOOGLE_LINKED_QUERY_KEY;
const ERROR_QUERY_KEY = GOOGLE_ERROR_QUERY_KEY;

/** Monochrome Google mark — matches the pattern in features/auth/components/SocialAuth.tsx. */
const GoogleMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="currentColor">
    <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
  </svg>
);

const formatDate = (iso: string, locale: string): string => {
  /* c8 ignore start -- Intl.DateTimeFormat only throws on unsupported locale tags; every locale used by the app is a valid BCP-47 tag. */
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso;
  }
  /* c8 ignore stop */
};

export interface GoogleConnectionCardProps {
  siteId: string;
}

export const GoogleConnectionCard = ({ siteId }: GoogleConnectionCardProps) => {
  const { t, i18n } = useTranslation('google');
  const dispatch = useAppDispatch();
  const connection = useAppSelector(selectGoogleConnection);
  const connectionSiteId = useAppSelector(selectGoogleConnectionSiteId);
  const loading = useAppSelector(selectGoogleLoading);
  const loaded = useAppSelector(selectGoogleLoaded);
  const error = useAppSelector(selectGoogleError);
  const connecting = useAppSelector(selectGoogleConnecting);
  const connectError = useAppSelector(selectGoogleConnectError);
  const disconnecting = useAppSelector(selectGoogleDisconnecting);
  const disconnectError = useAppSelector(selectGoogleDisconnectError);
  const message = useAppSelector(selectGoogleMessage);
  const properties = useAppSelector(selectGoogleProperties);
  const settingProperty = useAppSelector(selectGoogleSettingProperty);
  const setPropertyError = useAppSelector(selectGoogleSetPropertyError);
  const revoking = useAppSelector(selectGoogleRevoking);
  const revokeError = useAppSelector(selectGoogleRevokeError);

  useEffect(() => {
    if ((connectionSiteId !== siteId || !loaded) && !loading) {
      void dispatch(loadConnection(siteId));
    }
  }, [connectionSiteId, dispatch, loaded, loading, siteId]);

  useEffect(() => {
    const pending = [connection?.gscStatus, connection?.ga4Status].some(
      (status) => status === 'queued' || status === 'matching',
    );
    if (connectionSiteId !== siteId || !pending) return;
    const timeout = window.setTimeout(() => {
      void dispatch(pollConnection(siteId));
    }, 2_500);
    return () => window.clearTimeout(timeout);
  }, [connection, connectionSiteId, dispatch, siteId]);

  /**
   * After Better Auth redirects back with `?google_linked=1`, the refresh
   * token lives in the Better Auth account table. The server-side
   * complete endpoint reads it from there — the client just triggers the
   * upsert with placeholder fields (the server treats them as hints and
   * consults its own account record for the source of truth).
   */
  useEffect(() => {
    /* c8 ignore start -- guard for SSR; the callback effect never runs on the server since the whole card is CSR-only. */
    if (typeof window === 'undefined') {
      return;
    }
    /* c8 ignore stop */
    const params = new URLSearchParams(window.location.search);
    if (params.get(RECONNECT_QUERY_KEY) !== '1') return;
    // The server resolves the refresh token + email from the Better Auth
    // account row — the client just triggers the upsert with the GSC scope.
    void dispatch(connectGoogle({ siteId, scopes: [GSC_SCOPE] })).then((result) => {
      if (connectGoogle.fulfilled.match(result)) {
        params.delete(RECONNECT_QUERY_KEY);
        const search = params.toString();
        const url = `${window.location.pathname}${search ? `?${search}` : ''}`;
        window.history.replaceState(null, '', url);
      }
    });
  }, [dispatch, siteId]);

  /**
   * Better Auth redirects here with `?google_error=1` when the link OAuth
   * fails or is short-circuited (e.g. the user picked a different Google
   * account than the one they signed in with). Surface a clear error instead
   * of a silent bounce back to the connect card.
   */
  useEffect(() => {
    /* c8 ignore start -- guard for SSR; the callback effect never runs on the server since the whole card is CSR-only. */
    if (typeof window === 'undefined') {
      return;
    }
    /* c8 ignore stop */
    const params = new URLSearchParams(window.location.search);
    if (params.get(ERROR_QUERY_KEY) !== '1') return;
    dispatch(setConnectError(t('errors.linkFailed')));
    params.delete(ERROR_QUERY_KEY);
    const search = params.toString();
    const url = `${window.location.pathname}${search ? `?${search}` : ''}`;
    window.history.replaceState(null, '', url);
  }, [dispatch, t]);

  const startLink = useCallback(async () => {
    const googlePath = `/sites/${siteId}?tab=google`;
    const { error: linkError } = await startGoogleLink({
      scopes: [GSC_SCOPE],
      callbackURL: appHref(`${googlePath}&${RECONNECT_QUERY_KEY}=1`),
      errorCallbackURL: appHref(`${googlePath}&${ERROR_QUERY_KEY}=1`),
    });
    if (linkError) {
      // Surface the linkSocial failure directly — no server round-trip needed.
      dispatch(setConnectError(t('errors.unavailable')));
    }
  }, [dispatch, siteId, t]);

  if (loading || !loaded || connectionSiteId !== siteId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('connect.title')}</CardTitle>
          <CardDescription>{t('connect.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div aria-busy="true" aria-live="polite" className="flex flex-col gap-3">
            <Skeleton className="h-4 w-2/3" data-testid="google-skeleton" />
            <Skeleton className="h-9 w-40" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('connect.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
          <Button
            variant="outline"
            onClick={() => void dispatch(loadConnection(siteId))}
            disabled={loading}
          >
            {t('connect.cta')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!connection) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('connect.title')}</CardTitle>
          <CardDescription>{t('connect.description')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => void startLink()}
            loading={connecting}
            loadingLabel={t('connect.connecting')}
          >
            <GoogleMark />
            {t('connect.cta')}
          </Button>
          <p className="text-muted-foreground text-xs">{t('connect.scopeNote')}</p>
          <DocsLink slug="google-search-console" />
          {connectError ? (
            <p role="alert" className="text-destructive text-sm">
              {connectError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (connection.status === 'needs_reconnect' || connection.status === 'revoked') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.title')}</CardTitle>
          <CardDescription>{t('settings.subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertTitle>{t('needsReconnect.title')}</AlertTitle>
            <AlertDescription>{t('needsReconnect.body')}</AlertDescription>
          </Alert>
          <Button
            type="button"
            variant="outline"
            onClick={() => void startLink()}
            loading={connecting}
            loadingLabel={t('connect.connecting')}
          >
            <GoogleMark />
            {t('needsReconnect.cta')}
          </Button>
          {connectError ? (
            <p role="alert" className="text-destructive text-sm">
              {connectError}
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  const connectedDate = formatDate(connection.connectedAt, i18n.language);
  const lastUsedLabel = connection.lastUsedAt
    ? t('connected.lastUsedAt', { date: formatDate(connection.lastUsedAt, i18n.language) })
    : t('connected.lastUsedNever');
  const gscGranted = hasGscScope(connection);
  const ga4Granted = hasGa4Scope(connection);
  const gscMatchStatus = connection.gscStatus;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('connected.title')}</CardTitle>
        <CardDescription>{t('connected.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground">{t('connected.emailLabel')}</p>
          <p className="text-foreground font-medium">{connection.googleAccountEmail}</p>
        </div>
        {/* Compact scopes row — icon shape (Check vs Minus) + sr-only text
            carry the state, never color alone. */}
        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground">{t('scopes.label')}</p>
          <div
            className="flex flex-wrap items-center gap-x-4 gap-y-1"
            data-testid="google-scopes-row"
          >
            <span
              className="inline-flex items-center gap-1.5"
              data-testid="google-scope-gsc"
              data-granted={gscGranted ? 'true' : 'false'}
            >
              {gscGranted ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Minus aria-hidden="true" className="text-muted-foreground size-4" />
              )}
              <span>{t('scopes.searchConsole')}</span>
              <span className="sr-only">
                {gscGranted ? t('scopes.granted') : t('scopes.notGranted')}
              </span>
            </span>
            <span
              className="inline-flex items-center gap-1.5"
              data-testid="google-scope-ga4"
              data-granted={ga4Granted ? 'true' : 'false'}
            >
              {ga4Granted ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Minus aria-hidden="true" className="text-muted-foreground size-4" />
              )}
              <span>{t('scopes.analytics')}</span>
              <span className="sr-only">
                {ga4Granted ? t('scopes.granted') : t('scopes.notGranted')}
              </span>
            </span>
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <Label htmlFor="gsc-property" className="text-muted-foreground">
            {t('connected.propertyLabel')}
          </Label>
          {gscMatchStatus && gscMatchStatus !== 'bound' && gscMatchStatus !== 'unbound' ? (
            <p className="text-muted-foreground text-xs" role="status">
              {t(`autoMatch.${gscMatchStatus}`)}
            </p>
          ) : null}
          {properties.length > 0 ? (
            <Select
              value={connection.propertyUrl ?? undefined}
              disabled={settingProperty}
              onValueChange={(value) => {
                if (value !== connection.propertyUrl) {
                  void dispatch(setGoogleProperty({ siteId, propertyUrl: value }));
                }
              }}
            >
              <SelectTrigger id="gsc-property" className="w-full sm:w-96" aria-busy={settingProperty}>
                <SelectValue placeholder={t('connected.propertyPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {properties.map((property) => (
                  <SelectItem key={property.siteUrl} value={property.siteUrl}>
                    {property.siteUrl}
                    {property.inUseBy?.length
                      ? ` — ${property.inUseBy.map((used) => used.displayName || used.domain).join(', ')}`
                      : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-foreground font-medium">
              {connection.propertyUrl ?? t('connected.propertyMissing')}
            </p>
          )}
          {setPropertyError ? (
            <p role="alert" className="text-destructive text-sm">
              {setPropertyError}
            </p>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">
          {t('connected.connectedAt', { date: connectedDate })}
          {' · '}
          {lastUsedLabel}
        </p>
        {message ? (
          <p className="text-muted-foreground text-sm" role="status">
            {message === 'site_unlinked' ? t('disconnect.siteUnlinked') : message}
          </p>
        ) : null}
        {disconnectError ? (
          <p role="alert" className="text-destructive text-sm">
            {disconnectError}
          </p>
        ) : null}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" className="text-destructive" disabled={disconnecting}>
              {t('connected.disconnect')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('disconnect.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('disconnect.confirmBody')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('disconnect.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  void dispatch(disconnectGoogle(siteId));
                }}
              >
                {t('disconnect.confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" className="text-destructive" disabled={revoking}>
              {t('revoke.cta')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('revoke.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('revoke.confirmBody', {
                  count: connection.connectedSiteCount ?? 0,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('disconnect.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void dispatch(revokeGoogle(siteId))}
              >
                {t('revoke.confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {revokeError ? (
          <p role="alert" className="text-destructive text-sm">
            {revokeError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
};
