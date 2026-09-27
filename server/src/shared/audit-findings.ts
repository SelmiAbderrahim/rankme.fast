/**
 * A finding whose rule could not be evaluated — the data source was not
 * connected, not configured, or returned no usable data
 * (`meta.insufficientData`). The stored bucket stays `watch` for snapshot
 * compatibility, but every consumer (counts, report tabs, actions worklist,
 * AI summary, exports) treats it as "not evaluated" rather than an open
 * problem.
 */
export function isNotEvaluatedFinding(finding: {
    bucket: string;
    meta?: Record<string, unknown> | null;
}): boolean {
    return finding.bucket !== 'passed' && finding.meta?.insufficientData === true;
}
