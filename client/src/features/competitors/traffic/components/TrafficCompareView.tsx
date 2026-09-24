import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { ReportExportControl } from '@features/report-export';
import { apiErrorMessage } from '@shared/api/errorMessage';
import type { ObservationMeta } from '@shared/observations/types';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import { countryName } from '@shared/markets';
import { compareTrafficSnapshots } from '../api';
import type { TrafficSnapshotCompareResponse } from '../types';
import { CoverageNote } from './CoverageNote';
import { TrafficCompareChart } from './TrafficCompareChart';

interface TrafficCompareViewProps {
  ids: string[];
  siteId: string;
  onCollapse: (remainingId: string) => void;
}

const MAX_COMPARE_SNAPSHOTS = 5;

const CompareStat = ({
  label,
  observation,
  value,
}: {
  label: string;
  observation: ObservationMeta;
  value: number | null;
}) => {
  const { t, i18n } = useTranslation('competitorsTraffic');
  return (
    <div>
      <dt className="text-sm text-muted-foreground">
        {t('estimate.label')}: {label}
      </dt>
      <dd className="flex flex-col gap-1">
        <span className="text-2xl font-semibold tabular-nums">
          {value === null
            ? t('common.notAvailable')
            : new Intl.NumberFormat(i18n.language).format(value)}
        </span>
        <CoverageNote observation={observation} />
      </dd>
    </div>
  );
};

export const readTrafficCompareIds = (params: URLSearchParams): string[] => [
  ...new Set(
    (params.get('ids') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  ),
];

export const TrafficCompareView = ({ ids, siteId, onCollapse }: TrafficCompareViewProps) => {
  const { t, i18n } = useTranslation('competitorsTraffic');
  const [params, setParams] = useSearchParams();
  const selectedIdsKey = ids.slice(0, MAX_COMPARE_SNAPSHOTS).join(',');
  const selectedIds = useMemo(() => selectedIdsKey.split(',').filter(Boolean), [selectedIdsKey]);
  const [data, setData] = useState<TrafficSnapshotCompareResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const clamped = ids.length > MAX_COMPARE_SNAPSHOTS;
  const [showClampWarning, setShowClampWarning] = useState(clamped);
  const date = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }),
    [i18n.language],
  );
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);

  const load = (preserveError = false) => {
    const controller = new AbortController();
    setLoading(true);
    if (!preserveError) {
      setError('');
      setData(null);
    }
    void compareTrafficSnapshots(selectedIds, {
      signal: controller.signal,
      siteId,
    })
      .then(setData)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(apiErrorMessage(reason, 'competitorsTraffic:errors.compareFailed'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return controller;
  };

  useEffect(() => {
    const controller = load();
    return () => controller.abort();
    // selectedIds is a stable, id-order-sensitive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, siteId]);

  useEffect(() => {
    if (!clamped) return;
    setShowClampWarning(true);
    const next = new URLSearchParams(params);
    next.set('ids', selectedIds.join(','));
    setParams(next, { replace: true });
  }, [clamped, params, selectedIds, setParams]);

  const remove = (id: string) => {
    const remaining = selectedIds.filter((candidate) => candidate !== id);
    if (remaining.length < 2) {
      const next = new URLSearchParams(params);
      next.delete('ids');
      setParams(next, { replace: true });
      onCollapse(remaining[0]!);
      return;
    }
    const next = new URLSearchParams(params);
    next.set('ids', remaining.join(','));
    setParams(next, { replace: true });
  };

  return (
    <section className="flex flex-col gap-6" data-testid="traffic-compare-view">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-start text-xl font-semibold">{t('compare.title')}</h3>
          <p className="text-start text-sm text-muted-foreground">{t('compare.description')}</p>
        </div>
        <ReportExportControl
          kind="competitors.traffic_comparison"
          target={{
            scope: 'account_resource',
            resourceId: selectedIds[0]!,
            siteId,
          }}
          selection={{ snapshotIds: selectedIds }}
        />
      </div>

      {showClampWarning || data?.warning ? (
        <Alert role="alert" data-testid="traffic-compare-clamped">
          <AlertDescription>
            {data?.warning?.message ?? t('compare.clamped', { count: MAX_COMPARE_SNAPSHOTS })}
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{error}</span>
            <Button
              type="button"
              variant="outline"
              loading={loading}
              loadingLabel={t('states.timeout.retrying')}
              onClick={() => load(true)}
            >
              {t('states.timeout.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-live="polite">
          <Skeleton className="h-52 w-full" />
          <Skeleton className="h-52 w-full" />
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {data.snapshots.map((snapshot) => (
              <Card key={snapshot.id} data-testid={`traffic-compare-card-${snapshot.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-start">
                      <CardTitle className="break-all text-base">{snapshot.targetDomain}</CardTitle>
                      <CardDescription>
                        {date.format(new Date(snapshot.capturedAt))}
                      </CardDescription>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('compare.remove', { domain: snapshot.targetDomain })}
                      onClick={() => remove(snapshot.id)}
                    >
                      <X data-icon="inline-start" aria-hidden="true" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <dl className="flex flex-col gap-4">
                    <CompareStat
                      label={t('detail.monthlyVisits')}
                      observation={snapshot.payload.monthlyOrganicVisits.observation}
                      value={snapshot.payload.monthlyOrganicVisits.value}
                    />
                    <CompareStat
                      label={t('detail.rank')}
                      observation={snapshot.payload.domainRank.observation}
                      value={snapshot.payload.domainRank.value}
                    />
                    <CompareStat
                      label={t('detail.keywords')}
                      observation={snapshot.payload.keywordCount.observation}
                      value={snapshot.payload.keywordCount.value}
                    />
                  </dl>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('compare.countriesTitle')}</CardTitle>
              <CardDescription>{t('estimate.coverage')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <caption className="sr-only">{t('compare.countriesTitle')}</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">{t('detail.countries.country')}</TableHead>
                    {data.snapshots.map((snapshot) => (
                      <TableHead key={snapshot.id} className="text-end">
                        <TableHeaderHelp
                          label={`${snapshot.targetDomain} · ${t('estimate.label')}`}
                          description={t('common:tableHelp.estimatedTraffic')}
                        />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.axes.countryCodes.map((countryCode) => (
                    <TableRow key={countryCode}>
                      <TableCell className="text-start">
                        {countryName(countryCode, i18n.language) ?? t('common:market.unknownCountry')}
                      </TableCell>
                      {data.snapshots.map((snapshot) => {
                        const country = snapshot.payload.topCountries.find(
                          (candidate) => candidate.countryCode === countryCode,
                        );
                        return (
                          <TableCell key={snapshot.id} className="text-end tabular-nums">
                            {country ? (
                              <span className="flex flex-col items-end gap-1">
                                <span>{number.format(country.visits.value)}</span>
                                <CoverageNote observation={country.visits.observation} />
                              </span>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('compare.historyTitle')}</CardTitle>
              <CardDescription>{t('compare.historyDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <TrafficCompareChart snapshots={data.snapshots} />
            </CardContent>
          </Card>
        </>
      ) : null}
    </section>
  );
};
