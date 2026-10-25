import type { FindingMeasurement, LocalizedFinding } from './types';

/**
 * The report screen receives a preview of each finding's lists plus exact
 * totals; the full lists load on demand. Older payloads
 * without totals are complete lists.
 */

/** Total affected URLs of a finding, preview or not. */
export const affectedUrlTotal = (finding: Pick<LocalizedFinding, 'affectedUrls' | 'affectedUrlCount'>): number =>
  Math.max(finding.affectedUrlCount ?? 0, finding.affectedUrls.length);

/** Total broken-link targets of a finding, preview or not. */
export const brokenLinkTargetTotal = (
  finding: Pick<LocalizedFinding, 'brokenLinkTargets' | 'brokenLinkTargetCount'>,
): number => Math.max(finding.brokenLinkTargetCount ?? 0, finding.brokenLinkTargets?.length ?? 0);

/** True when the finding carries only a preview of one of its lists. */
export const hasFindingListPreview = (finding: LocalizedFinding): boolean =>
  affectedUrlTotal(finding) > finding.affectedUrls.length ||
  brokenLinkTargetTotal(finding) > (finding.brokenLinkTargets?.length ?? 0) ||
  (finding.brokenLinkEvidenceTotal ?? 0) > (finding.brokenLinkEvidence?.length ?? 0);

/**
 * Per-URL measured lengths a finding carries in `meta.measurements`
 * (thin-content); malformed entries are skipped.
 */
export const readFindingMeasurements = (meta: LocalizedFinding['meta']): FindingMeasurement[] => {
  const raw = meta?.measurements;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is FindingMeasurement =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as FindingMeasurement).url === 'string' &&
      typeof (entry as FindingMeasurement).value === 'number' &&
      ((entry as FindingMeasurement).unit === 'words' || (entry as FindingMeasurement).unit === 'characters'),
  );
};
