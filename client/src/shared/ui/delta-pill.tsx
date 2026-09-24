import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@shared/lib/utils';

/**
 * DeltaPill (SPEC-09) — a `rounded-full` pill for a signed change beside a KPI.
 * Colored by GOODNESS, not by sign: pass `goodDirection="down"` for metrics
 * where a decrease is good (e.g. rank position). Values are locale-formatted by
 * the caller-supplied `format`; the sign glyph is rendered separately so it is
 * RTL-safe. null → neutral em-dash.
 */
type DeltaPillProps = Omit<ComponentProps<'span'>, 'children'> & {
  value: number | null;
  /** Which sign is "good". Default up (higher is better). */
  goodDirection?: 'up' | 'down';
  /** Locale formatter for the magnitude. Defaults to `toLocaleString`. */
  format?: (n: number) => string;
};

export function DeltaPill({
  value,
  goodDirection = 'up',
  format,
  className,
  ...props
}: DeltaPillProps) {
  const { i18n } = useTranslation();
  const formatValue = format ?? ((number: number) =>
    new Intl.NumberFormat(i18n.language).format(number));
  const isZero = value === 0 || value === null;
  const good = value !== null && value !== 0 && value > 0 === (goodDirection === 'up');

  const tone = isZero
    ? 'bg-muted text-muted-foreground'
    : good
      ? 'bg-success/10 text-success'
      : 'bg-destructive/10 text-destructive';

  // The magnitude is locale-formatted; negatives carry the locale's own minus
  // (RTL-safe), positives get an explicit `+`. null → neutral em-dash.
  let text: string;
  if (value === null) text = '—';
  else if (value === 0) text = formatValue(0);
  else if (value > 0) text = `+${formatValue(value)}`;
  else text = formatValue(value);

  return (
    <span
      data-slot="delta-pill"
      data-good={isZero ? 'neutral' : good ? 'yes' : 'no'}
      className={cn(
        'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums whitespace-nowrap',
        tone,
        className,
      )}
      {...props}
    >
      {text}
    </span>
  );
}
