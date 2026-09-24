import type { LucideIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from '@shared/lib/utils';

/**
 * IconTile (SPEC-08) — a lucide icon centered in a soft-tinted rounded square.
 * `bg-{token}/10 text-{token}` (SPEC-A2) or neutral muted. Used in stat cards,
 * feed rows, and feature lists. Never emoji, never raw hex.
 */
export type IconTileTone =
  | 'primary'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'info'
  | 'muted'
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5';

const TONE_STYLES: Record<IconTileTone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
  muted: 'bg-muted text-muted-foreground',
  'chart-1': 'bg-chart-1/10 text-chart-1',
  'chart-2': 'bg-chart-2/10 text-chart-2',
  'chart-3': 'bg-chart-3/10 text-chart-3',
  'chart-4': 'bg-chart-4/10 text-chart-4',
  'chart-5': 'bg-chart-5/10 text-chart-5',
};

const SIZE_STYLES = {
  sm: 'size-8 rounded-lg [&>svg]:size-4',
  md: 'size-10 rounded-xl [&>svg]:size-5',
} as const;

type IconTileProps = Omit<ComponentProps<'span'>, 'children'> & {
  icon: LucideIcon;
  tone?: IconTileTone;
  size?: keyof typeof SIZE_STYLES;
};

export function IconTile({
  icon: Icon,
  tone = 'muted',
  size = 'md',
  className,
  ...props
}: IconTileProps) {
  return (
    <span
      data-slot="icon-tile"
      data-tone={tone}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        SIZE_STYLES[size],
        TONE_STYLES[tone],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" />
    </span>
  );
}
