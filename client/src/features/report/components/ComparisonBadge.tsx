/**
 * The one badge for how a finding (or one of its URLs) compares with the
 * previous audit. Every surface uses this component and the
 * `report:comparison.*` vocabulary, so a finding can never read "Regressed"
 * in one place and "New" in another. Status is text plus a screen-reader
 * sentence, never colour alone. `unchanged` renders nothing: the absence of
 * a badge is the unchanged state.
 *
 * data-testid: `report-comparison-<status>` (row and URL badges alike).
 */
import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusTone } from '@shared/ui/status-chip';
import type { DiffKind, FindingComparisonStatus } from '../types';

const TONES: Record<Exclude<FindingComparisonStatus, 'unchanged'>, StatusTone> = {
  new: 'info',
  regressed: 'destructive',
  improved: 'success',
  resolved: 'success',
  not_comparable: 'muted',
};

/** A per-URL diff entry in the comparison vocabulary (`fixed` URL = resolved). */
export function urlComparisonStatus(kind: DiffKind | undefined): FindingComparisonStatus | undefined {
  if (kind === 'fixed') return 'resolved';
  if (kind === 'regressed' || kind === 'new') return kind;
  return undefined;
}

export interface ComparisonBadgeProps {
  status: FindingComparisonStatus | undefined;
}

export function ComparisonBadge({ status }: ComparisonBadgeProps) {
  const { t } = useTranslation('report');
  if (status === undefined || status === 'unchanged') return null;
  return (
    <StatusChip
      tone={TONES[status]}
      title={t(`comparison.description.${status}`)}
      data-testid={`report-comparison-${status}`}
      data-status={status}
    >
      <span aria-hidden="true">{t(`comparison.status.${status}`)}</span>
      <span className="sr-only">{t(`comparison.description.${status}`)}</span>
    </StatusChip>
  );
}
