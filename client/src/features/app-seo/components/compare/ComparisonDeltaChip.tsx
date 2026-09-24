import { useTranslation } from 'react-i18next';
import { cn } from '@shared/lib/utils';

export function ComparisonDeltaChip({
  value,
  format,
  className,
}: {
  value: number | null;
  format?: (value: number) => string;
  className?: string;
}) {
  const { t, i18n } = useTranslation('appSeoCompare');
  const magnitude = value === null ? null : Math.abs(value);
  const formatted = magnitude === null
    ? null
    : (format ?? ((number: number) => new Intl.NumberFormat(i18n.language).format(number)))(magnitude);
  const label = value === null
    ? t('deltas.notObserved')
    : value === 0
      ? t('deltas.even')
      : value > 0
        ? t('deltas.googlePlayLeads', { value: formatted })
        : t('deltas.appStoreLeads', { value: formatted });
  return (
    <span
      className={cn(
        'inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        value === null || value === 0
          ? 'bg-muted text-muted-foreground'
          : value > 0
            ? 'bg-chart-2/10 text-chart-2'
            : 'bg-chart-5/10 text-chart-5',
        className,
      )}
    >
      {label}
    </span>
  );
}
