/**
 * One place that applies the user's finding decisions to a report
 *.
 *
 * Decisions are site-level (per rule), so the same run must read the same
 * way whether it is opened as "the latest report" or pinned by id. Every
 * report endpoint passes its report through {@link applyDismissals}: each
 * Fix-now / Watch finding carries its decision (who, when, why), dismissed
 * and fixed findings leave the open counts, and a dismissed finding that the
 * newest audit reports on MORE pages than when it was dismissed comes back
 * into the counts (resurfaced) instead of staying hidden.
 */
import type { ActionState } from '../../db/schema/action-events.js';
import type { ActionEventsDb } from '../actions/actions.events.repo.js';
import {
  isResolvedAuditDecision,
  loadAuditDecisions,
  openAuditRuleIds,
  resolveAuditDecisionEvidence,
  type AuditDecision,
} from '../actions/audit-decisions.js';
import { AUDIT_REGRESSION_ACTOR } from '../actions/actions.regression.js';
import { User } from '../users/users.model.js';
import { AuditRun } from './audit-run.model.js';
import {
  FindingDismissal,
  type DismissalReason,
  type FindingRecheckOutcome,
} from './finding-dismissal.model.js';
import type { AuditReport, LocalizedFinding } from './report.service.js';
import { ReportSnapshot } from './report-snapshot.model.js';
import type { FindingCounts } from './rules/index.js';

/** Rules whose stored evidence a targeted, first-party re-check can test. */
export const RECHECKABLE_RULE_IDS: ReadonlySet<string> = new Set(['broken-internal-links']);

export interface FindingRecheckView {
  checkedAt: string;
  totalUrls: number;
  checked: number;
  stillFailing: number;
  cleared: number;
  unverified: number;
  results: Array<{ url: string; outcome: FindingRecheckOutcome; status: number | null }>;
}

/** The user's decision on one finding, as every report reader sees it. */
export interface FindingDecisionView {
  state: ActionState;
  /** Marked fixed, but a newer audit still reports it (state is `open`). */
  regressed: boolean;
  decidedAt: string;
  /** Display name of the person who decided; null for system or unknown actors. */
  decidedBy: string | null;
  /** Dismissal reason; null when not dismissed or not recorded. */
  reason: DismissalReason | null;
  /** Affected pages in the newest audit when the finding was dismissed. */
  affectedCountAtDismissal: number | null;
  /** The newest audit's view of this rule; null when the site has no finished audit. */
  latest: { runId: string; detected: boolean; affectedCount: number } | null;
  /** Dismissed, but the newest audit counts more affected pages: counted as open again. */
  resurfaced: { addedCount: number } | null;
  /** Whether a targeted re-check of this finding's URLs is possible. */
  recheckable: boolean;
  /** The latest targeted re-check, if any. */
  recheck: FindingRecheckView | null;
}

export type DecidedFinding = LocalizedFinding & { decision?: FindingDecisionView };

export interface DismissalsApplied {
  findings: DecidedFinding[];
  /** The site's newest finished audit; null when it has none. */
  latestRunId: string | null;
  /** `counts` without dismissed and fixed findings (resurfaced ones count). */
  openCounts: FindingCounts;
  /** What `openCounts` leaves out — the "Not in these counts" line. */
  notCounted: { dismissed: number; completed: number };
}

export interface ApplyDismissalsContext {
  accountId: string;
  siteId: string;
  /** The decisions store; without it no decision is applied. */
  db?: ActionEventsDb | undefined;
}

interface LatestRuleView {
  runId: string;
  counts: Map<string, number>;
  open: Set<string>;
}

async function latestRuleView(
  accountId: string,
  siteId: string,
  report: AuditReport,
): Promise<LatestRuleView | null> {
  const latest = await AuditRun.findOne(
    { accountId, siteId, status: 'succeeded', kind: 'site' },
    { _id: 1 },
  )
    .sort({ _id: -1 })
    .lean<{ _id: { toString(): string } } | null>();
  if (!latest) return null;
  const runId = String(latest._id);
  if (runId === report.runId) {
    return {
      runId,
      counts: new Map(report.findings.map((f) => [f.ruleId as string, f.affectedUrls.length])),
      open: openAuditRuleIds(report.findings),
    };
  }
  const snapshot = await ReportSnapshot.findOne({ runId: latest._id }, { findings: 1 }).lean<{
    findings: Array<{ ruleId: string; bucket: string; affectedUrls: string[]; meta?: Record<string, unknown> | null }>;
  } | null>();
  const findings = snapshot?.findings ?? [];
  return {
    runId,
    counts: new Map(findings.map((f) => [f.ruleId, f.affectedUrls.length])),
    open: openAuditRuleIds(findings),
  };
}

function displayName(user: { email: string; profile: { firstName: string; lastName: string } }): string {
  const name = [user.profile.firstName, user.profile.lastName]
    .filter((part) => part.trim().length > 0)
    .join(' ');
  return name.length > 0 ? name : user.email;
}

async function actorNames(decisions: ReadonlyMap<string, AuditDecision>): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      [...decisions.values()]
        .map((decision) => decision.actorUserId)
        .filter((id) => id !== AUDIT_REGRESSION_ACTOR && /^[a-f0-9]{24}$/i.test(id)),
    ),
  ];
  if (ids.length === 0) return new Map();
  const users = await User.find({ _id: { $in: ids } }, { email: 1, profile: 1 }).lean<
    Array<{ _id: { toString(): string }; email: string; profile: { firstName: string; lastName: string } }>
  >();
  return new Map(users.map((user) => [String(user._id), displayName(user)]));
}

/** A re-check as stored on the dismissal. */
export interface StoredFindingRecheck {
  checkedAt: Date;
  totalUrls: number;
  results: Array<{ url: string; outcome: FindingRecheckOutcome; status?: number | null }>;
}

/** The wire shape of a stored re-check, with its tallies. */
export function toFindingRecheckView(stored: StoredFindingRecheck): FindingRecheckView {
  const results = stored.results.map((r) => ({ url: r.url, outcome: r.outcome, status: r.status ?? null }));
  const count = (outcome: FindingRecheckOutcome) => results.filter((r) => r.outcome === outcome).length;
  return {
    checkedAt: new Date(stored.checkedAt).toISOString(),
    totalUrls: stored.totalUrls,
    checked: results.length,
    stillFailing: count('still_failing'),
    cleared: count('cleared'),
    unverified: count('unverified'),
    results,
  };
}

/** Whether the finding is left out of the open counts. */
export function isUncountedDecision(decision: FindingDecisionView | undefined): boolean {
  return decision !== undefined && isResolvedAuditDecision(decision.state) && decision.resurfaced === null;
}

/**
 * Dismissed findings come back when the newest audit reports MORE affected
 * pages than when they were dismissed. Fewer or equal pages, an
 * unknown dismissal count, or a rule the newest audit no longer reports keep
 * the dismissal.
 */
export function resurfacedBy(input: {
  state: ActionState;
  affectedCountAtDismissal: number | null;
  latest: { detected: boolean; affectedCount: number } | null;
}): { addedCount: number } | null {
  if (input.state !== 'dismissed' || input.affectedCountAtDismissal === null || !input.latest?.detected) {
    return null;
  }
  const added = input.latest.affectedCount - input.affectedCountAtDismissal;
  return added > 0 ? { addedCount: added } : null;
}

/** Apply the site's finding decisions to a report (every report endpoint). */
export async function applyDismissals<R extends AuditReport>(
  report: R,
  ctx: ApplyDismissalsContext,
): Promise<Omit<R, 'findings'> & DismissalsApplied> {
  const latest = await latestRuleView(ctx.accountId, ctx.siteId, report);
  const evidence = await resolveAuditDecisionEvidence({
    accountId: ctx.accountId,
    siteId: ctx.siteId,
    runId: report.runId,
    findings: report.findings,
  });
  const decisions = ctx.db
    ? await loadAuditDecisions(ctx.db, {
        accountId: ctx.accountId,
        siteId: ctx.siteId,
        runId: report.runId,
        ruleIds: report.findings.map((f) => f.ruleId),
        evidence,
      })
    : new Map<string, AuditDecision>();
  const names = await actorNames(decisions);
  const dismissedRuleIds = [...decisions]
    .filter(([, decision]) => decision.state === 'dismissed')
    .map(([ruleId]) => ruleId);
  const details = new Map(
    dismissedRuleIds.length === 0
      ? []
      : (
          await FindingDismissal.find({
            accountId: ctx.accountId,
            siteId: ctx.siteId,
            ruleId: { $in: dismissedRuleIds },
          }).lean()
        ).map((doc) => [doc.ruleId, doc]),
  );

  const openCounts: FindingCounts = { ...report.counts };
  const notCounted = { dismissed: 0, completed: 0 };
  const findings: DecidedFinding[] = report.findings.map((finding) => {
    const decision = decisions.get(finding.ruleId);
    if (!decision || (finding.bucket !== 'fix-now' && finding.bucket !== 'watch')) return finding;
    const detail = decision.state === 'dismissed' ? details.get(finding.ruleId) : undefined;
    const latestView = latest
      ? {
          runId: latest.runId,
          detected: latest.open.has(finding.ruleId),
          affectedCount: latest.counts.get(finding.ruleId) ?? 0,
        }
      : null;
    const affectedCountAtDismissal = detail?.affectedCount ?? null;
    const view: FindingDecisionView = {
      state: decision.state,
      regressed: decision.regressed,
      decidedAt: decision.decidedAt.toISOString(),
      decidedBy: names.get(decision.actorUserId) ?? null,
      reason: (detail?.reason as DismissalReason | null | undefined) ?? null,
      affectedCountAtDismissal,
      latest: latestView,
      resurfaced: resurfacedBy({ state: decision.state, affectedCountAtDismissal, latest: latestView }),
      recheckable: RECHECKABLE_RULE_IDS.has(finding.ruleId),
      recheck: detail?.lastRecheck ? toFindingRecheckView(detail.lastRecheck as StoredFindingRecheck) : null,
    };
    if (isUncountedDecision(view)) {
      const state = view.state as 'dismissed' | 'completed';
      notCounted[state] += 1;
      if (finding.bucket === 'fix-now') openCounts.fixNow -= 1;
      else openCounts.watch -= 1;
    }
    return { ...finding, decision: view };
  });

  return {
    ...report,
    findings,
    latestRunId: latest?.runId ?? null,
    openCounts,
    notCounted,
  };
}

/**
 * Record why a finding was dismissed and how many pages the newest audit
 * reported for it at that moment. Replaces any earlier dismissal of
 * the same rule. Called after the dismissal event was appended.
 */
export async function recordFindingDismissal(input: {
  accountId: string;
  siteId: string;
  ruleId: string;
  reason: DismissalReason | null;
  actorUserId: string;
  now?: Date;
}): Promise<void> {
  const latest = await AuditRun.findOne(
    { accountId: input.accountId, siteId: input.siteId, status: 'succeeded', kind: 'site' },
    { _id: 1 },
  )
    .sort({ _id: -1 })
    .lean<{ _id: { toString(): string } } | null>();
  let affectedCount: number | null = null;
  if (latest) {
    const snapshot = await ReportSnapshot.findOne({ runId: latest._id }, { findings: 1 }).lean<{
      findings: Array<{ ruleId: string; affectedUrls: string[] }>;
    } | null>();
    const finding = snapshot?.findings.find((f) => f.ruleId === input.ruleId);
    affectedCount = finding ? finding.affectedUrls.length : null;
  }
  await FindingDismissal.findOneAndUpdate(
    { accountId: input.accountId, siteId: input.siteId, ruleId: input.ruleId },
    {
      $set: {
        reason: input.reason,
        affectedCount,
        runId: latest ? String(latest._id) : null,
        actorUserId: input.actorUserId,
        dismissedAt: input.now ?? new Date(),
        lastRecheck: null,
      },
    },
    { upsert: true },
  );
}

/** One stored finding reduced to what the open-count rules need. */
export interface StoredFindingCount {
  ruleId: string;
  bucket: string;
  /** Distinct pages the finding lists in its run. */
  affectedCount: number;
  /** The check could not run (missing data source): never an open problem. */
  notEvaluated: boolean;
}

/**
 * Open Fix-now findings of a site's newest audit with the owner's decisions
 * applied, the same rules `applyDismissals` uses for the report: dismissed and
 * fixed findings leave the count, a dismissal that the audit now reports on
 * more pages than when it was made counts again, and a fixed finding that
 * the audit still reports is reopened. `runId` must be the site's newest
 * succeeded run, so its own findings are the "latest" view.
 */
export async function countOpenFixNow(
  db: ActionEventsDb,
  input: { accountId: string; siteId: string; runId: string; findings: readonly StoredFindingCount[] },
): Promise<number> {
  const candidates = new Map<string, number>();
  for (const finding of input.findings) {
    if (finding.bucket === 'fix-now' && !finding.notEvaluated) candidates.set(finding.ruleId, finding.affectedCount);
  }
  if (candidates.size === 0) return 0;
  const evidence = await resolveAuditDecisionEvidence({
    accountId: input.accountId,
    siteId: input.siteId,
    runId: input.runId,
    findings: input.findings.map((finding) => ({
      ruleId: finding.ruleId,
      bucket: finding.bucket,
      meta: finding.notEvaluated ? { insufficientData: true } : null,
    })),
  });
  const decisions = await loadAuditDecisions(db, {
    accountId: input.accountId,
    siteId: input.siteId,
    runId: input.runId,
    ruleIds: [...candidates.keys()],
    evidence,
  });
  const dismissedRuleIds = [...decisions].filter(([, decision]) => decision.state === 'dismissed').map(([ruleId]) => ruleId);
  const details = new Map(
    dismissedRuleIds.length === 0
      ? []
      : (
          await FindingDismissal.find({
            accountId: input.accountId,
            siteId: input.siteId,
            ruleId: { $in: dismissedRuleIds },
          }).lean()
        ).map((doc) => [doc.ruleId, doc.affectedCount]),
  );
  let open = 0;
  for (const [ruleId, affectedCount] of candidates) {
    const decision = decisions.get(ruleId);
    if (!decision || !isResolvedAuditDecision(decision.state)) {
      open += 1;
      continue;
    }
    const resurfaced = resurfacedBy({
      state: decision.state,
      affectedCountAtDismissal: details.get(ruleId) ?? null,
      latest: { detected: true, affectedCount },
    });
    if (resurfaced !== null) open += 1;
  }
  return open;
}
