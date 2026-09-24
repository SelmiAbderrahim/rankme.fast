/**
 * Shared status-token mapping for action metadata (design-system SPEC-A1
 * status color language). One authority so cards, chips, history entries
 * and the overview list can never drift.
 */
import type { StatusTone } from '@shared/ui/status-chip';
import type {
  ActionObservationFreshness,
  ActionSeverity,
  ActionState,
} from '../types';

export const ACTION_STATE_TONES: Record<ActionState, StatusTone> = {
  open: 'warning',
  planned: 'info',
  completed: 'success',
  dismissed: 'muted',
};

export const ACTION_SEVERITY_TONES: Record<ActionSeverity, StatusTone> = {
  critical: 'destructive',
  warning: 'warning',
  info: 'info',
};

export const ACTION_FRESHNESS_TONES: Record<
  ActionObservationFreshness,
  StatusTone
> = {
  fresh: 'success',
  stale: 'warning',
  unavailable: 'muted',
};
