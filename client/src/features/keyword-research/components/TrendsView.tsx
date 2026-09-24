/**
 * Historical trends view.
 *
 * One-to-ten phrases → server preview → confirm (`POST /trends`, one
 * keyword_lookups unit per deduped phrase). Every readout (multi-year
 * series, year-over-year delta, momentum, seasonality) is labelled Estimate;
 * null summary fields render the honest server thresholds ("Need 13/24
 * months") rather than fabricating a trend. Every chart has a visible
 * accessible data-table fallback; the SVG itself is static (reduced-motion
 * safe by construction).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip } from '@shared/ui/status-chip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { fetchKeywordPreview, runTrends } from '../store/thunks';
import { clearPreview } from '../store/slice';
import { selectPreview, selectTrends } from '../store/selectors';
import {
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_LOCATION_CODE,
  TRENDS_PHRASE_MAX,
  trendsFormSchema,
} from '../validation';
import { KeywordSpendPreviewCard } from './KeywordSpendPreviewCard';
import { keywordSlug } from './KeywordResearchPanel';
import { MarketSelects } from './MarketSelects';
import { PhraseChipsInput } from './PhraseChipsInput';
import { ProvenanceBadge } from './ProvenanceBadge';
import { TrendsChart, sortMonthlySeries } from './TrendsChart';
import type { TrendsRequestBody } from '../api';
import type { KeywordTrendsRow } from '../types';

const TrendsReadouts = ({ row }: { row: KeywordTrendsRow }) => {
  const { t, i18n } = useTranslation();
  const formatRatio = (value: number): string =>
    new Intl.NumberFormat(i18n.language, {
      style: 'percent',
      maximumFractionDigits: 1,
      signDisplay: 'exceptZero',
    }).format(value);

  const monthLabel = (month: number | null): string =>
    month === null
      ? t('keywordResearch:trends.insufficientSeasonality')
      : t(`keywordResearch:trends.monthName.${month}`);

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm lg:grid-cols-4">
      <div>
        <dt className="text-muted-foreground text-xs">{t('keywordResearch:trends.columnYoy')}</dt>
        <dd className="tabular-nums" data-testid={`kw-trends-yoy-${keywordSlug(row.keyword)}`}>
          {row.trends.yoyDelta === null
            ? t('keywordResearch:trends.insufficientYoy')
            : formatRatio(row.trends.yoyDelta)}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">
          {t('keywordResearch:trends.columnMomentum')}
        </dt>
        <dd className="tabular-nums" data-testid={`kw-trends-momentum-${keywordSlug(row.keyword)}`}>
          {row.trends.twelveMonthMomentum === null
            ? t('keywordResearch:trends.insufficientMomentum')
            : formatRatio(row.trends.twelveMonthMomentum)}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">
          {t('keywordResearch:trends.columnSeasonalPeak')}
        </dt>
        <dd data-testid={`kw-trends-peak-${keywordSlug(row.keyword)}`}>
          {monthLabel(row.trends.seasonalityFlags.peakMonth)}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground text-xs">
          {t('keywordResearch:trends.columnSeasonalTrough')}
        </dt>
        <dd data-testid={`kw-trends-trough-${keywordSlug(row.keyword)}`}>
          {monthLabel(row.trends.seasonalityFlags.troughMonth)}
        </dd>
      </div>
    </dl>
  );
};

const TrendsRowCard = ({ row }: { row: KeywordTrendsRow }) => {
  const { t, i18n } = useTranslation();
  const slug = keywordSlug(row.keyword);
  const ordered = sortMonthlySeries(row.monthlySearches);
  const formatVolume = (v: number): string => new Intl.NumberFormat(i18n.language).format(v);

  return (
    <Card data-testid={`kw-trends-card-${slug}`}>
      <CardHeader className="flex flex-col gap-2">
        <CardTitle className="text-base break-words">{row.keyword}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={row.cached ? 'muted' : 'success'}>
            {row.cached ? t('keywordResearch:history.cached') : t('keywordResearch:history.fresh')}
          </StatusChip>
          <ProvenanceBadge meta={row.meta} withTimestamps />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TrendsChart series={row.monthlySearches} />
        <TrendsReadouts row={row} />
        {ordered.length > 0 ? (
          <div className="overflow-x-auto">
            <Table data-testid={`kw-trends-table-${slug}`}>
              <caption className="sr-only">
                {t('keywordResearch:trends.tableCaption', { phrase: row.keyword })}
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('keywordResearch:trends.columnMonth')}</TableHead>
                  <TableHead className="text-end">
                    <TableHeaderHelp
                      label={t('keywordResearch:columnVolume')}
                      description={t('common:tableHelp.searchVolume')}
                    />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordered.map((point) => (
                  <TableRow key={`${point.year}-${point.month}`}>
                    <TableCell>
                      {t(`keywordResearch:trends.monthName.${point.month}`)} {point.year}
                    </TableCell>
                    <TableCell className="text-end tabular-nums">
                      {formatVolume(point.searchVolume)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export const TrendsView = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const preview = useAppSelector(selectPreview);
  const trends = useAppSelector(selectTrends);

  const [chips, setChips] = useState<string[]>([]);
  const [locationCode, setLocationCode] = useState(DEFAULT_LOCATION_CODE);
  const [languageCode, setLanguageCode] = useState(DEFAULT_LANGUAGE_CODE);
  const [formError, setFormError] = useState('');
  const [pendingBody, setPendingBody] = useState<TrendsRequestBody | null>(null);

  const requestPreview = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = trendsFormSchema.safeParse({
      keywords: chips,
      locationCode,
      languageCode,
    });
    if (!parsed.success) {
      setFormError(t(parsed.error.issues[0]?.message ?? ''));
      return;
    }
    setFormError('');
    setPendingBody(parsed.data);
    void dispatch(fetchKeywordPreview({ operation: 'trends', ...parsed.data }));
  };

  const previewOpen =
    preview.forOperation === 'trends' && (preview.loading || preview.data !== null);

  return (
    <div className="flex flex-col gap-5" data-testid="kw-trends-view">
      <Card>
        <CardHeader>
          <CardTitle>{t('keywordResearch:trends.title')}</CardTitle>
          <p className="text-muted-foreground text-sm">{t('keywordResearch:trends.description')}</p>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={requestPreview}
            className="flex flex-col gap-4"
            data-testid="kw-trends-form"
          >
            <PhraseChipsInput
              id="kw-trends-keywords"
              label={t('keywordResearch:inputLabel')}
              placeholder={t('keywordResearch:inputPlaceholder')}
              chips={chips}
              onChange={setChips}
              max={TRENDS_PHRASE_MAX}
              testIdPrefix="kw-trends"
            />
            <MarketSelects
              locationCode={locationCode}
              languageCode={languageCode}
              onLocationChange={setLocationCode}
              onLanguageChange={setLanguageCode}
              testIdPrefix="kw-trends"
            />
            {formError ? (
              <p
                role="alert"
                className="text-destructive text-sm"
                data-testid="kw-trends-form-error"
              >
                {formError}
              </p>
            ) : null}
            <div>
              <Button
                type="submit"
                loading={preview.loading && preview.forOperation === 'trends'}
                loadingLabel={t('keywordResearch:preview.loading')}
                data-testid="kw-trends-preview-cta"
              >
                {t('keywordResearch:preview.cta')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {preview.error && preview.forOperation === 'trends' ? (
        <Alert variant="destructive" role="alert" data-testid="kw-trends-preview-error">
          <AlertDescription>{preview.error}</AlertDescription>
        </Alert>
      ) : null}

      {previewOpen ? (
        <div className="flex flex-col gap-3">
          <KeywordSpendPreviewCard preview={preview.data} loading={preview.loading} />
          {preview.data ? (
            <div className="flex gap-2">
              <Button
                onClick={() => pendingBody && void dispatch(runTrends(pendingBody))}
                loading={trends.loading}
                loadingLabel={t('keywordResearch:trends.submitting')}
                data-testid="kw-trends-confirm"
              >
                {t('keywordResearch:preview.confirm')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setPendingBody(null);
                  dispatch(clearPreview());
                }}
                disabled={trends.loading}
                data-testid="kw-trends-cancel"
              >
                {t('keywordResearch:preview.cancel')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {trends.error ? (
        <Alert variant="destructive" role="alert" data-testid="kw-trends-error">
          <AlertDescription>{trends.error}</AlertDescription>
        </Alert>
      ) : null}

      {trends.loading && trends.rows.length === 0 ? (
        <div aria-busy="true" aria-live="polite" data-testid="kw-trends-loading">
          <Skeleton className="h-40 w-full" />
        </div>
      ) : null}

      {trends.rows.length > 0 ? (
        <div className="flex flex-col gap-4">
          {trends.rows.map((row) => (
            <TrendsRowCard key={row.keyword} row={row} />
          ))}
        </div>
      ) : trends.loaded && !trends.loading && !trends.error ? (
        <p className="text-muted-foreground text-sm" data-testid="kw-trends-empty">
          {t('keywordResearch:trends.emptySeries')}
        </p>
      ) : null}
    </div>
  );
};
