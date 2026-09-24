/**
 * Live Keyword Trends standalone view.
 *
 * NEW sibling to the Labs `TrendsView.tsx` (the historical-volume surface).
 * This view reads the live `TrendsProvider.explore` surface. Every readout carries `source=estimate` and the
 * localized `searchInterestIndex` coverage note because the 0..100 index is
 * NOT absolute search volume — the client renders that note verbatim from
 * the DTO.
 *
 * States modelled:
 *   idle · previewing · submitting · succeeded · sparse-history-honest ·
 *   failed · kill-switch-disabled · Arabic-RTL parity.
 *
 * Every clickable interaction ships pointer/disabled semantics via the
 * shared `Button` primitive (`interaction-hygiene` rule). Every user-facing
 * string flows through `t(...)` so the six sibling locales can be added
 * without touching component text.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import { ReportExportControl } from '@features/report-export';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { MarketSelects } from './MarketSelects';
import { PhraseChipsInput } from './PhraseChipsInput';
import { keywordSlug } from './KeywordResearchPanel';
import { clearLiveTrendsPreview, resetLiveTrends } from '../store/slice';
import {
  exploreLiveTrends,
  loadLiveTrendsList,
  loadLiveTrendsRun,
  previewLiveTrends,
} from '../store/thunks';
import {
  selectLiveTrendsList,
  selectLiveTrendsPreview,
  selectLiveTrendsRun,
  selectLiveTrendsStoredRun,
} from '../store/selectors';
import {
  DEFAULT_LIVE_TRENDS_GEO,
  DEFAULT_LIVE_TRENDS_LANGUAGE,
  LIVE_TRENDS_MAX_QUERY_CHARS,
  LIVE_TRENDS_PHRASE_MAX,
  LIVE_TRENDS_PHRASE_MAX_LENGTH,
  geoToLocationCode,
  liveTrendsFormSchema,
  locationCodeToGeo,
  normalizeLiveTrendsKeywords,
} from '../validation';
import {
  LIVE_TRENDS_HISTORY_FILTERS,
  useLiveTrendsQuery,
  type LiveTrendsHistoryFilter,
} from '../tabState';
import type {
  TrendsExplorationDto,
  TrendsReadoutDto,
  TrendsRelatedQueryDto,
  TrendsSeriesDto,
  TrendsSpendPreview,
  TrendsStoredRunSummary,
} from '../types';

/** Deterministic five-slot chart palette matches `--chart-1..5` tokens. */
const CHART_STROKE_CLASSES = [
  'stroke-highlight',
  'stroke-chart-2',
  'stroke-chart-3',
  'stroke-chart-4',
  'stroke-chart-5',
] as const;
const CHART_FILL_CLASSES = [
  'fill-highlight/10',
  'fill-chart-2/10',
  'fill-chart-3/10',
  'fill-chart-4/10',
  'fill-chart-5/10',
] as const;
const CHART_DOT_CLASSES = [
  'bg-highlight',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-5',
] as const;

interface OrderedPoint {
  year: number;
  month: number;
  value: number;
}

function orderPoints(points: readonly OrderedPoint[]): OrderedPoint[] {
  return [...points].sort((a, b) => (a.year !== b.year ? a.year - b.year : a.month - b.month));
}

/**
 * Multi-series overlay chart. Uses the shared `--chart-*` palette when 2+
 * series are present; the single-series case stays on `--highlight` to match
 * the Labs `TrendsChart` visual. Every series is `aria-hidden` so screen
 * readers hit the data-table fallback rendered below.
 */
function MultiSeriesOverlay({
  series,
}: {
  series: readonly { keyword: string; ordered: OrderedPoint[] }[];
}) {
  const nonEmpty = series.filter((s) => s.ordered.length >= 2);
  if (nonEmpty.length === 0) return null;
  const width = 320;
  const height = 96;
  const max = Math.max(1, ...nonEmpty.flatMap((s) => s.ordered.map((p) => p.value)));
  const maxLen = Math.max(...nonEmpty.map((s) => s.ordered.length));
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-24 w-full max-w-full"
      aria-hidden="true"
      focusable="false"
      data-testid="live-trends-chart"
    >
      {nonEmpty.map((s, seriesIdx) => {
        const step = width / Math.max(1, maxLen - 1);
        const pts = s.ordered.map((p, i) => {
          const x = i * step;
          const y = height - (p.value / max) * (height - 6) - 3;
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        const area = `0,${height} ${pts.join(' ')} ${(pts.length - 1) * step},${height}`;
        const strokeCls = CHART_STROKE_CLASSES[seriesIdx] ?? CHART_STROKE_CLASSES[0]!;
        const fillCls = CHART_FILL_CLASSES[seriesIdx] ?? CHART_FILL_CLASSES[0]!;
        return (
          <g key={s.keyword} data-testid={`live-trends-chart-series-${keywordSlug(s.keyword)}`}>
            <polygon points={area} className={fillCls} />
            <polyline
              points={pts.join(' ')}
              fill="none"
              className={strokeCls}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        );
      })}
    </svg>
  );
}

function ChartLegend({ series }: { series: readonly { keyword: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-2 text-xs" data-testid="live-trends-chart-legend">
      {series.map((s, i) => (
        <li
          key={s.keyword}
          className="border-border inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5"
        >
          <span
            aria-hidden="true"
            className={`inline-block size-2 rounded-full ${CHART_DOT_CLASSES[i] ?? CHART_DOT_CLASSES[0]!}`}
          />
          <span>{s.keyword}</span>
        </li>
      ))}
    </ul>
  );
}

/** RTL-safe accessible data-table fallback (every chart has one). */
function SeriesDataTable({ series }: { series: readonly TrendsSeriesDto[] }) {
  const { t, i18n } = useTranslation();
  const fmt = new Intl.NumberFormat(i18n.language);
  const monthLabel = (m: number) => t(`keywordResearch:trends.monthName.${m}`);
  return (
    <div className="overflow-x-auto">
      <Table data-testid="live-trends-table">
        <caption className="sr-only">{t('keywordResearch:liveTrends.tableCaption')}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{t('keywordResearch:trends.columnKeyword')}</TableHead>
            <TableHead>{t('keywordResearch:trends.columnMonth')}</TableHead>
            <TableHead className="text-end">
              <TableHeaderHelp
                label={t('keywordResearch:liveTrends.columnIndex')}
                description={t('common:tableHelp.trend')}
              />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {series.flatMap((s) => {
            const ordered = orderPoints(s.points);
            return ordered.map((p) => (
              <TableRow key={`${s.keyword}-${p.year}-${p.month}`}>
                <TableCell className="break-words">{s.keyword}</TableCell>
                <TableCell>
                  {monthLabel(p.month)} {p.year}
                </TableCell>
                <TableCell className="text-end tabular-nums">{fmt.format(p.value)}</TableCell>
              </TableRow>
            ));
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Estimate label chip — attaches the coverage-note key text on hover/focus. */
/** Server ships coverage-note keys as `keywordResearch.trends.coverageNote.*`
 *  (dot-separated). i18next expects `keywordResearch:trends.coverageNote.*`
 *  (colon namespace separator) — translate the first dot into a colon so the
 *  lookup resolves without touching the server DTO. */
function toClientI18nKey(serverKey: string): string {
  const idx = serverKey.indexOf('.');
  if (idx < 0) return serverKey;
  return `${serverKey.slice(0, idx)}:${serverKey.slice(idx + 1)}`;
}

function EstimateBadge({ noteKey }: { noteKey: string }) {
  const { t } = useTranslation();
  const note = t(toClientI18nKey(noteKey));
  return (
    <span
      className="border-border bg-muted inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
      title={note}
      data-testid="live-trends-estimate-chip"
    >
      {t('keywordResearch:liveTrends.estimateLabel')}
    </span>
  );
}

function directionBadgeTone(
  direction: TrendsReadoutDto['momentum']['direction'],
): 'success' | 'destructive' | 'muted' {
  if (direction === 'up') return 'success';
  if (direction === 'down') return 'destructive';
  return 'muted';
}

function ReadoutsRow({ keyword, readouts }: { keyword: string; readouts: TrendsReadoutDto }) {
  const { t, i18n } = useTranslation();
  const slug = keywordSlug(keyword);
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  });
  const monthName = (m: number) => t(`keywordResearch:trends.monthName.${m}`);
  const noteKey = readouts.yoy.observationMeta.searchInterestIndexKey;
  return (
    <div
      className="border-border flex flex-col gap-2 rounded-md border p-3"
      data-testid={`live-trends-readouts-${slug}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium break-words">{keyword}</p>
        <EstimateBadge noteKey={noteKey} />
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground text-xs">
            {t('keywordResearch:liveTrends.readouts.yoy')}
          </dt>
          <dd data-testid={`live-trends-yoy-${slug}`} className="tabular-nums">
            {readouts.yoy.deltaFraction === null
              ? t('keywordResearch:liveTrends.readouts.needMoreYoy')
              : percent.format(readouts.yoy.deltaFraction)}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">
            {t('keywordResearch:liveTrends.readouts.momentum')}
          </dt>
          <dd data-testid={`live-trends-momentum-${slug}`}>
            {readouts.momentum.slopePerWeek === null ? (
              t('keywordResearch:liveTrends.readouts.needMoreMomentum')
            ) : (
              <StatusChip tone={directionBadgeTone(readouts.momentum.direction)}>
                {t(`keywordResearch:liveTrends.readouts.direction.${readouts.momentum.direction}`)}
              </StatusChip>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground text-xs">
            {t('keywordResearch:liveTrends.readouts.seasonality')}
          </dt>
          <dd data-testid={`live-trends-seasonality-${slug}`}>
            {readouts.seasonality.reason === 'insufficient_history' ? (
              <span>{t('keywordResearch:liveTrends.readouts.needMoreSeasonality')}</span>
            ) : readouts.seasonality.months.length === 0 ? (
              <span className="text-muted-foreground">
                {t('keywordResearch:liveTrends.readouts.noSeasonality')}
              </span>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {readouts.seasonality.months.map((m) => (
                  <li key={m}>
                    <Badge variant="outline">{monthName(m)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Pre-confirm disclosure card. Usage is not metered, so it only says so. */
function TrendsPreviewCard({ preview }: { preview: TrendsSpendPreview | null }) {
  const { t } = useTranslation();
  // The caller only mounts this card while the estimate is in flight or
  // settled, so a null preview means "still estimating".
  if (!preview) {
    return (
      <Card aria-busy="true" data-testid="live-trends-preview-loading">
        <CardHeader>
          <CardTitle>{t('keywordResearch:liveTrends.preview.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid="live-trends-preview">
      <CardHeader>
        <CardTitle>{t('keywordResearch:liveTrends.preview.title')}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground text-sm">
        {t('common:capacity.selfHost')}
      </CardContent>
    </Card>
  );
}

function StoredHistoryRow({
  row,
  onOpen,
  active,
  loading,
}: {
  row: TrendsStoredRunSummary;
  onOpen: (runId: string) => void;
  active: boolean;
  loading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const fmtDate = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const status = t(`keywordResearch:liveTrends.storedRun.status.${row.status}`);
  return (
    <li
      className={`border-border flex flex-col gap-2 rounded-md border p-3 text-sm ${
        active ? 'ring-primary ring-2' : ''
      }`}
      data-testid={`live-trends-stored-row-${row.runId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip
            tone={
              row.status === 'succeeded'
                ? 'success'
                : row.status === 'failed'
                  ? 'destructive'
                  : 'muted'
            }
          >
            {status}
          </StatusChip>
          {row.refunded ? (
            <Badge variant="outline">{t('keywordResearch:liveTrends.storedRun.refunded')}</Badge>
          ) : null}
        </div>
        <span className="text-muted-foreground tabular-nums">
          {fmtDate.format(new Date(row.createdAt))}
        </span>
      </div>
      <p className="text-muted-foreground text-xs break-words">{row.inputs.keywords.join(', ')}</p>
      <p className="text-muted-foreground text-xs">
        {t('keywordResearch:liveTrends.storedRun.counts', {
          series: row.seriesCount,
          related: row.relatedQueryCount,
        })}
      </p>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={active && loading}
          loadingLabel={t('keywordResearch:liveTrends.storedRun.opening')}
          onClick={() => onOpen(row.runId)}
          data-testid={`live-trends-stored-open-${row.runId}`}
        >
          {t('keywordResearch:liveTrends.storedRun.open')}
        </Button>
      </div>
    </li>
  );
}

/** Bounded rising/related pill row with one-click follow-up. */
function RelatedQueries({
  rows,
  onFollowUp,
  disabled,
}: {
  rows: readonly TrendsRelatedQueryDto[];
  onFollowUp: (query: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) return null;
  const rising = rows.filter((r) => r.kind === 'rising');
  const top = rows.filter((r) => r.kind === 'top');
  return (
    <div className="flex flex-col gap-3" data-testid="live-trends-related">
      {rising.length > 0 ? (
        <div>
          <h4 className="text-sm font-medium">{t('keywordResearch:liveTrends.related.rising')}</h4>
          <ul className="mt-2 flex flex-wrap gap-2">
            {rising.map((r) => (
              <li key={`rising-${r.query}`}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onFollowUp(r.query)}
                  data-testid={`live-trends-related-rising-${keywordSlug(r.query)}`}
                >
                  <span className="max-w-64 truncate">
                    {r.query.slice(0, LIVE_TRENDS_MAX_QUERY_CHARS)}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {top.length > 0 ? (
        <div>
          <h4 className="text-sm font-medium">{t('keywordResearch:liveTrends.related.top')}</h4>
          <ul className="mt-2 flex flex-wrap gap-2">
            {top.map((r) => (
              <li key={`top-${r.query}`}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onFollowUp(r.query)}
                  data-testid={`live-trends-related-top-${keywordSlug(r.query)}`}
                >
                  <span className="max-w-64 truncate">
                    {r.query.slice(0, LIVE_TRENDS_MAX_QUERY_CHARS)}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** URL-backed history filter — purely local, never re-fetches, never spends. */
function matchesHistoryFilter(
  row: TrendsStoredRunSummary,
  filter: LiveTrendsHistoryFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'refunded') return row.refunded;
  return row.status === filter;
}

function HistoryFilterChips({
  active,
  onSelect,
}: {
  active: LiveTrendsHistoryFilter;
  onSelect: (next: LiveTrendsHistoryFilter) => void;
}) {
  const { t } = useTranslation();
  const label = (filter: LiveTrendsHistoryFilter) => {
    if (filter === 'all') return t('keywordResearch:liveTrends.storedRun.filterAll');
    if (filter === 'refunded') return t('keywordResearch:liveTrends.storedRun.refunded');
    return t(`keywordResearch:liveTrends.storedRun.status.${filter}`);
  };
  return (
    <div
      role="group"
      aria-label={t('keywordResearch:liveTrends.storedRun.filterLabel')}
      className="flex flex-wrap gap-2"
      data-testid="live-trends-history-filters"
    >
      {LIVE_TRENDS_HISTORY_FILTERS.map((filter) => (
        <Button
          key={filter}
          type="button"
          size="sm"
          variant={filter === active ? 'default' : 'outline'}
          aria-pressed={filter === active}
          onClick={() => onSelect(filter)}
          data-testid={`live-trends-history-filter-${filter}`}
        >
          {label(filter)}
        </Button>
      ))}
    </div>
  );
}

function isKillSwitchDisabledMessage(errorKind: string | null): boolean {
  return errorKind === 'unavailable';
}

export const LiveTrendsView = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const preview = useAppSelector(selectLiveTrendsPreview);
  const run = useAppSelector(selectLiveTrendsRun);
  const list = useAppSelector(selectLiveTrendsList);
  const storedRun = useAppSelector(selectLiveTrendsStoredRun);
  const [query, setQuery] = useLiveTrendsQuery();

  const [chips, setChips] = useState<string[]>(query.keywords);
  const [locationCode, setLocationCode] = useState<number>(
    geoToLocationCode(query.geo ?? DEFAULT_LIVE_TRENDS_GEO),
  );
  const [languageCode, setLanguageCode] = useState<string>(
    query.language ?? DEFAULT_LIVE_TRENDS_LANGUAGE,
  );
  const [formError, setFormError] = useState('');

  // Load stored history once per mount.
  useEffect(() => {
    if (!list.data && !list.loading) {
      void dispatch(loadLiveTrendsList({ limit: 20 }));
    }
    // Intentional: mount-only load, subsequent history refreshes flow from
    // successful explores' optimistic prepend.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only load
  }, []);

  const persistUrl = useCallback(
    (nextChips: string[], nextLoc: number, nextLang: string) => {
      const normalized = normalizeLiveTrendsKeywords(nextChips);
      const geo = locationCodeToGeo(nextLoc);
      setQuery({
        keywords: normalized,
        geo: geo === DEFAULT_LIVE_TRENDS_GEO ? null : geo,
        language: nextLang === DEFAULT_LIVE_TRENDS_LANGUAGE ? null : nextLang,
      });
    },
    [setQuery],
  );

  const buildBody = () => {
    const normalized = normalizeLiveTrendsKeywords(chips);
    return {
      keywords: normalized,
      geo: locationCodeToGeo(locationCode),
      language: languageCode,
    };
  };

  const requestPreview = (e: FormEvent) => {
    e.preventDefault();
    const parsed = liveTrendsFormSchema.safeParse({
      keywords: normalizeLiveTrendsKeywords(chips),
      geo: locationCodeToGeo(locationCode),
      language: languageCode,
    });
    if (!parsed.success) {
      // A failed zod parse always carries at least one issue.
      setFormError(t(parsed.error.issues[0]!.message));
      return;
    }
    setFormError('');
    persistUrl(parsed.data.keywords, locationCode, languageCode);
    void dispatch(previewLiveTrends(parsed.data));
  };

  const confirmSubmit = () => {
    void dispatch(exploreLiveTrends(buildBody()));
  };

  const cancelPreview = () => {
    dispatch(clearLiveTrendsPreview());
  };

  const startFollowUp = (query: string) => {
    // A rising-query follow-up is a NEW single-keyword exploration:
    // it MUST fire a new preview (surfacing a new unit) and then a new
    // submit — never bypassing the preview surface ("one
    // explicit-click follow-up that consumes a new unit").
    const nextChips = [query];
    setChips(nextChips);
    setFormError('');
    persistUrl(nextChips, locationCode, languageCode);
    const parsed = liveTrendsFormSchema.safeParse({
      keywords: nextChips,
      geo: locationCodeToGeo(locationCode),
      language: languageCode,
    });
    if (!parsed.success) {
      // A failed zod parse always carries at least one issue.
      setFormError(t(parsed.error.issues[0]!.message));
      return;
    }
    void dispatch(previewLiveTrends(parsed.data));
  };

  const openStored = (runId: string) => {
    void dispatch(loadLiveTrendsRun({ runId }));
  };

  // Filtering the stored history is a FREE, URL-backed, purely local narrow —
  // it never refetches and never touches the metered explore surface.
  const historyFilter = query.historyFilter;
  const loadedRuns = list.data?.runs ?? [];
  const visibleRuns = loadedRuns.filter((row) => matchesHistoryFilter(row, historyFilter));

  const previewOpen = preview.loading || preview.data !== null;
  const disabledFollowUp = preview.loading || run.loading;

  const succeeded: TrendsExplorationDto | null =
    run.data && run.data.status === 'succeeded' ? run.data : null;

  const killSwitchDisabled = isKillSwitchDisabledMessage(
    preview.errorKind ?? run.errorKind ?? null,
  );

  const sparseHistoryHonest =
    succeeded !== null &&
    succeeded.seriesReadouts.length > 0 &&
    succeeded.seriesReadouts.every(
      (r) =>
        r.readouts.yoy.reason === 'insufficient_history' &&
        r.readouts.seasonality.reason === 'insufficient_history',
    );
  const successfulEmpty = succeeded !== null && succeeded.series.length === 0;

  const seriesForChart = useMemo(
    () =>
      succeeded?.series.map((s) => ({
        keyword: s.keyword,
        ordered: orderPoints(s.points),
      })) ?? [],
    [succeeded],
  );

  const coverageNoteKey =
    succeeded?.series[0]?.observationMeta.searchInterestIndexKey ??
    'keywordResearch.trends.coverageNote.searchInterestIndex';

  return (
    <div className="flex flex-col gap-5" data-testid="live-trends-view">
      <Card>
        <CardHeader>
          <CardTitle>{t('keywordResearch:liveTrends.title')}</CardTitle>
          <p className="text-muted-foreground text-sm">
            {t('keywordResearch:liveTrends.description')}
          </p>
          <p className="text-muted-foreground text-xs" data-testid="live-trends-coverage-note">
            {t(toClientI18nKey(coverageNoteKey))}
          </p>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={requestPreview}
            className="flex flex-col gap-4"
            data-testid="live-trends-form"
          >
            <PhraseChipsInput
              id="live-trends-keywords"
              label={t('keywordResearch:liveTrends.form.keywordsLabel')}
              placeholder={t('keywordResearch:liveTrends.form.keywordsPlaceholder')}
              chips={chips}
              onChange={(next) => {
                setChips(next);
                setFormError('');
                dispatch(resetLiveTrends());
                persistUrl(next, locationCode, languageCode);
              }}
              max={LIVE_TRENDS_PHRASE_MAX}
              maxLength={LIVE_TRENDS_PHRASE_MAX_LENGTH}
              testIdPrefix="live-trends"
            />
            <MarketSelects
              locationCode={locationCode}
              languageCode={languageCode}
              onLocationChange={(loc) => {
                setLocationCode(loc);
                persistUrl(chips, loc, languageCode);
              }}
              onLanguageChange={(lang) => {
                setLanguageCode(lang);
                persistUrl(chips, locationCode, lang);
              }}
              testIdPrefix="live-trends"
            />
            {formError ? (
              <p
                role="alert"
                className="text-destructive text-sm"
                data-testid="live-trends-form-error"
              >
                {formError}
              </p>
            ) : null}
            <div>
              <Button
                type="submit"
                loading={preview.loading}
                loadingLabel={t('keywordResearch:liveTrends.form.previewing')}
                data-testid="live-trends-preview-cta"
              >
                {t('keywordResearch:liveTrends.form.preview')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {killSwitchDisabled ? (
        <Alert role="alert" data-testid="live-trends-kill-switch">
          <AlertTitle>{t('keywordResearch:liveTrends.states.unavailableTitle')}</AlertTitle>
          <AlertDescription>
            {preview.error || run.error || t('keywordResearch:liveTrends.states.unavailableBody')}
          </AlertDescription>
        </Alert>
      ) : null}

      {preview.error && !killSwitchDisabled ? (
        <Alert variant="destructive" role="alert" data-testid="live-trends-preview-error">
          <AlertDescription>{preview.error}</AlertDescription>
        </Alert>
      ) : null}

      {previewOpen && !killSwitchDisabled ? (
        <div className="flex flex-col gap-3">
          <TrendsPreviewCard preview={preview.data} />
          {preview.data ? (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                loading={run.loading}
                loadingLabel={t('keywordResearch:liveTrends.form.submitting')}
                onClick={confirmSubmit}
                data-testid="live-trends-confirm"
              >
                {t('keywordResearch:liveTrends.form.confirm')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={run.loading}
                onClick={cancelPreview}
                data-testid="live-trends-cancel"
              >
                {t('keywordResearch:liveTrends.form.cancel')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {run.error && !killSwitchDisabled ? (
        <Alert variant="destructive" role="alert" data-testid="live-trends-run-error">
          <AlertTitle>
            {run.errorKind === 'providerFailed'
              ? t('keywordResearch:liveTrends.states.providerFailedTitle')
              : t('keywordResearch:liveTrends.states.failedTitle')}
          </AlertTitle>
          <AlertDescription>{run.error}</AlertDescription>
        </Alert>
      ) : null}

      {run.loading && !succeeded ? (
        <div
          aria-busy="true"
          aria-live="polite"
          data-testid="live-trends-submit-loading"
          className="flex flex-col gap-2"
        >
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}

      {succeeded ? (
        <Card data-testid="live-trends-results">
          <CardHeader className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{t('keywordResearch:liveTrends.results.title')}</CardTitle>
              <StatusChip tone={succeeded.cached ? 'muted' : 'success'}>
                {succeeded.cached
                  ? t('keywordResearch:liveTrends.results.cached')
                  : t('keywordResearch:liveTrends.results.fresh')}
              </StatusChip>
              <EstimateBadge noteKey={coverageNoteKey} />
              <ReportExportControl
                kind="keyword.trends_run"
                target={{ scope: 'account_resource', resourceId: succeeded.runId }}
                selection={{ phrases: succeeded.inputs.keywords }}
              />
            </div>
            {seriesForChart.length > 0 ? <ChartLegend series={seriesForChart} /> : null}
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {successfulEmpty ? (
              <Alert role="status" data-testid="live-trends-empty">
                <AlertTitle>{t('keywordResearch:liveTrends.states.emptyTitle')}</AlertTitle>
                <AlertDescription>
                  {t('keywordResearch:liveTrends.states.emptyBody')}
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <MultiSeriesOverlay series={seriesForChart} />
                <SeriesDataTable series={succeeded.series} />
              </>
            )}
            {sparseHistoryHonest && !successfulEmpty ? (
              <Alert role="status" data-testid="live-trends-sparse">
                <AlertTitle>{t('keywordResearch:liveTrends.states.sparseTitle')}</AlertTitle>
                <AlertDescription>
                  {t('keywordResearch:liveTrends.states.sparseBody')}
                </AlertDescription>
              </Alert>
            ) : null}
            {!successfulEmpty ? (
              <div className="flex flex-col gap-2">
                {succeeded.seriesReadouts.map((r) => (
                  <ReadoutsRow key={r.keyword} keyword={r.keyword} readouts={r.readouts} />
                ))}
              </div>
            ) : null}
            <RelatedQueries
              rows={succeeded.relatedQueries}
              onFollowUp={startFollowUp}
              disabled={disabledFollowUp}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card data-testid="live-trends-history">
        <CardHeader>
          <CardTitle>{t('keywordResearch:liveTrends.storedRun.title')}</CardTitle>
          <p className="text-muted-foreground text-sm">
            {t('keywordResearch:liveTrends.storedRun.description')}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <HistoryFilterChips
            active={historyFilter}
            onSelect={(next) => setQuery({ historyFilter: next })}
          />
          {list.loading && !list.data ? (
            <Skeleton className="h-16 w-full" />
          ) : list.error ? (
            <Alert variant="destructive" role="alert" data-testid="live-trends-history-error">
              <AlertDescription>{list.error}</AlertDescription>
            </Alert>
          ) : visibleRuns.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {visibleRuns.map((row) => (
                <StoredHistoryRow
                  key={row.runId}
                  row={row}
                  onOpen={openStored}
                  active={storedRun.data?.runId === row.runId}
                  loading={storedRun.loading}
                />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm" data-testid="live-trends-history-empty">
              {loadedRuns.length > 0
                ? t('keywordResearch:liveTrends.storedRun.emptyFiltered')
                : t('keywordResearch:liveTrends.storedRun.empty')}
            </p>
          )}
          {storedRun.data ? (
            <Alert data-testid="live-trends-stored-detail">
              <ExternalLink aria-hidden="true" className="size-4" />
              <AlertTitle>{t('keywordResearch:liveTrends.storedRun.reopenedTitle')}</AlertTitle>
              <AlertDescription className="flex flex-col gap-1 text-xs">
                <ReportExportControl
                  kind="keyword.trends_run"
                  target={{ scope: 'account_resource', resourceId: storedRun.data.runId }}
                  selection={{ phrases: storedRun.data.inputs.keywords }}
                />
                <span>
                  {t('keywordResearch:liveTrends.storedRun.counts', {
                    series: storedRun.data.seriesCount,
                    related: storedRun.data.relatedQueryCount,
                  })}
                </span>
                <span className="text-muted-foreground">
                  {storedRun.data.inputs.keywords.join(', ')}
                </span>
              </AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};
