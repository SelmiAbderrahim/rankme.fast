/**
 * Rule `broken-internal-links` — pages that link out to URLs the crawler
 * could not fetch (4xx/5xx). Always fix-now — broken links waste crawl
 * budget and confuse readers.
 *
 * The processor re-requests every reported target (up to a bounded number,
 * following redirects) before this rule runs and drops the targets that turn
 * out to resolve, so `page.brokenLinks` holds only the crawler's verdicts that
 * survived the check. `meta` records how each one fared:
 *   - `confirmedTargets`  our own request also failed (404/410/5xx, loop, limit)
 *   - `unverifiedTargets` we could not tell (timeout, refused 401/403/429, not re-requested)
 *   - `reportedTargets`   no re-check was recorded (runs from before verification)
 *   - `clearedTargets`    reported broken but resolve when re-requested — dismissed
 *
 * When every remaining target is an inconclusive re-check the finding drops
 * to `watch` (severity `warning`) instead of fix-now.
 */
import type { AuditResult, BrokenLinkEvidence } from '../../../shared/providers/index.js';
import { bucketFor } from './bucket.js';
import type { AuditRule, RuleFinding } from './rule.types.js';
const RULE_ID = 'broken-internal-links' as const;
/**
 * Our own re-request could not tell (a refusal such as 403, a timeout, an
 * unreachable host). Sites behind bot protection answer the crawler and our
 * check with 403 while visitors get the page, so these never make a fix-now
 * finding on their own. A target that was not re-requested at all keeps the
 * crawler's verdict.
 */
function isInconclusive(proof: BrokenLinkEvidence | undefined): boolean {
    return proof?.outcome === 'unverified' && (proof.status !== null || proof.failure !== undefined);
}
export const brokenInternalLinksRule: AuditRule = {
    id: RULE_ID,
    evaluate(result: AuditResult): RuleFinding {
        const actionable: string[] = [];
        const inconclusivePages: string[] = [];
        const brokenLinkTargets = new Set<string>();
        const confirmed = new Set<string>();
        const unverified = new Set<string>();
        const reported = new Set<string>();
        const cleared = new Set<string>();
        let totalBroken = 0;
        for (const page of result.pages) {
            const proofByTarget = new Map((page.brokenLinkEvidence ?? []).map((proof) => [proof.target, proof]));
            for (const [target, proof] of proofByTarget) {
                if (proof.outcome === 'cleared')
                    cleared.add(target);
            }
            if (page.brokenLinks.length > 0) {
                totalBroken += page.brokenLinks.length;
                let pageActionable = false;
                for (const target of page.brokenLinks) {
                    brokenLinkTargets.add(target);
                    const proof = proofByTarget.get(target);
                    if (proof?.outcome === 'confirmed')
                        confirmed.add(target);
                    else if (proof?.outcome === 'unverified')
                        unverified.add(target);
                    else
                        reported.add(target);
                    if (!isInconclusive(proof))
                        pageActionable = true;
                }
                (pageActionable ? actionable : inconclusivePages).push(page.url);
            }
        }
        const passed = actionable.length === 0 && inconclusivePages.length === 0;
        // Only inconclusive re-checks: worth a look, not a fix-now claim.
        const severity = actionable.length > 0 ? 'critical' : 'warning';
        const clearedMeta = cleared.size > 0 ? { clearedTargets: cleared.size } : {};
        return {
            ruleId: RULE_ID,
            bucket: bucketFor(severity, passed),
            severity: passed ? 'critical' : severity,
            affectedUrls: actionable.length > 0 ? actionable : inconclusivePages,
            ...(passed
                ? cleared.size > 0
                    ? { meta: clearedMeta }
                    : {}
                : {
                    meta: {
                        totalBroken,
                        brokenLinkTargets: [...brokenLinkTargets],
                        confirmedTargets: confirmed.size,
                        unverifiedTargets: unverified.size,
                        reportedTargets: reported.size,
                        ...clearedMeta,
                    },
                }),
        };
    },
};
