import type {
  AuditReport,
  BrokenLinkEvidenceRow,
  DiffEntry,
  DiffKind,
  LocalizedFinding,
} from './report.service.js';

/**
 * Browser-facing report payload.
 *
 * The stored report carries every affected URL, every broken-link pair and
 * one diff entry per (rule, URL). For a large crawl that is well over 100 KB
 * on the first screen, most of it inside findings nobody has opened. The
 * report screen receives a preview per finding plus exact totals; the full
 * lists load on demand from the finding-URLs route.
 *
 * Exports, PDFs, MCP and the public API keep reading `getAuditReport()`
 * directly, so their contracts are unchanged.
 */

/** Affected URLs (and broken-link targets) shown before "Show all". */
export const AFFECTED_URL_PREVIEW = 5;
/** Broken-link source → target rows shown before "Show all". */
export const BROKEN_LINK_EVIDENCE_PREVIEW = 20;

/**
 * Copy the report screen renders. The message keys stay on the full report
 * (exports, MCP, public API); the screen only shows the localized text, so the
 * first screen leaves them out so fifty checks still fit the first-screen
 * budget.
 */
export type BrowserRuleCopy = Omit<LocalizedFinding['copy'], 'titleKey' | 'whyKey' | 'fixKey' | 'passedLabelKey' | 'reasonKey'>;

export interface BrowserFinding extends Omit<LocalizedFinding, 'copy'> {
  copy: BrowserRuleCopy;
  /** Total affected URLs; `affectedUrls` holds the first {@link AFFECTED_URL_PREVIEW}. */
  affectedUrlCount: number;
  /** Total broken-link targets when the list was cut. */
  brokenLinkTargetCount?: number;
}

export interface BrowserAuditReport extends Omit<AuditReport, 'findings'> {
  findings: BrowserFinding[];
}

/** The full lists of one finding, served by the lazy finding-URLs route. */
export interface FindingUrlsPayload {
  ruleId: string;
  affectedUrls: string[];
  brokenLinkTargets: string[];
  brokenLinkEvidence: BrokenLinkEvidenceRow[];
  /** Measured length of every affected URL, when the check records one. */
  measurements: FindingMeasurement[];
  /** Per-URL diff against the previous run; `unchanged` entries are omitted. */
  diff: Array<{ url: string; kind: DiffKind }>;
  /** Full deep crawl evidence lists; `{}` when the finding has none. */
  evidence: Record<string, unknown[]>;
}

const RULE_KIND_PRECEDENCE: Record<DiffKind, number> = {
  regressed: 3,
  new: 2,
  fixed: 1,
  unchanged: 0,
};

/** One measured page length (thin-content). */
export interface FindingMeasurement {
  url: string;
  value: number;
  unit: 'words' | 'characters';
}

/** The per-URL measurements a finding recorded; `[]` when it recorded none. */
export function findingMeasurements(meta: LocalizedFinding['meta']): FindingMeasurement[] {
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
}

/** Deep crawl evidence keyed by an affected URL. */
const PER_URL_EVIDENCE_KEYS = ['pages', 'resources'] as const;
/** Deep crawl evidence blocks that are not one URL's row. */
const BLOCK_EVIDENCE_KEYS = ['chains', 'groups', 'insecureResources', 'reachedThroughChain'] as const;

const rowUrl = (row: unknown): unknown =>
  row && typeof row === 'object' ? (row as { url?: unknown }).url : undefined;

/** The full deep crawl evidence of a finding, for the lazy finding-URLs route. */
export function findingEvidence(meta: LocalizedFinding['meta']): Record<string, unknown[]> {
  const evidence: Record<string, unknown[]> = {};
  for (const key of [...PER_URL_EVIDENCE_KEYS, ...BLOCK_EVIDENCE_KEYS]) {
    const value = meta?.[key];
    if (Array.isArray(value)) evidence[key] = value;
  }
  return evidence;
}

/**
 * Drops a meta field the payload already carries as a top-level list, and
 * keeps per-URL measurements and deep crawl evidence only for the previewed
 * URLs (evidence blocks only their first rows); the lazy route serves the rest.
 */
function compactMeta(
  meta: LocalizedFinding['meta'],
  previewUrls: ReadonlySet<string>,
): LocalizedFinding['meta'] {
  if (!meta) return meta;
  const { brokenLinkTargets: _dropped, ...rest } = meta;
  const compacted: Record<string, unknown> = { ...rest };
  if ('measurements' in rest) {
    compacted.measurements = findingMeasurements(rest).filter((entry) => previewUrls.has(entry.url));
  }
  for (const key of PER_URL_EVIDENCE_KEYS) {
    const value = rest[key];
    if (Array.isArray(value)) compacted[key] = value.filter((row) => previewUrls.has(rowUrl(row) as string));
  }
  for (const key of BLOCK_EVIDENCE_KEYS) {
    const value = rest[key];
    if (Array.isArray(value)) compacted[key] = value.slice(0, AFFECTED_URL_PREVIEW);
  }
  return compacted;
}

function browserCopy(copy: LocalizedFinding['copy']): BrowserRuleCopy {
  const { titleKey: _title, whyKey: _why, fixKey: _fix, passedLabelKey: _passed, reasonKey: _reason, ...text } = copy;
  return text;
}

function compactFinding(finding: LocalizedFinding): BrowserFinding {
  const { brokenLinkTargets, brokenLinkEvidence, meta, copy, ...rest } = finding;
  const compactedMeta = compactMeta(meta, new Set(finding.affectedUrls.slice(0, AFFECTED_URL_PREVIEW)));
  const evidenceTotal = finding.brokenLinkEvidenceTotal ?? brokenLinkEvidence?.length ?? 0;
  return {
    ...rest,
    copy: browserCopy(copy),
    ...(compactedMeta ? { meta: compactedMeta } : {}),
    affectedUrls: finding.affectedUrls.slice(0, AFFECTED_URL_PREVIEW),
    affectedUrlCount: finding.affectedUrls.length,
    ...(brokenLinkTargets
      ? {
          brokenLinkTargets: brokenLinkTargets.slice(0, AFFECTED_URL_PREVIEW),
          ...(brokenLinkTargets.length > AFFECTED_URL_PREVIEW
            ? { brokenLinkTargetCount: brokenLinkTargets.length }
            : {}),
        }
      : {}),
    ...(brokenLinkEvidence
      ? {
          brokenLinkEvidence: brokenLinkEvidence.slice(0, BROKEN_LINK_EVIDENCE_PREVIEW),
          ...(evidenceTotal > BROKEN_LINK_EVIDENCE_PREVIEW
            ? { brokenLinkEvidenceTotal: evidenceTotal }
            : {}),
        }
      : {}),
  };
}

/**
 * Diff entries the first screen needs: one rule-level entry (`url: ''`) with
 * the strongest change, plus per-URL entries for the previewed URLs. The
 * summary counts stay exact.
 */
function compactDiffEntries(
  entries: readonly DiffEntry[],
  previewByRule: ReadonlyMap<string, ReadonlySet<string>>,
): DiffEntry[] {
  const ruleKinds = new Map<string, DiffKind>();
  const kept: DiffEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === 'unchanged') continue;
    const current = ruleKinds.get(entry.ruleId);
    if (current === undefined || RULE_KIND_PRECEDENCE[entry.kind] > RULE_KIND_PRECEDENCE[current]) {
      ruleKinds.set(entry.ruleId, entry.kind);
    }
    if (entry.url !== '' && previewByRule.get(entry.ruleId)?.has(entry.url)) kept.push(entry);
  }
  const ruleLevel = [...ruleKinds].map(([ruleId, kind]) => ({ ruleId, url: '', kind }));
  return [...ruleLevel, ...kept];
}

export function toBrowserAuditReport(report: AuditReport): BrowserAuditReport {
  const findings = report.findings.map(compactFinding);
  const previewByRule = new Map(
    findings.map((finding) => [finding.ruleId as string, new Set(finding.affectedUrls)]),
  );
  return {
    ...report,
    findings,
    diff: {
      summary: report.diff.summary,
      entries: compactDiffEntries(report.diff.entries, previewByRule),
    },
  };
}

/** The full lists of `ruleId`, or `null` when the run has no such finding. */
export function findingUrlsFromReport(
  report: AuditReport,
  ruleId: string,
): FindingUrlsPayload | null {
  const finding = report.findings.find((candidate) => candidate.ruleId === ruleId);
  if (!finding) return null;
  return {
    ruleId,
    affectedUrls: [...finding.affectedUrls],
    brokenLinkTargets: [...(finding.brokenLinkTargets ?? [])],
    brokenLinkEvidence: [...(finding.brokenLinkEvidence ?? [])],
    measurements: findingMeasurements(finding.meta),
    evidence: findingEvidence(finding.meta),
    diff: report.diff.entries
      .filter((entry) => entry.ruleId === ruleId && entry.url !== '' && entry.kind !== 'unchanged')
      .map((entry) => ({ url: entry.url, kind: entry.kind })),
  };
}
