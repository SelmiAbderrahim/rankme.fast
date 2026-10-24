import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';

export type FindingBucket = 'fix-now' | 'watch' | 'passed' | 'not-evaluated';
export type FindingSeverity = 'critical' | 'warning' | 'info';
const SEVERITY_TONE: Record<FindingSeverity, StatusTone> = { critical: 'destructive', warning: 'warning', info: 'info' };

export function FindingStatusChip({ bucket, severity, 'data-testid': testId }: { bucket: FindingBucket; severity: FindingSeverity; 'data-testid'?: string }) {
  const { t } = useTranslation('report');
  if (bucket === 'passed') return <StatusChip tone="success" data-testid={testId}>{t('tabs.passed')}</StatusChip>;
  if (bucket === 'not-evaluated') return <StatusChip tone="muted" data-testid={testId}>{t('notEvaluated.title')}</StatusChip>;
  return <StatusChip tone={SEVERITY_TONE[severity]} data-testid={testId}>{t('findingStatus', { bucket: t(`tabs.${bucket}`), severity: t(`severity.${severity}`) })}</StatusChip>;
}
