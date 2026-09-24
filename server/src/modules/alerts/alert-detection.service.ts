/**
 * Detection — turning a CONFIRMED transition into `alert-dispatch` jobs.
 *
 * Two producers, both additive:
 *
 *   • Rank drops reuse the shipped two-observation confirmation
 *     (`rank_drop_confirmations`). This module never re-derives drop math and
 *     never calls a provider — it is handed an already-settled `confirmed`
 *     observation pair.
 *   • Link changes are a deterministic diff of two CONSECUTIVE completed
 *     `backlink_row_snapshots` reviews. This module never writes that table.
 *
 * Neither producer emits without a baseline: a first-ever snapshot yields
 * `{ skipped: 'no_baseline' }` rather than a dishonest "300 new links".
 */
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { Db } from '../../db/client.js';
import type { AlertRuleRow } from '../../db/schema/index.js';
import { enqueueAlertDispatchJob } from '../../shared/queue/index.js';
import { filterPausedSiteIds } from '../sites/sites.guard.js';
import { findPreviousReview, listConfirmedRankDrops, listEnabledRulesForSite, listRecentReviews, readReviewDomains, } from './alerts.repo.js';
import { ALERT_EVIDENCE_DOMAIN_CAP, type LinkEvidence, type RankDropEvidence, } from './alerts.schema.js';
export interface AlertDetectionDeps {
    db: Db;
    /** Null when the worker booted with the kill switch off — detection no-ops. */
    queue: Queue | null;
    logger?: Logger;
}
export interface DetectionOutcome {
    /** Rule ids that received a dispatch job. */
    dispatched: string[];
    skipped?: 'no_baseline' | 'no_rules' | 'no_change' | 'below_threshold' | 'disabled';
}
const NOTHING = (skipped: NonNullable<DetectionOutcome['skipped']>): DetectionOutcome => ({
    dispatched: [],
    skipped,
});
// ---------------------------------------------------------------------------
// Rank drops
// ---------------------------------------------------------------------------
export interface ConfirmedRankDrop {
    accountId: string;
    siteId: string;
    /** `rank_drop_confirmations.id` — UNIQUE per candidate ranking. */
    confirmationId: string;
    keyword: string;
    beforePosition: number;
    beforeAt: Date;
    /** `null` is a valid observation: the domain left vendor depth entirely. */
    afterPosition: number | null;
    afterAt: Date;
}
/**
 * A rule fires when the CONFIRMED position is at or worse than its threshold.
 * Leaving vendor depth (`null`) is worse than any finite position, so it always
 * satisfies a threshold.
 */
export function meetsThreshold(afterPosition: number | null, threshold: number): boolean {
    return afterPosition === null || afterPosition >= threshold;
}
export function buildRankDropEvidence(drop: ConfirmedRankDrop, threshold: number): RankDropEvidence {
    return {
        kind: 'rank_drop',
        keyword: drop.keyword,
        threshold,
        before: { at: drop.beforeAt.toISOString(), position: drop.beforePosition },
        after: { at: drop.afterAt.toISOString(), position: drop.afterPosition },
    };
}
export async function detectRankDropAlerts(drop: ConfirmedRankDrop, deps: AlertDetectionDeps): Promise<DetectionOutcome> {
    if (deps.queue === null)
        return NOTHING('disabled');
    const rules = await listEnabledRulesForSite(deps.db, {
        accountId: drop.accountId,
        siteId: drop.siteId,
        type: 'rank_drop',
    });
    if (rules.length === 0)
        return NOTHING('no_rules');
    const matching = rules.filter((rule) => meetsThreshold(drop.afterPosition, rule.threshold as number));
    if (matching.length === 0)
        return NOTHING('below_threshold');
    const transitionId = `rank:${drop.confirmationId}`;
    const dispatched: string[] = [];
    for (const rule of matching) {
        await enqueueAlertDispatchJob(deps.queue, {
            accountId: drop.accountId,
            siteId: drop.siteId,
            ruleId: rule.id,
            transitionId,
            evidence: buildRankDropEvidence(drop, rule.threshold as number),
        });
        dispatched.push(rule.id);
    }
    return { dispatched };
}
// ---------------------------------------------------------------------------
// Backlink snapshot diff
// ---------------------------------------------------------------------------
export interface BacklinkDiff {
    added: string[];
    removed: string[];
}
/** Pure set diff over two sorted domain lists. */
export function diffDomains(previous: readonly string[], current: readonly string[]): BacklinkDiff {
    const before = new Set(previous);
    const after = new Set(current);
    return {
        added: current.filter((domain) => !before.has(domain)),
        removed: previous.filter((domain) => !after.has(domain)),
    };
}
export interface CompletedReview {
    accountId: string;
    siteId: string;
    reviewId: string;
    capturedAt: Date;
}
interface ReviewSide {
    reviewId: string;
    at: string;
    rowCount: number;
}
function buildLinkEvidence(kind: 'new_backlink' | 'lost_backlink', before: ReviewSide, after: ReviewSide, changed: readonly string[]): LinkEvidence {
    return {
        kind,
        before: { at: before.at, reviewId: before.reviewId, rowCount: before.rowCount },
        after: { at: after.at, reviewId: after.reviewId, rowCount: after.rowCount },
        // Bounded sample; `changedTotal` stays the honest full count.
        changedDomains: changed.slice(0, ALERT_EVIDENCE_DOMAIN_CAP),
        changedTotal: changed.length,
    };
}
export async function detectBacklinkAlerts(review: CompletedReview, deps: AlertDetectionDeps): Promise<DetectionOutcome> {
    if (deps.queue === null)
        return NOTHING('disabled');
    const previous = await findPreviousReview(deps.db, {
        accountId: review.accountId,
        siteId: review.siteId,
        capturedAt: review.capturedAt,
    });
    // No baseline → nothing honest to say about "new" or "lost".
    if (previous === null)
        return NOTHING('no_baseline');
    const [previousDomains, currentDomains] = await Promise.all([
        readReviewDomains(deps.db, {
            accountId: review.accountId,
            siteId: review.siteId,
            reviewId: previous.reviewId,
        }),
        readReviewDomains(deps.db, {
            accountId: review.accountId,
            siteId: review.siteId,
            reviewId: review.reviewId,
        }),
    ]);
    const diff = diffDomains(previousDomains, currentDomains);
    const beforeSide: ReviewSide = {
        reviewId: previous.reviewId,
        at: previous.capturedAt.toISOString(),
        rowCount: previous.rowCount,
    };
    const afterSide: ReviewSide = {
        reviewId: review.reviewId,
        at: review.capturedAt.toISOString(),
        rowCount: currentDomains.length,
    };
    const plans: Array<{
        kind: 'new_backlink' | 'lost_backlink';
        changed: string[];
    }> = [
        { kind: 'new_backlink', changed: diff.added },
        { kind: 'lost_backlink', changed: diff.removed },
    ];
    const dispatched: string[] = [];
    for (const plan of plans) {
        if (plan.changed.length === 0)
            continue;
        const rules = await listEnabledRulesForSite(deps.db, {
            accountId: review.accountId,
            siteId: review.siteId,
            type: plan.kind,
        });
        for (const rule of rules) {
            await enqueueAlertDispatchJob(deps.queue, {
                accountId: review.accountId,
                siteId: review.siteId,
                ruleId: rule.id,
                // One transition per ORDERED snapshot pair — a review that adds 300
                // links is one alert carrying a bounded sample, never 300 alerts.
                transitionId: `link:${plan.kind === 'new_backlink' ? 'new' : 'lost'}:${previous.reviewId}:${review.reviewId}`,
                evidence: buildLinkEvidence(plan.kind, beforeSide, afterSide, plan.changed),
            });
            dispatched.push(rule.id);
        }
    }
    if (dispatched.length === 0) {
        return NOTHING(diff.added.length === 0 && diff.removed.length === 0 ? 'no_change' : 'no_rules');
    }
    return { dispatched };
}
/** Convenience for the worker: does this site have any enabled rule of a type? */
export async function hasEnabledRule(db: Db, input: {
    accountId: string;
    siteId: string;
    type: AlertRuleRow['type'];
}): Promise<boolean> {
    const rules = await listEnabledRulesForSite(db, input);
    return rules.length > 0;
}
// ---------------------------------------------------------------------------
// Sweep — the automatic producer
// ---------------------------------------------------------------------------
/** How far back a sweep looks for settled confirmations. */
export const ALERT_SWEEP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Hard ceiling on rows examined per sweep — bounds worst-case fan-out. */
export const ALERT_SWEEP_LIMIT = 200;
export interface AlertSweepOutcome {
    examined: number;
    dispatched: number;
}
/**
 * Turn every recently-CONFIRMED rank drop into dispatch jobs.
 *
 * Deliberately re-scans a window rather than mutating a claim column: the
 * 04-owned `alert_claimed_at` stays untouched, and duplicate work collapses
 * twice over — first on the deterministic `alert-dispatch-<rule>-<hash>` job
 * id, then on the UNIQUE `alert_deliveries.idempotency_key`. Re-running a sweep
 * is therefore free and cannot re-deliver.
 */
export async function runAlertDetectionSweep(deps: AlertDetectionDeps & {
    now?: () => Date;
}): Promise<AlertSweepOutcome> {
    if (deps.queue === null)
        return { examined: 0, dispatched: 0 };
    const now = (deps.now ?? (() => new Date()))();
    const rows = await listConfirmedRankDrops(deps.db, {
        since: new Date(now.getTime() - ALERT_SWEEP_WINDOW_MS),
        limit: ALERT_SWEEP_LIMIT,
    });
    // Paused sites produce no alert dispatches — filter both arms per batch.
    const pausedForDrops = await filterPausedSiteIds(rows.map((r) => r.siteId));
    let dispatched = 0;
    for (const row of rows) {
        if (pausedForDrops.has(row.siteId))
            continue;
        try {
            const outcome = await detectRankDropAlerts(row, deps);
            dispatched += outcome.dispatched.length;
        }
        catch (err) {
            // One bad confirmation never stops the sweep — same isolation contract
            // as the per-recipient delivery loop.
            deps.logger?.warn({ confirmationId: row.confirmationId, err: (err as Error).message }, 'alert sweep: confirmation skipped');
        }
    }
    // Link transitions ride the SAME sweep. The toxicity pipeline owns
    // every write to `backlink_row_snapshots`; this side is read-only, so a
    // completed review needs no additional hook to produce an alert, and a
    // re-scan collapses on the ordered-review-pair idempotency key.
    const reviews = await listRecentReviews(deps.db, {
        since: new Date(now.getTime() - ALERT_SWEEP_WINDOW_MS),
        limit: ALERT_SWEEP_LIMIT,
    });
    const pausedForReviews = await filterPausedSiteIds(reviews.map((r) => r.siteId));
    for (const review of reviews) {
        if (pausedForReviews.has(review.siteId))
            continue;
        try {
            const outcome = await detectBacklinkAlerts(review, deps);
            dispatched += outcome.dispatched.length;
        }
        catch (err) {
            deps.logger?.warn({ reviewId: review.reviewId, err: (err as Error).message }, 'alert sweep: review skipped');
        }
    }
    return { examined: rows.length + reviews.length, dispatched };
}
