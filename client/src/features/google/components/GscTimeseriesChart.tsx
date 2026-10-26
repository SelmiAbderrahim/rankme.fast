/**
 * GscTimeseriesChart — the GSC-flavoured wrapper over the shared
 * `MetricTimeseriesChart`: clicks/impressions toggle, four sr-only table
 * columns (clicks / impressions / ctr / position), `gsc-timeseries-*`
 * test ids, and the `searchSummary.*` i18n keys. The `days` prop keeps the
 * chart label / caption honest for the 7d/90d ranges (defaults to 28).
 */
import { useTranslation } from 'react-i18next';
import { formatInt } from '../lib/format';
import { MetricTimeseriesChart } from './MetricTimeseriesChart';
import type { GscSummaryTimeseriesPoint } from '../types';
import { MetricValue } from '@shared/components/MetricValue';

export interface GscTimeseriesChartProps {
  points: GscSummaryTimeseriesPoint[];
  /** Day count of the active range for the `{{days}}` interpolations. */
  days?: number;
}

export const GscTimeseriesChart = ({ points, days = 28 }: GscTimeseriesChartProps) => {
  const { t, i18n } = useTranslation('google');

  return (
    <MetricTimeseriesChart
      points={points}
      locale={i18n.language}
      toggles={[
        {
          id: 'clicks',
          label: t('searchSummary.clicks'),
          value: (p) => p.clicks,
        },
        {
          id: 'impressions',
          label: t('searchSummary.impressions'),
          value: (p) => p.impressions,
        },
      ]}
      columns={[
        {
          id: 'clicks',
          header: t('searchSummary.clicks'),
          format: (locale, p) => formatInt(locale, p.clicks),
        },
        {
          id: 'impressions',
          header: t('searchSummary.impressions'),
          format: (locale, p) => formatInt(locale, p.impressions),
        },
        {
          id: 'ctr',
          header: t('searchSummary.ctr'),
          // No impressions means no CTR or position, not 0.
          format: (_locale, p) => <MetricValue kind="ratio" value={p.ctr} denominator={p.impressions} />,
        },
        {
          id: 'position',
          header: t('searchSummary.position'),
          format: (_locale, p) => (
            <MetricValue kind="position" value={p.position} denominator={p.impressions} />
          ),
        },
      ]}
      chartLabel={(metric) =>
        t('searchSummary.timeseriesChartLabel', { count: days, metric, days })
      }
      metricGroupLabel={t('searchSummary.metricLabel')}
      tableCaption={t('searchSummary.timeseriesTableCaption', { count: days, days })}
      dateHeader={t('searchSummary.tableDate')}
      emptyLabel={t('searchSummary.timeseriesEmpty')}
      noActivityLabel={(metricId) =>
        t(metricId === 'impressions' ? 'searchSummary.timeseriesNoImpressions' : 'searchSummary.timeseriesNoClicks')
      }
      testIdPrefix="gsc-timeseries"
    />
  );
};
