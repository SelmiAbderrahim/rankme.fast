import type { StatusTone } from '@shared/ui/status-chip';
import type { ContentAnalysisStatus } from '../types';

/**
 * SPEC-A status-color language for content-analysis run states:
 *   queued → warning (pending); the five in-flight stages → info (running);
 *   completed → success; partial → warning; failed → destructive;
 *   cancelled → muted. Mirrors `inventory/status.ts`.
 */
const TONE_BY_STATUS: Record<ContentAnalysisStatus, StatusTone> = {
  queued: 'warning',
  collecting_owned: 'info',
  collecting_serp: 'info',
  collecting_competitors: 'info',
  scoring: 'info',
  generating_brief: 'info',
  generating_draft: 'info',
  completed: 'success',
  partial: 'warning',
  failed: 'destructive',
  cancelled: 'muted',
};

export function analysisStatusTone(status: ContentAnalysisStatus): StatusTone {
  return TONE_BY_STATUS[status];
}
