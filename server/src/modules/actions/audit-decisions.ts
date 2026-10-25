import type { ActionEventRow, ActionState } from '../../db/schema/action-events.js';
import { isNotEvaluatedFinding } from '../../shared/audit-findings.js';
import { AuditRun } from '../audits/audit-run.model.js';
import { findLatestEventsForActions, type ActionEventsDb } from './actions.events.repo.js';
import { hashActionId, legacyAuditActionId } from './actions.identity.js';
import { isAuditRegressionEvent, reconcileAuditRegressions, type RegressionEvidence } from './actions.regression.js';

export type ResolvedAuditDecisionState = 'dismissed' | 'completed';
export function isResolvedAuditDecision(state: ActionState): state is ResolvedAuditDecisionState {
    return state === 'dismissed' || state === 'completed';
}

export interface AuditDecision {
    state: ActionState;
    regressed: boolean;
    decidedAt: Date;
    actorUserId: string;
    ordinal: number;
}

export interface AuditDecisionEvidence {
    runId: string;
    observedAt: string;
    openRuleIds: ReadonlySet<string>;
}

interface RuleFinding { ruleId: string; bucket: string; meta?: Record<string, unknown> | null }

export function openAuditRuleIds(findings: readonly RuleFinding[]): Set<string> {
    const ids = new Set<string>();
    for (const finding of findings) {
        if (finding.bucket !== 'fix-now' && finding.bucket !== 'watch') continue;
        if (isNotEvaluatedFinding(finding)) continue;
        ids.add(finding.ruleId);
    }
    return ids;
}

/** Only the newest succeeded site audit can contradict an earlier completion. */
export async function resolveAuditDecisionEvidence(input: {
    accountId: string; siteId: string; runId: string; findings: readonly RuleFinding[];
    fallbackObservedAt?: Date;
}): Promise<AuditDecisionEvidence | undefined> {
    const latest = await AuditRun.findOne({ accountId: input.accountId, siteId: input.siteId,
        status: 'succeeded', kind: 'site' }, { finishedAt: 1 })
        .sort({ _id: -1 })
        .lean<{ _id: { toString(): string }; finishedAt?: Date | null } | null>();
    if (!latest || String(latest._id) !== input.runId) return undefined;
    const observedAt = latest.finishedAt ?? input.fallbackObservedAt;
    if (!observedAt) return undefined;
    return { runId: input.runId, observedAt: observedAt.toISOString(),
        openRuleIds: openAuditRuleIds(input.findings) };
}

export async function loadAuditDecisions(db: ActionEventsDb, input: {
    accountId: string; siteId: string; runId: string; ruleIds: readonly string[];
    evidence?: AuditDecisionEvidence;
}): Promise<Map<string, AuditDecision>> {
    const identities = [...new Set(input.ruleIds)].map((ruleId) => {
        const base = { accountId: input.accountId, siteId: input.siteId,
            sourceType: 'audit_finding' as const, sourceId: ruleId };
        return { ruleId, id: hashActionId(base),
            legacyId: legacyAuditActionId({ ...base, sourceRef: `${input.runId}:${ruleId}` }) };
    });
    const latest = await findLatestEventsForActions(db, input.accountId,
        identities.flatMap(({ id, legacyId }) => legacyId ? [id, legacyId] : [id]));
    const events = new Map<string, ActionEventRow>();
    const regressionEvidence: RegressionEvidence[] = [];
    for (const { ruleId, id, legacyId } of identities) {
        const event = latest.get(id) ?? (legacyId ? latest.get(legacyId) : undefined);
        if (!event) continue;
        events.set(ruleId, event);
        if (input.evidence?.openRuleIds.has(ruleId)) regressionEvidence.push({
            actionId: id, ruleId, latest: event, observedAt: input.evidence.observedAt,
            runId: input.evidence.runId,
        });
    }
    const regressed = await reconcileAuditRegressions(db, { accountId: input.accountId,
        siteId: input.siteId, evidence: regressionEvidence });
    const decisions = new Map<string, AuditDecision>();
    for (const { ruleId, id } of identities) {
        const event = regressed.get(id) ?? events.get(ruleId);
        if (!event) continue;
        decisions.set(ruleId, { state: event.newState,
            regressed: isAuditRegressionEvent(event) && event.newState === 'open',
            decidedAt: event.createdAt, actorUserId: event.actorUserId, ordinal: event.ordinal });
    }
    return decisions;
}

export async function loadAuditDecisionStates(db: ActionEventsDb,
    input: Parameters<typeof loadAuditDecisions>[1]): Promise<Map<string, ActionState>> {
    const decisions = await loadAuditDecisions(db, input);
    return new Map([...decisions].map(([ruleId, decision]) => [ruleId, decision.state]));
}
