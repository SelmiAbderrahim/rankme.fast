import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { SignedNumber, type SignedNumberProps } from '@shared/components/SignedNumber';
import { isolateSignedNumber } from '@shared/lib/signedNumber';
import { cn } from '@shared/lib/utils';

/**
 * DeltaPill (SPEC-09) — a `rounded-full` pill for a signed change beside a KPI.
 * Colored by GOODNESS, not by sign: pass `goodDirection="down"` for metrics
 * where a decrease is good (e.g. rank position). The shared numeric formatter
 * keeps the locale's sign and number in one isolate. null → neutral em-dash.
 */
type DeltaPillProps = Omit<ComponentProps<'span'>, 'children'> & {
  value: number | null;
  /** Which sign is "good". Default up (higher is better). */
  goodDirection?: 'up' | 'down';
  options?: SignedNumberProps['options'];
};

export function DeltaPill({
  value,
  goodDirection = 'up',
  options,
  className,
  ...props
}: DeltaPillProps) {
  const { i18n } = useTranslation();
  const isZero = value === 0 || value === null;
  const good = value !== null && value !== 0 && value > 0 === (goodDirection === 'up');

  const tone = isZero
    ? 'bg-muted text-muted-foreground'
    : good
      ? 'bg-success/10 text-success'
      : 'bg-destructive/10 text-destructive';

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
      aria-label={props['aria-label'] === undefined ? undefined : `${props['aria-label']}: ${value === null ? '—' : isolateSignedNumber(value, i18n.language, options)}`}
    >
      {value === null ? '—' : <SignedNumber value={value} options={options} />}
    </span>
  );
}
