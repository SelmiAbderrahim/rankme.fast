import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportExportControl } from '@features/report-export';
import { Alert, AlertDescription, AlertTitle } from '@shared/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Skeleton } from '@shared/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@shared/ui/table';
import { TableHeaderHelp } from '@shared/ui/table-header-help';
import type { TrafficSnapshotDetail } from '../types';
import { CoverageNote } from './CoverageNote';
import { HistorySparkline } from './HistorySparkline';

interface SnapshotDetailProps {
  detail: TrafficSnapshotDetail | null;
  loading: boolean;
  error?: string;
}

export const SnapshotDetail = ({ detail, loading, error = '' }: SnapshotDetailProps) => {
  const { t, i18n } = useTranslation('competitorsTraffic');
  const number = useMemo(() => new Intl.NumberFormat(i18n.language), [i18n.language]);
  const countries = useMemo(
    () => new Intl.DisplayNames([i18n.language], { type: 'region' }),
    [i18n.language],
  );

  if (loading && !detail) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!detail) return null;

  if (detail.status === 'failed') {
    return (
      <Alert variant="destructive" role="alert" data-testid="traffic-detail-failed">
        <AlertTitle>{t('states.failed.title')}</AlertTitle>
        <AlertDescription>{t('states.failed.refund')}</AlertDescription>
      </Alert>
    );
  }

  if (!detail.snapshot) {
    return (
      <Card aria-busy="true" aria-live="polite">
        <CardHeader>
          <CardTitle>{detail.targetDomain}</CardTitle>
          <CardDescription>{t(`states.${detail.status}`)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  const payload = detail.snapshot.payload;
  const retainedCount = Object.values(detail.retainedOps).filter(Boolean).length;
  const statRows = [
    {
      key: 'monthlyVisits',
      label: t('detail.monthlyVisits'),
      value: number.format(payload.monthlyOrganicVisits.value),
      observation: payload.monthlyOrganicVisits.observation,
    },
    {
      key: 'rank',
      label: t('detail.rank'),
      value:
        payload.domainRank.value === null
          ? t('common.notAvailable')
          : number.format(payload.domainRank.value),
      observation: payload.domainRank.observation,
    },
    {
      key: 'keywords',
      label: t('detail.keywords'),
      value:
        payload.keywordCount.value === null
          ? t('common.notAvailable')
          : number.format(payload.keywordCount.value),
      observation: payload.keywordCount.observation,
    },
  ];

  return (
    <section className="flex flex-col gap-4" aria-labelledby="traffic-detail-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="traffic-detail-title" className="text-start text-xl font-semibold">
            {detail.targetDomain}
          </h2>
          <p className="text-start text-sm text-muted-foreground">{t('detail.description')}</p>
        </div>
        <ReportExportControl
          kind="competitors.traffic_snapshot"
          target={{
            scope: 'account_resource',
            resourceId: detail.id,
            ...(detail.siteId ? { siteId: detail.siteId } : {}),
          }}
          selection={{}}
        />
      </div>
      {detail.status === 'partial' || retainedCount < 3 ? (
        <Alert data-testid="traffic-detail-partial">
          <AlertTitle>{t('states.partial.title')}</AlertTitle>
          <AlertDescription>
            {t('states.partial.description', { retained: retainedCount })}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 md:grid-cols-3">
        {statRows.map((stat) => (
          <Card key={stat.key} data-testid={`traffic-stat-${stat.key}`}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{stat.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <CoverageNote observation={stat.observation} />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('detail.countries.title')}</CardTitle>
          <CardDescription>{t('detail.countries.description')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table data-testid="traffic-country-table">
            <caption className="sr-only">{t('detail.countries.title')}</caption>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">{t('detail.countries.country')}</TableHead>
                <TableHead className="text-end">
                  <TableHeaderHelp
                    label={t('detail.countries.visits')}
                    description={t('common:tableHelp.estimatedTraffic')}
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payload.topCountries.map((country) => (
                <TableRow key={country.countryCode}>
                  <TableCell className="text-start">
                    {countries.of(country.countryCode) ?? country.countryCode}
                  </TableCell>
                  <TableCell className="text-end">
                    <span className="flex flex-col items-end gap-1">
                      <span className="tabular-nums">{number.format(country.visits.value)}</span>
                      <CoverageNote observation={country.visits.observation} />
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('detail.history.title')}</CardTitle>
          <CardDescription>{t('detail.history.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <HistorySparkline points={payload.history} />
        </CardContent>
      </Card>
    </section>
  );
};
