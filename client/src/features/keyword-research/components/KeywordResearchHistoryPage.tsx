/**
 * Per-account keyword-research history (`/keyword-research/history`).
 *
 * data-testid contract:
 *   - keyword-research-history-page       root
 *   - keyword-research-history-loading    initial loading skeleton
 *   - keyword-research-history-error      load-failure alert
 *   - keyword-research-history-empty      empty state
 *   - keyword-research-history-table      results table
 *   - keyword-research-history-row-<id>   one per history entry
 *   - keyword-research-history-search-again-<id>  prefill deep link per row
 *   - keyword-research-history-load-more  cursor pagination button
 *   - keyword-research-history-back       back link to /keyword-research
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@shared/components/PageHeader';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { loadHistory } from '../store/thunks';
import {
  selectHistory,
  selectHistoryCursor,
  selectHistoryError,
  selectHistoryLoaded,
  selectHistoryLoading,
} from '../store/selectors';
import { buildSearchAgainUrl } from '../validation';
import { ResearchHistoryTable } from './ResearchHistoryTable';

// Re-exported so existing imports (tests + external consumers) keep resolving
// after the label helpers moved into the shared table component.
export { locationLabel, languageLabel } from './ResearchHistoryTable';

export const KeywordResearchHistoryPage = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const items = useAppSelector(selectHistory);
  const loading = useAppSelector(selectHistoryLoading);
  const loaded = useAppSelector(selectHistoryLoaded);
  const error = useAppSelector(selectHistoryError);
  const cursor = useAppSelector(selectHistoryCursor);

  useEffect(() => {
    // History is an un-metered Postgres read, so refetch page 1 on every mount —
    // a fresh visit must reflect searches recorded since the last visit.
    void dispatch(loadHistory({}));
  }, [dispatch]);

  const showEmpty = loaded && !loading && !error && items.length === 0;

  return (
    <div
      className="flex flex-col gap-6 px-4 py-8"
      data-testid="keyword-research-history-page"
    >
      <PageHeader
        icon={APP_PAGE_ICONS.keywordHistory}
        title={t('keywordResearch:history.title')}
        description={t('keywordResearch:history.description')}
        actions={<Button variant="outline" asChild>
          <Link to="/keyword-research" data-testid="keyword-research-history-back">
            <ArrowLeft className="me-1 h-4 w-4 rtl:rotate-180" aria-hidden="true" />
            {t('keywordResearch:history.back')}
          </Link>
        </Button>}
      />

      {error ? (
        <Alert
          variant="destructive"
          role="alert"
          data-testid="keyword-research-history-error"
        >
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading && items.length === 0 ? (
        <div
          className="flex flex-col gap-2"
          aria-busy="true"
          aria-live="polite"
          data-testid="keyword-research-history-loading"
        >
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : null}

      {showEmpty ? (
        <p
          className="text-muted-foreground text-sm"
          data-testid="keyword-research-history-empty"
        >
          {t('keywordResearch:history.empty')}
        </p>
      ) : null}

      {items.length > 0 ? (
        <ResearchHistoryTable
          items={items}
          onSearchAgain={(item) => navigate(buildSearchAgainUrl(item))}
          testIdPrefix="keyword-research-history"
        />
      ) : null}

      {cursor ? (
        <div>
          <Button
            variant="outline"
            loading={loading}
            loadingLabel={t('keywordResearch:history.loading')}
            onClick={() => void dispatch(loadHistory({ cursor }))}
            data-testid="keyword-research-history-load-more"
          >
            {t('keywordResearch:history.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
