import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { StatusChip } from '@shared/ui/status-chip';
import { countryName, languageName } from '@shared/markets';
import {
  buildBrandRadarMentionCsv,
  brandRadarCsvFilename,
  downloadBrandRadarCsv,
} from '../csv';
import {
  buildBrandRadarTrendPoints,
  selectBrandRadarDetailEntry,
  selectBrandRadarItems,
  selectBrandRadarMentionEntry,
} from '../store/selectors';
import {
  loadBrandRadarMentions,
  loadBrandRadarScanDetail,
} from '../store/thunks';
import type { BrandRadarHalt } from '../types';
import type { BrandRadarSentimentFilter } from '../urlState';
import { DigestSection } from './DigestSection';
import {
  MentionTable,
  type BrandRadarMentionFilters,
} from './MentionTable';
import { BRAND_RADAR_STATUS_TONES } from './ScanListTable';
import { SentimentBar } from './SentimentBar';
import { BRAND_RADAR_TREND_MIN_POINTS, TrendSparkline } from './TrendSparkline';

interface ScanDetailPanelProps {
  scanId: string;
  filters: BrandRadarMentionFilters;
  onBack: () => void;
  onSentiment: (next: BrandRadarSentimentFilter) => void;
  onDomain: (next: string) => void;
  onFrom: (next: string) => void;
  onTo: (next: string) => void;
}

/**
 * The six stage×reason combinations the server can persist (the halt
 * contract). An unknown future combination falls back to the generic
 * banner copy instead of rendering a raw i18n key.
 */
const BRAND_RADAR_HALT_KEYS = new Set([
  'search_provider_error',
  'summary_cost_ceiling',
  'summary_provider_error',
  'brand_digest_cost_ceiling',
  'brand_digest_digest_failed',
  'scan_processing_failure',
]);

export function brandRadarHaltKey(halt: BrandRadarHalt | null): string | null {
  if (!halt) return null;
  const key = `${halt.stage}_${halt.reason}`;
  return BRAND_RADAR_HALT_KEYS.has(key) ? key : null;
}

/**
 * Stored scan detail.
 *
 * Every number on this screen is a server value rendered as handed over: the
 * client re-sorts the trend series and does nothing else arithmetic. Each
 * shipped status × digest-state combination has its own honest state, and a
 * `completed_empty` scan renders NO zero-valued chart.
 */
export const ScanDetailPanel = ({
  scanId,
  filters,
  onBack,
  onSentiment,
  onDomain,
  onFrom,
  onTo,
}: ScanDetailPanelProps) => {
  const { t, i18n } = useTranslation(['brandRadar', 'language']);
  const dispatch = useAppDispatch();
  const entry = useAppSelector((state) => selectBrandRadarDetailEntry(state, scanId));
  const mentions = useAppSelector((state) =>
    selectBrandRadarMentionEntry(state, scanId),
  );
  const items = useAppSelector(selectBrandRadarItems);
  const detail = entry.detail;

  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  );
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const trendPoints = useMemo(
    () => buildBrandRadarTrendPoints(items, detail),
    [items, detail],
  );
  const marketLabel = detail
    ? `${detail.countryCode
      ? countryName(detail.countryCode, i18n.language) ?? t('common:market.unknownCountry')
      : t('common:market.allCountries')} · ${detail.language
      ? languageName(detail.language, i18n.language) ?? t('common:market.unknownLanguage')
      : t('common:market.allLanguages')}`
    : '';

  useEffect(() => {
    void dispatch(loadBrandRadarScanDetail({ scanId }));
    void dispatch(loadBrandRadarMentions({ scanId }));
  }, [dispatch, scanId]);

  const loadMore = useCallback(
    (cursor: string) => {
      void dispatch(loadBrandRadarMentions({ scanId, cursor }));
    },
    [dispatch, scanId],
  );

  /**
   * A scan only has aggregates worth charting once it settled WITH rows. A
   * queued/running/empty/failed scan renders its honest banner instead of a
   * zero-valued chart.
   */
  const showAggregates =
    detail?.status === 'completed' || detail?.status === 'completed_partial';

  return (
    <Card data-testid="brand-radar-detail">
      <CardHeader>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          data-testid="brand-radar-detail-back"
          onClick={onBack}
        >
          {t('detail.back')}
        </Button>
        {detail ? (
          <>
            {/* SEC-OUT: the brand query is user text, rendered as a text node. */}
            <CardTitle data-testid="brand-radar-detail-query">
              {detail.brandQuery}
            </CardTitle>
            <CardDescription>
              {t('detail.mentionCount', { count: detail.mentionCount })}
            </CardDescription>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={BRAND_RADAR_STATUS_TONES[detail.status]}>
                {t(`status.${detail.status}`)}
              </StatusChip>
              <StatusChip tone="muted">{t(`digest.${detail.digestState}`)}</StatusChip>
              {detail.refund.state === 'refunded' ? (
                <StatusChip tone="success" data-testid="brand-radar-detail-refund">
                  {t('refund.refunded')}
                </StatusChip>
              ) : null}
              {showAggregates ? (
                <ReportExportControl
                  kind="brand.radar_scan"
                  target={{ scope: 'site_resource', siteId: detail.siteId, resourceId: scanId }}
                  selection={{
                    ...(filters.sentiment !== 'all' ? { sentiment: [filters.sentiment] } : {}),
                    ...(filters.domain ? { domain: [filters.domain] } : {}),
                    ...(filters.from ? { from: filters.from } : {}),
                    ...(filters.to ? { to: filters.to } : {}),
                  }}
                />
              ) : null}
            </div>
            <dl className="text-muted-foreground grid gap-1 text-xs sm:grid-cols-2">
              <div className="flex gap-1">
                <dt>{t('detail.market')}</dt>
                <dd>{marketLabel}</dd>
              </div>
              {detail.outputLocale ? (
                <div className="flex gap-1" data-testid="brand-radar-detail-output-locale">
                  <dt>{t('detail.outputLocale')}</dt>
                  <dd>{t(`language:names.${detail.outputLocale}`)}</dd>
                </div>
              ) : null}
              <div className="flex gap-1">
                <dt>{t('detail.createdAt')}</dt>
                <dd>{dateTime.format(new Date(detail.createdAt))}</dd>
              </div>
              <div className="flex gap-1">
                <dt>{t('detail.terminalAt')}</dt>
                <dd>
                  {detail.terminalAt === null
                    ? t('detail.notSettled')
                    : dateTime.format(new Date(detail.terminalAt))}
                </dd>
              </div>
            </dl>
          </>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {entry.error ? (
          <Alert variant="destructive" role="alert">
            <AlertTitle>{t('detail.errorTitle')}</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2">
              <span>{entry.error}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="brand-radar-detail-retry"
                onClick={() => {
                  void dispatch(loadBrandRadarScanDetail({ scanId }));
                }}
              >
                {t('list.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {entry.status === 'loading' && !detail ? (
          <div
            className="flex flex-col gap-2"
            aria-busy="true"
            aria-live="polite"
            data-testid="brand-radar-detail-loading"
          >
            <span className="sr-only">{t('detail.loading')}</span>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : null}

        {detail ? (
          <>
            {detail.status === 'queued' || detail.status === 'running' ? (
              // No ETA, no percentage, no stage name — the server exposes none.
              <Alert data-testid="brand-radar-detail-pending">
                <AlertTitle>{t(`detail.banners.${detail.status}.title`)}</AlertTitle>
                <AlertDescription>
                  {t(`detail.banners.${detail.status}.description`)}
                </AlertDescription>
              </Alert>
            ) : null}

            {detail.status === 'completed_empty' ? (
              <Alert data-testid="brand-radar-detail-empty">
                <AlertTitle>{t('detail.banners.completed_empty.title')}</AlertTitle>
                <AlertDescription>
                  {t('detail.banners.completed_empty.description')}
                </AlertDescription>
              </Alert>
            ) : null}

            {detail.status === 'completed_partial' ? (
              <Alert
                data-testid="brand-radar-detail-partial"
                data-halt={brandRadarHaltKey(detail.halt) ?? undefined}
              >
                <AlertTitle>{t('detail.banners.completed_partial.title')}</AlertTitle>
                <AlertDescription>
                  {/* Which stage halted and why (the halt contract); the
                      generic copy covers legacy scans without the field. */}
                  {brandRadarHaltKey(detail.halt)
                    ? t(`detail.halt.${brandRadarHaltKey(detail.halt)}`)
                    : t('detail.banners.completed_partial.description')}
                </AlertDescription>
              </Alert>
            ) : null}

            {detail.status === 'failed' ? (
              <Alert
                variant="destructive"
                role="alert"
                data-testid="brand-radar-detail-failed"
                data-halt={brandRadarHaltKey(detail.halt) ?? undefined}
              >
                <AlertTitle>{t('detail.banners.failed.title')}</AlertTitle>
                <AlertDescription>
                  {brandRadarHaltKey(detail.halt) ? (
                    <span className="block">
                      {t(`detail.halt.${brandRadarHaltKey(detail.halt)}`)}
                    </span>
                  ) : null}
                  <span className="block">
                    {detail.refund.state === 'refunded'
                      ? t('detail.banners.failed.refunded')
                      : t('detail.banners.failed.description')}
                  </span>
                </AlertDescription>
              </Alert>
            ) : null}

            {/* A scan with nothing to show renders no zero-valued chart. */}
            {showAggregates ? (
              <SentimentBar distribution={detail.sentimentDistribution} />
            ) : null}

            {showAggregates && detail.topDomains.length > 0 ? (
              <section className="flex flex-col gap-2" data-testid="brand-radar-top-domains">
                <h3 className="text-sm font-semibold">{t('detail.topDomains.title')}</h3>
                <ul className="flex flex-col gap-1 text-sm">
                  {detail.topDomains.map((entryRow) => (
                    <li
                      key={entryRow.domain}
                      className="flex items-center justify-between gap-4"
                      data-testid="brand-radar-top-domain-row"
                    >
                      {/* SEC-OUT: vendor domain string as a text node. */}
                      <span>{entryRow.domain}</span>
                      <span className="tabular-nums">{number.format(entryRow.count)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {showAggregates ? (
              detail.trend === null ? (
                // Never a fabricated 0 — the server said there is no baseline.
                <p data-testid="brand-radar-trend-null">
                  {t('detail.trend.noComparison')}
                </p>
              ) : trendPoints.length >= BRAND_RADAR_TREND_MIN_POINTS ? (
                <TrendSparkline points={trendPoints} />
              ) : (
                <p data-testid="brand-radar-trend-needmore">
                  {t('detail.trend.needMore')}
                </p>
              )
            ) : null}

            <DigestSection
              digestState={detail.digestState}
              sentences={detail.digestSentences}
              mentions={mentions.items}
            />

            {showAggregates ? (
              <MentionTable
                rows={mentions.items}
                status={mentions.status}
                error={mentions.error}
                filters={filters}
                nextCursor={mentions.nextCursor}
                loadingMore={mentions.loadingMore}
                onSentiment={onSentiment}
                onDomain={onDomain}
                onFrom={onFrom}
                onTo={onTo}
                onLoadMore={loadMore}
                onExport={() => {
                  downloadBrandRadarCsv(
                    brandRadarCsvFilename(detail),
                    buildBrandRadarMentionCsv(detail, mentions.items),
                  );
                }}
              />
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
};
