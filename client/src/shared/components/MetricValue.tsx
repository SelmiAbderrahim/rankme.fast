import { useTranslation } from 'react-i18next';
import { formatMetricValue, type MetricContext, type MetricKind } from '@shared/lib/metricValue';
import { cn } from '@shared/lib/utils';

export interface MetricValueProps extends MetricContext {
  kind: MetricKind;
  value: number | null | undefined;
  className?: string;
  'data-testid'?: string;
}

export function MetricValue({ kind, value, denominator, className, ...rest }: MetricValueProps) {
  const { t, i18n } = useTranslation('common');
  const formatted = formatMetricValue(kind, value, i18n.language, { denominator });
  return formatted === null
    ? <span className={cn('text-muted-foreground', className)} data-testid={rest['data-testid']} data-empty="true"><span aria-hidden="true">—</span><span className="sr-only">{t('metric.noData')}</span></span>
    : <span className={className} data-testid={rest['data-testid']}>{formatted}</span>;
}
