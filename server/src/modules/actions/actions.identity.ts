import { createHash } from 'node:crypto';
import type { ActionSourceType } from '../../db/schema/action-events.js';
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;
// Server-side stable ID for a candidate action. Preimage
// `accountId + \0 + siteId + \0 + sourceType + \0 + sourceId` MUST NOT leak.
// Callers never supply the preimage as authority — the source is always
// re-resolved and re-hashed before serving history or accepting a transition.
export function hashActionId(input: {
    accountId: string;
    siteId: string;
    sourceType: ActionSourceType;
    sourceId: string;
}): string {
    return createHash('sha256')
        .update(input.accountId)
        .update('\0')
        .update(input.siteId)
        .update('\0')
        .update(input.sourceType)
        .update('\0')
        .update(input.sourceId)
        .digest('hex');
}
// Public reference stored alongside an event so the `action_events` row can be
// scanned by `sourceType`/`sourceIdRef` without exposing the preimage. Also
// account/site scoped so a leaked ref cannot be replayed against another
// tenant.
export function hashSourceIdRef(input: {
    accountId: string;
    sourceType: ActionSourceType;
    sourceId: string;
}): string {
    return createHash('sha256')
        .update(input.accountId)
        .update('\0')
        .update(input.sourceType)
        .update('\0')
        .update(input.sourceId)
        .digest('hex');
}
/**
 * Audit actions briefly used `${runId}:${ruleId}` as their identity. Resolve
 * that last-run alias from the evidence ref so decisions made before the
 * stable rule-only identity shipped do not silently revert to open.
 *
 * ponytail: this covers the run exposed by the source reader; remove it after
 * legacy audit action rows have been migrated to rule-only ids.
 */
export function legacyAuditActionId(input: {
    accountId: string;
    siteId: string;
    sourceType: ActionSourceType;
    sourceId: string;
    sourceRef?: string;
}): string | null {
    if (input.sourceType !== 'audit_finding' || !input.sourceRef)
        return null;
    const suffix = `:${input.sourceId}`;
    if (!input.sourceRef.endsWith(suffix))
        return null;
    const runId = input.sourceRef.slice(0, -suffix.length);
    if (!OBJECT_ID_RE.test(runId))
        return null;
    return hashActionId({
        accountId: input.accountId,
        siteId: input.siteId,
        sourceType: input.sourceType,
        sourceId: input.sourceRef,
    });
}
/**
 * Split a composite `head:tail` source id with exactly the semantics of
 * `sourceId.split(':', 2)` — the head is everything before the first colon,
 * the tail everything between the first and second colon (`''` when there is
 * no colon at all).
 *
 * Written without an indexed read because `split` ALWAYS yields index 0, so a
 * `parts[0] ?? ''` guard would carry an arm no input can reach. Every branch
 * below is reachable: no colon, one colon, two-or-more colons.
 */
function splitCompositeSourceId(sourceId: string): readonly [
    string,
    string
] {
    const sep = sourceId.indexOf(':');
    if (sep === -1)
        return [sourceId, ''];
    const rest = sourceId.slice(sep + 1);
    const nextSep = rest.indexOf(':');
    return [
        sourceId.slice(0, sep),
        nextSep === -1 ? rest : rest.slice(0, nextSep),
    ];
}
const INTERNAL_ROUTE_BUILDERS: Record<ActionSourceType, (siteId: string, sourceId: string) => string> = {
    // Audit findings are identified by rule id alone (run-independent). The
    // report resolves this query onto the finding's bucket and opens its detail.
    audit_finding: (siteId, sourceId) => `/sites/${encodeURIComponent(siteId)}/report?finding=${encodeURIComponent(sourceId)}`,
    confirmed_rank_drop: (siteId, sourceId) => `/sites/${encodeURIComponent(siteId)}/ranks/drops/${encodeURIComponent(sourceId)}`,
    gsc_decline: (siteId, sourceId) => `/sites/${encodeURIComponent(siteId)}/gsc/declines/${encodeURIComponent(sourceId)}`,
    ga4_decline: (siteId, sourceId) => `/sites/${encodeURIComponent(siteId)}/ga4/declines/${encodeURIComponent(sourceId)}`,
    content_recommendation: (siteId, sourceId) => {
        const [analysisId, recommendationId] = splitCompositeSourceId(sourceId);
        return `/sites/${encodeURIComponent(siteId)}/content-intelligence/${encodeURIComponent(analysisId)}/recommendations/${encodeURIComponent(recommendationId)}`;
    },
    citation_gap: (siteId, sourceId) => `/sites/${encodeURIComponent(siteId)}/content-intelligence/citation-gaps/${encodeURIComponent(sourceId)}`,
    audience_research: (siteId, sourceId) => `/sites/${encodeURIComponent(siteId)}/audience-research/${encodeURIComponent(sourceId)}`,
    competitor_opportunity: (siteId, sourceId) => {
        const [reportId, opportunityId] = splitCompositeSourceId(sourceId);
        return `/sites/${encodeURIComponent(siteId)}?tab=competitors&view=reports&run=${encodeURIComponent(reportId)}&opportunity=${encodeURIComponent(opportunityId)}`;
    },
};
export function buildSourceLink(sourceType: ActionSourceType, siteId: string, sourceId: string): string {
    return INTERNAL_ROUTE_BUILDERS[sourceType](siteId, sourceId);
}
