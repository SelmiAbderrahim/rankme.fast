/**
 * Report screen — Fix now / Watch / Passed.
 *
 * data-testid contract (used by Playwright):
 *   - report-tabs                          root Tabs list
 *   - report-tab-fix-now                   Fix now tab trigger
 *   - report-tab-watch                     Watch tab trigger
 *   - report-tab-passed                    Passed tab trigger
 *   - report-retest                        primary Retest CTA
 *   - report-issue-row                     one per issue row (any bucket)
 *   - report-issue-detail                  expanded row body
 *   - report-issue-copy                    copy-fix button in the detail
 *   - report-badge-fixed / -regressed      diff badges on affected rows
 *   - report-finding-fix / -dismiss        decision controls (latest run only)
 *   - report-finding-fixed / -dismissed    decision chips
 *   - report-finding-reappeared            marked fixed, still detected
 *   - report-finding-reopen                back to the open worklist
 *   - report-badge-severity-<sev>          severity badge on each row
 *   - report-loading                       skeleton state
 *   - report-empty-<tab>                   per-tab empty state
 *   - report-run-in-progress               run-in-progress banner
 *   - report-error                         inline error alert
 *   - report-no-run                        first-run empty state
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { ReportExportControl } from '@features/report-export';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Skeleton } from '@shared/ui/skeleton';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@shared/ui/empty';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@shared/ui/tabs';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  DEFAULT_REPORT_TAB,
  REPORT_TABS,
  useReportTab,
  type ReportTab,
} from '../tabState';
import { loadReport, pollRun, startRetest } from '../store/thunks';
import {
  selectReport,
  selectReportError,
  selectReportLoaded,
  selectReportLoading,
  selectReportRetestError,
  selectReportRetesting,
  selectReportRunId,
  selectReportRunStatus,
  selectReportSiteId,
} from '../store/selectors';
import type {
  DiffKind,
  LocalizedFinding,
} from '../types';
import { AiSummaryCard } from './AiSummaryCard';
import { IssueRow } from './IssueRow';
import { RetestConfirmDialog } from './RetestConfirmDialog';
import { RunHistory } from './RunHistory';
import { DocsLink } from '@shared/docs/DocsLink';
import {
  presentationRequestIdentity,
  usePresentationRefreshSignal,
} from '@shared/i18n';
import {
  actionsReducer,
  loadActions,
  nextActionsRequestSeq,
} from '@features/actions';
import { rootReducer } from '@app/store';

// The report surface maps findings onto unified actions, so
// the actions slice must exist on both the workspace-embedded and the
// standalone report routes. `combineSlices.inject` is idempotent by path.
rootReducer.inject({ reducerPath: 'actions', reducer: actionsReducer });

const POLL_INTERVAL_MS = 3000;

/** Stable empty-map sentinel so IssueRow doesn't rerender when a finding has no diff entries. */
const EMPTY_DIFF_BY_URL: Map<string, DiffKind> = new Map();

/**
 * Page-cap presets for the audit crawl. 'max' omits `requestedPageCap` so the
 * server clamps to its configured `audit_pages` ceiling; the numeric presets bound
 * the vendor's upfront per-run cost (billed on max_crawl_pages).
 */
const PAGE_CAP_MAX = 'max';
const PAGE_CAP_OPTIONS = ['10', '100', '500', '1000', PAGE_CAP_MAX] as const;

interface RuleDiff {
  kind: DiffKind | undefined;
  byUrl: Map<string, DiffKind>;
}

export const buildRuleDiffMap = (
  entries: readonly { ruleId: string; url: string; kind: DiffKind }[],
): Map<string, RuleDiff> => {
  const map = new Map<string, RuleDiff>();
  for (const entry of entries) {
    let bucket = map.get(entry.ruleId);
    if (!bucket) {
      bucket = { kind: undefined, byUrl: new Map<string, DiffKind>() };
      map.set(entry.ruleId, bucket);
    }
    if (entry.url) bucket.byUrl.set(entry.url, entry.kind);
    // Precedence: regressed > new > fixed. `new` maps to `regressed` in the
    // rule-level badge — the finding is worse than the previous snapshot.
    if (entry.kind === 'regressed' || entry.kind === 'new') {
      bucket.kind = 'regressed';
    } else if (entry.kind === 'fixed' && bucket.kind !== 'regressed') {
      bucket.kind = 'fixed';
    }
  }
  return map;
};

const filterByTab = (
  findings: LocalizedFinding[],
  tab: ReportTab,
): LocalizedFinding[] => findings.filter((f) => f.bucket === tab);

interface ReportPageProps {
  siteId?: string;
  runId?: string;
}

export const ReportPage = ({
  siteId: siteIdProp,
  runId: runIdProp,
}: ReportPageProps = {}) => {
  const { t } = useTranslation('report');
  const presentation = usePresentationRefreshSignal();
  const presentationLocale = presentation.locale;
  const requestIdentity = useMemo(
    () => ({
      presentationLocale,
      presentationGeneration: presentation.generation,
    }),
    [presentation.generation, presentationLocale],
  );
  const dispatch = useAppDispatch();
  const params = useParams<{ siteId: string; runId?: string }>();
  /* c8 ignore next -- route matcher guarantees params.siteId when the standalone route is used, and the prop path is exercised by the workspace embed test. */
  const siteId = siteIdProp ?? params.siteId ?? '';
  const runIdParam = runIdProp ?? params.runId;
  const [searchParams] = useSearchParams();
  const focusedRuleId = searchParams.get('finding');

  const [activeTab, setActiveTab] = useReportTab();
  // Local UI state (not navigation — the ?tab= rule does not apply).
  const [pageCap, setPageCap] = useState<string>(PAGE_CAP_MAX);
  // Retest confirmation dialog — opening it is a read-only
  // preview; only the in-dialog confirm dispatches the mutation.
  const [retestOpen, setRetestOpen] = useState(false);

  const loading = useAppSelector(selectReportLoading);
  const loaded = useAppSelector(selectReportLoaded);
  const error = useAppSelector(selectReportError);
  const report = useAppSelector(selectReport);
  const retesting = useAppSelector(selectReportRetesting);
  const retestError = useAppSelector(selectReportRetestError);
  const runId = useAppSelector(selectReportRunId);
  const runStatus = useAppSelector(selectReportRunStatus);
  const currentSiteId = useAppSelector(selectReportSiteId);

  const lastLoadKey = useRef<string>('');
  const lastPresentationRefresh = useRef(presentation.refreshGeneration);

  // Ref-mirrors of the preloaded-slice indicators — the mount effect reads
  // them without listing them in deps, so the pending fulfillment doesn't
  // re-run the effect and abort its own in-flight dispatch.
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const currentSiteIdRef = useRef(currentSiteId);
  currentSiteIdRef.current = currentSiteId;
  const runIdRef = useRef(runId);
  runIdRef.current = runId;

  useEffect(() => {
    // Skip on mount when the preloaded slice already matches the requested
    // (siteId, runIdParam) pair — the tests exercise error/empty states by
    // seeding the store, and a re-fetch would overwrite that seed. Deps are
    // limited to (siteId, runIdParam) so pending fulfillments don't re-run
    // this effect and abort their own in-flight dispatch.
    const presentationChanged =
      lastPresentationRefresh.current !== presentation.refreshGeneration;
    lastPresentationRefresh.current = presentation.refreshGeneration;
    const alreadyLoaded =
      !presentationChanged &&
      loadedRef.current &&
      currentSiteIdRef.current === siteId &&
      /* c8 ignore next -- second operand only reached when a deep-linked run's runId already matches state (test-only seed). */
      (runIdParam === undefined || runIdRef.current === runIdParam);
    lastLoadKey.current = `${siteId}::${runIdParam ?? ''}::${presentationLocale}`;
    if (alreadyLoaded) return;
    const p = dispatch(loadReport({ siteId, runId: runIdParam, ...requestIdentity }));
    return () => {
      p.abort();
    };
  }, [
    dispatch,
    presentation.generation,
    presentation.refreshGeneration,
    presentationLocale,
    requestIdentity,
    siteId,
    runIdParam,
  ]);

  // Poll the run while it's queued/running (retest just kicked off, for
  // example). Stops as soon as the run reaches a terminal state, at which
  // point we refetch the report so the tab counts refresh.
  useEffect(() => {
    if (!runId) return;
    if (runStatus !== 'queued' && runStatus !== 'running') return;
    let inFlight: { abort: () => void } | null = null;
    const timer = window.setInterval(() => {
      inFlight = dispatch(pollRun({ runId, ...requestIdentity }));
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      inFlight?.abort();
    };
  }, [dispatch, requestIdentity, runId, runStatus]);

  const finishedRunRef = useRef<string | null>(null);
  useEffect(() => {
    if (!runId || runStatus !== 'succeeded') return;
    /* c8 ignore next -- defensive guard against React StrictMode double-invocation; the effect deps guarantee at most one dispatch per (runId, runStatus) transition in practice. */
    if (finishedRunRef.current === runId) return;
    finishedRunRef.current = runId;
    // Force refetch after a run finishes — bypass the dedupe guard above.
    lastLoadKey.current = '';
    const p = dispatch(loadReport({ siteId, runId, ...requestIdentity }));
    return () => {
      p.abort();
    };
  }, [dispatch, requestIdentity, runId, runStatus, siteId]);

  // Load the audit-sourced actions for the current run so findings can map
  // onto their unified action identity. A stored-data read —
  // never a vendor call. Keyed on (siteId, runId): a completed retest swaps
  // the runId and refreshes the mapping exactly once.
  const hasReport = Boolean(report);
  useEffect(() => {
    if (!hasReport || !runId) return;
    const promise = dispatch(
      loadActions({
        siteId,
        filters: { source: ['audit_finding'] },
        // Without an explicit limit the server serves 20 and the remaining
        // rows silently lose their controls.
        limit: 50,
        requestSeq: nextActionsRequestSeq(),
        ...requestIdentity,
      }),
    );
    return () => {
      promise.abort();
    };
  }, [dispatch, hasReport, requestIdentity, runId, siteId]);

  // Finding decisions are site-level (per rule), so they may only be taken
  // from the latest report — a URL that pins an explicit run is a historical
  // view.
  // ponytail: `no :runId` == latest; refine against `runs[0]` if pinning the
  // latest run explicitly needs the controls too.
  const isLatestRun = runIdParam === undefined;

  const counts = report?.counts ?? { fixNow: 0, watch: 0, passed: 0 };
  const diffEntries = useMemo(() => report?.diff.entries ?? [], [report]);

  const diffMap = useMemo(() => buildRuleDiffMap(diffEntries), [diffEntries]);

  const findingsByTab = useMemo(() => {
    const findings = report?.findings ?? [];
    const map: Record<ReportTab, LocalizedFinding[]> = {
      'fix-now': [],
      watch: [],
      passed: [],
    };
    for (const tab of REPORT_TABS) {
      map[tab] = filterByTab(findings, tab);
    }
    return map;
  }, [report]);

  const focusedReportRef = useRef('');
  useEffect(() => {
    if (!focusedRuleId || !report) return;
    const finding = report.findings.find((item) => item.ruleId === focusedRuleId);
    if (!finding) return;
    const key = `${report.runId}:${finding.ruleId}`;
    if (focusedReportRef.current === key) return;
    focusedReportRef.current = key;
    if (activeTab !== finding.bucket) setActiveTab(finding.bucket);
  }, [activeTab, focusedRuleId, report, setActiveTab]);

  const countForTab: Record<ReportTab, number> = {
    'fix-now': counts.fixNow,
    watch: counts.watch,
    passed: counts.passed,
  };

  const handleRetest = async () => {
    const result = await dispatch(
      startRetest({
        siteId,
        ...(pageCap === PAGE_CAP_MAX
          ? {}
          : { requestedPageCap: Number(pageCap) }),
      }),
    );
    if (startRetest.fulfilled.match(result)) {
      lastLoadKey.current = '';
      setRetestOpen(false);
    }
  };

  const runInProgress =
    retesting || runStatus === 'queued' || runStatus === 'running';

  const pageCapPicker = (
    <Select value={pageCap} onValueChange={setPageCap} disabled={runInProgress}>
      <SelectTrigger
        size="sm"
        aria-label={t('pageCap.label')}
        data-testid="report-page-cap"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PAGE_CAP_OPTIONS.map((option) => (
          <SelectItem key={option} value={option}>
            {option === PAGE_CAP_MAX
              ? t('pageCap.max')
              : t('pageCap.pages', { pages: option })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const renderTabPanel = (tab: ReportTab) => {
    const items = findingsByTab[tab];
    if (items.length === 0) {
      return (
        <Empty className="w-full" data-testid={`report-empty-${tab}`}>
          <EmptyHeader>
            <EmptyTitle>{t(`empty.${tab}.title`)}</EmptyTitle>
            <EmptyDescription>{t(`empty.${tab}.description`)}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {items.map((finding) => {
          const bucket = diffMap.get(finding.ruleId);
          return (
            <IssueRow
              key={finding.ruleId}
              finding={finding}
              ruleDiffKind={bucket?.kind}
              diffByUrl={bucket?.byUrl ?? EMPTY_DIFF_BY_URL}
              pageSpeed={report?.pageSpeed ?? null}
              gscSearch={report?.gscSearch ?? null}
              gscSitemaps={report?.gscSitemaps ?? null}
              aiVisibility={report?.aiVisibility ?? null}
              localSeo={report?.localSeo ?? null}
              siteId={siteId}
              isLatestRun={isLatestRun}
              initiallyExpanded={finding.ruleId === focusedRuleId}
            />
          );
        })}
      </div>
    );
  };

  // ---------------- Global states ----------------
  if (loading || (!loaded && !error)) {
    return (
      <div
        className="px-4 py-8"
        aria-busy="true"
        aria-live="polite"
        data-testid="report-loading"
      >
        <p className="text-muted-foreground mb-4 text-sm">{t('states.loading')}</p>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-10 w-64" data-testid="report-skeleton" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-2/3" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-8">
        <Alert
          variant="destructive"
          role="alert"
          data-testid="report-error"
        >
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => {
            lastLoadKey.current = '';
            void dispatch(
              loadReport({
                siteId,
                runId: runIdParam,
                ...presentationRequestIdentity(),
              }),
            );
          }}
        >
          {t('states.retry')}
        </Button>
      </div>
    );
  }

  const runInFlight = runStatus === 'queued' || runStatus === 'running';
  const showNoRun =
    loaded && !report && !runInFlight && currentSiteId === siteId;
  if (showNoRun) {
    return (
      <div className="flex flex-col items-center gap-6 px-4 py-8">
        <Empty className="w-full max-w-md" data-testid="report-no-run">
          <EmptyHeader>
            <EmptyTitle>{t('noRun.title')}</EmptyTitle>
            <EmptyDescription>{t('noRun.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            onClick={() => setRetestOpen(true)}
            loading={retesting}
            loadingLabel={t('retest.starting')}
            data-testid="report-retest"
          >
            {retesting ? null : <RefreshCw aria-hidden="true" />}
            {t('retest.first')}
          </Button>
        </div>
        {retestError && !retestOpen ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{retestError}</AlertDescription>
          </Alert>
        ) : null}
        <RetestConfirmDialog
          open={retestOpen}
          onOpenChange={setRetestOpen}
          pageCapPicker={pageCapPicker}
          confirming={retesting}
          error={retestError}
          onConfirm={() => void handleRetest()}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
          <div className="mt-1">
            <DocsLink slug="audit-report" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {report && runId ? (
            <ReportExportControl
              kind="audit.run"
              target={{ scope: 'site_resource', siteId, resourceId: runId }}
              selection={{ buckets: [activeTab === 'fix-now' ? 'fixNow' : activeTab] }}
            />
          ) : null}
          <Button
            type="button"
            onClick={() => setRetestOpen(true)}
            loading={runInProgress}
            loadingLabel={t('retest.running')}
            data-testid="report-retest"
            aria-live="polite"
          >
            {runInProgress ? null : <RefreshCw aria-hidden="true" />}
            {t('retest.cta')}
          </Button>
        </div>
      </div>

      <RetestConfirmDialog
        open={retestOpen}
        onOpenChange={setRetestOpen}
        pageCapPicker={pageCapPicker}
        confirming={retesting}
        error={retestError}
        onConfirm={() => void handleRetest()}
      />

      {retestError && !retestOpen ? (
        <Alert
          variant="destructive"
          role="alert"
          data-testid="report-retest-error"
        >
          <AlertDescription>{retestError}</AlertDescription>
        </Alert>
      ) : null}

      {runInProgress ? (
        <Alert
          role="status"
          aria-live="polite"
          data-testid="report-run-in-progress"
        >
          <AlertDescription>{t('states.runInProgress')}</AlertDescription>
        </Alert>
      ) : null}

      {report?.aiSummaryEnabled && runId ? (
        <AiSummaryCard
          key={`${runId}:${presentationLocale}`}
          runId={runId}
          requestedLocale={presentationLocale}
          initial={
            report.aiSummaryAvailability
              ? report.aiSummaryAvailability.requestedLocale === presentationLocale
                ? (report.aiSummary ?? null)
                : null
              : report.aiSummary?.locale === presentationLocale
                ? report.aiSummary
                : null
          }
          initialStatus={
            report.aiSummaryAvailability?.requestedLocale === presentationLocale
              ? report.aiSummaryAvailability.status
              : report.aiSummary?.locale === presentationLocale
                ? report.aiSummaryStatus
                : 'idle'
          }
        />
      ) : null}

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ReportTab)}
        defaultValue={DEFAULT_REPORT_TAB}
      >
        <TabsList
          data-testid="report-tabs"
          className="h-auto w-full flex-wrap justify-start sm:w-fit"
        >
          {REPORT_TABS.map((tab) => (
            <TabsTrigger
              key={tab}
              value={tab}
              data-testid={`report-tab-${tab}`}
            >
              {t(`tabs.${tab}`)}
              <span className="text-muted-foreground ms-2 tabular-nums">
                ({countForTab[tab]})
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        {REPORT_TABS.map((tab) => (
          <TabsContent key={tab} value={tab} className="mt-4">
            {renderTabPanel(tab)}
          </TabsContent>
        ))}
      </Tabs>

      <RunHistory siteId={siteId} />
    </div>
  );
};
