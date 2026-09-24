export const AUDIT_CODE_FIX_RULE_IDS = [
    'robots-blocked',
    'sitemap-missing-or-weak',
    'title-missing-or-weak',
    'meta-description-missing',
    'headings-weak',
    'canonical-missing-or-broken',
    'structured-data-missing',
    'broken-internal-links',
    'llms-txt-missing',
    'https-canonicalization',
    'core-web-vitals-poor',
    'page-speed-lab-low',
    'mobile-unfriendly',
    'accessibility-low',
    'not-indexed',
    'rich-results-issues',
    'index-partial',
    'sitemap-errors',
] as const;
export const CONTENT_CODE_FIX_RULE_IDS = [
    'add-title',
    'add-description',
    'add-headings',
    'add-internal-links',
    'add-structured-data',
    'mark-up-article',
    'set-canonical',
    'set-language',
] as const;
const AUDIT_CODE_FIX_RULES = new Set<string>(AUDIT_CODE_FIX_RULE_IDS);
const CONTENT_CODE_FIX_RULES = new Set<string>(CONTENT_CODE_FIX_RULE_IDS);
export function isAuditCodeFixEligible(finding: {
    ruleId: string;
    bucket: string;
    meta?: Record<string, unknown> | null;
}): boolean {
    return finding.bucket !== 'passed' &&
        AUDIT_CODE_FIX_RULES.has(finding.ruleId) &&
        !finding.meta?.insufficientData &&
        finding.meta?.error !== true;
}
export function isContentCodeFixEligible(ruleId: string): boolean {
    return CONTENT_CODE_FIX_RULES.has(ruleId);
}
