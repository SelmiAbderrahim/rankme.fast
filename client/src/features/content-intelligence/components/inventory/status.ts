import type { StatusTone } from '@shared/ui/status-chip';
import type { ContentInventoryStatus } from '../../types';

/**
 * SPEC-A status-color language for inventory run states:
 *   queued → warning (pending), crawling/analyzing → info (running),
 *   completed → success, partial → warning, failed → destructive,
 *   cancelled → muted.
 */
const TONE_BY_STATUS: Record<ContentInventoryStatus, StatusTone> = {
  queued: 'warning',
  crawling: 'info',
  analyzing: 'info',
  completed: 'success',
  partial: 'warning',
  failed: 'destructive',
  cancelled: 'muted',
};

export function inventoryStatusTone(status: ContentInventoryStatus): StatusTone {
  return TONE_BY_STATUS[status];
}
