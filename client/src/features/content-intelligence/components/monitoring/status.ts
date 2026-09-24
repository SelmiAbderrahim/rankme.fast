import type { StatusTone } from '@shared/ui/status-chip';
import type { ContentMonitorStatus } from '../../types';

/**
 * SPEC-A status-color language for monitor lifecycle states:
 *   active → success (healthy), paused → muted (user-disabled),
 *   cap_paused → warning (monthly allowance exhausted), error → destructive.
 */
const TONE_BY_STATUS: Record<ContentMonitorStatus, StatusTone> = {
  active: 'success',
  paused: 'muted',
  cap_paused: 'warning',
  error: 'destructive',
};

export function monitorStatusTone(status: ContentMonitorStatus): StatusTone {
  return TONE_BY_STATUS[status];
}

/**
 * Change-feed event-kind tone. Unknown kinds (a forward-compatible server event)
 * fall back to the neutral `muted` tone rather than crashing.
 */
const TONE_BY_FEED_KIND: Record<string, StatusTone> = {
  check_reserved: 'info',
  check_completed: 'success',
  change_detected: 'warning',
  check_failed: 'destructive',
  cap_paused: 'warning',
};

export function monitorFeedTone(kind: string): StatusTone {
  return TONE_BY_FEED_KIND[kind] ?? 'muted';
}
