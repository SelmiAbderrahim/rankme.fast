import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@shared/lib/utils';

/** Mirrors the server position-change threshold; lower positions are better. */
export const POSITION_UNCHANGED_EPSILON = 0.05;
export type PositionDirection = 'improved' | 'declined' | 'unchanged';
export interface PositionChangeValue {
  currentPosition: number | null;
  previousPosition: number | null;
  positionDelta: number | null;
  direction: PositionDirection | null;
  window: { range: string | null; comparison: 'previous_sync' | 'previous_check' };
}
export type RankMovementKind = PositionDirection | 'entered' | 'dropped' | 'unranked' | 'new';
export interface RankMovementValue { kind: RankMovementKind; amount: number | null; }
export interface PositionDeltaProps {
  change?: PositionChangeValue | null;
  movement?: RankMovementValue;
  /** Earlier responses use previous minus current, positive for improvement. */
  fallbackDelta?: number | null;
  variant?: 'compact' | 'full';
  className?: string;
  testId?: string;
}

function fromDelta(delta: number | null | undefined): RankMovementValue {
  if (delta === undefined || delta === null) return { kind: 'new', amount: null };
  if (Math.abs(delta) < POSITION_UNCHANGED_EPSILON) return { kind: 'unchanged', amount: 0 };
  return { kind: delta > 0 ? 'improved' : 'declined', amount: Math.abs(delta) };
}

function resolve({ change, movement, fallbackDelta }: PositionDeltaProps) {
  let value: RankMovementValue;
  if (change && change.direction !== null && change.positionDelta !== null) {
    value = { kind: change.direction, amount: change.direction === 'unchanged' ? 0 : Math.abs(change.positionDelta) };
  } else if (change) {
    value = movement && movement.amount === null ? movement : { kind: 'new', amount: null };
  } else value = movement ?? fromDelta(fallbackDelta);
  return {
    kind: value.kind,
    amount: value.amount ?? 0,
    comparison: change?.window.comparison ?? 'previous_check',
    days: Number.parseInt(change?.window.range ?? '28', 10),
  };
}

const TONE: Record<RankMovementKind, string> = {
  improved: 'text-success', entered: 'text-success',
  declined: 'text-destructive', dropped: 'text-destructive',
  unchanged: 'text-muted-foreground', unranked: 'text-muted-foreground', new: 'text-muted-foreground',
};

/** Shape, words and accessible text convey movement alongside semantic color. */
export function PositionDelta({ variant = 'compact', className, testId, ...input }: PositionDeltaProps) {
  const { t, i18n } = useTranslation('common');
  const resolved = resolve(input);
  const value = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(resolved.amount);
  const count = Number(resolved.amount.toFixed(1));
  let sentence: string;
  let short: string;
  let Icon: typeof ArrowUp | null = null;
  switch (resolved.kind) {
    case 'improved':
      sentence = t('positionDelta.improved', { count, value });
      short = t('positionDelta.short.improved');
      Icon = ArrowUp;
      break;
    case 'declined':
      sentence = t('positionDelta.declined', { count, value });
      short = t('positionDelta.short.declined');
      Icon = ArrowDown;
      break;
    case 'unchanged':
      sentence = t('positionDelta.unchanged');
      short = t('positionDelta.short.unchanged');
      Icon = Minus;
      break;
    case 'entered':
      sentence = t('rankChange.enteredLabel');
      short = t('rankChange.entered');
      Icon = ArrowUp;
      break;
    case 'dropped':
      sentence = t('rankChange.droppedLabel');
      short = t('rankChange.dropped');
      Icon = ArrowDown;
      break;
    case 'unranked':
      sentence = t('rankChange.unranked');
      short = '—';
      break;
    default:
      sentence = t('positionDelta.noPrevious');
      short = '—';
  }
  const tooltip = resolved.comparison === 'previous_sync'
    ? t('positionDelta.window.previousSync', { count: resolved.days, days: resolved.days })
    : t('positionDelta.window.previousCheck');
  const numeric = resolved.kind === 'improved' || resolved.kind === 'declined';
  return (
    <span className={cn('inline-flex items-center gap-1 tabular-nums whitespace-nowrap', TONE[resolved.kind], className)} title={tooltip} data-testid={testId} data-direction={resolved.kind} data-slot="position-delta">
      {Icon ? <Icon aria-hidden="true" className="size-3 shrink-0" /> : null}
      <span aria-hidden="true">{variant === 'full' ? sentence : numeric ? <><bdi dir="ltr">{value}</bdi> {short}</> : short}</span>
      <span className="sr-only">{sentence}</span>
    </span>
  );
}
