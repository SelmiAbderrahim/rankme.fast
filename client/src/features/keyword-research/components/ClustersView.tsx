import { isolateText } from '@shared/lib/bidi';
import { Bdi } from '@shared/components/Bdi';
/**
 * AI keyword clusters view.
 *
 * Selection: 10–200 phrases chosen from STORED rows with a visible
 * "N of 200 selected · minimum 10" count. The picker lists every phrase the
 * account has stored for the chosen market — the seeds it searched plus the
 * related, idea and long-tail phrases cached under them — from a free,
 * read-only endpoint (`GET /stored-keywords`); it is searchable and has a
 * select-all that stops at the 200 maximum. The run resolves the picked
 * phrases server-side against the same stored evidence; the client never
 * authors evidence. The pre-run disclosure states the exact spend (one
 * `ai_summaries` unit per fresh pass) and that an identical rerun is a free
 * read of the stored run.
 *
 * URL grammar: `run` (64-hex — reload survival for an open run) and
 * `decision` (all|pending|accepted|dismissed card filter). Progress is
 * honest (no fabricated percentage); failure and evidence-only outcomes are
 * distinct states — an evidence-only run never reads as "no topics exist".
 *
 * Decision display is session-scoped: the server contract exposes no
 * decision read endpoint, so post-reload terminality is proven through the
 * server's idempotent/409 decision API (the conflict banner), never
 * fabricated client-side.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip } from '@shared/ui/status-chip';
import { cn } from '@shared/lib/utils';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { loadClusterRun, loadClusterRuns, loadStoredKeywords, runClusters } from '../store/thunks';
import { selectClusters } from '../store/selectors';
import { CLUSTER_PHRASE_MAX, CLUSTER_PHRASE_MIN } from '../validation';
import {
  CLUSTER_DECISION_FILTERS,
  useKeywordWorkspaceQuery,
  type ClusterDecisionFilter,
} from '../tabState';
import { keywordSlug } from './KeywordResearchPanel';
import { AcceptClusterDialog } from './AcceptClusterDialog';
import { ClusterCard } from './ClusterCard';
import { DismissClusterDialog } from './DismissClusterDialog';
import { MarketSelects } from './MarketSelects';
import type { ClusterResult, ClusterRun } from '../types';
import { useResearchMarket } from '../useResearchMarket';

/** Keyword research's lookups are what store phrases for clustering. */
const FIND_MORE_HREF = '/keyword-research?tab=research';
/** Most stored phrases the picker loads per market; the server reports `total` when there are more. */
export const CANDIDATE_LIMIT = 1000;
/** Pause after the last keystroke before the stored-phrase search runs. */
export const CANDIDATE_SEARCH_DEBOUNCE_MS = 250;

const RunSummaryChips = ({ run }: { run: ClusterRun }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {run.cached ? (
        <StatusChip tone="muted" data-testid="kw-clusters-cached">
          {t('keywordResearch:clusters.cachedRun')}
        </StatusChip>
      ) : (
        <StatusChip tone="success" data-testid="kw-clusters-fresh">
          {t('keywordResearch:clusters.freshRun')}
        </StatusChip>
      )}
      <span className="text-muted-foreground text-xs">
        {t('keywordResearch:clusters.aiProfileLine', {
          name: isolateText(run.aiProfile.name),
          version: run.aiProfile.version,
        })}
      </span>
    </div>
  );
};

export const ClustersView = () => {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const [query, setQuery] = useKeywordWorkspaceQuery();

  const clusters = useAppSelector(selectClusters);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limitHit, setLimitHit] = useState(false);
  // The site's (or last used) market, never a hardcoded default.
  const {
    locationCode,
    languageCode,
    setLocationCode,
    setLanguageCode,
    adjustLocationCode,
    adjustLanguageCode,
  } = useResearchMarket();
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [dialog, setDialog] = useState<
    | { kind: 'accept' | 'dismiss'; cluster: ClusterResult }
    | null
  >(null);

  const { candidates: candidateState } = clusters;
  const candidates = candidateState.data?.candidates ?? [];

  // Debounce the search box so a burst of keystrokes is one read.
  useEffect(() => {
    const id = setTimeout(() => setAppliedSearch(search.trim()), CANDIDATE_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  // Stored phrases for the chosen market. A free read: it never reaches a provider.
  useEffect(() => {
    void dispatch(
      loadStoredKeywords({
        locationCode,
        languageCode,
        limit: CANDIDATE_LIMIT,
        ...(appliedSearch ? { q: appliedSearch } : {}),
      }),
    );
  }, [dispatch, locationCode, languageCode, appliedSearch]);

  // A selection belongs to the market it was picked in, so changing the market
  // starts a fresh selection. The handlers are stable (MarketSelects re-runs its
  // fallback effects whenever they change) and never create state when there
  // is nothing to clear.
  const resetSelection = useCallback(() => {
    setSelected((prev) => (prev.size === 0 ? prev : new Set()));
    setLimitHit(false);
  }, []);
  const onLocationChange = useCallback(
    (code: number) => {
      setLocationCode(code);
      resetSelection();
    },
    [resetSelection, setLocationCode],
  );
  const onLanguageChange = useCallback(
    (code: string) => {
      setLanguageCode(code);
      resetSelection();
    },
    [resetSelection, setLanguageCode],
  );

  useEffect(() => {
    if (clusters.runsLoaded || clusters.runsLoading) return;
    void dispatch(loadClusterRuns({}));
  }, [dispatch, clusters.runsLoaded, clusters.runsLoading]);

  // Reload survival — `?run=<64hex>` restores the stored run for free.
  useEffect(() => {
    if (!query.run) return;
    if (clusters.run?.runId === query.run || clusters.detailLoading) return;
    void dispatch(loadClusterRun({ runId: query.run }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the URL run changes
  }, [dispatch, query.run]);

  const toggle = (phrase: string) => {
    if (!selected.has(phrase) && selected.size >= CLUSTER_PHRASE_MAX) {
      setLimitHit(true);
      return;
    }
    setLimitHit(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(phrase)) next.delete(phrase);
      else next.add(phrase);
      return next;
    });
  };

  // Select every listed phrase, stopping at the maximum (and saying so).
  const selectAllShown = () => {
    const next = new Set(selected);
    let skipped = false;
    for (const candidate of candidates) {
      if (next.has(candidate.phrase)) continue;
      if (next.size >= CLUSTER_PHRASE_MAX) {
        skipped = true;
        break;
      }
      next.add(candidate.phrase);
    }
    setSelected(next);
    setLimitHit(skipped);
  };

  const count = selected.size;
  const withinBounds = count >= CLUSTER_PHRASE_MIN && count <= CLUSTER_PHRASE_MAX;
  // Every stored phrase for this market (before the list limit) is still short
  // of the minimum. A search narrows the list, so it does not count.
  const belowMinimum =
    !appliedSearch &&
    candidateState.data !== null &&
    candidateState.data.total > 0 &&
    candidateState.data.total < CLUSTER_PHRASE_MIN;

  const onRun = async () => {
    if (!withinBounds || clusters.running) return;
    const action = await dispatch(
      runClusters({
        phrases: Array.from(selected),
        locationCode,
        languageCode,
      }),
    );
    if (runClusters.fulfilled.match(action)) {
      setQuery({ run: action.payload.runId });
    }
  };

  // Refetch the stored run after a decision conflict — the conflict banner
  // (decision slot) stays visible until a new decision attempt resets it.
  const refetchRun = (target: ClusterRun) => {
    void dispatch(loadClusterRun({ runId: target.runId }));
  };

  const decisionOf = (target: ClusterRun, clusterId: string) =>
    clusters.decisions[`${target.runId}:${clusterId}`];

  const visibleClusters = (run: ClusterRun): ClusterResult[] =>
    run.clusters.filter((cluster) => {
      if (query.decision === 'all') return true;
      const kind = decisionOf(run, cluster.clusterId)?.result?.kind ?? 'pending';
      return kind === query.decision;
    });

  const formatDate = (iso: string): string =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  const run = clusters.run;

  return (
    <div className="flex flex-col gap-5" data-testid="kw-clusters-view">
      <Card>
        <CardHeader>
          <CardTitle>{t('keywordResearch:clusters.title')}</CardTitle>
          <p className="text-muted-foreground text-sm">
            {t('keywordResearch:clusters.description')}
          </p>
          <p className="text-muted-foreground text-sm" data-testid="kw-clusters-cross-link">
            {t('keywordResearch:clusters.crossLink.body')}{' '}
            <Link
              className="text-primary font-medium underline-offset-4 hover:underline"
              to="/sites"
            >
              {t('keywordResearch:clusters.crossLink.cta')}
            </Link>
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <MarketSelects
            locationCode={locationCode}
            languageCode={languageCode}
            onLocationChange={onLocationChange}
            onLanguageChange={onLanguageChange}
            onLocationAdjust={adjustLocationCode}
            onLanguageAdjust={adjustLanguageCode}
            testIdPrefix="kw-clusters"
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kw-clusters-search">
              {t('keywordResearch:clusters.searchLabel')}
            </Label>
            <Input
              id="kw-clusters-search"
              type="search"
              value={search}
              placeholder={t('keywordResearch:clusters.searchPlaceholder')}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="kw-clusters-search"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm" aria-live="polite" data-testid="kw-clusters-count">
              {t('keywordResearch:clusters.selectionCount', {
                count,
                min: CLUSTER_PHRASE_MIN,
                max: CLUSTER_PHRASE_MAX,
              })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={candidates.length === 0}
                onClick={selectAllShown}
                data-testid="kw-clusters-select-all"
              >
                {t('keywordResearch:clusters.selectAll', { count: candidates.length })}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={count === 0}
                onClick={resetSelection}
                data-testid="kw-clusters-clear"
              >
                {t('keywordResearch:clusters.clearSelection')}
              </Button>
            </div>
          </div>
          {limitHit ? (
            <p role="alert" className="text-destructive text-sm" data-testid="kw-clusters-limit">
              {t('keywordResearch:clusters.limitReached', { max: CLUSTER_PHRASE_MAX })}
            </p>
          ) : null}
          {candidateState.error ? (
            <Alert variant="destructive" role="alert" data-testid="kw-clusters-candidates-error">
              <AlertDescription>{candidateState.error}</AlertDescription>
            </Alert>
          ) : null}
          {candidateState.loading && candidateState.data === null ? (
            <div aria-busy="true" aria-live="polite" data-testid="kw-clusters-candidates-loading">
              <Skeleton className="h-16 w-full" />
            </div>
          ) : null}
          {candidateState.data !== null && candidates.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="kw-clusters-no-candidates">
              {t(
                appliedSearch
                  ? 'keywordResearch:clusters.noMatches'
                  : 'keywordResearch:clusters.noCandidates',
              )}
              {appliedSearch ? null : (
                <>
                  {' '}
                  <Link
                    className="text-primary font-medium underline-offset-4 hover:underline"
                    to={FIND_MORE_HREF}
                  >
                    {t('keywordResearch:clusters.findMore')}
                  </Link>
                </>
              )}
            </p>
          ) : null}
          {/* Fewer stored phrases than a run needs: "Select all shown" can never
              reach the minimum, so say so and say where to get more. */}
          {belowMinimum ? (
            <p className="text-sm" role="status" data-testid="kw-clusters-below-minimum">
              {t('keywordResearch:clusters.belowMinimum', {
                count: candidateState.data!.total,
                min: CLUSTER_PHRASE_MIN,
              })}{' '}
              <Link
                className="text-primary font-medium underline-offset-4 hover:underline"
                to={FIND_MORE_HREF}
              >
                {t('keywordResearch:clusters.findMore')}
              </Link>
            </p>
          ) : null}
          {candidates.length > 0 ? (
            <ul
              className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto"
              aria-label={t('keywordResearch:clusters.title')}
              data-testid="kw-clusters-candidates"
            >
              {candidates.map((candidate) => {
                const checked = selected.has(candidate.phrase);
                return (
                  <li key={candidate.phrase}>
                    <label
                      className={cn(
                        'border-border inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs max-md:min-h-11',
                        checked && 'border-primary bg-primary/10',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(candidate.phrase)}
                        data-testid={`kw-clusters-candidate-${keywordSlug(candidate.phrase)}`}
                      />
                      <span className="max-w-48 truncate"><Bdi>{candidate.phrase}</Bdi></span>
                      <span className="text-muted-foreground">
                        {t(`keywordResearch:clusters.source.${candidate.source}`)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {candidateState.data?.truncated ? (
            <p className="text-muted-foreground text-xs" data-testid="kw-clusters-truncated">
              {t('keywordResearch:clusters.truncatedNote', {
                count: candidates.length,
                total: candidateState.data.total,
              })}
            </p>
          ) : null}
          <div
            className="border-border flex flex-col gap-1.5 rounded-md border p-3 text-sm"
            data-testid="kw-clusters-disclosure"
          >
            <p className="font-medium">{t('keywordResearch:clusters.disclosureUnit')}</p>
            <p className="text-muted-foreground">
              {t('keywordResearch:clusters.disclosureRerunFree')}
            </p>
          </div>
          {count > 0 && !withinBounds ? (
            <p
              role="alert"
              className="text-destructive text-sm"
              data-testid="kw-clusters-bounds-error"
            >
              {t('keywordResearch:clusters.boundsError', {
                min: CLUSTER_PHRASE_MIN,
                max: CLUSTER_PHRASE_MAX,
              })}
            </p>
          ) : null}
          <div>
            <Button
              onClick={onRun}
              disabled={!withinBounds || clusters.running}
              loading={clusters.running}
              loadingLabel={t('keywordResearch:clusters.running')}
              data-testid="kw-clusters-run"
            >
              {t('keywordResearch:clusters.run')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {clusters.running ? (
        <p
          aria-live="polite"
          className="text-muted-foreground text-sm"
          data-testid="kw-clusters-running"
        >
          {t('keywordResearch:clusters.runningStatus')}
        </p>
      ) : null}

      {clusters.runError ? (
        <Alert variant="destructive" role="alert" data-testid="kw-clusters-error">
          <AlertDescription>{clusters.runError}</AlertDescription>
        </Alert>
      ) : null}

      {clusters.detailError ? (
        <Alert
          variant="destructive"
          role="alert"
          data-testid="kw-clusters-detail-error"
        >
          <AlertDescription>{clusters.detailError}</AlertDescription>
        </Alert>
      ) : null}

      {clusters.detailLoading && !run ? (
        <div aria-busy="true" aria-live="polite" data-testid="kw-clusters-detail-loading">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {run ? (
        <Card data-testid="kw-clusters-result">
          <CardHeader className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">
                {t('keywordResearch:clusters.resultTitle', {
                  count: run.clusters.length,
                })}
              </CardTitle>
              <ReportExportControl
                kind="keyword.ai_cluster_run"
                target={{ scope: 'account_resource', resourceId: run.runId }}
                selection={{ decision: query.decision === 'pending' ? 'undecided' : query.decision }}
              />
            </div>
            <RunSummaryChips run={run} />
            <div
              className="flex items-center gap-1"
              role="group"
              aria-label={t('keywordResearch:clusters.decisionFilterLabel')}
            >
              {CLUSTER_DECISION_FILTERS.map((filter: ClusterDecisionFilter) => {
                const selectedFilter = query.decision === filter;
                return (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={selectedFilter}
                    onClick={() => setQuery({ decision: filter })}
                    data-testid={`kw-clusters-decision-filter-${filter}`}
                    className={cn(
                      'cursor-pointer rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                      selectedFilter
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-background hover:bg-accent',
                    )}
                  >
                    {t(`keywordResearch:clusters.decisionFilter.${filter}`)}
                  </button>
                );
              })}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {run.clusters.length === 0 ? (
              <div data-testid="kw-clusters-evidence-only">
                <p className="font-medium">
                  {t('keywordResearch:clusters.evidenceOnlyTitle')}
                </p>
                <p className="text-muted-foreground text-sm">
                  {t('keywordResearch:clusters.evidenceOnlyBody')}
                </p>
              </div>
            ) : visibleClusters(run).length === 0 ? (
              <p
                className="text-muted-foreground text-sm"
                data-testid="kw-clusters-no-filter-match"
              >
                {t('keywordResearch:clusters.noFilterMatch')}
              </p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {visibleClusters(run).map((cluster) => (
                  <ClusterCard
                    key={cluster.clusterId}
                    run={run}
                    cluster={cluster}
                    decision={decisionOf(run, cluster.clusterId)}
                    onAccept={() => setDialog({ kind: 'accept', cluster })}
                    onDismiss={() => setDialog({ kind: 'dismiss', cluster })}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-col gap-3" data-testid="kw-clusters-runs">
        <h3 className="text-base font-semibold">
          {t('keywordResearch:clusters.runsTitle')}
        </h3>
        {clusters.runsError ? (
          <Alert variant="destructive" role="alert" data-testid="kw-clusters-runs-error">
            <AlertDescription>{clusters.runsError}</AlertDescription>
          </Alert>
        ) : null}
        {clusters.runsLoading && clusters.runs.length === 0 ? (
          <Skeleton className="h-16 w-full" data-testid="kw-clusters-runs-loading" />
        ) : clusters.runs.length === 0 && clusters.runsLoaded ? (
          <p
            className="text-muted-foreground text-sm"
            data-testid="kw-clusters-runs-empty"
          >
            {t('keywordResearch:clusters.runsEmpty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {clusters.runs.map((stored) => (
              <li
                key={stored.runId}
                className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                data-testid={`kw-clusters-run-row-${stored.runId}`}
              >
                <span className="flex flex-col">
                  <span className="font-medium">
                    {t('keywordResearch:clusters.runRowTitle', {
                      count: stored.clusters.length,
                    })}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {formatDate(stored.createdAt)} · {stored.market.languageCode} ·{' '}
                    {stored.memberRefs.length}{' '}
                    {t('keywordResearch:clusters.runRowMembers')}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setQuery({ run: stored.runId })}
                  data-testid={`kw-clusters-open-${stored.runId}`}
                >
                  {t('keywordResearch:clusters.openRun')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {clusters.runsCursor ? (
          <div>
            <Button
              variant="outline"
              size="sm"
              loading={clusters.runsLoading}
              loadingLabel={t('keywordResearch:history.loading')}
              onClick={() =>
                void dispatch(loadClusterRuns({ cursor: clusters.runsCursor! }))
              }
              data-testid="kw-clusters-load-more"
            >
              {t('keywordResearch:history.loadMore')}
            </Button>
          </div>
        ) : null}
      </div>

      {dialog && run ? (
        dialog.kind === 'accept' ? (
          <AcceptClusterDialog
            runId={run.runId}
            cluster={dialog.cluster}
            onClose={() => setDialog(null)}
            onConflict={() => refetchRun(run)}
          />
        ) : (
          <DismissClusterDialog
            runId={run.runId}
            cluster={dialog.cluster}
            onClose={() => setDialog(null)}
            onConflict={() => refetchRun(run)}
          />
        )
      ) : null}
    </div>
  );
};
