import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@shared/lib/utils';
import { DeltaPill } from '@shared/ui/delta-pill';
import { IconTile, type IconTileTone } from '@shared/ui/icon-tile';
import type { StatusTone } from '@shared/ui/status-chip';

/**
 * StatCard (SPEC-05) — three sanctioned variants:
 *  - `chip`  (A): soft-tint chip, value + solid-token icon circle, muted label.
 *  - `meter` (B): bordered card, value + IconTile + thin progress bar (cap meter).
 *  - `kpi`   (C): bordered card, value + DeltaPill, muted context line, optional
 *                 sparkline/chart slot and trailing action.
 * Static — no hover lift, no animated counters. Values are locale-formatted by
 * the caller. Class strings are literal for the Tailwind scanner.
 */

const CHIP_TONES: Record<StatusTone, { card: string; icon: string }> = {
  success: { card: 'bg-success/10', icon: 'bg-success text-success-foreground' },
  warning: { card: 'bg-warning/10', icon: 'bg-warning text-warning-foreground' },
  destructive: {
    card: 'bg-destructive/10',
    icon: 'bg-destructive text-destructive-foreground',
  },
  info: { card: 'bg-info/10', icon: 'bg-info text-info-foreground' },
  primary: { card: 'bg-primary/10', icon: 'bg-primary text-primary-foreground' },
  muted: { card: 'bg-muted', icon: 'bg-muted-foreground/15 text-muted-foreground' },
};

const METER_FILL: Record<StatusTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-info',
  primary: 'bg-primary',
  muted: 'bg-muted-foreground',
};

type ChipProps = {
  variant: 'chip';
  label: string;
  value: ReactNode;
  tone?: StatusTone;
  icon?: LucideIcon;
};

type MeterProps = {
  variant: 'meter';
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: StatusTone;
  iconTone?: IconTileTone;
  /** 0..1; clamped. The bar is the cap meter. */
  progress: number;
  progressLabel?: ReactNode;
};

type KpiProps = {
  variant: 'kpi';
  label: string;
  value: ReactNode;
  delta?: {
    value: number | null;
    goodDirection?: 'up' | 'down';
    format?: (n: number) => string;
    testId?: string;
  };
  context?: string;
  chart?: ReactNode;
  action?: ReactNode;
};

type StatCardProps = (ChipProps | MeterProps | KpiProps) & {
  className?: string;
  'data-testid'?: string;
};

export function StatCard(props: StatCardProps) {
  const { className } = props;
  const testId = props['data-testid'];

  if (props.variant === 'chip') {
    const tone = props.tone ?? 'muted';
    const styles = CHIP_TONES[tone];
    const Icon = props.icon;
    return (
      <div
        data-slot="stat-card"
        data-variant="chip"
        data-testid={testId}
        className={cn('min-w-0 rounded-xl p-4', styles.card, className)}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="min-w-0 break-words text-xl font-bold text-foreground tabular-nums">
            {props.value}
          </span>
          {Icon ? (
            <span
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-full [&>svg]:size-4',
                styles.icon,
              )}
            >
              <Icon aria-hidden="true" />
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{props.label}</p>
      </div>
    );
  }

  if (props.variant === 'meter') {
    const tone = props.tone ?? 'primary';
    const pct = Math.round(Math.min(1, Math.max(0, props.progress)) * 100);
    return (
      <div
        data-slot="stat-card"
        data-variant="meter"
        data-testid={testId}
        className={cn('min-w-0 rounded-xl border bg-card p-4', className)}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="break-words text-2xl font-bold text-foreground tabular-nums">
              {props.value}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{props.label}</p>
          </div>
          {props.icon ? (
            <IconTile icon={props.icon} tone={props.iconTone ?? tone} />
          ) : null}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <div
            className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={props.label}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={cn('h-full rounded-full', METER_FILL[tone])}
              style={{ inlineSize: `${pct}%` }}
            />
          </div>
          {props.progressLabel ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {props.progressLabel}
            </span>
          ) : null}
        </div>
      </div>
    );
  }

  // kpi
  return (
    <div
      data-slot="stat-card"
      data-variant="kpi"
      data-testid={testId}
      className={cn('min-w-0 rounded-xl border bg-card p-4', className)}
    >
      <p className="text-sm text-muted-foreground">{props.label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-words text-2xl font-bold text-foreground tabular-nums">
          {props.value}
        </span>
        {props.delta ? (
          <DeltaPill
            value={props.delta.value}
            goodDirection={props.delta.goodDirection}
            format={props.delta.format}
            data-testid={props.delta.testId}
          />
        ) : null}
      </div>
      {props.context ? (
        <p className="mt-1 text-xs text-muted-foreground">{props.context}</p>
      ) : null}
      {props.chart ? <div className="mt-3">{props.chart}</div> : null}
      {props.action ? <div className="mt-3">{props.action}</div> : null}
    </div>
  );
}
