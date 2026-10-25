/**
 * Shared evaluation for the deep crawl rules.
 *
 * Every deep crawl signal is optional on `AuditResult`. These helpers keep
 * the three outcomes apart the same way for every rule:
 *   - a measured problem       → a finding with per-page evidence;
 *   - measured and clean       → passed;
 *   - not measured             → `insufficientData` with a reason
 *       `legacy-run`      the crawl result predates these signals,
 *       `no-crawl-signal` the crawler did not report the signal,
 *       `scan-off`        the resource scan was turned off for this run,
 *       `unavailable`     the extra read failed (`cause` says how).
 * "Not measured" is never read as clean.
 */
import type {
  AuditExtraSignal,
  AuditPage,
  AuditPageChecks,
  AuditResult,
} from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import type { RuleFinding, RuleId, RuleSeverity } from './rule.types.js';

/** Evidence rows kept per finding; `affectedUrls` stays complete. */
export const MAX_EVIDENCE_ROWS = 200;

export const DEEP_CRAWL_NOT_EVALUATED_REASONS = [
  'legacy-run',
  'no-crawl-signal',
  'scan-off',
  'unavailable',
] as const;
export type DeepCrawlNotEvaluatedReason = (typeof DEEP_CRAWL_NOT_EVALUATED_REASONS)[number];

/** A page that served a body and should be found in search. */
export function servedIndexable(page: AuditPage): boolean {
  return page.isIndexable && Math.floor(page.statusCode / 100) === 2;
}

/** Why a crawl signal is missing, from what the result says about itself. */
export function missingSignalMeta(
  result: AuditResult,
  signal?: AuditExtraSignal,
): { insufficientData: true; reason: DeepCrawlNotEvaluatedReason; cause?: string } {
  const failed = signal ? result.unavailableSignals?.find((entry) => entry.signal === signal) : undefined;
  if (failed) return { insufficientData: true, reason: 'unavailable', cause: failed.cause };
  if (!result.capabilities) return { insufficientData: true, reason: 'legacy-run' };
  return { insufficientData: true, reason: 'no-crawl-signal' };
}

export function notEvaluated(
  ruleId: RuleId,
  severity: RuleSeverity,
  meta: Record<string, unknown>,
): RuleFinding {
  // `insufficientData` → `not-evaluated` happens in bucket.ts.
  return { ruleId, bucket: 'watch', severity, affectedUrls: [], meta };
}

/** Bounded evidence list with the size of what was cut. */
export function boundedEvidence<T>(rows: T[], key: string): Record<string, unknown> {
  return {
    [key]: rows.slice(0, MAX_EVIDENCE_ROWS),
    ...(rows.length > MAX_EVIDENCE_ROWS ? { evidenceTruncated: rows.length } : {}),
  };
}

export interface PageCheckRuleSpec {
  id: RuleId;
  /** Severity of a failing finding. */
  severity: RuleSeverity;
  /** Pages the check applies to. Defaults to served, indexable pages. */
  scope?: (page: AuditPage) => boolean;
  /** The checks this rule reads; a page is measured when any is reported. */
  checks: readonly (keyof AuditPageChecks)[];
  /** Extra evidence for a flagged page, next to its URL and problems. */
  evidence?: (page: AuditPage) => Record<string, unknown>;
  /** Send the failing finding to fix-now when this holds for a flagged page. */
  fixNowWhen?: (page: AuditPage) => boolean;
  /** Severity when `fixNowWhen` holds (defaults to `severity`). */
  fixNowSeverity?: RuleSeverity;
  /** Extra meta on a failing finding. */
  extraMeta?: (result: AuditResult, flagged: AuditPage[]) => Record<string, unknown>;
}

/** Problems a page carries among `checks`, in declaration order. */
export function problemsOf(page: AuditPage, checks: readonly (keyof AuditPageChecks)[]): (keyof AuditPageChecks)[] {
  return checks.filter((check) => page.checks?.[check] === true);
}

/**
 * Generic per-page check rule: a page is flagged when any listed check is
 * `true`, clean when the checks it reports are all `false`, and unmeasured
 * when it reports none of them.
 */
export function evaluatePageChecks(result: AuditResult, spec: PageCheckRuleSpec): RuleFinding {
  const scope = spec.scope ?? servedIndexable;
  const inScope = result.pages.filter(scope);
  const measured = inScope.filter((page) => spec.checks.some((check) => typeof page.checks?.[check] === 'boolean'));
  if (inScope.length > 0 && measured.length === 0) {
    return notEvaluated(spec.id, spec.severity, missingSignalMeta(result));
  }
  const flagged = measured.filter((page) => problemsOf(page, spec.checks).length > 0);
  if (flagged.length === 0) {
    return { ruleId: spec.id, bucket: bucketFor(spec.severity, true), severity: spec.severity, affectedUrls: [] };
  }
  const fixNow = spec.fixNowWhen ? flagged.some(spec.fixNowWhen) : false;
  const severity = fixNow ? (spec.fixNowSeverity ?? spec.severity) : spec.severity;
  const rows = flagged.map((page) => ({
    url: page.url,
    problems: problemsOf(page, spec.checks),
    ...(spec.evidence ? spec.evidence(page) : {}),
  }));
  return {
    ruleId: spec.id,
    bucket: bucketFor(severity, false, { fixNow }),
    severity,
    affectedUrls: flagged.map((page) => page.url),
    meta: {
      ...boundedEvidence(rows, 'pages'),
      ...(spec.extraMeta ? spec.extraMeta(result, flagged) : {}),
    },
  };
}

/** Copies only the numeric facts a page reports. */
export function pageFacts<K extends keyof AuditPage>(page: AuditPage, keys: readonly K[]): Partial<Pick<AuditPage, K>> {
  const out: Partial<Pick<AuditPage, K>> = {};
  for (const key of keys) {
    if (page[key] !== undefined) out[key] = page[key];
  }
  return out;
}

/**
 * Resources of the paid scan, or the not-evaluated meta explaining their
 * absence: `scan-off` when the crawl ran without the scan, `legacy-run`
 * before these signals existed, `unavailable` when the read failed.
 */
export function scannedResources(
  result: AuditResult,
): { resources: NonNullable<AuditResult['resources']> } | { missing: ReturnType<typeof missingSignalMeta> } {
  if (!result.capabilities) return { missing: { insufficientData: true, reason: 'legacy-run' } };
  if (!result.capabilities.resourceScan) return { missing: { insufficientData: true, reason: 'scan-off' } };
  if (!result.resources) return { missing: missingSignalMeta(result, 'resources') };
  return { resources: result.resources };
}

/** Evidence row of one resource. */
export function resourceEvidence(resource: NonNullable<AuditResult['resources']>[number]): Record<string, unknown> {
  return {
    url: resource.url,
    type: resource.type,
    statusCode: resource.statusCode,
    ...(resource.sizeBytes !== undefined ? { sizeBytes: resource.sizeBytes } : {}),
    usedOn: resource.usedOn,
    ...(resource.usedOnCount !== undefined ? { usedOnCount: resource.usedOnCount } : {}),
  };
}
