import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ReportExportControl } from '@features/report-export';
import { CodeFixPromptButton } from '@shared/components/CodeFixPromptButton';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/ui/dialog';
import { Empty, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@shared/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@shared/ui/select';
import { Skeleton } from '@shared/ui/skeleton';
import { Spinner } from '@shared/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { Textarea } from '@shared/ui/textarea';
import { ApiError } from '@shared/api/client';
import { safeExternalHref } from '@shared/security';
import {
  getRecommendationApplicationCheck,
  getRecommendationOutcome,
  listRecommendationHistory,
  mutateRecommendation,
} from '../api';
import type {
  ContentAnalysis,
  ContentRecommendation,
  ContentRecommendationEvent,
  ContentRecommendationState,
  RecommendationApplicationCheck,
  RecommendationOutcome,
  RecommendationSeverity,
} from '../types';

interface RecommendationWorkflowProps {
  analysis: ContentAnalysis;
  onChanged: () => void;
}

type Action = 'accept' | 'dismiss' | 'apply' | 'undo';
const STATE_PARAM = 'recState';
const SEVERITY_PARAM = 'severity';
const STATE_FILTERS = ['all', 'suggested', 'accepted', 'dismissed', 'applied'] as const;
const SEVERITY_FILTERS = ['all', 'high', 'medium', 'low'] as const;

function isFilterValue<T extends readonly string[]>(
  values: T,
  value: string | null,
): value is T[number] {
  return value !== null && values.includes(value);
}

function severityFor(recommendation: ContentRecommendation): RecommendationSeverity {
  if (recommendation.confidence >= 0.8) return 'high';
  if (recommendation.confidence >= 0.5) return 'medium';
  return 'low';
}

function implicitState(
  recommendation: ContentRecommendation,
  analysisVersion: string,
): ContentRecommendationState {
  return {
    recommendationId: recommendation.id,
    analysisVersion,
    state: 'suggested',
    version: 0,
    actorUserId: null,
    stateChangedAt: null,
    appliedAt: null,
    baselineAnchorAt: null,
    contentHash: null,
    analysisContentHash: null,
    hashStatus: 'unavailable',
  };
}

function newClientKey(): string {
  return `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function errorText(error: unknown, fallback: string, conflict: string): string {
  if (error instanceof ApiError && error.status === 409) return conflict;
  return fallback;
}

function ActionDialog({
  action,
  open,
  pending,
  note,
  error,
  applicationCheck,
  applicationCheckLoading,
  onOpenChange,
  onNoteChange,
  onConfirm,
}: {
  action: Action | null;
  open: boolean;
  pending: boolean;
  note: string;
  error: string | null;
  applicationCheck: RecommendationApplicationCheck | null;
  applicationCheckLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onNoteChange: (note: string) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('contentIntelligence');
  if (!action) return null;
  const applyBlocked =
    action === 'apply' &&
    (applicationCheckLoading ||
      !applicationCheck?.available ||
      (applicationCheck.noteRequired && note.trim().length === 0));
  const noteInvalid =
    action === 'apply' && applicationCheck?.noteRequired === true && note.trim().length === 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`opportunities.confirm.${action}.title`)}</DialogTitle>
          <DialogDescription>{t(`opportunities.confirm.${action}.description`)}</DialogDescription>
        </DialogHeader>
        {action === 'apply' && applicationCheckLoading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
            <Spinner className="size-4" />
            {t('opportunities.applicationCheck.loading')}
          </div>
        ) : null}
        {action === 'apply' && applicationCheck?.hashStatus === 'same' ? (
          <Alert>
            <AlertTitle>{t('opportunities.applicationCheck.sameTitle')}</AlertTitle>
            <AlertDescription>
              {t('opportunities.applicationCheck.sameDescription')}
            </AlertDescription>
          </Alert>
        ) : null}
        {action === 'apply' && applicationCheck?.hashStatus === 'changed' ? (
          <Alert>
            <AlertTitle>{t('opportunities.applicationCheck.changedTitle')}</AlertTitle>
            <AlertDescription>
              {t('opportunities.applicationCheck.changedDescription')}
            </AlertDescription>
          </Alert>
        ) : null}
        {action === 'apply' && !applicationCheckLoading && applicationCheck?.available === false ? (
          <Alert variant="destructive">
            <AlertTitle>{t('opportunities.applicationCheck.unavailableTitle')}</AlertTitle>
            <AlertDescription>
              {t('opportunities.applicationCheck.unavailableDescription')}
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <FieldGroup>
          <Field data-invalid={noteInvalid || undefined}>
            <FieldLabel htmlFor="recommendation-note">{t('opportunities.noteLabel')}</FieldLabel>
            <Textarea
              id="recommendation-note"
              value={note}
              maxLength={4000}
              aria-invalid={noteInvalid || undefined}
              aria-describedby="recommendation-note-description"
              onChange={(event) => onNoteChange(event.target.value)}
            />
            <FieldDescription id="recommendation-note-description">
              {t('opportunities.noteHint')}
            </FieldDescription>
            {noteInvalid ? (
              <FieldError>{t('opportunities.applicationCheck.noteRequired')}</FieldError>
            ) : null}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{t('opportunities.cancel')}</Button>
          </DialogClose>
          <Button
            disabled={applyBlocked}
            loading={pending}
            loadingLabel={t('opportunities.updating')}
            onClick={onConfirm}
          >
            {t(`opportunities.confirm.${action}.confirm`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type OutcomePoint = NonNullable<RecommendationOutcome['series']>[number];

function OutcomeSyncAlert({ siteId }: { siteId: string }) {
  const { t } = useTranslation('contentIntelligence');
  return (
    <Alert>
      <AlertTitle>{t('opportunities.outcomes.unavailable')}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-3">
        <span>{t('opportunities.outcomes.syncAction')}</span>
        <Button asChild variant="outline" size="sm">
          <Link to={`/sites/${encodeURIComponent(siteId)}?tab=google`}>
            {t('opportunities.outcomes.syncButton')}
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function chartPoints(values: number[], higherIsBetter: boolean): string {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return values
    .map((value, index) => {
      const x = values.length <= 1 ? 50 : 5 + (index / (values.length - 1)) * 90;
      const ratio = maximum === minimum ? 0.5 : (value - minimum) / (maximum - minimum);
      const y = higherIsBetter ? 90 - ratio * 80 : 10 + ratio * 80;
      return `${x},${y}`;
    })
    .join(' ');
}

function OutcomeSeries({ source, points }: { source: 'gsc' | 'rank'; points: OutcomePoint[] }) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const number = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }),
    [i18n.language],
  );
  const percent = useMemo(
    () => new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 2 }),
    [i18n.language],
  );
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );
  const chartValues = points.flatMap((point) => {
    const value = source === 'rank' ? point.rankPosition : point.clicks;
    return value === null ? [] : [value];
  });
  if (points.length === 0) return null;
  return (
    <figure className="flex flex-col gap-2 rounded-md border p-3">
      <figcaption className="font-medium">
        {t(`opportunities.outcomes.series.${source}.title`)}
      </figcaption>
      {chartValues.length > 0 ? (
        <svg
          viewBox="0 0 100 100"
          role="img"
          aria-label={t(`opportunities.outcomes.series.${source}.chartLabel`)}
          className="h-40 w-full"
        >
          <polyline
            points={chartPoints(chartValues, source === 'gsc')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={source === 'gsc' ? 'text-chart-1' : 'text-chart-2'}
          />
        </svg>
      ) : null}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('opportunities.outcomes.observedDate')}</TableHead>
              <TableHead>{t('opportunities.outcomes.phase')}</TableHead>
              {source === 'gsc' ? (
                <>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('opportunities.outcomes.metrics.clicks')}
                      description={t('common:tableHelp.clicks')}
                    />
                  </TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('opportunities.outcomes.metrics.impressions')}
                      description={t('common:tableHelp.impressions')}
                    />
                  </TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('opportunities.outcomes.metrics.ctr')}
                      description={t('common:tableHelp.ctr')}
                    />
                  </TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('opportunities.outcomes.metrics.averagePosition')}
                      description={t('common:tableHelp.averagePosition')}
                    />
                  </TableHead>
                </>
              ) : (
                <TableHead className="text-end">
                  <TableHeaderHelp
                    label={t('opportunities.outcomes.metrics.rankPosition')}
                    description={t('common:tableHelp.position')}
                  />
                </TableHead>
              )}
              <TableHead>{t('opportunities.outcomes.laterEditColumn')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((point) => (
              <TableRow key={`${point.source}-${point.observedAt}`}>
                <TableCell>{date.format(new Date(point.observedAt))}</TableCell>
                <TableCell>{t(`opportunities.outcomes.phases.${point.phase}`)}</TableCell>
                {source === 'gsc' ? (
                  <>
                    <TableCell className="text-end">
                      {point.clicks === null ? '—' : number.format(point.clicks)}
                    </TableCell>
                    <TableCell className="text-end">
                      {point.impressions === null ? '—' : number.format(point.impressions)}
                    </TableCell>
                    <TableCell className="text-end">
                      {point.ctr === null ? '—' : percent.format(point.ctr)}
                    </TableCell>
                    <TableCell className="text-end">
                      {point.averagePosition === null ? '—' : number.format(point.averagePosition)}
                    </TableCell>
                  </>
                ) : (
                  <TableCell className="text-end">
                    {point.rankPosition === null ? '—' : number.format(point.rankPosition)}
                  </TableCell>
                )}
                <TableCell>
                  {t(`opportunities.outcomes.boolean.${point.laterEdit ? 'yes' : 'no'}`)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </figure>
  );
}

function OutcomeView({ outcome, siteId }: { outcome: RecommendationOutcome; siteId: string }) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const number = useMemo(
    () => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }),
    [i18n.language],
  );
  const percent = useMemo(
    () => new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 2 }),
    [i18n.language],
  );
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );
  if (!outcome.available || !outcome.metrics || !outcome.coverage || !outcome.window) {
    return <OutcomeSyncAlert siteId={siteId} />;
  }
  const metrics = [
    ['clicks', outcome.metrics.clicks],
    ['impressions', outcome.metrics.impressions],
    ['ctr', outcome.metrics.ctr],
    ['averagePosition', outcome.metrics.averagePosition],
    ['rankPosition', outcome.metrics.rankPosition],
  ] as const;
  const formatMetric = (key: (typeof metrics)[number][0], value: number | null) => {
    if (value === null) return '—';
    return key === 'ctr' ? percent.format(value) : number.format(value);
  };
  const gscSeries = (outcome.series ?? []).filter((point) => point.source === 'gsc');
  const rankSeries = (outcome.series ?? []).filter((point) => point.source === 'rank');
  const baselineLastDay = new Date(
    new Date(outcome.window.baselineEnd).getTime() - 24 * 60 * 60 * 1000,
  );
  const followingLastDay = new Date(
    new Date(outcome.window.followingEnd).getTime() - 24 * 60 * 60 * 1000,
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {t('opportunities.outcomes.observedAfter', {
          date: outcome.appliedAt ? date.format(new Date(outcome.appliedAt)) : '',
        })}
      </p>
      <div className="text-muted-foreground flex flex-col gap-1 text-sm">
        <span>
          {t('opportunities.outcomes.baseline')}:{' '}
          {date.format(new Date(outcome.window.baselineStart))}
          {' – '}
          {date.format(baselineLastDay)}
        </span>
        <span>
          {t('opportunities.outcomes.following')}:{' '}
          {date.format(new Date(outcome.window.followingStart))}
          {' – '}
          {date.format(followingLastDay)}
        </span>
      </div>
      <div className="flex flex-col gap-1 rounded-md border p-3 text-sm">
        <span className="font-medium">{t('opportunities.outcomes.hashAnchor')}</span>
        <code dir="ltr" className="text-muted-foreground break-all">
          {outcome.contentHash ?? '—'}
        </code>
        <span className="text-muted-foreground">
          {t(`opportunities.hash.${outcome.hashStatus ?? 'unavailable'}`)}
        </span>
      </div>
      {outcome.dataAvailable === false ? <OutcomeSyncAlert siteId={siteId} /> : null}
      {!outcome.window.complete ? (
        <Alert>
          <AlertDescription>{t('opportunities.outcomes.windowIncomplete')}</AlertDescription>
        </Alert>
      ) : null}
      {outcome.laterEdit ? (
        <Alert>
          <AlertDescription>{t('opportunities.outcomes.laterEdit')}</AlertDescription>
        </Alert>
      ) : null}
      {outcome.coverage.gsc.completeness === 'unavailable' ||
      outcome.coverage.rank.completeness === 'unavailable' ? (
        <Alert>
          <AlertDescription>{t('opportunities.outcomes.sourceUnavailable')}</AlertDescription>
        </Alert>
      ) : null}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('opportunities.outcomes.metric')}</TableHead>
              <TableHead className="text-end">{t('opportunities.outcomes.baseline')}</TableHead>
              <TableHead className="text-end">{t('opportunities.outcomes.following')}</TableHead>
              <TableHead className="text-end">
                <TableHeaderHelp
                  label={t('opportunities.outcomes.delta')}
                  description={t('common:tableHelp.absoluteChange')}
                />
              </TableHead>
              <TableHead className="text-end">
                <TableHeaderHelp
                  label={t('opportunities.outcomes.relativeDelta')}
                  description={t('common:tableHelp.relativeChange')}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {metrics.map(([key, value]) => (
              <TableRow key={key}>
                <TableCell>{t(`opportunities.outcomes.metrics.${key}`)}</TableCell>
                <TableCell className="text-end">{formatMetric(key, value.baseline)}</TableCell>
                <TableCell className="text-end">{formatMetric(key, value.following)}</TableCell>
                <TableCell className="text-end">
                  {formatMetric(key, value.delta.absolute)}
                </TableCell>
                <TableCell className="text-end">
                  {value.delta.relative === null ? '—' : percent.format(value.delta.relative)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <OutcomeSeries source="gsc" points={gscSeries} />
      <OutcomeSeries source="rank" points={rankSeries} />
      <p className="text-muted-foreground text-xs">
        {t('opportunities.outcomes.coverage', {
          gsc: `${outcome.coverage.gsc.followingDays}/${outcome.coverage.gsc.expectedDays}`,
          rank: `${outcome.coverage.rank.followingDays}/${outcome.coverage.rank.expectedDays}`,
        })}
      </p>
      <div className="text-muted-foreground flex flex-col gap-1 text-xs">
        <span>
          {t('opportunities.outcomes.series.gsc.title')} —{' '}
          {t('opportunities.confidence', {
            value: t(`opportunities.severities.${outcome.coverage.gsc.confidence}`),
          })}
        </span>
        <span>
          {t('opportunities.outcomes.series.rank.title')} —{' '}
          {t('opportunities.confidence', {
            value: t(`opportunities.severities.${outcome.coverage.rank.confidence}`),
          })}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">{t('opportunities.outcomes.disclaimer')}</p>
    </div>
  );
}

export function RecommendationWorkflow({ analysis, onChanged }: RecommendationWorkflowProps) {
  const { t, i18n } = useTranslation('contentIntelligence');
  const [params, setParams] = useSearchParams();
  const rawStateFilter = params.get(STATE_PARAM);
  const rawSeverityFilter = params.get(SEVERITY_PARAM);
  const stateFilter = isFilterValue(STATE_FILTERS, rawStateFilter) ? rawStateFilter : 'all';
  const severityFilter = isFilterValue(SEVERITY_FILTERS, rawSeverityFilter)
    ? rawSeverityFilter
    : 'all';

  useEffect(() => {
    const next = new URLSearchParams(params);
    let changed = false;
    if (rawStateFilter !== null && !isFilterValue(STATE_FILTERS, rawStateFilter)) {
      next.delete(STATE_PARAM);
      changed = true;
    }
    if (rawSeverityFilter !== null && !isFilterValue(SEVERITY_FILTERS, rawSeverityFilter)) {
      next.delete(SEVERITY_PARAM);
      changed = true;
    }
    if (changed) setParams(next, { replace: true });
  }, [params, rawSeverityFilter, rawStateFilter, setParams]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applicationCheck, setApplicationCheck] = useState<RecommendationApplicationCheck | null>(
    null,
  );
  const [applicationCheckLoading, setApplicationCheckLoading] = useState(false);
  const [history, setHistory] = useState<ContentRecommendationEvent[] | null>(null);
  const [outcome, setOutcome] = useState<RecommendationOutcome | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  );
  const number = useMemo(
    () => new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 }),
    [i18n.language],
  );

  const stateById = useMemo(
    () => new Map(analysis.recommendationStates.map((state) => [state.recommendationId, state])),
    [analysis.recommendationStates],
  );
  const recommendations = useMemo(
    () =>
      analysis.recommendations.filter((recommendation) => {
        const state = stateById.get(recommendation.id)?.state ?? 'suggested';
        return (
          (stateFilter === 'all' || state === stateFilter) &&
          (severityFilter === 'all' || severityFor(recommendation) === severityFilter)
        );
      }),
    [analysis.recommendations, severityFilter, stateById, stateFilter],
  );

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params);
      if (value === 'all') next.delete(key);
      else next.set(key, value);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const openAction = useCallback(
    (recommendationId: string, nextAction: Action) => {
      setSelectedId(recommendationId);
      setAction(nextAction);
      setNote('');
      setError(null);
      setApplicationCheck(null);
      if (nextAction !== 'apply') return;
      setApplicationCheckLoading(true);
      void getRecommendationApplicationCheck(analysis.analysisId, recommendationId)
        .then(setApplicationCheck)
        .catch((caught: unknown) => {
          setError(
            errorText(
              caught,
              t('opportunities.applicationCheck.error'),
              t('opportunities.errors.conflict'),
            ),
          );
        })
        .finally(() => setApplicationCheckLoading(false));
    },
    [analysis.analysisId, t],
  );

  const confirmAction = useCallback(
    async (recommendationId: string, nextAction: Action) => {
      const recommendation = analysis.recommendations.find((item) => item.id === recommendationId)!;
      const current =
        stateById.get(recommendationId) ?? implicitState(recommendation, analysis.schemaVersion);
      setPending(true);
      setError(null);
      try {
        await mutateRecommendation({
          analysisId: analysis.analysisId,
          recommendationId,
          action: nextAction,
          analysisVersion: analysis.schemaVersion,
          expectedVersion: current.version,
          clientKey: newClientKey(),
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        toast.success(t('opportunities.success'));
        setAction(null);
        setApplicationCheck(null);
        onChanged();
      } catch (caught) {
        setError(
          errorText(caught, t('opportunities.errors.generic'), t('opportunities.errors.conflict')),
        );
      } finally {
        setPending(false);
      }
    },
    [analysis, note, onChanged, stateById, t],
  );

  const loadDetails = useCallback(
    async (recommendationId: string) => {
      setSelectedId(recommendationId);
      setDetailLoading(true);
      setError(null);
      try {
        const [historyResult, outcomeResult] = await Promise.all([
          listRecommendationHistory(analysis.analysisId, recommendationId),
          getRecommendationOutcome(analysis.analysisId, recommendationId),
        ]);
        setHistory(historyResult.events);
        setOutcome(outcomeResult);
      } catch (caught) {
        setError(
          errorText(caught, t('opportunities.errors.generic'), t('opportunities.errors.conflict')),
        );
      } finally {
        setDetailLoading(false);
      }
    },
    [analysis.analysisId, t],
  );

  useEffect(() => {
    setHistory(null);
    setOutcome(null);
  }, [analysis.analysisId]);

  return (
    <Card data-testid="recommendation-workflow">
      <CardHeader>
        <CardTitle>{t('opportunities.title')}</CardTitle>
        <CardDescription>{t('opportunities.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="recommendation-state-filter">
              {t('opportunities.filters.state')}
            </FieldLabel>
            <Select value={stateFilter} onValueChange={(value) => updateFilter(STATE_PARAM, value)}>
              <SelectTrigger id="recommendation-state-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t('opportunities.filters.state')}</SelectLabel>
                  {STATE_FILTERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`opportunities.states.${value}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="recommendation-severity-filter">
              {t('opportunities.filters.severity')}
            </FieldLabel>
            <Select
              value={severityFilter}
              onValueChange={(value) => updateFilter(SEVERITY_PARAM, value)}
            >
              <SelectTrigger id="recommendation-severity-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t('opportunities.filters.severity')}</SelectLabel>
                  {SEVERITY_FILTERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`opportunities.severities.${value}`)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>
        {error && action === null ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {recommendations.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t('opportunities.empty')}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            {recommendations.map((recommendation) => {
              const current =
                stateById.get(recommendation.id) ??
                implicitState(recommendation, analysis.schemaVersion);
              const severity = severityFor(recommendation);
              const evidence = recommendation.evidenceSourceIds.map((sourceId) => ({
                sourceId,
                citation: analysis.citations.find((citation) => citation.sourceId === sourceId),
              }));
              return (
                <section
                  key={recommendation.id}
                  className="rounded-xl border p-4"
                  aria-labelledby={`rec-${recommendation.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-col gap-1">
                      <h3 id={`rec-${recommendation.id}`} className="font-semibold">
                        {t('opportunities.recommendationLabel', {
                          section: t(`detail.sections.${recommendation.section}`),
                          direction: t(`opportunities.directions.${recommendation.direction}`),
                        })}
                      </h3>
                      <p className="text-muted-foreground text-sm">
                        {t('opportunities.confidence', {
                          value: number.format(recommendation.confidence),
                        })}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{t(`opportunities.severities.${severity}`)}</Badge>
                      <Badge variant="outline">{t(`opportunities.states.${current.state}`)}</Badge>
                    </div>
                  </div>
                  <p className="mt-3 text-sm">
                    <span className="font-medium">{t('opportunities.rationale')}: </span>
                    {recommendation.message}
                  </p>
                  <div className="mt-3 flex flex-col gap-1 text-sm">
                    <p className="font-medium">
                      {t('opportunities.evidence', { count: evidence.length })}
                    </p>
                    {evidence.length > 0 ? (
                      <ul className="flex list-disc flex-col gap-1 ps-5">
                        {evidence.map(({ sourceId, citation }) => {
                          const href = citation ? safeExternalHref(citation.url) : '#';
                          return (
                            <li key={sourceId}>
                              {citation && href !== '#' ? (
                                <a href={href} target="_blank" rel="nofollow ugc noopener noreferrer">
                                  {citation.title ?? citation.url}
                                </a>
                              ) : (
                                <span>{citation?.title ?? t('opportunities.ownedEvidence')}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {recommendation.codeFixPromptAvailable ? (
                      <CodeFixPromptButton
                        input={{
                          reference: recommendation.ruleId,
                          severity,
                          confidence: number.format(recommendation.confidence),
                          problem: t('opportunities.recommendationLabel', {
                            section: t(`detail.sections.${recommendation.section}`),
                            direction: t(`opportunities.directions.${recommendation.direction}`),
                          }),
                          whyItMatters: recommendation.message,
                          recommendedFix: recommendation.message,
                          affectedUrls: [analysis.ownedUrl],
                          affectedUrlCount: 1,
                        }}
                      />
                    ) : null}
                    {current.state === 'suggested' || current.state === 'dismissed' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openAction(recommendation.id, 'accept')}
                      >
                        {t('opportunities.actions.accept')}
                      </Button>
                    ) : null}
                    {current.state === 'suggested' || current.state === 'accepted' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openAction(recommendation.id, 'dismiss')}
                      >
                        {t('opportunities.actions.dismiss')}
                      </Button>
                    ) : null}
                    {current.state === 'accepted' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openAction(recommendation.id, 'apply')}
                      >
                        {t('opportunities.actions.apply')}
                      </Button>
                    ) : null}
                    {current.state === 'applied' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openAction(recommendation.id, 'undo')}
                      >
                        {t('opportunities.actions.undo')}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void loadDetails(recommendation.id)}
                    >
                      {t('opportunities.actions.details')}
                    </Button>
                  </div>
                </section>
              );
            })}
          </div>
        )}
        {detailLoading ? <Skeleton className="h-32 w-full" /> : null}
        {selectedId && history ? (
          <section className="flex flex-col gap-3" aria-labelledby="recommendation-history-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id="recommendation-history-title" className="font-semibold">
                {t('opportunities.history.title')}
              </h3>
              {outcome ? (
                <ReportExportControl
                  kind="content.recommendation_outcome"
                  target={{
                    scope: 'site_resource',
                    siteId: analysis.siteId,
                    resourceId: analysis.analysisId,
                  }}
                  selection={{}}
                />
              ) : null}
            </div>
            {history.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t('opportunities.history.empty')}</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {history.map((event) => (
                  <li key={event.id} className="rounded-md border p-3 text-sm">
                    <p>{t(`opportunities.history.events.${event.eventKind}`)}</p>
                    <p className="text-muted-foreground">
                      {t('opportunities.history.meta', {
                        actor: event.actorUserId,
                        time: date.format(new Date(event.recordedAt)),
                      })}
                    </p>
                    {event.note ? <p>{event.note}</p> : null}
                    <p className="text-muted-foreground">
                      {t(`opportunities.hash.${event.hashStatus}`)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {outcome ? <OutcomeView outcome={outcome} siteId={analysis.siteId} /> : null}
          </section>
        ) : null}
      </CardContent>
      <ActionDialog
        action={action}
        open={action !== null}
        pending={pending}
        note={note}
        error={error}
        applicationCheck={applicationCheck}
        applicationCheckLoading={applicationCheckLoading}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setAction(null);
            setApplicationCheck(null);
          }
        }}
        onNoteChange={setNote}
        onConfirm={() => void confirmAction(selectedId!, action!)}
      />
    </Card>
  );
}
