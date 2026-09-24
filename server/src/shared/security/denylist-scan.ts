export interface ForbiddenFinding {
    path: string;
    reason: string;
}
export interface DenylistScanOptions {
    vendorKeys?: readonly string[];
    promptFieldNames?: readonly string[];
    evidenceFieldNames?: readonly string[];
    allowedEvidenceFieldNames?: readonly string[];
    /**
     * Field names whose SUBTREE holds first-party copy we author ourselves —
     * localized rule/action strings out of `shared/i18n/dictionaries`, which
     * legitimately quote markup (`add a <meta name="viewport" …> tag`). Only the
     * raw-HTML check is waived inside them; authorization material and
     * high-entropy secrets are still rejected, so this can never become a
     * secret-leak allowance. Never pass a field that carries crawled pages,
     * vendor payloads, or model prose.
     */
    allowedHtmlFieldNames?: readonly string[];
    maxDepth?: number;
    maxNodes?: number;
    maxStringLength?: number;
    entropyThreshold?: number;
}
const DEFAULT_PROMPT_FIELDS = ['prompt', 'system', 'messages', 'completion', 'rawText'] as const;
const DEFAULT_VENDOR_KEYS = ['se_result'] as const;
const DEFAULT_EVIDENCE_FIELDS = [
    'brandQuery',
    'brand_query',
    'mentionSnippet',
    'mention_snippet',
    'reviewText',
    'review_text',
    'reviewTitle',
    'review_title',
    'keywords',
    'keywordList',
    'keyword_list',
    'relatedQueries',
    'related_queries',
    'digestText',
    'digest_text',
    'digestSentenceText',
    'digest_sentence_text',
    'themeExcerpt',
    'theme_excerpt',
] as const;
const SECRET_KEY = /^(?:authorization|cookie|password|secret|token|.*api[_-]?keys?|access[_-]?token|refresh[_-]?token|.*(?:[_-](?:secret|key|keys|token|password)|(?:ApiKey|ApiKeys|Secret|Token|Password)))$/i;
const AUTH_VALUE = /^(?:Bearer\s+|Basic\s+|rmf_)/i;
const RAW_HTML = /<!doctype\b|<(?:script|iframe|[a-z][a-z\d-]*)(?:\s|>|\/)/i;
const HEX_BLOB = /^[a-f\d]+$/i;
const BASE64_BLOB = /^[A-Za-z\d+/_=-]+$/;
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
function keyName(value: string): string {
    return value
        .replace(/^\$\.?/, '')
        .replace(/\[\d*\]/g, '')
        .toLowerCase();
}
function looksHighEntropy(value: string, threshold: number): boolean {
    if (value.length < threshold || UUID.test(value))
        return false;
    const encoded = HEX_BLOB.test(value) || BASE64_BLOB.test(value);
    if (!encoded || !/[A-Za-z]/.test(value) || !/\d/.test(value))
        return false;
    const counts = new Map<string, number>();
    for (const character of value)
        counts.set(character, (counts.get(character) ?? 0) + 1);
    const entropy = [...counts.values()].reduce((total, count) => {
        const probability = count / value.length;
        return total - probability * Math.log2(probability);
    }, 0);
    return entropy >= 3.5;
}
function stringReason(value: string, entropyThreshold: number, htmlAllowed: boolean): string | null {
    if (AUTH_VALUE.test(value))
        return 'authorization-material';
    if (!htmlAllowed && RAW_HTML.test(value))
        return 'raw-html';
    if (looksHighEntropy(value, entropyThreshold))
        return 'high-entropy-secret';
    return null;
}
export function scanForForbidden(value: unknown, opts: DenylistScanOptions = {}): ForbiddenFinding[] {
    const findings: ForbiddenFinding[] = [];
    const promptFields = new Set((opts.promptFieldNames ?? DEFAULT_PROMPT_FIELDS).map(keyName));
    const vendorKeys = new Set([...DEFAULT_VENDOR_KEYS, ...(opts.vendorKeys ?? [])].map(keyName));
    const evidenceFields = new Set([...DEFAULT_EVIDENCE_FIELDS, ...(opts.evidenceFieldNames ?? [])].map(keyName));
    const allowedEvidenceFields = new Set((opts.allowedEvidenceFieldNames ?? []).map(keyName));
    const allowedHtmlFields = new Set((opts.allowedHtmlFieldNames ?? []).map(keyName));
    const maxDepth = opts.maxDepth ?? 12;
    const maxNodes = opts.maxNodes ?? 10000;
    const maxStringLength = opts.maxStringLength ?? 100000;
    const entropyThreshold = opts.entropyThreshold ?? 32;
    const seen = new WeakSet<object>();
    let nodes = 0;
    const add = (path: string, reason: string): void => {
        findings.push({ path, reason });
    };
    const walk = (current: unknown, path: string, depth: number, htmlAllowed: boolean): void => {
        nodes += 1;
        if (nodes > maxNodes) {
            add(path, 'node-limit');
            return;
        }
        if (depth > maxDepth) {
            add(path, 'depth-limit');
            return;
        }
        if (typeof current === 'string') {
            if (current.length > maxStringLength)
                add(path, 'string-limit');
            const reason = stringReason(current.slice(0, maxStringLength), entropyThreshold, htmlAllowed);
            if (reason)
                add(path, reason);
            return;
        }
        if (current === null || typeof current !== 'object')
            return;
        if (seen.has(current)) {
            add(path, 'cyclic-value');
            return;
        }
        seen.add(current);
        if (Array.isArray(current)) {
            for (let index = 0; index < current.length; index += 1) {
                walk(current[index], `${path}[${index}]`, depth + 1, htmlAllowed);
                if (nodes > maxNodes)
                    break;
            }
            return;
        }
        for (const [key, child] of Object.entries(current)) {
            const childPath = `${path}.${key}`;
            const normalized = keyName(key);
            if (SECRET_KEY.test(key))
                add(childPath, 'secret-key');
            if (promptFields.has(normalized))
                add(childPath, 'prompt-or-completion-field');
            if (evidenceFields.has(normalized) && !allowedEvidenceFields.has(normalized)) {
                add(childPath, 'evidence-content-field');
            }
            if (vendorKeys.has(normalized) || vendorKeys.has(keyName(childPath))) {
                add(childPath, 'vendor-payload-key');
            }
            walk(child, childPath, depth + 1, htmlAllowed || allowedHtmlFields.has(normalized));
            if (nodes > maxNodes)
                break;
        }
    };
    walk(value, '$', 0, false);
    return findings;
}
/**
 * Thrown when a payload fails the scan. Typed so a caller can report "output
 * withheld" honestly instead of collapsing it into a generic internal error,
 * and so the offending paths stay available for the log without ever being
 * serialized to the wire.
 */
export class ForbiddenOutputError extends Error {
    readonly findings: readonly ForbiddenFinding[];
    constructor(findings: readonly ForbiddenFinding[]) {
        super(`Forbidden output at ${findings.map(({ path, reason }) => `${path} (${reason})`).join(', ')}`);
        this.name = 'ForbiddenOutputError';
        this.findings = findings;
    }
}
export function assertNoForbidden(value: unknown, opts: DenylistScanOptions = {}): void {
    const findings = scanForForbidden(value, opts);
    if (findings.length === 0)
        return;
    throw new ForbiddenOutputError(findings);
}
