import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@shared/api/client';
import { ReportExportControl } from '@features/report-export';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@shared/ui/accordion';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Checkbox } from '@shared/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import {
  fetchToxicityReview,
  fetchToxicityRuns,
  previewToxicityReview,
  startToxicityReview,
} from '../api';
import { serializeDisavowPreview } from '../disavow';
import type {
  DisavowSelection,
  SpendPreview,
  ToxicityBand,
  ToxicityRow,
  ToxicityRunDetail,
  ToxicityRunsPage,
  ToxicityRunStatus,
} from '../types';

const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
const BANDS = ['clean', 'watch', 'toxic'] as const;

type ErrorKind = 'disabled' | 'failed';
type SelectionState = Record<string, { included: boolean; kind: 'domain' | 'url' }>;

function typedStatus(value: string | null): ToxicityRunStatus | undefined {
  return RUN_STATUSES.find((status) => status === value);
}

function typedBand(value: string | null): ToxicityBand | undefined {
  return BANDS.find((band) => band === value);
}

function errorKind(error: unknown): ErrorKind {
  if (error instanceof ApiError && error.status === 503) return 'disabled';
  return 'failed';
}

function setSearchValue(
  location: ReturnType<typeof useLocation>,
  navigate: ReturnType<typeof useNavigate>,
  key: string,
  value: string | null,
): void {
  const params = new URLSearchParams(location.search);
  if (value) params.set(key, value);
  else params.delete(key);
  navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
}

export function ToxicityWorkspace({ siteId }: { siteId: string }) {
  const { i18n } = useTranslation('backlinks');
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const runId = params.get('toxRun');
  const status = typedStatus(params.get('toxStatus'));
  const band = typedBand(params.get('toxBand'));
  const [runs, setRuns] = useState<ToxicityRunsPage | null>(null);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState(false);
  const [detail, setDetail] = useState<ToxicityRunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);

  useEffect(() => {
    const rawStatus = new URLSearchParams(location.search).get('toxStatus');
    const rawBand = new URLSearchParams(location.search).get('toxBand');
    if (rawStatus && !typedStatus(rawStatus)) setSearchValue(location, navigate, 'toxStatus', null);
    if (rawBand && !typedBand(rawBand)) setSearchValue(location, navigate, 'toxBand', null);
  }, [location, navigate]);

  useEffect(() => {
    const controller = new AbortController();
    setRunsLoading(true);
    setRunsError(false);
    void fetchToxicityRuns(siteId, status, { signal: controller.signal })
      .then(setRuns)
      .catch(() => {
        if (!controller.signal.aborted) setRunsError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setRunsLoading(false);
      });
    return () => controller.abort();
  }, [siteId, status]);

  useEffect(() => {
    if (!runId) {
      setDetail(null);
      setDetailError(false);
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const load = async () => {
      controller = new AbortController();
      setDetailLoading(true);
      setDetailError(false);
      try {
        const result = await fetchToxicityReview(runId, undefined, {
          signal: controller.signal,
        });
        if (!active) return;
        setDetail(result);
        if (result.status === 'queued' || result.status === 'running') {
          timer = setTimeout(() => void load(), 1000);
        }
      } catch {
        // Cleanup marks this request inactive before aborting it, so the
        // explicit signal check would duplicate the same state guard.
        if (active) setDetailError(true);
      } finally {
        if (active) setDetailLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [runId]);

  return (
    <div className="flex flex-col gap-6" data-testid="toxicity-workspace" dir={i18n.dir()}>
      {runId ? (
        <ToxicityRunView
          detail={detail}
          loading={detailLoading}
          failed={detailError}
          band={band}
          setBand={(value) => setSearchValue(location, navigate, 'toxBand', value)}
          close={() => setSearchValue(location, navigate, 'toxRun', null)}
        />
      ) : (
        <ToxicityStartCard
          siteId={siteId}
          onStarted={(nextRunId) => setSearchValue(location, navigate, 'toxRun', nextRunId)}
        />
      )}
      <ToxicityRunList
        page={runs}
        loading={runsLoading}
        failed={runsError}
        status={status}
        setStatus={(value) => setSearchValue(location, navigate, 'toxStatus', value)}
        open={(nextRunId) => setSearchValue(location, navigate, 'toxRun', nextRunId)}
      />
    </div>
  );
}

function ToxicityStartCard({
  siteId,
  onStarted,
}: {
  siteId: string;
  onStarted: (runId: string) => void;
}) {
  const { t, i18n } = useTranslation('backlinks');
  const [preview, setPreview] = useState<SpendPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ErrorKind | null>(null);

  const requestPreview = async () => {
    setBusy(true);
    setFailure(null);
    try {
      setPreview(await previewToxicityReview(siteId));
    } catch (error) {
      setFailure(errorKind(error));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const started = await startToxicityReview(siteId, i18n.language);
      setPreview(null);
      onStarted(started.runId);
    } catch (error) {
      setFailure(errorKind(error));
    } finally {
      setBusy(false);
    }
  };

  if (failure === 'disabled') {
    return (
      <Card data-testid="toxicity-disabled">
        <CardHeader>
          <CardTitle>{t('toxicity.states.disabledTitle')}</CardTitle>
          <CardDescription>{t('toxicity.states.disabledBody')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card data-testid="toxicity-start">
      <CardHeader>
        <CardTitle>{t('toxicity.start.title')}</CardTitle>
        <CardDescription>{t('toxicity.start.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {preview ? (
          <div className="flex flex-col gap-4" data-testid="toxicity-preview">
            <div className="flex flex-wrap gap-2">
              <StatusChip tone="primary">{t('toxicity.preview.unit')}</StatusChip>
              <StatusChip tone="info">{t('toxicity.preview.rowClamp')}</StatusChip>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                loading={busy}
                onClick={() => void confirm()}
                data-testid="toxicity-confirm"
              >
                {t('toxicity.preview.confirm')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPreview(null)}
                data-testid="toxicity-cancel"
              >
                {t('toxicity.preview.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            loading={busy}
            onClick={() => void requestPreview()}
            data-testid="toxicity-preview-button"
          >
            {t('toxicity.preview.button')}
          </Button>
        )}
        {failure === 'failed' ? (
          <Alert variant="destructive" data-testid="toxicity-start-error">
            <AlertTitle>{t('toxicity.states.errorTitle')}</AlertTitle>
            <AlertDescription>{t('toxicity.states.errorBody')}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ToxicityRunList({
  page,
  loading,
  failed,
  status,
  setStatus,
  open,
}: {
  page: ToxicityRunsPage | null;
  loading: boolean;
  failed: boolean;
  status: ToxicityRunStatus | undefined;
  setStatus: (value: string | null) => void;
  open: (runId: string) => void;
}) {
  const { t, i18n } = useTranslation('backlinks');
  return (
    <Card data-testid="toxicity-run-list">
      <CardHeader>
        <CardTitle>{t('toxicity.runs.title')}</CardTitle>
        <CardDescription>{t('toxicity.runs.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Select
          value={status ?? 'all'}
          onValueChange={(value) => setStatus(value === 'all' ? null : value)}
        >
          <SelectTrigger
            aria-label={t('toxicity.filters.status')}
            data-testid="toxicity-status-filter"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('toxicity.filters.allStatuses')}</SelectItem>
            {RUN_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`toxicity.status.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {loading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : failed ? (
          <Alert variant="destructive">
            <AlertTitle>{t('toxicity.states.errorTitle')}</AlertTitle>
            <AlertDescription>{t('toxicity.states.listError')}</AlertDescription>
          </Alert>
        ) : !page || page.runs.length === 0 ? (
          <Empty data-testid="toxicity-runs-empty">
            <EmptyHeader>
              <EmptyTitle>{t('toxicity.runs.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('toxicity.runs.emptyBody')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <caption className="sr-only">{t('toxicity.runs.description')}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('toxicity.runs.date')}</TableHead>
                  <TableHead>{t('toxicity.runs.status')}</TableHead>
                  <TableHead>
                    <TableHeaderHelp
                      label={t('toxicity.runs.rows')}
                      description={t('common:tableHelp.toxicityRetainedRows')}
                    />
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">{t('toxicity.actions.open')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.runs.map((run) => (
                  <TableRow key={run.runId}>
                    <TableCell>{formatDate(run.createdAt, i18n.language)}</TableCell>
                    <TableCell>
                      <RunStatusChip status={run.status} />
                    </TableCell>
                    <TableCell>{run.retainedCount}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => open(run.runId)}
                      >
                        {t('toxicity.actions.open')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RunStatusChip({ status }: { status: ToxicityRunStatus }) {
  const { t } = useTranslation('backlinks');
  const tone: StatusTone =
    status === 'succeeded'
      ? 'success'
      : status === 'failed'
        ? 'destructive'
        : status === 'running'
          ? 'info'
          : 'muted';
  return <StatusChip tone={tone}>{t(`toxicity.status.${status}`)}</StatusChip>;
}

function ToxicityRunView({
  detail,
  loading,
  failed,
  band,
  setBand,
  close,
}: {
  detail: ToxicityRunDetail | null;
  loading: boolean;
  failed: boolean;
  band: ToxicityBand | undefined;
  setBand: (value: string | null) => void;
  close: () => void;
}) {
  const { t, i18n } = useTranslation('backlinks');
  if ((loading && !detail) || detail?.status === 'queued' || detail?.status === 'running') {
    return (
      <Card aria-busy="true" data-testid="toxicity-running">
        <CardHeader>
          <CardTitle>{t('toxicity.states.runningTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (failed || !detail) {
    return (
      <Alert variant="destructive" data-testid="toxicity-detail-error">
        <AlertTitle>{t('toxicity.states.errorTitle')}</AlertTitle>
        <AlertDescription>{t('toxicity.states.errorBody')}</AlertDescription>
      </Alert>
    );
  }
  if (detail.status === 'failed') {
    return (
      <Card data-testid="toxicity-failed">
        <CardHeader>
          <CardTitle>{t('toxicity.states.failedTitle')}</CardTitle>
          <CardDescription>
            {detail.refunded
              ? t('toxicity.states.providerRefunded')
              : t('toxicity.states.ceilingConsumed')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={close}>
            {t('toxicity.actions.back')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const visibleRows = band ? detail.rows.filter((row) => row.band === band) : detail.rows;
  return (
    <div className="flex flex-col gap-5" data-testid="toxicity-results">
      <Card>
        <CardHeader>
          <CardTitle>{t('toxicity.results.title')}</CardTitle>
          <CardDescription>{detail.domain}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <ReportExportControl
            kind="backlinks.toxicity_run"
            target={{ scope: 'site_resource', siteId: detail.siteId, resourceId: detail.runId }}
            selection={band ? { band } : {}}
          />
          <RunStatusChip status={detail.status} />
          <StatusChip tone="muted">
            {t('toxicity.results.rubric', { version: detail.rubricVersion })}
          </StatusChip>
          {detail.providerStatus === 'partial_failed' ? (
            <StatusChip tone="warning">{t('toxicity.states.partial')}</StatusChip>
          ) : null}
        </CardContent>
        <CardFooter>
          <Button type="button" variant="outline" onClick={close}>
            {t('toxicity.actions.back')}
          </Button>
        </CardFooter>
      </Card>
      {detail.rows.length === 0 ? (
        <Empty data-testid="toxicity-empty">
          <EmptyHeader>
            <EmptyTitle>{t('toxicity.states.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('toxicity.states.emptyBody')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('toxicity.results.rowsTitle')}</CardTitle>
              <CardDescription>{t('toxicity.results.observationCopy')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Select
                value={band ?? 'all'}
                onValueChange={(value) => setBand(value === 'all' ? null : value)}
              >
                <SelectTrigger
                  aria-label={t('toxicity.filters.band')}
                  data-testid="toxicity-band-filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('toxicity.filters.allBands')}</SelectItem>
                  {BANDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`toxicity.band.${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="overflow-x-auto">
                <Table data-testid="toxicity-table">
                  <caption className="sr-only">{t('toxicity.results.rowsTitle')}</caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('toxicity.columns.domain')}</TableHead>
                      <TableHead>
                        <TableHeaderHelp
                          label={t('toxicity.columns.score')}
                          description={t('common:tableHelp.toxicityScore')}
                        />
                      </TableHead>
                      <TableHead>
                        <TableHeaderHelp
                          label={t('toxicity.columns.band')}
                          description={t('common:tableHelp.rubricBand')}
                        />
                      </TableHead>
                      <TableHead>
                        <TableHeaderHelp
                          label={t('toxicity.columns.signals')}
                          description={t('common:tableHelp.contributingSignals')}
                        />
                      </TableHead>
                      <TableHead>{t('toxicity.columns.firstSeen')}</TableHead>
                      <TableHead>{t('toxicity.columns.lastSeen')}</TableHead>
                      <TableHead>
                        <TableHeaderHelp
                          label={t('toxicity.columns.rationale')}
                          description={t('common:tableHelp.rationale')}
                        />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleRows.map((row) => (
                      <ToxicityTableRow key={row.id} row={row} locale={i18n.language} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          <DisavowBuilder key={detail.runId} run={detail} />
        </>
      )}
    </div>
  );
}

function ToxicityTableRow({ row, locale }: { row: ToxicityRow; locale: string }) {
  const { t } = useTranslation('backlinks');
  return (
    <TableRow data-testid={`toxicity-row-${row.id}`}>
      <TableCell>
        <span className="block max-w-64 break-all" data-testid="toxicity-domain">
          {row.domain}
        </span>
      </TableCell>
      <TableCell>{row.spamScore}</TableCell>
      <TableCell>
        <BandChip band={row.band} />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {row.signals.map((signal) => (
            <StatusChip key={signal} tone="muted">
              {t(`toxicity.signal.${signal}`)}
            </StatusChip>
          ))}
        </div>
      </TableCell>
      <TableCell>{formatDate(row.firstSeen, locale)}</TableCell>
      <TableCell>{formatDate(row.lastSeen, locale)}</TableCell>
      <TableCell className="min-w-56">
        <Accordion type="single" collapsible>
          <AccordionItem value={row.id}>
            <AccordionTrigger className="py-2 text-sm">
              {t('toxicity.rationale.toggle')}
            </AccordionTrigger>
            <AccordionContent className="text-sm">
              {row.rationale.text ?? t(`toxicity.rationale.${row.rationale.status}`)}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </TableCell>
    </TableRow>
  );
}

function BandChip({ band }: { band: ToxicityBand }) {
  const { t } = useTranslation('backlinks');
  const tones: Record<ToxicityBand, StatusTone> = {
    clean: 'success',
    watch: 'warning',
    toxic: 'destructive',
  };
  return <StatusChip tone={tones[band]}>{t(`toxicity.band.${band}`)}</StatusChip>;
}

function initialSelection(rows: readonly ToxicityRow[]): SelectionState {
  return Object.fromEntries(
    rows.map((row) => [row.id, { included: row.band === 'toxic', kind: 'domain' as const }]),
  );
}

function DisavowBuilder({ run }: { run: ToxicityRunDetail }) {
  const { t } = useTranslation('backlinks');
  const [selection, setSelection] = useState<SelectionState>(() => initialSelection(run.rows));
  const [generatedOn] = useState(() => new Date());

  const entries: DisavowSelection[] = run.rows.flatMap((row) => {
    const state = selection[row.id]!;
    return state.included ? [{ rowId: row.id, kind: state.kind }] : [];
  });
  const preview = serializeDisavowPreview(run.rows, entries, run.rubricVersion, generatedOn);

  return (
    <Card data-testid="disavow-builder">
      <CardHeader>
        <CardTitle>{t('toxicity.disavow.title')}</CardTitle>
        <CardDescription>{t('toxicity.disavow.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="overflow-x-auto">
          <Table>
            <caption className="sr-only">{t('toxicity.disavow.selectionCaption')}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('toxicity.disavow.include')}</TableHead>
                <TableHead>{t('toxicity.columns.domain')}</TableHead>
                <TableHead>
                  <TableHeaderHelp
                    label={t('toxicity.columns.band')}
                    description={t('common:tableHelp.rubricBand')}
                  />
                </TableHead>
                <TableHead>
                  <TableHeaderHelp
                    label={t('toxicity.disavow.scope')}
                    description={t('common:tableHelp.disavowScope')}
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.rows.map((row) => (
                <DisavowSelectionRow
                  key={row.id}
                  row={row}
                  selection={selection}
                  setSelection={setSelection}
                />
              ))}
            </TableBody>
          </Table>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t('toxicity.disavow.preview')}</h3>
          <pre
            className="bg-muted max-h-72 overflow-auto border p-4 text-xs whitespace-pre-wrap"
            dir="ltr"
            data-testid="disavow-preview"
            aria-live="polite"
          >
            {preview}
          </pre>
        </div>
        <Alert data-testid="disavow-review-banner">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>{t('toxicity.disavow.reviewTitle')}</AlertTitle>
          <AlertDescription className="gap-3">
            <span>{t('toxicity.disavow.reviewBody')}</span>
            <ReportExportControl
              kind="backlinks.disavow"
              target={{ scope: 'site_resource', siteId: run.siteId, resourceId: run.runId }}
              selection={{ entries }}
            />
          </AlertDescription>
        </Alert>
        <p className="text-muted-foreground text-xs">{t('toxicity.results.providerObservation')}</p>
      </CardContent>
    </Card>
  );
}

function DisavowSelectionRow({
  row,
  selection,
  setSelection,
}: {
  row: ToxicityRow;
  selection: SelectionState;
  setSelection: Dispatch<SetStateAction<SelectionState>>;
}) {
  const { t } = useTranslation('backlinks');
  const state = selection[row.id]!;
  return (
    <TableRow>
      <TableCell>
        <Checkbox
          checked={state.included}
          onCheckedChange={(checked) =>
            setSelection((current) => ({
              ...current,
              [row.id]: { ...state, included: checked === true },
            }))
          }
          aria-label={t('toxicity.disavow.includeDomain', { domain: row.domain })}
        />
      </TableCell>
      <TableCell>
        <span className="block max-w-64 break-all">{row.domain}</span>
      </TableCell>
      <TableCell>
        <BandChip band={row.band} />
      </TableCell>
      <TableCell>
        <Select
          value={state.kind}
          onValueChange={(value: 'domain' | 'url') =>
            setSelection((current) => ({
              ...current,
              [row.id]: { ...state, kind: value },
            }))
          }
        >
          <SelectTrigger aria-label={t('toxicity.disavow.scopeFor', { domain: row.domain })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="domain">{t('toxicity.disavow.domainScope')}</SelectItem>
            <SelectItem value="url">{t('toxicity.disavow.urlScope')}</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
    </TableRow>
  );
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}
