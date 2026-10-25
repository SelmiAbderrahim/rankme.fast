/**
 * Keywords panel — mounted by the site workspace under the "keywords" tab.
 *
 * data-testid contract:
 *   - keywords-table          keyword list root
 *   - keyword-add             add form root
 *   - keyword-add-error       inline add error alert
 *   - rank-trend              rank trend chart card
 *   - rank-trend-empty        text state shown when < 2 datapoints
 *   - cadence-toggle          weekly/daily switch
 *   - keywords-loading        skeleton state
 *   - keywords-error          global error alert
 *   - keywords-empty          empty state (no keywords yet)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ReportExportControl } from '@features/report-export';
import { NativeSelect } from '@shared/ui/native-select';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { PageHeader } from '@shared/components/PageHeader';
import { RefreshButton } from '@shared/components/RefreshButton';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Skeleton } from '@shared/ui/skeleton';
import { KeywordMarketMove } from './KeywordMarketMove';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { useJobStatus } from '@shared/hooks/useJobStatus';
import { rankJobSettled } from '@shared/cache/invalidation';
import {
  checkNow,
  loadKeywordHistory,
  loadKeywords,
  removeKeyword,
  updateCadence,
  addKeywordsBulk,
} from '../store/thunks';
import { selectKeyword } from '../store/slice';
import {
  selectAddKeywordError,
  selectAddingKeyword,
  selectCadence,
  selectCadenceError,
  selectCheckCooldownUntil,
  selectCheckingKeywordId,
  selectCheckingNow,
  selectHistory,
  selectHistoryMissedChecks,
  selectHistoryError,
  selectHistoryKeywordId,
  selectHistoryLoading,
  selectKeywords,
  selectKeywordLoadedQuery,
  selectKeywordTotal,
  selectKeywordSiteTotal,
  selectRanksLoading,
  selectRanksError,
  selectRanksLoaded,
  selectRemoveError,
  selectRemovingId,
  selectSelectedKeywordId,
  selectUpdatingCadence,
} from '../store/selectors';
import { KeywordsTable } from './KeywordsTable';
import { KeywordsPagination } from './KeywordsPagination';
import { AddKeywordForm } from './AddKeywordForm';
import { CadenceToggle } from './CadenceToggle';
import { RankTrendChart } from './RankTrendChart';
import { RANK_ENGINES, type Keyword, type KeywordListQuery, type RankCadence, type RankEngine } from '../types';
import type { AddKeywordFormValues } from '../validation';
import { rankCheckReachedTerminal } from '../check-status';
import { fetchActiveRankJobRequest, fetchRankJobRequest, retryFailedRankJobRequest } from '../api';
import { forgetTrackedRankJob, isRankJobFinished, newIdempotencyKey, rankJobOutcome, rankJobToastId, readTrackedRankJob, rememberTrackedRankJob } from '../rankJobs';
import type { RankJob } from '../types';
import { CheckNowDialog, type CheckNowTarget } from './CheckNowDialog';
import { KEYWORD_SEARCH_MAX, keywordPageCount, readKeywordListQuery, sameKeywordListQuery, writeKeywordListQuery } from '../keywordListParams';

interface Props {
  siteId: string;
}

/** Poll cadence + ceiling for automatic first checks after an add. */
const CHECK_POLL_INTERVAL_MS = 3_000;
const CHECK_POLL_MAX_MS = 60_000;
const SEARCH_DEBOUNCE_MS = 300;
const BULK_KEYWORDS_PER_REQUEST = 100;

/** A keyword just added whose automatic first check is still outstanding. */
interface InitialCheck {
  /** Server stamp (`updatedAt`) the first snapshot must reach. */
  since: number;
  /** Local epoch ms after which the row stops showing "Checking…". */
  until: number;
}

export const KeywordsPanel = ({ siteId }: Props) => {
  const { t } = useTranslation('ranks');
  const dispatch = useAppDispatch();

  const keywords = useAppSelector(selectKeywords);
  const [searchParams, setSearchParams] = useSearchParams();
  const listQuery = readKeywordListQuery(searchParams);
  const { page, pageSize, engine: requestedEngine, search } = listQuery;
  const engineFilter: RankEngine | 'all' = requestedEngine ?? 'all';
  const updateListQuery = useCallback((patch: Partial<KeywordListQuery>, push = false) => {
    const next = { page, pageSize, engine: requestedEngine, search,
      ...(patch.page === undefined ? { page: 1 } : {}), ...patch };
    setSearchParams(writeKeywordListQuery(searchParams, next), { replace: !push });
  }, [page, pageSize, requestedEngine, search, searchParams, setSearchParams]);
  const setEngineFilter = (next: RankEngine | 'all') => updateListQuery({ engine: next === 'all' ? null : next });
  const total = useAppSelector(selectKeywordTotal);
  const siteTotal = useAppSelector(selectKeywordSiteTotal);
  const listLoading = useAppSelector(selectRanksLoading);
  const loadedQuery = useAppSelector(selectKeywordLoadedQuery);
  const loaded = useAppSelector(selectRanksLoaded);
  const reloadKeywords = useCallback(() => dispatch(loadKeywords({ siteId, page, pageSize, search,
    ...(requestedEngine ? { engine: requestedEngine } : {}) })),
  [dispatch, siteId, page, pageSize, search, requestedEngine]);
  const error = useAppSelector(selectRanksError);
  const adding = useAppSelector(selectAddingKeyword);
  const addError = useAppSelector(selectAddKeywordError);
  const removingId = useAppSelector(selectRemovingId);
  const removeError = useAppSelector(selectRemoveError);
  const cadence = useAppSelector(selectCadence);
  const [checkingSince, setCheckingSince] = useState<number | null>(null);
  const [checkingTargetId, setCheckingTargetId] = useState<string | null>(null);
  const [checkTarget, setCheckTarget] = useState<CheckNowTarget | null>(null);
  const [trackedJob, setTrackedJob] = useState<{ id: string; initial: RankJob | null } | null>(null);
  // Keywords added this session whose automatic first check has not landed.
  const [initialChecks, setInitialChecks] = useState<Record<string, InitialCheck>>({});
  const updatingCadence = useAppSelector(selectUpdatingCadence);
  const cadenceError = useAppSelector(selectCadenceError);
  const checkingNow = useAppSelector(selectCheckingNow);
  const requestingKeywordId = useAppSelector(selectCheckingKeywordId);
  const checkCooldownUntil = useAppSelector(selectCheckCooldownUntil);
  const selectedId = useAppSelector(selectSelectedKeywordId);
  const history = useAppSelector(selectHistory);
  const missedChecks = useAppSelector(selectHistoryMissedChecks);
  const historyKeywordId = useAppSelector(selectHistoryKeywordId);
  const historyLoading = useAppSelector(selectHistoryLoading);
  const historyError = useAppSelector(selectHistoryError);
  const jobStatus = useJobStatus<RankJob>({
    jobId: trackedJob?.id ?? null,
    initialJob: trackedJob?.initial ?? null,
    fetchJob: async (jobId, signal) => (await fetchRankJobRequest(siteId, jobId, signal)).job,
    isTerminal: isRankJobFinished,
  });
  const job = jobStatus.job;
  const retryFailed = useCallback(async (jobId: string) => {
    try {
      const accepted = await retryFailedRankJobRequest(siteId, jobId);
      if (!accepted.job) { toast.success(accepted.message); return; }
      rememberTrackedRankJob(siteId, accepted.job.id);
      toast.loading(accepted.message, { id: rankJobToastId(accepted.job.id) });
      setTrackedJob({ id: accepted.job.id, initial: accepted.job });
    } catch {
      toast.error(t('checkFailed'));
    }
  }, [siteId, t]);

  const ranksSiteId = useAppSelector((s) => s.ranks.siteId);
  const historyKeywordIdRef = useRef(historyKeywordId);
  historyKeywordIdRef.current = historyKeywordId;
  const viewKey = `${siteId}:${page}:${pageSize}:${requestedEngine ?? 'all'}:${search}`;
  const loadedViewKeyRef = useRef<string | null>(
    loaded && !listLoading && ranksSiteId === siteId && sameKeywordListQuery(loadedQuery, listQuery)
      ? viewKey : null,
  );

  useEffect(() => {
    if (loadedViewKeyRef.current === viewKey) return;
    loadedViewKeyRef.current = viewKey;
    const p = dispatch(
      loadKeywords({ siteId, page, pageSize, search,
        ...(requestedEngine ? { engine: requestedEngine } : {}) }),
    );
    return () => {
      p.abort();
    };
  }, [dispatch, viewKey, requestedEngine, page, pageSize, search, siteId]);

  const [searchDraft, setSearchDraft] = useState(search);
  useEffect(() => {
    setSearchDraft((draft) => draft.trim() === search ? draft : search);
  }, [search]);
  useEffect(() => {
    const next = searchDraft.trim().slice(0, KEYWORD_SEARCH_MAX);
    if (next === search) return;
    const timer = window.setTimeout(() => updateListQuery({ search: next }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchDraft, search, updateListQuery]);

  const pageCount = keywordPageCount(total, pageSize);
  const changingView = !sameKeywordListQuery(loadedQuery, listQuery);
  const answered = !listLoading && !changingView;
  useEffect(() => {
    if (answered && page > pageCount) updateListQuery({ page: pageCount });
  }, [answered, page, pageCount, updateListQuery]);

  useEffect(() => {
    if (!selectedId) return;
    if (historyKeywordIdRef.current === selectedId) return;
    const p = dispatch(loadKeywordHistory({ keywordId: selectedId }));
    return () => {
      p.abort();
    };
  }, [dispatch, selectedId]);

  const reportedJobId = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setTrackedJob(null);
    setCheckingSince(null);
    setCheckingTargetId(null);
    reportedJobId.current = null;
    const remembered = readTrackedRankJob(siteId);
    if (remembered) setTrackedJob({ id: remembered, initial: null });
    else void fetchActiveRankJobRequest(siteId, controller.signal)
      .then(({ job: active }) => {
        if (controller.signal.aborted || !active) return;
        setTrackedJob({ id: active.id, initial: active });
        setCheckingSince(Date.parse(active.createdAt));
        setCheckingTargetId(active.scope === 'keyword' && active.items.length === 1 ? active.items[0]!.keywordId : null);
      })
      .catch(() => { /* The next explicit check still works if this stored read fails. */ });
    return () => controller.abort();
  }, [siteId]);

  useEffect(() => {
    if (jobStatus.phase !== 'polling' || job?.siteId !== siteId) return;
    setCheckingSince(Date.parse(job.createdAt));
    setCheckingTargetId(job.scope === 'keyword' && job.items.length === 1 ? job.items[0]!.keywordId : null);
  }, [jobStatus.phase, job, siteId]);

  useEffect(() => {
    if (jobStatus.phase !== 'terminal' || !job || job.siteId !== siteId || reportedJobId.current === job.id) return;
    reportedJobId.current = job.id;
    forgetTrackedRankJob(siteId, job.id);
    dispatch(rankJobSettled({ siteId, jobId: job.id }));
    void reloadKeywords();
    if (selectedId) void dispatch(loadKeywordHistory({ keywordId: selectedId }));
    setCheckingSince(null);
    setCheckingTargetId(null);
    const outcome = rankJobOutcome(t, job);
    toast[outcome.tone](outcome.title, { id: rankJobToastId(job.id),
      ...(outcome.description ? { description: outcome.description } : {}),
      ...(outcome.failed > 0 ? { action: { label: t('retryFailed'), onClick: () => void retryFailed(job.id) } } : {}),
    });
  }, [jobStatus.phase, job, siteId, dispatch, reloadKeywords, selectedId, t, retryFailed]);

  useEffect(() => {
    if (jobStatus.phase === 'capped' && job?.siteId === siteId) {
      setCheckingSince(null);
      setCheckingTargetId(null);
      toast.info(t('jobStillRunning'), { id: rankJobToastId(job.id) });
    }
  }, [jobStatus.phase, job, siteId, t]);

  useEffect(() => {
    const id = trackedJob?.id;
    if (!id) return;
    return () => { if (reportedJobId.current !== id) toast.dismiss(rankJobToastId(id)); };
  }, [trackedJob?.id]);

  // Adding a keyword makes the server enqueue its first check, which finishes
  // asynchronously in the worker. Keep the new rows in "Checking…" and poll the
  // list until each snapshot (or recorded failure) lands, or the deadline
  // passes, so the position appears without a manual reload.
  useEffect(() => {
    const entries = Object.entries(initialChecks);
    if (entries.length === 0) return;
    const now = Date.now();
    const live = entries.filter(([id, { since, until }]) => {
      const keyword = keywords.find((k) => k.id === id);
      return keyword !== undefined && now < until && !rankCheckReachedTerminal(keyword, since);
    });
    if (live.length !== entries.length) {
      setInitialChecks(Object.fromEntries(live));
      return;
    }
    let inFlight: { abort: () => void } | null = null;
    const timer = window.setInterval(() => {
      if (live.some(([, { until }]) => Date.now() >= until)) {
        setInitialChecks(
          Object.fromEntries(live.filter(([, { until }]) => Date.now() < until)),
        );
        return;
      }
      inFlight = reloadKeywords();
    }, CHECK_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      inFlight?.abort();
    };
  }, [keywords, initialChecks, reloadKeywords]);

  const handleAdd = async (values: AddKeywordFormValues[]) => {
    const added: string[] = [];
    const fresh: Record<string, InitialCheck> = {};
    let duplicates = 0;
    let tooLong = 0;
    let invalid = 0;
    let processed = 0;
    for (let offset = 0; offset < values.length; offset += BULK_KEYWORDS_PER_REQUEST) {
      const batch = values.slice(offset, offset + BULK_KEYWORDS_PER_REQUEST);
      const first = batch[0];
      if (!first) break;
      const result = await dispatch(addKeywordsBulk({ siteId, phrases: batch.map((value) => value.phrase),
        locationCode: first.locationCode, languageCode: first.languageCode,
        device: first.device, engine: first.engine, engineTarget: first.engineTarget }));
      if (!addKeywordsBulk.fulfilled.match(result)) break;
      processed += result.payload.results.length;
      for (const item of result.payload.results) {
        if (item.status === 'duplicate') { duplicates += 1; continue; }
        if (item.status === 'invalid') {
          if (item.reason === 'too_long') tooLong += 1;
          else invalid += 1;
          continue;
        }
        if (!item.keyword) continue;
        added.push(item.phrase);
        fresh[item.keyword.id] = { since: Date.parse(item.keyword.updatedAt),
          until: Date.now() + CHECK_POLL_MAX_MS };
      }
    }
    if (added.length > 0) {
      toast.success(
        t(added.length === 1 ? 'keywordsAddedOne' : 'keywordsAdded', { count: added.length }),
      );
      await reloadKeywords();
      // Registered after the reload so the new rows already exist in the list
      // when the poll effect first looks for them.
      setInitialChecks((current) => ({ ...current, ...fresh }));
    }
    return { added, duplicates, tooLong, invalid, unsent: values.length - processed };
  };

  const handleRemove = async (k: Keyword) => {
    const result = await dispatch(removeKeyword(k.id));
    if (removeKeyword.fulfilled.match(result)) {
      await reloadKeywords();
    }
  };

  const handleCadence = (next: RankCadence) => {
    void dispatch(updateCadence({ siteId, cadence: next, previous: cadence }));
  };

  const handleCheckNow = async (target: CheckNowTarget) => {
    const result = await dispatch(
      checkNow({ siteId, ...(target.scope === 'keyword' ? { keywordId: target.keyword.id } : {}),
        idempotencyKey: newIdempotencyKey() }),
    );
    if (checkNow.fulfilled.match(result)) {
      setCheckTarget(null);
      if (result.payload.job) {
        rememberTrackedRankJob(siteId, result.payload.job.id);
        toast.loading(result.payload.message, { id: rankJobToastId(result.payload.job.id) });
        setTrackedJob({ id: result.payload.job.id, initial: result.payload.job });
        setCheckingTargetId(target.scope === 'keyword' ? target.keyword.id : null);
        setCheckingSince(Date.parse(result.payload.checkStartedAt));
      } else toast.success(result.payload.message);
    } else {
      /* c8 ignore start -- checkNow always rejects via rejectWithValue, so payload.error is set; the ?? only guards an unexpected thunk throw. */
      toast.error(result.payload?.error ?? t('checkFailed'));
      /* c8 ignore stop */
    }
  };

  const handleSelect = (k: Keyword) => {
    dispatch(selectKeyword(k.id));
  };

  const selectedKeyword: Keyword | undefined = selectedId
    ? keywords.find((k) => k.id === selectedId)
    : undefined;

  // Explain the missing trend from the keyword's real state (first check still
  // running, never checked, failed, or one snapshot under this site's cadence)
  // rather than promising a fixed schedule.
  const trendHintKey = (keyword: Keyword): string => {
    const initial = initialChecks[keyword.id];
    if (initial !== undefined && !rankCheckReachedTerminal(keyword, initial.since)) {
      return 'trendChecking';
    }
    if (history.length === 0 && keyword.lastCheckedAt === null) {
      return keyword.lastFailedCheckAt === null ? 'trendNoChecks' : 'trendCheckFailed';
    }
    return cadence === 'daily' ? 'trendOneCheckDaily' : 'trendOneCheckWeekly';
  };

  const renderTrend = () => {
    if (!selectedKeyword) {
      if (keywords.length === 0) return null;
      return (
        <p className="text-muted-foreground text-sm" data-testid="rank-trend-prompt">
          {t('trendSelectPrompt')}
        </p>
      );
    }
    // The store's history/historyKeywordId can lag behind the freshly-selected
    // keyword by one dispatch. Rendering during that window would label the
    // previous keyword's series as the new one — show the loading skeleton
    // until the slice catches up.
    if (historyLoading || historyKeywordId !== selectedKeyword.id) {
      return (
        <div
          className="flex flex-col gap-2"
          aria-busy="true"
          aria-live="polite"
          data-testid="rank-trend-loading"
        >
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-40 w-full" />
        </div>
      );
    }
    if (historyError) {
      return (
        <Alert variant="destructive" role="alert" data-testid="rank-trend-error">
          <AlertDescription>{historyError}</AlertDescription>
        </Alert>
      );
    }
    if (history.length < 2) {
      return (
        <p className="text-muted-foreground text-sm" data-testid="rank-trend-empty">
          {t(trendHintKey(selectedKeyword))}
        </p>
      );
    }
    return <RankTrendChart keyword={selectedKeyword} series={history} missedChecks={missedChecks} />;
  };

  // Title row like every other workspace tab (Backlinks, Keyword clusters): the
  // site name is the page h1, so the tab title is an h2 at the same size.
  const header = (
    <PageHeader
      data-testid="keywords-header"
      title={t('panelTitle')}
      description={t('panelDescription')}
    />
  );

  if (!loaded) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <div
          className="flex flex-col gap-3"
          aria-busy="true"
          aria-live="polite"
          data-testid="keywords-loading"
        >
          <p className="text-muted-foreground text-sm">{t('loading')}</p>
          <Skeleton className="h-10 w-full" data-testid="keywords-skeleton" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Alert variant="destructive" role="alert" data-testid="keywords-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={() => void reloadKeywords()}
        >
          {t('retry')}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {header}
      <h3 className="text-lg font-semibold" data-testid="keyword-list-heading">
        {t(search || requestedEngine ? 'keywordList.headingFiltered' : 'keywordList.heading',
          search || requestedEngine ? { matched: total, total: siteTotal } : { total: siteTotal })}
      </h3>
      <KeywordMarketMove siteId={siteId} keywordCount={siteTotal} onMoved={() => { void reloadKeywords(); }} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <CadenceToggle
          cadence={cadence}
          disabled={updatingCadence}
          onChange={handleCadence}
        />
        <div className="flex flex-wrap items-center gap-3" data-testid="keywords-toolbar">
          <ReportExportControl
            kind="ranks.current"
            target={{ scope: 'site', siteId }}
            selection={requestedEngine ? { engine: requestedEngine } : {}}
            label={t('exportRankings')}
            clipboardText={page === 1 && total === keywords.length && total > 0
              ? `${keywords.map(({ phrase }) => phrase).join(',')},` : undefined}
          />
          {selectedKeyword ? (
            <ReportExportControl
              kind="ranks.history"
              target={{ scope: 'site', siteId }}
              selection={{ keywordIds: [selectedKeyword.id] }}
              label={t('exportHistory')}
              ariaLabel={t('exportHistoryAria', { keyword: selectedKeyword.phrase })}
            />
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link to={`/sites/${siteId}?tab=keyword-clusters`}>{t('keywordClusteringCta')}</Link>
          </Button>
          <div className="flex items-center gap-2" data-testid="engine-filter">
            <label className="text-muted-foreground text-sm" htmlFor="rank-engine-filter">
              {t('engine.filterLabel')}
            </label>
            <NativeSelect
              id="rank-engine-filter"
              value={engineFilter}
              onChange={(event) => setEngineFilter(event.target.value as RankEngine | 'all')}
            >
              <option value="all">{t('engine.filterAll')}</option>
              {RANK_ENGINES.map((option) => (
                <option key={option} value={option}>
                  {t(`engine.name.${option}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="relative sm:w-72">
            <Label htmlFor="keyword-search" className="sr-only">{t('keywordList.searchLabel')}</Label>
            <Search aria-hidden="true" className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" />
            <Input id="keyword-search" type="search" className="ps-9" value={searchDraft}
              maxLength={KEYWORD_SEARCH_MAX} placeholder={t('keywordList.searchPlaceholder')}
              onChange={(event) => setSearchDraft(event.target.value)} data-testid="keyword-search" />
          </div>
          {cadenceError ? (
            <Alert
              variant="destructive"
              role="alert"
              data-testid="cadence-error"
              className="w-auto"
            >
              <AlertDescription>{cadenceError}</AlertDescription>
            </Alert>
          ) : null}
          {siteTotal > 0 ? (
            <RefreshButton
              onRefresh={() => setCheckTarget({ scope: 'site' })}
              isRefreshing={checkingNow}
              cooldownUntil={checkCooldownUntil}
              labelKey="ranks:checkNow"
              cooldownKey="ranks:checkCooldownCountdown"
              data-testid="keyword-check-now"
            />
          ) : null}
        </div>
      </div>
      {removeError ? (
        <Alert variant="destructive" role="alert" data-testid="keyword-remove-error">
          <AlertDescription>{removeError}</AlertDescription>
        </Alert>
      ) : null}
      {changingView ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite" data-testid="keywords-page-loading">
          <Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" />
        </div>
      ) : keywords.length === 0 ? (
        <Empty className="w-full" data-testid="keywords-empty">
          <EmptyHeader>
            <EmptyTitle>{t(search || requestedEngine ? 'keywordList.noMatchTitle' : 'emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t(search || requestedEngine ? 'keywordList.noMatchDescription' : 'emptyDescription')}</EmptyDescription>
          </EmptyHeader>
          {search || requestedEngine ? <Button type="button" variant="outline"
            onClick={() => { setSearchDraft(''); updateListQuery({ search: '', engine: null }); }}>
            {t('keywordList.clearFilters')}
          </Button> : <Button type="button" variant="outline" onClick={() => document.getElementById('keyword-phrase')?.focus()}>
            {t('emptyCta')}
          </Button>}
        </Empty>
      ) : (
        <KeywordsTable
          keywords={keywords}
          jobItems={jobStatus.phase !== 'capped' && job?.siteId === siteId
            ? new Map(job.items.map((item) => [item.keywordId, item]))
            : undefined}
          removingId={removingId}
          selectedId={selectedId}
          onSelect={handleSelect}
          onRemove={handleRemove}
          onCheck={(keyword) => setCheckTarget({ scope: 'keyword', keyword })}
          checkingSince={checkingSince}
          checkingKeywordId={checkingTargetId}
          requestingKeywordId={requestingKeywordId}
          initialChecks={initialChecks}
        />
      )}
      {!changingView && total > 0 ? <KeywordsPagination page={page} pageSize={pageSize} total={total}
        shown={keywords.length} onPageChange={(next) => updateListQuery({ page: next }, true)}
        onPageSizeChange={(next) => updateListQuery({ pageSize: next })} /> : null}
      {renderTrend()}
      <AddKeywordForm
        siteId={siteId}
        onSubmit={handleAdd}
        submitting={adding}
        addError={addError}
      />
      {checkTarget ? <CheckNowDialog open target={checkTarget} confirming={checkingNow}
        onConfirm={(target) => void handleCheckNow(target)} onCancel={() => setCheckTarget(null)} /> : null}
    </div>
  );
};
