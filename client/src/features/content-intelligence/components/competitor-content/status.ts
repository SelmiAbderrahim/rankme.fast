import type { StatusTone } from '@shared/ui/status-chip';
import type { CompetitorContentConfidence, CompetitorContentStatus } from '../../types';

/**
 * SPEC-A status-color language for competitor content run states:
 *   queued → warning (pending), collecting/comparing → info (running),
 *   completed → success, partial → warning, failed → destructive,
 *   cancelled → muted.
 */
const TONE_BY_STATUS: Record<CompetitorContentStatus, StatusTone> = {
  queued: 'warning',
  collecting: 'info',
  comparing: 'info',
  completed: 'success',
  partial: 'warning',
  failed: 'destructive',
  cancelled: 'muted',
};

export function competitorStatusTone(status: CompetitorContentStatus): StatusTone {
  return TONE_BY_STATUS[status];
}

const TONE_BY_CONFIDENCE: Record<CompetitorContentConfidence, StatusTone> = {
  high: 'info',
  medium: 'warning',
  low: 'muted',
};

export function competitorConfidenceTone(
  confidence: CompetitorContentConfidence,
): StatusTone {
  return TONE_BY_CONFIDENCE[confidence];
}
