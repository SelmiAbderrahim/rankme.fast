import { useTranslation } from 'react-i18next';
import { StatusChip } from '@shared/ui/status-chip';

export interface OpenIssuesValue { state: 'value' | 'stale'; count: number; }

export function OpenIssuesChip({ metric, testId }: { metric: OpenIssuesValue; testId?: string }) {
  const { t, i18n } = useTranslation('common');
  if (metric.count > 0) return <StatusChip tone="destructive" data-testid={testId}>{t('dashboard.health.fixNow.open', { count: metric.count, n: new Intl.NumberFormat(i18n.language).format(metric.count) })}</StatusChip>;
  return metric.state === 'stale'
    ? <StatusChip tone="warning" data-testid={testId}>{t('dashboard.health.fixNow.noneStale')}</StatusChip>
    : <StatusChip tone="success" data-testid={testId}>{t('dashboard.health.fixNow.none')}</StatusChip>;
}
