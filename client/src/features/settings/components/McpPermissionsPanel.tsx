import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  loadSites,
  selectSites,
  selectSitesError,
  selectSitesLoaded,
  selectSitesLoading,
} from '@features/sites';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { clearMcpPermissionsMessages } from '../store/mcpPermissionsSlice';
import {
  selectMcpPermissions,
  selectMcpPermissionsLoadError,
  selectMcpPermissionsLoaded,
  selectMcpPermissionsLoading,
  selectMcpPermissionsSaved,
  selectMcpPermissionsSaveError,
  selectMcpPermissionsSaving,
} from '../store/mcpPermissionsSelectors';
import { loadMcpPermissions, saveMcpPermissions } from '../store/mcpPermissionsThunks';
import type { McpPermissionSettings } from '../types';
import { McpQuickStart } from './McpQuickStart';
import { McpScopeFields } from './McpScopeFields';

function McpPermissionsLoading() {
  const { t } = useTranslation('settings');
  return (
    <Card role="status" aria-label={t('mcp.loading')}>
      <CardHeader>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-3/4" />
      </CardContent>
    </Card>
  );
}

/** Account-level defaults shared by bearer MCP calls and Assistant tools. */
export function McpPermissionsPanel() {
  const { t } = useTranslation('settings');
  const dispatch = useAppDispatch();
  const settings = useAppSelector(selectMcpPermissions);
  const loading = useAppSelector(selectMcpPermissionsLoading);
  const loaded = useAppSelector(selectMcpPermissionsLoaded);
  const loadError = useAppSelector(selectMcpPermissionsLoadError);
  const saving = useAppSelector(selectMcpPermissionsSaving);
  const saveError = useAppSelector(selectMcpPermissionsSaveError);
  const saved = useAppSelector(selectMcpPermissionsSaved);
  const sites = useAppSelector(selectSites);
  const sitesLoaded = useAppSelector(selectSitesLoaded);
  const sitesLoading = useAppSelector(selectSitesLoading);
  const sitesError = useAppSelector(selectSitesError);
  const [draft, setDraft] = useState<McpPermissionSettings>(settings);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!loaded && !loading) void dispatch(loadMcpPermissions());
  }, [dispatch, loaded, loading]);

  useEffect(() => {
    if (!sitesLoaded && !sitesLoading && !sitesError) {
      void dispatch(loadSites({}));
    }
  }, [dispatch, sitesError, sitesLoaded, sitesLoading]);

  useEffect(() => {
    setDraft(settings);
    setDirty(false);
  }, [settings]);

  const changeDraft = (next: McpPermissionSettings) => {
    dispatch(clearMcpPermissionsMessages());
    setDraft(next);
    setDirty(true);
  };

  const save = async () => {
    const action = await dispatch(saveMcpPermissions(draft));
    if (saveMcpPermissions.fulfilled.match(action)) setDirty(false);
  };

  if (!loaded) {
    return <McpPermissionsLoading />;
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>{t('mcp.title')}</h2>
            </CardTitle>
            <CardDescription>{t('mcp.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {loadError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{loadError}</AlertDescription>
              </Alert>
            ) : null}
            {saveError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            ) : null}
            {sitesError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{t('mcp.errors.sitesFailed')}</AlertDescription>
              </Alert>
            ) : null}
            {saved && !dirty ? (
              <Alert role="status">
                <ShieldCheck aria-hidden="true" />
                <AlertDescription>{t('mcp.saved')}</AlertDescription>
              </Alert>
            ) : null}

            {loadError ? (
              <Button
                type="button"
                variant="outline"
                loading={loading}
                loadingLabel={t('mcp.loading')}
                onClick={() => void dispatch(loadMcpPermissions())}
              >
                {t('mcp.retry')}
              </Button>
            ) : (
              <McpScopeFields
                idPrefix="account-mcp"
                value={draft}
                sites={sites}
                control="switch"
                disabled={saving}
                onChange={changeDraft}
              />
            )}
          </CardContent>
          {!loadError ? (
            <CardFooter>
              <Button
                type="submit"
                disabled={!dirty}
                loading={saving}
                loadingLabel={t('mcp.saving')}
              >
                {t('mcp.save')}
              </Button>
            </CardFooter>
          ) : null}
        </Card>
      </form>

      <McpQuickStart />
    </div>
  );
}
