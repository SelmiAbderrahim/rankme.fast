import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@shared/components/PageHeader';
import { Button } from '@shared/ui/button';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Skeleton } from '@shared/ui/skeleton';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@shared/ui/empty';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { loadSites, removeSite } from '../store/thunks';
import {
  selectCursorStack,
  selectDeleteSiteError,
  selectDeletingSiteId,
  selectNextCursor,
  selectSites,
  selectSitesError,
  selectSitesLoaded,
  selectSitesLoading,
} from '../store/selectors';
import { AddSiteForm } from './AddSiteForm';
import { AddSiteDialog } from './AddSiteDialog';
import { SitesTable } from './SitesTable';
import type { Site } from '../types';
import { getSiteTabLabelKey, isSiteTab, type SiteTab } from '../tabState';
import { useSiteSummaries } from '../useSiteSummaries';

export const SitesPage = () => {
  const { t } = useTranslation('sites');
  const location = useLocation();
  const requestedTool = new URLSearchParams(location.search).get('open');
  const openTab: SiteTab | undefined = isSiteTab(requestedTool) && requestedTool !== 'overview' ? requestedTool : undefined;
  const dispatch = useAppDispatch();
  const sites = useAppSelector(selectSites);
  const siteIds = useMemo(() => sites.map((site) => site.id), [sites]);
  const summaries = useSiteSummaries(siteIds);
  const loading = useAppSelector(selectSitesLoading);
  const loaded = useAppSelector(selectSitesLoaded);
  const error = useAppSelector(selectSitesError);
  const nextCursor = useAppSelector(selectNextCursor);
  const cursorStack = useAppSelector(selectCursorStack);
  const deletingId = useAppSelector(selectDeletingSiteId);
  const deleteError = useAppSelector(selectDeleteSiteError);
  useEffect(() => {
    if (!loaded && !loading) {
      void dispatch(loadSites({ direction: 'initial' }));
    }
  }, [dispatch, loaded, loading]);

  const handleDelete = async (site: Site) => {
    const result = await dispatch(removeSite(site.id));
    if (removeSite.fulfilled.match(result)) {
      await dispatch(loadSites({ direction: 'initial' }));
    }
  };

  const goNext = () => {
    void dispatch(loadSites({ cursor: nextCursor, direction: 'next' }));
  };

  const goPrevious = () => {
    const cursor = cursorStack[cursorStack.length - 1] ?? null;
    void dispatch(loadSites({ cursor, direction: 'prev' }));
  };

  if (!loaded) {
    return (
      <div className="flex flex-col gap-6 px-4 py-8" aria-busy="true" aria-live="polite">
        <PageHeader
          icon={APP_PAGE_ICONS.sites}
          title={t('title')}
          description={t('listDescription')}
        />
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" data-testid="sites-skeleton" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6 px-4 py-8">
        <PageHeader
          icon={APP_PAGE_ICONS.sites}
          title={t('title')}
          description={t('listDescription')}
        />
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          className="self-start"
          onClick={() => void dispatch(loadSites({ direction: 'initial', force: true }))}
        >
          {t('retry')}
        </Button>
      </div>
    );
  }

  if (sites.length === 0) {
    return (
      <div className="flex flex-col gap-6 px-4 py-8">
        <PageHeader
          icon={APP_PAGE_ICONS.sites}
          title={t('title')}
          description={t('listDescription')}
        />
        <div className="flex flex-col items-center gap-6">
          <Empty className="w-full max-w-md">
            <EmptyHeader>
              <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
          <AddSiteForm />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-8">
      <PageHeader
        icon={APP_PAGE_ICONS.sites}
        title={t('title')}
        description={t('listDescription')}
        actions={<AddSiteDialog />}
      />
      {openTab ? <Alert role="status" data-testid="sites-open-tab-hint"><AlertDescription>
        {t('openTabHint', { tab: t(getSiteTabLabelKey(openTab)) })}
      </AlertDescription></Alert> : null}
      {deleteError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{deleteError}</AlertDescription>
        </Alert>
      ) : null}
      <SitesTable sites={sites} deletingId={deletingId} onDelete={handleDelete} openTab={openTab} summaries={summaries} />
      {/* One page needs no pager: the controls appear only when there is a
          page to go to or come back from. */}
      {cursorStack.length > 0 || nextCursor !== null ? (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={loading || cursorStack.length === 0}
            onClick={goPrevious}
          >
            {t('previous')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || nextCursor === null}
            onClick={goNext}
          >
            {t('next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
