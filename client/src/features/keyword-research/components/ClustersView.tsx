/**
 * AI keyword clusters view.
 *
 * Selection: 10–200 phrases chosen from STORED rows (current metrics, ideas,
 * research-history phrases) with a visible count — the run resolves them
 * server-side against the stored evidence; the client never authors
 * evidence. The pre-run disclosure states the exact spend (one
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
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip } from '@shared/ui/status-chip';
import { cn } from '@shared/lib/utils';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { loadClusterRun, loadClusterRuns, runClusters } from '../store/thunks';
import {
  selectClusters,
  selectHistory,
  selectIdeas,
  selectMetrics,
} from '../store/selectors';
import {
  CLUSTER_PHRASE_MAX,
  CLUSTER_PHRASE_MIN,
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_LOCATION_CODE,
} from '../validation';
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

interface CandidatePhrase {
  phrase: string;
  sourceKey: 'metrics' | 'ideas' | 'history';
}

/** Dedup stored phrases (metrics → ideas → history precedence), capped. */
export function collectCandidatePhrases(input: {
  metrics: readonly { keyword: string }[];
  ideas: readonly { keyword: string }[];
  historyPhrases: readonly string[];
}): CandidatePhrase[] {
  const seen = new Set<string>();
  const out: CandidatePhrase[] = [];
  const push = (phrase: string, sourceKey: CandidatePhrase['sourceKey']) => {
    const normalized = phrase.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push({ phrase: normalized, sourceKey });
  };
  for (const row of input.metrics) push(row.keyword, 'metrics');
  for (const row of input.ideas) push(row.keyword, 'ideas');
  for (const phrase of input.historyPhrases) push(phrase, 'history');
  return out.slice(0, CLUSTER_PHRASE_MAX * 2);
}

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
          name: run.aiProfile.name,
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

  const metrics = useAppSelector(selectMetrics);
  const ideas = useAppSelector(selectIdeas);
  const history = useAppSelector(selectHistory);
  const clusters = useAppSelector(selectClusters);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [locationCode, setLocationCode] = useState(DEFAULT_LOCATION_CODE);
  const [languageCode, setLanguageCode] = useState(DEFAULT_LANGUAGE_CODE);
  const [dialog, setDialog] = useState<
    | { kind: 'accept' | 'dismiss'; cluster: ClusterResult }
    | null
  >(null);

  const candidates = useMemo(
    () =>
      collectCandidatePhrases({
        metrics,
        ideas,
        historyPhrases: history.flatMap((item) => item.phrases),
      }),
    [metrics, ideas, history],
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
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(phrase)) next.delete(phrase);
      else if (next.size < CLUSTER_PHRASE_MAX) next.add(phrase);
      return next;
    });
  };

  const count = selected.size;
  const withinBounds = count >= CLUSTER_PHRASE_MIN && count <= CLUSTER_PHRASE_MAX;

  const onRun = async () => {
    if (!withinBounds) return;
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
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {candidates.length === 0 ? (
            <p
              className="text-muted-foreground text-sm"
              data-testid="kw-clusters-no-candidates"
            >
              {t('keywordResearch:clusters.noCandidates')}
            </p>
          ) : (
            <>
              <p
                className="text-sm"
                aria-live="polite"
                data-testid="kw-clusters-count"
              >
                {t('keywordResearch:clusters.selectionCount', {
                  count,
                  min: CLUSTER_PHRASE_MIN,
                  max: CLUSTER_PHRASE_MAX,
                })}
              </p>
              <ul className="flex max-h-64 flex-wrap gap-1.5 overflow-y-auto">
                {candidates.map((candidate) => {
                  const checked = selected.has(candidate.phrase);
                  return (
                    <li key={candidate.phrase}>
                      <label
                        className={cn(
                          'border-border inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs',
                          checked && 'border-primary bg-primary/10',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(candidate.phrase)}
                          data-testid={`kw-clusters-candidate-${keywordSlug(candidate.phrase)}`}
                        />
                        <span className="max-w-48 truncate">{candidate.phrase}</span>
                        <span className="text-muted-foreground">
                          {t(
                            `keywordResearch:clusters.source.${candidate.sourceKey}`,
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <MarketSelects
                locationCode={locationCode}
                languageCode={languageCode}
                onLocationChange={setLocationCode}
                onLanguageChange={setLanguageCode}
                testIdPrefix="kw-clusters"
              />
              <div
                className="border-border flex flex-col gap-1.5 rounded-md border p-3 text-sm"
                data-testid="kw-clusters-disclosure"
              >
                <p className="font-medium">
                  {t('keywordResearch:clusters.disclosureUnit')}
                </p>
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
            </>
          )}
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
