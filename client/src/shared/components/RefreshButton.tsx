/**
 * Shared manual-refresh trigger for vendor-backed panels.
 *
 * One pattern for every panel: a ghost icon button that spins while the
 * refresh is in flight and shows a live countdown while the server-imposed
 * cooldown is active. Panel-local state only — a refresh is an action, not
 * navigation, so it never touches the URL (`?tab=` stays the only tab state).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';

export interface RefreshButtonProps {
  onRefresh: () => void;
  isRefreshing: boolean;
  /** Epoch ms when the cooldown expires; null/past → button enabled. */
  cooldownUntil: number | null;
  /** i18n key for the button label + aria-label (e.g. `backlinks:refresh.button`). */
  labelKey: string;
  /** i18n key for the countdown text; receives `{{seconds}}`. */
  cooldownKey: string;
  disabled?: boolean;
  'data-testid'?: string;
}

function secondsLeft(cooldownUntil: number | null): number {
  if (cooldownUntil === null) return 0;
  return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
}

export const RefreshButton = ({
  onRefresh,
  isRefreshing,
  cooldownUntil,
  labelKey,
  cooldownKey,
  disabled = false,
  'data-testid': testId,
}: RefreshButtonProps) => {
  const { t } = useTranslation();
  const [remaining, setRemaining] = useState(() => secondsLeft(cooldownUntil));

  // 1s ticker while a cooldown is pending; stops (and re-enables) at zero.
  useEffect(() => {
    setRemaining(secondsLeft(cooldownUntil));
    if (cooldownUntil === null || cooldownUntil <= Date.now()) return undefined;
    const timer = window.setInterval(() => {
      const left = secondsLeft(cooldownUntil);
      setRemaining(left);
      if (left <= 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  const coolingDown = remaining > 0;
  const label = coolingDown
    ? t(cooldownKey, { seconds: remaining })
    : t(labelKey);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onRefresh}
      disabled={disabled || isRefreshing || coolingDown}
      aria-label={label}
      data-testid={testId}
    >
      <RefreshCw
        aria-hidden="true"
        className={cn('h-4 w-4', isRefreshing && 'animate-spin')}
      />
      <span>{label}</span>
    </Button>
  );
};
