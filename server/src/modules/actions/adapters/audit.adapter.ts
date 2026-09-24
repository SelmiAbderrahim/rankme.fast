import { Types } from 'mongoose';
import { buildObservationMeta } from '../../../shared/observations/observations.js';
// Deep model imports (reference: audience-research.adapter.ts) — the audits
// barrel drags in routes/services/queue holders this read-only adapter must
// never touch, and barrel imports are the module-cycle footgun documented on
// the reference adapter.
import { AuditRun } from '../../audits/audit-run.model.js';
import { ReportSnapshot } from '../../audits/report-snapshot.model.js';
import type { SourceReader } from '../actions.registry.js';
import type { ActionEvidence, CandidateAction } from '../actions.types.js';
import type { Severity } from '../actions.orders.js';
import { canonicalizeAffectedUrls } from './url.js';
import type { TranslationKey } from '../../../shared/i18n/index.js';
import { isAuditCodeFixEligible } from '../../../shared/code-fix-eligibility.js';
interface RunLean {
    _id: Types.ObjectId;
    finishedAt?: Date | null;
}
interface FindingLean {
    ruleId: string;
    bucket: 'fix-now' | 'watch' | 'passed';
    severity: Severity;
    affectedUrls?: string[];
    meta?: Record<string, unknown> | null;
}
interface SnapshotLean {
    findings?: FindingLean[];
    createdAt: Date;
}
// Locked contract: the adapter reads ONLY the
// latest succeeded site audit and emits `fix-now` + `watch` findings as
// candidates; `passed` findings are absent. Retests continue through the
// shipped audit start service (controller-side), so audit candidates are the
// ONLY source with `retestAvailable: true`.
//
// Deterministic mapping (no AI):
//   - severity   = the finding's own rule-engine severity (critical|warning|info);
//   - confidence = fixed 'high' — the latest succeeded run IS the freshest
//     direct observation of the site we own; there is no ObservationMeta on
//     frozen report findings to derive from;
//   - firstPartyImpact = 'none' — the crawl is a provider observation, not
//     first-party analytics volume;
//   - effort = 'medium' (locked source default for audit);
//   - copy   = the shipped localized plain-language rule copy
//     (`auditRules.<ruleId>.title|why|fix`) — reviewed in all 7 locales, so
//     no parallel actions.* copy block is needed for this source.
export const auditActionAdapter: SourceReader = async (ctx) => {
    // Non-ObjectId ids cannot own audit runs; return empty instead of letting
    // a mongoose CastError mark the whole source unavailable.
    if (!Types.ObjectId.isValid(ctx.accountId) ||
        !Types.ObjectId.isValid(ctx.siteId)) {
        return { actions: [], status: 'available' };
    }
    const run = await AuditRun.findOne({
        accountId: ctx.accountId,
        siteId: ctx.siteId,
        status: 'succeeded',
        kind: 'site',
    }, { finishedAt: 1 })
        .sort({ _id: -1 })
        .lean<RunLean | null>();
    if (!run) {
        return { actions: [], status: 'available' };
    }
    const snapshot = await ReportSnapshot.findOne({ runId: run._id, accountId: ctx.accountId, siteId: ctx.siteId }, { findings: 1, createdAt: 1 }).lean<SnapshotLean | null>();
    if (!snapshot) {
        // A succeeded run whose frozen report is missing is an inconsistent
        // source — mark it stale rather than claiming a healthy empty list.
        return { actions: [], status: 'stale' };
    }
    const runId = String(run._id);
    const observedAt = (run.finishedAt ?? snapshot.createdAt).toISOString();
    const actions: CandidateAction[] = [];
    const seenRuleIds = new Set<string>();
    for (const finding of snapshot.findings ?? []) {
        if (finding.bucket !== 'fix-now' && finding.bucket !== 'watch')
            continue;
        // The rule engine emits one finding per rule; dedupe defensively so a
        // malformed snapshot can never mint two candidates with the same id.
        if (seenRuleIds.has(finding.ruleId))
            continue;
        seenRuleIds.add(finding.ruleId);
        // Run-independent identity: the decision belongs to the (account, site,
        // rule) triple, not to the run that happened to observe it. A retest
        // therefore keeps a dismissal or a "marked fixed" instead of silently
        // minting a fresh action id. The run stays visible through the evidence
        // ref below.
        const sourceId = finding.ruleId;
        const evidence: ActionEvidence[] = [
            {
                sourceRef: `${runId}:${finding.ruleId}`,
                observation: buildObservationMeta({
                    sourceKind: 'provider_observation',
                    observedAt,
                }),
            },
        ];
        actions.push({
            sourceType: 'audit_finding',
            sourceId,
            affectedUrls: canonicalizeAffectedUrls(finding.affectedUrls ?? []),
            evidence,
            severity: finding.severity,
            firstPartyImpact: 'none',
            confidence: 'high',
            effort: 'medium',
            sourceState: 'open',
            observedAt,
            lastVerifiedAt: observedAt,
            retestAvailable: true,
            copyKeys: {
                problem: `auditRules.${finding.ruleId}.title` as TranslationKey,
                whyItMatters: `auditRules.${finding.ruleId}.why` as TranslationKey,
                nextStep: `auditRules.${finding.ruleId}.fix` as TranslationKey,
            },
            ...(isAuditCodeFixEligible(finding)
                ? {
                    codeFixPrompt: {
                        reference: finding.ruleId,
                        recommendedFixKey: `auditRules.${finding.ruleId}.fix` as TranslationKey,
                        affectedUrlCount: finding.affectedUrls?.length ?? 0,
                    },
                }
                : {}),
        });
    }
    return { actions, status: 'available', lastObservedAt: observedAt };
};
