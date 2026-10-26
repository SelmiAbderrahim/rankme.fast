/**
 * Targeted re-check of a dismissed finding.
 *
 * A user who dismissed "Broken internal links" as a false positive can test
 * that claim without a new audit: the stored broken targets of the run on
 * screen are requested again, the same first-party GET the audit's own
 * verification stage makes (shared SSRF authority, bounded URLs, concurrency
 * and deadline). It never calls a vendor, so it spends nothing. The result is
 * kept with the dismissal so the report can show it.
 */
import type { ActionEventsDb } from '../actions/actions.events.repo.js';
import { loadAuditDecisions, type AuditDecision } from '../actions/audit-decisions.js';
import type { PageProber } from '../../shared/security/site-probe.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { SupportedLocale } from '../../shared/i18n/index.js';
import { classifyBrokenTarget, EVIDENCE_CONCURRENCY } from './crawl-evidence.js';
import { FindingDismissal, type FindingRecheckOutcome } from './finding-dismissal.model.js';
import {
  RECHECKABLE_RULE_IDS,
  toFindingRecheckView,
  type FindingRecheckView,
} from './report-dismissals.js';
import { getAuditReport } from './report.service.js';

/** URLs requested per re-check. */
export const FINDING_RECHECK_MAX_URLS = 25;
/** Whole re-check wall clock; URLs not reached in time stay unverified. */
export const FINDING_RECHECK_DEADLINE_MS = 20_000;
/** A re-check within this window returns the stored result instead of requesting again. */
export const FINDING_RECHECK_COOLDOWN_MS = 60_000;

let recheckProber: PageProber | null = null;

/**
 * Boot wiring (and test seam): the prober a re-check requests URLs with.
 * `null` (the default, and a fake crawl) = no outbound requests; every URL
 * stays unverified.
 */
export function setFindingRecheckProber(prober: PageProber | null): void {
  recheckProber = prober;
}

export interface FindingRecheckInput {
  accountId: string;
  siteId: string;
  runId: string;
  ruleId: string;
  locale: SupportedLocale;
  db: ActionEventsDb;
}

export interface FindingRecheckPreview {
  ruleId: string;
  /** Distinct URLs the finding lists. */
  totalUrls: number;
  /** URLs a re-check requests (bounded). */
  urlCount: number;
  /** The latest re-check, if any. */
  lastRecheck: FindingRecheckView | null;
}

const unavailable = () =>
  HttpError.conflict({ code: 'AUDITS_ERRORS_RECHECK_UNAVAILABLE', messageKey: 'audits.errors.recheckUnavailable' });

async function recheckTargets(
  input: FindingRecheckInput,
): Promise<{ targets: string[]; total: number; decision: AuditDecision }> {
  if (!RECHECKABLE_RULE_IDS.has(input.ruleId)) throw unavailable();
  const report = await getAuditReport({ accountId: input.accountId, runId: input.runId, locale: input.locale });
  const finding = report.findings.find((f) => f.ruleId === input.ruleId);
  const decision = (
    await loadAuditDecisions(input.db, {
      accountId: input.accountId,
      siteId: input.siteId,
      runId: input.runId,
      ruleIds: [input.ruleId],
    })
  ).get(input.ruleId);
  if (!finding || !decision || decision.state !== 'dismissed') throw unavailable();
  const all = [...new Set(finding.brokenLinkTargets ?? [])].sort();
  if (all.length === 0) throw unavailable();
  return { targets: all.slice(0, FINDING_RECHECK_MAX_URLS), total: all.length, decision };
}

async function storedRecheck(input: FindingRecheckInput) {
  const doc = await FindingDismissal.findOne(
    { accountId: input.accountId, siteId: input.siteId, ruleId: input.ruleId },
    { lastRecheck: 1 },
  ).lean();
  return doc?.lastRecheck ?? null;
}

/** What a re-check would request. Read-only. */
export async function previewFindingRecheck(input: FindingRecheckInput): Promise<FindingRecheckPreview> {
  const { targets, total } = await recheckTargets(input);
  const last = await storedRecheck(input);
  return {
    ruleId: input.ruleId,
    totalUrls: total,
    urlCount: targets.length,
    lastRecheck: last ? toFindingRecheckView(last) : null,
  };
}

const OUTCOME: Record<'confirmed' | 'cleared' | 'unverified', FindingRecheckOutcome> = {
  confirmed: 'still_failing',
  cleared: 'cleared',
  unverified: 'unverified',
};

/** Request the finding's URLs again and keep the result with the dismissal. */
export async function runFindingRecheck(
  input: FindingRecheckInput,
  deps: { now?: () => number } = {},
): Promise<FindingRecheckView> {
  const now = deps.now ?? Date.now;
  const { targets, total, decision } = await recheckTargets(input);
  const last = await storedRecheck(input);
  if (last && now() - new Date(last.checkedAt).getTime() < FINDING_RECHECK_COOLDOWN_MS) {
    return toFindingRecheckView(last);
  }
  const prober = recheckProber;
  const deadline = now() + FINDING_RECHECK_DEADLINE_MS;
  const outcomes: Array<{ url: string; outcome: FindingRecheckOutcome; status: number | null }> = targets.map(
    (url) => ({ url, outcome: 'unverified', status: null }),
  );
  if (prober) {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < targets.length && now() < deadline) {
        const index = next;
        next += 1;
        const url = targets[index]!;
        const proof = classifyBrokenTarget(url, await prober.probe(url, { method: 'GET', checkRobots: false }));
        outcomes[index] = { url, outcome: OUTCOME[proof.outcome], status: proof.status ?? null };
      }
    };
    await Promise.all(Array.from({ length: Math.min(EVIDENCE_CONCURRENCY, targets.length) }, worker));
  }
  const stored = { checkedAt: new Date(now()), totalUrls: total, results: outcomes };
  // A dismissal recorded before reasons existed has no document yet.
  await FindingDismissal.updateOne(
    { accountId: input.accountId, siteId: input.siteId, ruleId: input.ruleId },
    {
      $set: { lastRecheck: stored },
      $setOnInsert: {
        reason: null,
        affectedCount: null,
        runId: null,
        actorUserId: decision.actorUserId,
        dismissedAt: decision.decidedAt,
      },
    },
    { upsert: true },
  );
  return toFindingRecheckView(stored);
}
