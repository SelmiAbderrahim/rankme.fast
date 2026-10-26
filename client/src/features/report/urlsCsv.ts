import { toCsv, type CsvColumn } from '@shared/security';
import type { BrokenLinkEvidenceRow } from './types';

/**
 * Every URL a finding names, as CSV. A free read of data the
 * report already holds: broken-link targets first, then the pages that link
 * to them (or the affected pages for any other rule). Cells go through
 * `neutralizeExportCell` inside `toCsv`. Headers are data column keys, not
 * UI copy.
 */
export const FINDING_URL_CSV_COLUMNS: readonly CsvColumn[] = [
  { key: 'ruleId', header: 'rule_id' },
  { key: 'role', header: 'url_role' },
  { key: 'url', header: 'url' },
];

/**
 * Every source → target pair behind a broken-links finding with the result of
 * re-requesting the target — dismissed rows included, so the file explains why
 * the on-screen count is smaller than what the crawler first reported.
 */
export const BROKEN_LINK_EVIDENCE_CSV_COLUMNS: readonly CsvColumn[] = [
  { key: 'ruleId', header: 'rule_id' },
  { key: 'source', header: 'source_url' },
  { key: 'target', header: 'target_url' },
  { key: 'outcome', header: 'recheck_result' },
  { key: 'status', header: 'http_status' },
  { key: 'failure', header: 'failure' },
  { key: 'finalUrl', header: 'final_url' },
];

export function buildBrokenLinkEvidenceCsv(finding: {
  ruleId: string;
  brokenLinkEvidence?: readonly BrokenLinkEvidenceRow[];
}): string {
  return toCsv(
    (finding.brokenLinkEvidence ?? []).map((row) => ({
      ruleId: finding.ruleId,
      source: row.source,
      target: row.target,
      outcome: row.outcome,
      status: row.status ?? '',
      failure: row.failure ?? '',
      finalUrl: row.finalUrl ?? '',
    })),
    BROKEN_LINK_EVIDENCE_CSV_COLUMNS,
  );
}

export function buildFindingUrlsCsv(finding: {
  ruleId: string;
  affectedUrls: readonly string[];
  brokenLinkTargets?: readonly string[];
}): string {
  const targets = finding.brokenLinkTargets ?? [];
  const pageRole = targets.length > 0 ? 'links_to_broken_target' : 'affected_page';
  return toCsv(
    [
      ...targets.map((url) => ({ ruleId: finding.ruleId, role: 'broken_target', url })),
      ...finding.affectedUrls.map((url) => ({ ruleId: finding.ruleId, role: pageRole, url })),
    ],
    FINDING_URL_CSV_COLUMNS,
  );
}
