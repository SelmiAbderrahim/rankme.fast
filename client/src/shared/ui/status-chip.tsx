import type { ComponentProps } from 'react';
import { cn } from '@shared/lib/utils';

/**
 * StatusChip (SPEC-06) — one shared pill for every table and detail view,
 * app and admin alike. Soft-tint fill (`bg-{token}/10 text-{token}`, SPEC-A2),
 * `rounded-full` (SPEC-A3), always token + localized text (never color alone).
 * Static — no pulse. Class strings are literal so the Tailwind scanner sees them.
 */
export type StatusTone =
  | 'success'
  | 'warning'
  | 'destructive'
  | 'info'
  | 'primary'
  | 'muted';

const TONE_STYLES: Record<StatusTone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
  primary: 'bg-primary/10 text-primary',
  muted: 'bg-muted text-muted-foreground',
};

type StatusChipProps = ComponentProps<'span'> & {
  tone?: StatusTone;
  /** Show a leading status dot. Text is always present regardless (a11y). */
  dot?: boolean;
};

export function StatusChip({
  tone = 'muted',
  dot = false,
  className,
  children,
  ...props
}: StatusChipProps) {
  return (
    <span
      data-slot="status-chip"
      data-tone={tone}
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_STYLES[tone],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-current"
        />
      ) : null}
      {children}
    </span>
  );
}
