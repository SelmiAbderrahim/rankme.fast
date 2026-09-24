import type { ActionState } from '../../db/schema/action-events.js';
export const SEVERITIES = ['critical', 'warning', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const FIRST_PARTY_IMPACTS = ['high', 'medium', 'low', 'none'] as const;
export type FirstPartyImpact = (typeof FIRST_PARTY_IMPACTS)[number];
export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const EFFORTS = ['low', 'medium', 'high'] as const;
export type Effort = (typeof EFFORTS)[number];
// Ranks for descending sort. LOWER rank number = higher priority.
const SEVERITY_RANK: Record<Severity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
};
const FIRST_PARTY_IMPACT_RANK: Record<FirstPartyImpact, number> = {
    high: 0,
    medium: 1,
    low: 2,
    none: 3,
};
const CONFIDENCE_RANK: Record<Confidence, number> = {
    high: 0,
    medium: 1,
    low: 2,
};
const EFFORT_RANK: Record<Effort, number> = {
    low: 0,
    medium: 1,
    high: 2,
};
export const ACTION_MAX_AFFECTED_URLS = 20;
export interface OrderableAction {
    id: string;
    severity: Severity;
    firstPartyImpact: FirstPartyImpact;
    confidence: Confidence;
    effort: Effort;
    affectedUrls: readonly string[];
    observedAt: string;
}
// Deterministic tuple compare — no black-box score. Ties broken by newest
// `observedAt`, then `id` ASC for total-order stability.
export function compareActions(a: OrderableAction, b: OrderableAction): number {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0)
        return bySeverity;
    const byImpact = FIRST_PARTY_IMPACT_RANK[a.firstPartyImpact] -
        FIRST_PARTY_IMPACT_RANK[b.firstPartyImpact];
    if (byImpact !== 0)
        return byImpact;
    const byConfidence = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
    if (byConfidence !== 0)
        return byConfidence;
    const aUrls = Math.min(a.affectedUrls.length, ACTION_MAX_AFFECTED_URLS);
    const bUrls = Math.min(b.affectedUrls.length, ACTION_MAX_AFFECTED_URLS);
    if (aUrls !== bUrls)
        return bUrls - aUrls; // DESC
    const byEffort = EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort];
    if (byEffort !== 0)
        return byEffort;
    const aTime = Date.parse(a.observedAt);
    const bTime = Date.parse(b.observedAt);
    if (aTime !== bTime)
        return bTime - aTime; // DESC newest first
    if (a.id < b.id)
        return -1;
    if (a.id > b.id)
        return 1;
    return 0;
}
// GSC/GA4 decline severity banding — locked thresholds. Applied only when the
// source-inclusion filter (baseline + decline ≥ 20%) has already passed.
export function declineSeverity(percentDecline: number): Severity {
    if (percentDecline >= 40)
        return 'critical';
    return 'warning';
}
// Decline percent bucket for confidence/impact fine-tuning by call sites.
export function declineBand(percentDecline: number): 'high' | 'medium' | 'low' {
    if (percentDecline >= 40)
        return 'high';
    if (percentDecline >= 25)
        return 'medium';
    return 'low';
}
// First-party impact from baseline volume (clicks/sessions/key events).
export function firstPartyImpactFromBaseline(baseline: number): FirstPartyImpact {
    if (baseline >= 500)
        return 'high';
    if (baseline >= 100)
        return 'medium';
    if (baseline >= 20)
        return 'low';
    return 'none';
}
// Allowed transitions between action states. Same-state repeats route through
// the idempotency cache path, not this table.
const TRANSITIONS: Record<ActionState, readonly ActionState[]> = {
    open: ['planned', 'dismissed', 'completed'],
    planned: ['open', 'dismissed', 'completed'],
    dismissed: ['open', 'planned'],
    completed: ['open'],
};
export function isAllowedTransition(from: ActionState, to: ActionState): boolean {
    return TRANSITIONS[from].includes(to);
}
export const EVENT_KIND_FOR_TRANSITION: Record<ActionState, 'plan' | 'dismiss' | 'complete' | 'reopen'> = {
    open: 'reopen',
    planned: 'plan',
    dismissed: 'dismiss',
    completed: 'complete',
};
