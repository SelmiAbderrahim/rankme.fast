/**
 * SERP features panel — `?tab=serp-features` in the site workspace.
 *
 * Reads STORED observations only: the data was already paid for through the
 * `serp_checks` a rank check consumes, so nothing here spends, previews, or
 * meters. Honesty invariant: the surface can only say *observed* or
 * *not observed*. It never claims a feature is absent from Google.
 *
 * data-testid contract:
 *   - serp-features-panel            root
 *   - serp-features-loading          skeleton
 *   - serp-features-error            error alert
 *   - serp-features-capture-paused   non-blocking new-capture status
 *   - serp-features-empty            no tracked keywords
 *   - serp-features-table            list
 *   - serp-features-row-<keywordId>  one keyword row
 *   - serp-feature-chip-<type>       one observed feature chip
 *   - serp-feature-not-observed      keyword with no stored observation
 *   - serp-feature-none              observed, zero features
 *   - serp-feature-owned-snippet     ownership badge (featured snippet)
 *   - serp-feature-owned-paa         ownership badge (PAA answer)
 *   - serp-features-history          per-keyword drill-in
 *   - serp-features-history-table    accessible fallback for the chart
 *   - serp-features-top-results      stored top-100 drawer content
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Badge } from '@shared/ui/badge';
import { Button } from '@shared/ui/button';
import { StatusChip } from '@shared/ui/status-chip';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@shared/ui/sheet';
import { Skeleton } from '@shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { SAFE_EXTERNAL_REL, safeExternalHref } from '@shared/security/output-encoding';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { loadSerpFeatureDetail, loadSerpFeatures } from '../store/thunks';
import {
  selectSerpFeatureDetail,
  selectSerpFeatureDetailError,
  selectSerpFeatureDetailLoading,
  selectSerpFeatureRows,
  selectSerpFeatureCaptureEnabled,
  selectSerpFeatureCaptureStatus,
  selectSerpFeaturesDisabled,
  selectSerpFeaturesError,
  selectSerpFeaturesLoaded,
  selectSerpFeaturesLoading,
} from '../store/selectors';
import { SERP_FEATURE_TYPES, type SerpFeatureHistoryPoint, type SerpFeatureType } from '../types';

interface SerpFeaturesPanelProps {
  siteId: string;
}

/**
 * External SERP URLs are third-party content: routed through the shared
 * scheme guard with the ugc rel set (`.claude/rules/output-encoding.md`).
 * Titles and questions render as React text nodes, never as HTML.
 */
function ExternalRef({ url, label }: { url: string; label: string }) {
  return (
    // eslint-disable-next-line react/jsx-no-target-blank -- SAFE_EXTERNAL_REL includes noopener and noreferrer.
    <a
      href={safeExternalHref(url)}
      rel={SAFE_EXTERNAL_REL}
      target="_blank"
      className="text-primary inline-flex items-center gap-1 underline underline-offset-2"
    >
      {label}
      <ExternalLink aria-hidden="true" className="size-3" />
    </a>
  );
}

function FeatureChips({ features }: { features: SerpFeatureType[] }) {
  const { t } = useTranslation('ranks');
  if (features.length === 0) {
    return (
      <span className="text-muted-foreground text-xs" data-testid="serp-feature-none">
        {t('serpFeatures.noFeaturesObserved')}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {features.map((feature) => (
        <Badge key={feature} variant="secondary" data-testid={`serp-feature-chip-${feature}`}>
          {t(`serpFeatures.types.${feature}`)}
        </Badge>
      ))}
    </span>
  );
}

const FEATURE_CHART_DOT_CLASSES = [
  'bg-chart-1',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-5',
] as const;

/**
 * Categorical feature-presence history. Columns are completed checks, rows are
 * the closed feature union, and a chart-palette marker means that type was
 * observed in that check. The exact values remain in the semantic table below,
 * so this compact visual is deliberately hidden from assistive technology.
 */
function FeaturePresenceChart({
  history,
  formatStamp,
}: {
  history: SerpFeatureHistoryPoint[];
  formatStamp: (iso: string) => string;
}) {
  const { t } = useTranslation('ranks');
  return (
    <div
      className="border-border overflow-x-auto rounded-xl border"
      aria-hidden="true"
      data-testid="serp-features-history-chart"
    >
      <div
        className="grid min-w-max items-center gap-x-3 gap-y-2 p-3"
        style={{
          gridTemplateColumns: `minmax(9rem, auto) repeat(${history.length}, minmax(4rem, 1fr))`,
        }}
      >
        <span />
        {history.map((point) => (
          <span
            key={`date-${point.observedAt}`}
            className="text-muted-foreground text-center text-xs tabular-nums"
          >
            {formatStamp(point.observedAt)}
          </span>
        ))}
        {SERP_FEATURE_TYPES.flatMap((feature, featureIndex) => [
          <span key={`label-${feature}`} className="text-xs font-medium">
            {t(`serpFeatures.types.${feature}`)}
          </span>,
          ...history.map((point, pointIndex) => (
            <span
              key={`${feature}-${point.observedAt}`}
              className="flex min-h-5 items-center justify-center"
            >
              {point.features.includes(feature) ? (
                <span
                  className={`size-2.5 rounded-full ${FEATURE_CHART_DOT_CLASSES[featureIndex % FEATURE_CHART_DOT_CLASSES.length]}`}
                  data-testid={`serp-features-history-marker-${feature}-${pointIndex}`}
                />
              ) : null}
            </span>
          )),
        ])}
      </div>
    </div>
  );
}

export const SerpFeaturesPanel = ({ siteId }: SerpFeaturesPanelProps) => {
  const { t, i18n } = useTranslation('ranks');
  const dispatch = useAppDispatch();
  const [params, setParams] = useSearchParams();

  const rows = useAppSelector(selectSerpFeatureRows);
  const loading = useAppSelector(selectSerpFeaturesLoading);
  const loaded = useAppSelector(selectSerpFeaturesLoaded);
  const error = useAppSelector(selectSerpFeaturesError);
  const disabled = useAppSelector(selectSerpFeaturesDisabled);
  const captureEnabled = useAppSelector(selectSerpFeatureCaptureEnabled);
  const captureStatus = useAppSelector(selectSerpFeatureCaptureStatus);
  const detail = useAppSelector(selectSerpFeatureDetail);
  const detailLoading = useAppSelector(selectSerpFeatureDetailLoading);
  const detailError = useAppSelector(selectSerpFeatureDetailError);

  // `?keyword=` is the per-keyword drill-in; an unknown id simply renders the
  // list (the detail read is what validates ownership).
  const selectedKeywordId = params.get('keyword');

  useEffect(() => {
    const promise = dispatch(loadSerpFeatures({ siteId }));
    return () => promise.abort();
  }, [dispatch, siteId]);

  useEffect(() => {
    if (!selectedKeywordId) return;
    const promise = dispatch(loadSerpFeatureDetail({ keywordId: selectedKeywordId }));
    return () => promise.abort();
  }, [dispatch, selectedKeywordId]);

  const openKeyword = (keywordId: string) => {
    const next = new URLSearchParams(params);
    next.set('keyword', keywordId);
    setParams(next, { replace: true });
  };

  const closeKeyword = () => {
    const next = new URLSearchParams(params);
    next.delete('keyword');
    setParams(next, { replace: true });
  };

  const formatStamp = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });

  const capturePausedBanner = !captureEnabled ? (
    <Alert
      role="status"
      data-capture-status={captureStatus}
      data-testid="serp-features-capture-paused"
    >
      <AlertDescription>{t('serpFeatures.capturePaused')}</AlertDescription>
    </Alert>
  ) : null;

  if (loading && !loaded) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" data-testid="serp-features-loading">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (disabled) {
    return (
      <Alert data-testid="serp-features-disabled">
        <AlertDescription>{t('serpFeatures.disabled')}</AlertDescription>
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" role="alert" data-testid="serp-features-error">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (selectedKeywordId) {
    return (
      <section
        className="flex flex-col gap-4"
        data-testid="serp-features-panel"
        aria-labelledby="serp-features-history-heading"
      >
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={closeKeyword}>
            <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
            {t('serpFeatures.history.back')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="serp-features-history-heading" className="text-lg font-semibold">
            {detail ? detail.phrase : t('serpFeatures.history.title')}
          </h2>
          <ReportExportControl
            kind="ranks.serp_features"
            target={{ scope: 'site', siteId }}
            selection={{ keywordIds: [selectedKeywordId] }}
          />
        </div>
        {capturePausedBanner}
        {detailLoading ? (
          <Skeleton className="h-40 w-full" data-testid="serp-features-detail-loading" />
        ) : null}
        {detailError ? (
          <Alert variant="destructive" role="alert" data-testid="serp-features-detail-error">
            <AlertDescription>{detailError}</AlertDescription>
          </Alert>
        ) : null}
        {detail && !detailLoading ? (
          <div className="flex flex-col gap-6" data-testid="serp-features-history">
            {detail.latest === null ? (
              <p className="text-muted-foreground text-sm" data-testid="serp-feature-not-observed">
                {t('serpFeatures.notObserved')}
              </p>
            ) : (
              <>
                <div className="border-border flex flex-col gap-3 rounded-xl border p-4">
                  <p className="text-muted-foreground text-xs">
                    {t('serpFeatures.observedAt', {
                      date: formatStamp(detail.latest.observedAt),
                    })}
                  </p>
                  <FeatureChips features={detail.latest.features} />
                  {detail.latest.ownedSnippet ? (
                    <StatusChip tone="success" data-testid="serp-feature-owned-snippet">
                      {t('serpFeatures.ownedSnippet')}
                      {detail.latest.ownedSnippet.url ? (
                        <>
                          {' '}
                          <ExternalRef
                            url={detail.latest.ownedSnippet.url}
                            label={detail.latest.ownedSnippet.url}
                          />
                        </>
                      ) : null}
                    </StatusChip>
                  ) : detail.latest.snippetSource ? (
                    <p
                      className="text-muted-foreground text-xs"
                      data-testid="serp-feature-snippet-source"
                    >
                      {t('serpFeatures.snippetHeldBy', {
                        domain: detail.latest.snippetSource.domain,
                      })}
                    </p>
                  ) : null}
                  <Sheet>
                    <SheetTrigger asChild>
                      <Button variant="outline" size="sm">
                        {t('serpFeatures.topResults.open', {
                          count: detail.latest.topResults.length,
                        })}
                      </Button>
                    </SheetTrigger>
                    <SheetContent className="overflow-y-auto">
                      <SheetHeader>
                        <SheetTitle>{t('serpFeatures.topResults.title')}</SheetTitle>
                        <SheetDescription>
                          {t('serpFeatures.topResults.description', {
                            date: formatStamp(detail.latest.observedAt),
                          })}
                        </SheetDescription>
                      </SheetHeader>
                      <div className="px-4 pb-4" data-testid="serp-features-top-results">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>
                                <TableHeaderHelp
                                  label={t('serpFeatures.topResults.rank')}
                                  description={t('common:tableHelp.position')}
                                />
                              </TableHead>
                              <TableHead>{t('serpFeatures.topResults.result')}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detail.latest.topResults.map((row) => (
                              <TableRow key={`${row.rank}-${row.url}`}>
                                <TableCell>{row.rank}</TableCell>
                                <TableCell>
                                  <span className="flex flex-col gap-1">
                                    <ExternalRef url={row.url} label={row.domain} />
                                    {row.owned ? (
                                      <StatusChip tone="success">
                                        {t('serpFeatures.topResults.yours')}
                                      </StatusChip>
                                    ) : null}
                                  </span>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </SheetContent>
                  </Sheet>
                </div>

                {detail.latest.paa.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold">{t('serpFeatures.paaTitle')}</h3>
                    <ul className="flex flex-col gap-2">
                      {detail.latest.paa.map((entry) => (
                        <li
                          key={entry.question}
                          className="border-border flex flex-col gap-1 rounded-xl border p-3"
                        >
                          <span className="text-sm">{entry.question}</span>
                          {entry.owned ? (
                            <StatusChip tone="success" data-testid="serp-feature-owned-paa">
                              {t('serpFeatures.ownedPaa')}
                            </StatusChip>
                          ) : entry.answerDomain ? (
                            <span className="text-muted-foreground text-xs">
                              {t('serpFeatures.answeredBy', { domain: entry.answerDomain })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              {t('serpFeatures.answerUnknown')}
                            </span>
                          )}
                          {entry.answerUrl ? (
                            <ExternalRef url={entry.answerUrl} label={entry.answerUrl} />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t('serpFeatures.history.title')}</h3>
              {detail.history.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('serpFeatures.notObserved')}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  <FeaturePresenceChart history={detail.history} formatStamp={formatStamp} />
                  <div className="overflow-x-auto">
                    <Table data-testid="serp-features-history-table">
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('serpFeatures.history.checkedAt')}</TableHead>
                          <TableHead>
                            <TableHeaderHelp
                              label={t('serpFeatures.history.observed')}
                              description={t('common:tableHelp.observed')}
                            />
                          </TableHead>
                          <TableHead>
                            <TableHeaderHelp
                              label={t('serpFeatures.history.owned')}
                              description={t('common:tableHelp.aiVisibility')}
                            />
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.history.map((point) => (
                          <TableRow key={point.observedAt}>
                            <TableCell>{formatStamp(point.observedAt)}</TableCell>
                            <TableCell>
                              <FeatureChips features={point.features} />
                            </TableCell>
                            <TableCell>
                              {point.ownedSnippet || point.ownedPaaCount > 0
                                ? t('serpFeatures.history.ownedYes', {
                                    count: point.ownedPaaCount,
                                  })
                                : t('serpFeatures.history.ownedNo')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4" data-testid="serp-features-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('serpFeatures.title')}</h2>
          <p className="text-muted-foreground text-sm">{t('serpFeatures.description')}</p>
        </div>
        <ReportExportControl
          kind="ranks.serp_features"
          target={{ scope: 'site', siteId }}
          selection={{}}
        />
      </div>
      {capturePausedBanner}
      {rows.length === 0 ? (
        <Empty data-testid="serp-features-empty">
          <EmptyHeader>
            <EmptyTitle>{t('serpFeatures.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('serpFeatures.empty')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table data-testid="serp-features-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-1/5">{t('columnPhrase')}</TableHead>
              <TableHead>
                <TableHeaderHelp
                  label={t('serpFeatures.columnFeatures')}
                  description={t('common:tableHelp.serpFeatures')}
                />
              </TableHead>
              <TableHead>
                <TableHeaderHelp
                  label={t('serpFeatures.columnOwnership')}
                  description={t('common:tableHelp.aiVisibility')}
                />
              </TableHead>
              <TableHead>
                <TableHeaderHelp
                  label={t('serpFeatures.columnObserved')}
                  description={t('common:tableHelp.observed')}
                />
              </TableHead>
              <TableHead>{t('columnActions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.keywordId} data-testid={`serp-features-row-${row.keywordId}`}>
                {/* max-w-0 lets the truncating child cap the column at its 20%
                    share instead of the phrase widening the whole table. */}
                <TableCell className="w-1/5 max-w-0 font-medium">
                  <span className="block truncate" title={row.phrase}>
                    {row.phrase}
                  </span>
                </TableCell>
                <TableCell>
                  {row.observedAt === null ? (
                    <span
                      className="text-muted-foreground text-xs"
                      data-testid="serp-feature-not-observed"
                    >
                      {t('serpFeatures.notObserved')}
                    </span>
                  ) : (
                    <FeatureChips features={row.features} />
                  )}
                </TableCell>
                <TableCell>
                  <span className="flex flex-col items-start gap-1.5">
                    {row.ownedSnippet ? (
                      <span className="flex flex-col items-start gap-1">
                        <StatusChip tone="success" data-testid="serp-feature-owned-snippet">
                          {t('serpFeatures.ownedSnippet')}
                        </StatusChip>
                        {row.ownedSnippet.url ? (
                          <ExternalRef url={row.ownedSnippet.url} label={row.ownedSnippet.url} />
                        ) : null}
                      </span>
                    ) : null}
                    {row.ownedPaa.length > 0 ? (
                      <span className="flex flex-col items-start gap-1">
                        <StatusChip tone="success" data-testid="serp-feature-owned-paa">
                          {t('serpFeatures.ownedPaaCount', { count: row.ownedPaa.length })}
                        </StatusChip>
                        {row.ownedPaa.map((entry) =>
                          entry.url ? (
                            <ExternalRef
                              key={`${entry.question}-${entry.url}`}
                              url={entry.url}
                              label={entry.url}
                            />
                          ) : null,
                        )}
                      </span>
                    ) : null}
                    {!row.ownedSnippet && row.ownedPaa.length === 0 ? (
                      <span className="text-muted-foreground text-xs">
                        {t('serpFeatures.noneOwned')}
                      </span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {row.observedAt === null
                    ? t('serpFeatures.notObserved')
                    : formatStamp(row.observedAt)}
                </TableCell>
                <TableCell>
                  <Button variant="outline" size="sm" onClick={() => openKeyword(row.keywordId)}>
                    {t('serpFeatures.openDetail')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
};
