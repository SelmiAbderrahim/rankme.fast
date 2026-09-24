/**
 * Review Intelligence workspace (`/sites/:siteId?tab=reviews`).
 *
 * data-testid contract:
 *   - reviews-panel                     root
 *   - reviews-loading                   session/first-load skeleton
 *   - reviews-kill-switch               REVIEW_INTELLIGENCE_ENABLED=false
 *   - reviews-sources / reviews-sync-form / reviews-runs
 *   - reviews-stats / reviews-trend / reviews-themes / reviews-inventory
 *
 * A RankMeFast local business profile IS the owned site, so `siteId` is the
 * `profileId` every Review Intelligence route keys on.
 */
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthSession } from '@features/auth';
import { ReportExportControl } from '@features/report-export';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Skeleton } from '@shared/ui/skeleton';
import { useI18nDirection } from '@shared/i18n/useDirection';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { DocsLink } from '@shared/docs/DocsLink';
import {
  isReviewRunId,
  normalizeReviewParams,
  readReviewFilters,
} from '../filters';
import {
  loadReviewInventory,
  loadReviewRun,
  loadReviewRuns,
  loadReviewSources,
  loadReviewStats,
  loadReviewThemes,
} from '../store/thunks';
import {
  selectReviewInventory,
  selectReviewInventoryError,
  selectReviewInventoryStatus,
  selectReviewLastSubmit,
  selectReviewPreviewError,
  selectReviewPreviewErrorKind,
  selectReviewRun,
  selectReviewRuns,
  selectReviewRunsError,
  selectReviewRunsStatus,
  selectReviewSourceMutationError,
  selectReviewSourceMutationErrorKind,
  selectReviewSources,
  selectReviewStats,
  selectReviewStatsError,
  selectReviewStatsStatus,
  selectReviewSubmitError,
  selectReviewSubmitErrorKind,
  selectReviewThemes,
  selectReviewThemesError,
  selectReviewThemesStatus,
} from '../store/selectors';
import { ReviewKillSwitchBanner } from './ReviewStatePanels';
import { ReviewInventoryTable } from './ReviewInventoryTable';
import { ReviewRunList } from './ReviewRunList';
import { ReviewSourcesPanel } from './ReviewSourcesPanel';
import { ReviewStatsCards } from './ReviewStatsCards';
import { ReviewSyncForm } from './ReviewSyncForm';
import { ReviewThemeCards } from './ReviewThemeCards';
import { ReviewTrendChart } from './ReviewTrendChart';

interface ReviewsPanelProps {
  siteId: string;
}

export const ReviewsPanel = ({ siteId }: ReviewsPanelProps) => {
  const { t, i18n } = useTranslation('reviewIntelligence');
  const direction = useI18nDirection(i18n);
  const session = useAuthSession();
  const dispatch = useAppDispatch();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readReviewFilters(params), [params]);
  const rawRunParam = params.get('run');
  const selectedRunParam = isReviewRunId(rawRunParam) ? rawRunParam : null;

  const sources = useAppSelector(selectReviewSources);
  const runs = useAppSelector(selectReviewRuns);
  const runsStatus = useAppSelector(selectReviewRunsStatus);
  const runsError = useAppSelector(selectReviewRunsError);
  const run = useAppSelector(selectReviewRun);
  const inventory = useAppSelector(selectReviewInventory);
  const inventoryStatus = useAppSelector(selectReviewInventoryStatus);
  const inventoryError = useAppSelector(selectReviewInventoryError);
  const stats = useAppSelector(selectReviewStats);
  const statsStatus = useAppSelector(selectReviewStatsStatus);
  const statsError = useAppSelector(selectReviewStatsError);
  const themes = useAppSelector(selectReviewThemes);
  const themesStatus = useAppSelector(selectReviewThemesStatus);
  const themesError = useAppSelector(selectReviewThemesError);
  const lastSubmit = useAppSelector(selectReviewLastSubmit);
  const previewError = useAppSelector(selectReviewPreviewError);
  const previewErrorKind = useAppSelector(selectReviewPreviewErrorKind);
  const submitError = useAppSelector(selectReviewSubmitError);
  const submitErrorKind = useAppSelector(selectReviewSubmitErrorKind);
  const sourceError = useAppSelector(selectReviewSourceMutationError);
  const sourceErrorKind = useAppSelector(selectReviewSourceMutationErrorKind);

  // The kill switch is a server verdict — the client never guesses it, it
  // reports the refusal the server actually returned.
  const lockedReason =
    (submitErrorKind === 'locked' ? submitError : '') ||
    (previewErrorKind === 'locked' ? previewError : '') ||
    (sourceErrorKind === 'locked' ? sourceError : '');
  const locked = Boolean(lockedReason);
  const authenticated = session.authenticated && !session.isPending;

  useEffect(() => {
    const normalized = normalizeReviewParams(params);
    if (normalized.toString() !== params.toString()) {
      setParams(normalized, { replace: true });
    }
  }, [params, setParams]);

  useEffect(() => {
    if (!authenticated) return;
    const request = dispatch(loadReviewSources(siteId));
    return () => request.abort();
  }, [authenticated, dispatch, siteId]);

  useEffect(() => {
    if (!authenticated) return;
    const request = dispatch(loadReviewRuns(siteId));
    return () => request.abort();
  }, [authenticated, dispatch, siteId, lastSubmit?.runId]);

  useEffect(() => {
    if (!authenticated) return;
    const request = dispatch(loadReviewInventory({ profileId: siteId, filters }));
    return () => request.abort();
  }, [authenticated, dispatch, filters, siteId, lastSubmit?.runId]);

  // `?run=` selects a run; absent means the newest one the list returned.
  const activeRunId = selectedRunParam ?? runs[0]?.id ?? null;

  useEffect(() => {
    if (!authenticated || !activeRunId) return;
    void dispatch(loadReviewRun(activeRunId));
    void dispatch(loadReviewStats(activeRunId));
    void dispatch(loadReviewThemes(activeRunId));
  }, [authenticated, dispatch, activeRunId]);

  if (session.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite" data-testid="reviews-loading">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!session.authenticated) {
    return (
      <Alert role="alert" data-testid="reviews-signed-out">
        <AlertDescription>{t('states.signedOut')}</AlertDescription>
      </Alert>
    );
  }

  const selectRun = (runId: string) => {
    const next = new URLSearchParams(params);
    next.set('run', runId);
    // `replace` keeps run selection out of the back-button history, matching
    // the `?tab=` contract in `.claude/rules/url-tab-state.md`.
    setParams(next, { replace: true });
  };

  return (
    <section
      className="flex flex-col gap-6"
      dir={direction}
      data-testid="reviews-panel"
      data-direction={direction}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">{t('title')}</h2>
          <p className="text-muted-foreground text-sm">{t('description')}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <ReportExportControl
            kind="local.reviews"
            target={{ scope: 'site_resource', siteId, resourceId: siteId }}
            selection={{
              ...(activeRunId ? { runId: activeRunId } : {}),
              ...(filters.src ? { source: [filters.src] } : {}),
              ...(filters.rating ? { rating: [filters.rating] } : {}),
              ...(filters.q ? { query: filters.q } : {}),
            }}
          />
          <DocsLink slug="review-intelligence" className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2" />
        </div>
      </div>

      {locked ? <ReviewKillSwitchBanner description={lockedReason} /> : null}
      <ReviewSourcesPanel profileId={siteId} disabled={locked} />
      <ReviewSyncForm
        profileId={siteId}
        disabled={locked}
        disabledReason={locked ? lockedReason : undefined}
      />

      {sources.length === 0 && runs.length === 0 ? (
        <p className="text-muted-foreground text-sm" data-testid="reviews-no-sources">
          {t('states.noSources.title')}
        </p>
      ) : null}

      {sources.length > 0 && runs.length === 0 && runsStatus === 'succeeded' ? (
        <p className="text-muted-foreground text-sm" data-testid="reviews-never-synced">
          {t('states.neverSynced.description')}
        </p>
      ) : null}

      <ReviewRunList
        runs={runs}
        status={runsStatus}
        error={runsError}
        selectedRunId={run?.id ?? activeRunId}
        onSelect={selectRun}
      />

      <ReviewStatsCards stats={stats} status={statsStatus} error={statsError} />
      <ReviewTrendChart buckets={stats?.averageRatingTrend ?? []} />
      <ReviewThemeCards
        themes={themes}
        status={themesStatus}
        error={themesError}
        inventoryHref="#reviews-inventory-anchor"
      />
      <div id="reviews-inventory-anchor">
        <ReviewInventoryTable
          profileId={siteId}
          filters={filters}
          data={inventory}
          status={inventoryStatus}
          error={inventoryError}
        />
      </div>
    </section>
  );
};
