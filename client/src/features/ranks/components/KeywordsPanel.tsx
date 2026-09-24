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
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ReportExportControl } from '@features/report-export';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { RefreshButton } from '@shared/components/RefreshButton';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Skeleton } from '@shared/ui/skeleton';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  checkNow,
  loadKeywordHistory,
  loadKeywords,
  removeKeyword,
  updateCadence,
  addKeyword,
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
  selectHistoryError,
  selectHistoryKeywordId,
  selectHistoryLoading,
  selectKeywords,
  selectRanksError,
  selectRanksLoaded,
  selectRemoveError,
  selectRemovingId,
  selectSelectedKeywordId,
  selectUpdatingCadence,
} from '../store/selectors';
import { KeywordsTable } from './KeywordsTable';
import { AddKeywordForm } from './AddKeywordForm';
import { CadenceToggle } from './CadenceToggle';
import { RankTrendChart } from './RankTrendChart';
import { RANK_ENGINES, type Keyword, type RankCadence, type RankEngine } from '../types';
import type { AddKeywordFormValues } from '../validation';
import { rankCheckReachedTerminal } from '../check-status';

interface Props {
  siteId: string;
}

/** Poll cadence + ceiling for the post-"Check now" list refresh. */
const CHECK_POLL_INTERVAL_MS = 3_000;
const CHECK_POLL_MAX_MS = 60_000;

export const KeywordsPanel = ({ siteId }: Props) => {
  const { t } = useTranslation('ranks');
  const dispatch = useAppDispatch();

  const allKeywords = useAppSelector(selectKeywords);
  const [searchParams, setSearchParams] = useSearchParams();
  // Engine filter lives in the URL so a filtered
  // view is shareable and survives a refresh (url-tab-state rule). An unknown
  // value falls back to `all` rather than rendering an empty table.
  const rawEngine = searchParams.get('engine');
  const engineFilter: RankEngine | 'all' =
    rawEngine !== null && (RANK_ENGINES as readonly string[]).includes(rawEngine)
      ? (rawEngine as RankEngine)
      : 'all';
  const requestedEngine = engineFilter === 'all' ? undefined : engineFilter;
  const keywords =
    engineFilter === 'all' ? allKeywords : allKeywords.filter((k) => k.engine === engineFilter);
  const setEngineFilter = (next: RankEngine | 'all') => {
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('engine');
    else params.set('engine', next);
    setSearchParams(params, { replace: true });
  };
  const loaded = useAppSelector(selectRanksLoaded);
  const error = useAppSelector(selectRanksError);
  const adding = useAppSelector(selectAddingKeyword);
  const addError = useAppSelector(selectAddKeywordError);
  const removingId = useAppSelector(selectRemovingId);
  const removeError = useAppSelector(selectRemoveError);
  const cadence = useAppSelector(selectCadence);
  const [checkingSince, setCheckingSince] = useState<number | null>(null);
  const [checkingTargetId, setCheckingTargetId] = useState<string | null>(null);
  const updatingCadence = useAppSelector(selectUpdatingCadence);
  const cadenceError = useAppSelector(selectCadenceError);
  const checkingNow = useAppSelector(selectCheckingNow);
  const requestingKeywordId = useAppSelector(selectCheckingKeywordId);
  const checkCooldownUntil = useAppSelector(selectCheckCooldownUntil);
  const selectedId = useAppSelector(selectSelectedKeywordId);
  const history = useAppSelector(selectHistory);
  const historyKeywordId = useAppSelector(selectHistoryKeywordId);
  const historyLoading = useAppSelector(selectHistoryLoading);
  const historyError = useAppSelector(selectHistoryError);
  const checkingKeywords = useMemo(
    () =>
      checkingTargetId === null
        ? keywords
        : keywords.filter(({ id }) => id === checkingTargetId),
    [checkingTargetId, keywords],
  );

  const ranksSiteId = useAppSelector((s) => s.ranks.siteId);
  const historyKeywordIdRef = useRef(historyKeywordId);
  historyKeywordIdRef.current = historyKeywordId;
  const loadedViewKeyRef = useRef<string | null>(
    ranksSiteId === siteId && requestedEngine === undefined ? `${siteId}:all` : null,
  );

  useEffect(() => {
    const viewKey = `${siteId}:${requestedEngine ?? 'all'}`;
    if (loadedViewKeyRef.current === viewKey) return;
    loadedViewKeyRef.current = viewKey;
    const p = dispatch(
      loadKeywords({
        siteId,
        direction: 'initial',
        ...(requestedEngine ? { engine: requestedEngine } : {}),
      }),
    );
    return () => {
      p.abort();
    };
  }, [dispatch, requestedEngine, siteId]);

  useEffect(() => {
    if (!selectedId) return;
    if (historyKeywordIdRef.current === selectedId) return;
    const p = dispatch(loadKeywordHistory({ keywordId: selectedId }));
    return () => {
      p.abort();
    };
  }, [dispatch, selectedId]);

  // After a "Check now", the rank job runs asynchronously in the worker, so the
  // 202 says nothing about the result. Poll the list until every keyword's
  // snapshot has refreshed past the trigger stamp (or the deadline elapses),
  // then stop — mirrors the report run-status poll (report/ReportPage).
  useEffect(() => {
    if (checkingSince === null) return;
    if (checkingKeywords.every((keyword) => rankCheckReachedTerminal(keyword, checkingSince))) {
      return;
    }
    const deadline = checkingSince + CHECK_POLL_MAX_MS;
    let inFlight: { abort: () => void } | null = null;
    const timer = window.setInterval(() => {
      if (Date.now() >= deadline) {
        setCheckingSince(null);
        setCheckingTargetId(null);
        return;
      }
      inFlight = dispatch(
        loadKeywords({
          siteId,
          direction: 'initial',
          ...(requestedEngine ? { engine: requestedEngine } : {}),
        }),
      );
    }, CHECK_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      inFlight?.abort();
    };
  }, [dispatch, requestedEngine, siteId, checkingKeywords, checkingSince]);

  // Stop as soon as every row carries a snapshot newer than the trigger.
  // (An empty list `.every()` → true, which also stops — nothing to check.)
  useEffect(() => {
    if (checkingSince === null) return;
    const allRefreshed = checkingKeywords.every((keyword) =>
      rankCheckReachedTerminal(keyword, checkingSince),
    );
    if (allRefreshed) {
      setCheckingSince(null);
      setCheckingTargetId(null);
    }
  }, [checkingKeywords, checkingSince]);

  const handleAdd = async (values: AddKeywordFormValues[]) => {
    const added: string[] = [];
    for (const value of values) {
      const result = await dispatch(addKeyword({ siteId, ...value }));
      if (!addKeyword.fulfilled.match(result)) break;
      added.push(value.phrase);
    }
    if (added.length > 0) {
      await dispatch(
        loadKeywords({
          siteId,
          direction: 'initial',
          ...(requestedEngine ? { engine: requestedEngine } : {}),
        }),
      );
    }
    return added;
  };

  const handleRemove = async (k: Keyword) => {
    const result = await dispatch(removeKeyword(k.id));
    if (removeKeyword.fulfilled.match(result)) {
      await dispatch(
        loadKeywords({
          siteId,
          direction: 'initial',
          ...(requestedEngine ? { engine: requestedEngine } : {}),
        }),
      );
    }
  };

  const handleCadence = (next: RankCadence) => {
    void dispatch(updateCadence({ siteId, cadence: next, previous: cadence }));
  };

  const handleCheckNow = async (keyword?: Keyword) => {
    const result = await dispatch(
      checkNow({ siteId, ...(keyword ? { keywordId: keyword.id } : {}) }),
    );
    if (checkNow.fulfilled.match(result)) {
      toast.success(result.payload.message);
      // Kick off the poll: rows flip to "Checking…" until their snapshot lands.
      setCheckingTargetId(keyword?.id ?? null);
      setCheckingSince(Date.parse(result.payload.checkStartedAt));
    } else {
      setCheckingTargetId(null);
      setCheckingSince(null);
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
          {t('trendNotEnoughData')}
        </p>
      );
    }
    return <RankTrendChart keyword={selectedKeyword} series={history} />;
  };

  if (!loaded) {
    return (
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
    );
  }
  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive" role="alert" data-testid="keywords-error">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          onClick={() =>
            void dispatch(
              loadKeywords({
                siteId,
                direction: 'initial',
                ...(requestedEngine ? { engine: requestedEngine } : {}),
              }),
            )
          }
        >
          {t('retry')}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <CadenceToggle
          cadence={cadence}
          disabled={updatingCadence}
          onChange={handleCadence}
        />
        <div className="flex items-center gap-3">
          <ReportExportControl
            kind="ranks.current"
            target={{ scope: 'site', siteId }}
            selection={requestedEngine ? { engine: requestedEngine } : {}}
            clipboardText={
              keywords.length > 0 ? `${keywords.map(({ phrase }) => phrase).join(',')},` : ''
            }
          />
          {selectedKeyword ? (
            <ReportExportControl
              kind="ranks.history"
              target={{ scope: 'site', siteId }}
              selection={{ keywordIds: [selectedKeyword.id] }}
            />
          ) : null}
          <Button asChild variant="outline" size="sm">
            <Link to={`/sites/${siteId}?tab=keyword-clusters`}>{t('keywordClusteringCta')}</Link>
          </Button>
          <div className="flex items-center gap-2" data-testid="engine-filter">
            <label className="text-muted-foreground text-sm" htmlFor="rank-engine-filter">
              {t('engine.filterLabel')}
            </label>
            <select
              id="rank-engine-filter"
              className="border-input bg-background cursor-pointer rounded-md border px-3 py-2 text-sm"
              value={engineFilter}
              onChange={(event) => setEngineFilter(event.target.value as RankEngine | 'all')}
            >
              <option value="all">{t('engine.filterAll')}</option>
              {RANK_ENGINES.map((option) => (
                <option key={option} value={option}>
                  {t(`engine.name.${option}`)}
                </option>
              ))}
            </select>
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
          {keywords.length > 0 ? (
            <RefreshButton
              onRefresh={() => void handleCheckNow()}
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
      {keywords.length === 0 ? (
        <Empty className="w-full" data-testid="keywords-empty">
          <EmptyHeader>
            <EmptyTitle>{t('emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('emptyDescription')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <KeywordsTable
          keywords={keywords}
          removingId={removingId}
          selectedId={selectedId}
          onSelect={handleSelect}
          onRemove={handleRemove}
          onCheck={(keyword) => void handleCheckNow(keyword)}
          checkingSince={checkingSince}
          checkingKeywordId={checkingTargetId}
          requestingKeywordId={requestingKeywordId}
        />
      )}
      {renderTrend()}
      <AddKeywordForm
        siteId={siteId}
        onSubmit={handleAdd}
        submitting={adding}
        addError={addError}
      />
    </div>
  );
};
