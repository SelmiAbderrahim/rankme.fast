/**
 * Evidence assembly for the schema markup generator.
 *
 * Covers the frozen fact ids and the three source paths.
 *
 * An evidence fact is the ONLY thing that ever reaches the AI profile or the
 * emitted payload — raw crawl HTML never leaves this module. The audited-page
 * and inventory-page paths read stored documents and issue ZERO outbound
 * requests; only the pasted-URL path fetches, and it fetches exclusively
 * through the `fetchPublicUrlSafe` authority with the bounds declared below.
 */
import { AuditRun, AuditedPage, ReportSnapshot } from '../audits/index.js';
import { ContentInventoryPage } from '../content-intelligence/index.js';
import { Site } from '../sites/index.js';
import { fetchPublicUrlSafe, type FetchPublicUrlSafeOptions, } from '../../shared/security/url-safety.js';
import { safeUrlString } from '../../shared/security/input-guards.js';
export const EVIDENCE_SOURCES = ['audited-page', 'inventory-page', 'url'] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
export interface EvidenceFact {
    readonly id: string;
    readonly kind: 'first_party';
    readonly label: string;
    readonly value: string;
    /** Context-only facts describe the page's CURRENT markup; they never fill a property. */
    readonly contextOnly: boolean;
}
/** Facts the AI may read for context but may never cite in an assignment. */
export const CONTEXT_ONLY_FACT_IDS = [
    'detector.structuredData',
    'gsc.richResults',
    'inventory.schemaTypes',
] as const;
/** Every per-fact bound, plus the shared per-path array ceilings. */
export const EVIDENCE_LIMITS = {
    titleChars: 300,
    metaDescriptionChars: 500,
    h1Count: 5,
    h1Chars: 300,
    h2Count: 20,
    h2Chars: 300,
    faqAnswerCount: 10,
    faqAnswerChars: 1000,
    languageChars: 16,
    metaDateChars: 64,
    contextChars: 1000,
    contextItemCount: 8,
    contextItemChars: 64,
    htmlChars: 512000,
    responseBytes: 512000,
    deadlineMs: 8000,
    maxRedirects: 3,
} as const;
export type EvidenceErrorCode = 'site_not_found' | 'run_not_found' | 'page_not_found' | 'not_html';
/** Domain failure of evidence assembly. The route layer maps it to HTTP. */
export class SchemaEvidenceError extends Error {
    constructor(readonly code: EvidenceErrorCode) {
        super(`schema evidence unavailable: ${code}`);
        this.name = 'SchemaEvidenceError';
    }
}
export type SafeFetch = (url: string, init: RequestInit, opts: FetchPublicUrlSafeOptions) => Promise<Response>;
export interface AssembleEvidenceInput {
    readonly source: EvidenceSource;
    readonly accountId: string;
    readonly siteId: string;
    /** Audited/inventory page URL, or the pasted URL for `source: 'url'`. */
    readonly pageUrl: string;
    readonly runId?: string;
    /** Injected only by tests; production always uses `fetchPublicUrlSafe`. */
    readonly fetchUrl?: SafeFetch;
}
export interface AssembledEvidence {
    readonly source: EvidenceSource;
    readonly siteId: string;
    readonly pageUrl: string;
    readonly facts: readonly EvidenceFact[];
}
function fact(id: string, label: string, value: string, contextOnly = false): EvidenceFact {
    return { id, kind: 'first_party', label, value, contextOnly };
}
function clamp(value: string, max: number): string {
    return value.slice(0, max);
}
function contextJson(value: unknown): string {
    return clamp(JSON.stringify(value), EVIDENCE_LIMITS.contextChars);
}
function pushText(facts: EvidenceFact[], id: string, label: string, value: string | null | undefined, max: number): void {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length === 0)
        return;
    facts.push(fact(id, label, clamp(text, max)));
}
function pushList(facts: EvidenceFact[], id: string, label: string, values: readonly string[], maxCount: number, maxChars: number): void {
    let index = 0;
    for (const value of values) {
        if (index >= maxCount)
            return;
        const text = value.trim();
        if (text.length === 0)
            continue;
        facts.push(fact(`${id}[${index}]`, `${label} #${index + 1}`, clamp(text, maxChars)));
        index += 1;
    }
}
// ---------------------------------------------------------------------------
// HTML extraction (pasted-URL path only). Bounded, tag-stripping, no parser
// dependency, and the source HTML is discarded the moment this returns.
// ---------------------------------------------------------------------------
export interface ExtractedPage {
    readonly title: string | null;
    readonly metaDescription: string | null;
    readonly h1: string[];
    readonly h2: string[];
    /** Answer text keyed to the matching compacted `h2` fact index. */
    readonly faqAnswers: ExtractedFaqAnswer[];
    readonly language: string | null;
    readonly articlePublishedTime: string | null;
    readonly articleModifiedTime: string | null;
}
export interface ExtractedFaqAnswer {
    readonly headingIndex: number;
    readonly text: string;
}
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
};
function decodeEntities(value: string): string {
    return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
        const lower = body.toLowerCase();
        if (lower.startsWith('#x')) {
            const code = Number.parseInt(lower.slice(2), 16);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        if (lower.startsWith('#')) {
            const code = Number.parseInt(lower.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
        }
        return NAMED_ENTITIES[lower] ?? whole;
    });
}
function textOf(html: string): string {
    return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function attributeOf(tag: string, name: string): string | null {
    const doubleQuoted = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
    if (doubleQuoted)
        return decodeEntities(doubleQuoted[1]!).trim();
    const singleQuoted = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
    if (singleQuoted)
        return decodeEntities(singleQuoted[1]!).trim();
    const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag);
    return bare ? decodeEntities(bare[1]!).trim() : null;
}
function headings(html: string, level: '1' | '2'): {
    text: string;
    end: number;
}[] {
    const pattern = new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}\\s*>`, 'gi');
    const found: {
        text: string;
        end: number;
    }[] = [];
    for (const match of html.matchAll(pattern)) {
        found.push({ text: textOf(match[1]!), end: match.index! + match[0].length });
    }
    return found;
}
const QUESTION_SUFFIX = /[?？؟]$/;
/** A heading is question-shaped when it ends with a Latin, Arabic or full-width question mark. */
export function isQuestionHeading(value: string): boolean {
    return QUESTION_SUFFIX.test(value.trim());
}
function metaContent(html: string, attribute: 'name' | 'property', key: string): string | null {
    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
        const tag = match[0];
        if (attributeOf(tag, attribute)?.toLowerCase() !== key)
            continue;
        const content = attributeOf(tag, 'content');
        if (content !== null && content.length > 0)
            return content;
    }
    return null;
}
export function extractPageFacts(rawHtml: string): ExtractedPage {
    const html = clamp(rawHtml, EVIDENCE_LIMITS.htmlChars);
    const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
    const htmlTag = /<html\b[^>]*>/i.exec(html);
    const h1 = headings(html, '1');
    const h2 = headings(html, '2');
    const faqAnswers: ExtractedFaqAnswer[] = [];
    let headingIndex = 0;
    for (const heading of h2) {
        if (faqAnswers.length >= EVIDENCE_LIMITS.faqAnswerCount)
            break;
        const headingText = heading.text.trim();
        if (headingText.length === 0)
            continue;
        if (headingIndex >= EVIDENCE_LIMITS.h2Count)
            break;
        const currentHeadingIndex = headingIndex;
        headingIndex += 1;
        if (!isQuestionHeading(clamp(headingText, EVIDENCE_LIMITS.h2Chars)))
            continue;
        const rest = html.slice(heading.end);
        const stop = /<h[1-6]\b|<\/(?:main|body|section|article)\b/i.exec(rest);
        const answer = textOf(stop ? rest.slice(0, stop.index) : rest);
        if (answer.length > 0) {
            faqAnswers.push({ headingIndex: currentHeadingIndex, text: answer });
        }
    }
    return {
        title: titleMatch ? textOf(titleMatch[1]!) || null : null,
        metaDescription: metaContent(html, 'name', 'description'),
        h1: h1.map((entry) => entry.text),
        h2: h2.map((entry) => entry.text),
        faqAnswers,
        language: htmlTag ? attributeOf(htmlTag[0], 'lang') : null,
        articlePublishedTime: metaContent(html, 'property', 'article:published_time'),
        articleModifiedTime: metaContent(html, 'property', 'article:modified_time'),
    };
}
// ---------------------------------------------------------------------------
// Fact pushers
// ---------------------------------------------------------------------------
interface SiteRecord {
    readonly url: string;
    readonly domain: string;
    readonly displayName: string;
}
function pushSiteFacts(facts: EvidenceFact[], site: SiteRecord): void {
    let origin: string;
    try {
        origin = new URL(site.url).origin;
    }
    catch {
        origin = site.url;
    }
    pushText(facts, 'site.origin', 'Site origin', origin, EVIDENCE_LIMITS.titleChars);
    pushText(facts, 'site.domain', 'Site domain', site.domain, EVIDENCE_LIMITS.titleChars);
    pushText(facts, 'site.label', 'Site name', site.displayName, EVIDENCE_LIMITS.titleChars);
}
interface AuditedPageRecord {
    readonly url: string;
    readonly title: string | null;
    readonly metaDescription: string | null;
    readonly canonical: string | null;
    /** Mongoose defaults both heading arrays to `[]`, so they are never nullish. */
    readonly h1: string[];
    readonly h2: string[];
}
function pushAuditedPageFacts(facts: EvidenceFact[], page: AuditedPageRecord): void {
    pushText(facts, 'page.canonical', 'Canonical URL', page.canonical, EVIDENCE_LIMITS.titleChars);
    pushText(facts, 'page.title', 'Page title', page.title, EVIDENCE_LIMITS.titleChars);
    pushText(facts, 'page.metaDescription', 'Meta description', page.metaDescription, EVIDENCE_LIMITS.metaDescriptionChars);
    pushList(facts, 'page.h1', 'Heading 1', page.h1, EVIDENCE_LIMITS.h1Count, EVIDENCE_LIMITS.h1Chars);
    pushList(facts, 'page.h2', 'Heading 2', page.h2, EVIDENCE_LIMITS.h2Count, EVIDENCE_LIMITS.h2Chars);
}
interface SnapshotFinding {
    readonly ruleId: string;
    readonly meta?: unknown;
}
interface SnapshotRecord {
    /** Mongoose defaults `findings` to `[]`, so the array is never nullish. */
    readonly findings: SnapshotFinding[];
    readonly indexStatus?: {
        samples?: {
            url: string;
            inspection: {
                richResults: {
                    verdict: string;
                    items: {
                        type: string;
                        issues: number;
                    }[];
                };
            };
        }[];
    } | null;
}
function pushSnapshotContext(facts: EvidenceFact[], snapshot: SnapshotRecord, url: string): void {
    const finding = snapshot.findings.find((entry) => entry.ruleId === 'structured-data-missing');
    if (finding) {
        const meta = finding.meta as {
            offenders?: {
                url: string;
                reason: string;
            }[];
        } | null | undefined;
        const offender = (meta?.offenders ?? []).find((entry) => entry.url === url);
        // `errors: 1` means "the detector reported at least one markup error here".
        const present = offender === undefined || offender.reason === 'errors';
        const errors = offender?.reason === 'errors' ? 1 : 0;
        facts.push(fact('detector.structuredData', 'Structured data detected on this page', contextJson({ present, errors }), true));
    }
    const sample = (snapshot.indexStatus?.samples ?? []).find((entry) => entry.url === url);
    if (sample) {
        const rich = sample.inspection.richResults;
        facts.push(fact('gsc.richResults', 'Search Console rich-results verdict', contextJson({
            verdict: clamp(rich.verdict, EVIDENCE_LIMITS.contextItemChars),
            items: rich.items.slice(0, EVIDENCE_LIMITS.contextItemCount).map((item) => ({
                type: clamp(item.type, EVIDENCE_LIMITS.contextItemChars),
                issues: item.issues,
            })),
        }), true));
    }
}
function pushInventoryContext(facts: EvidenceFact[], row: {
    facts?: unknown;
}): void {
    const derived = row.facts as {
        schemaTypes?: unknown;
        hasSchemaOrgArticle?: unknown;
    } | null | undefined;
    const schemaTypes = Array.isArray(derived?.schemaTypes)
        ? derived.schemaTypes
            .filter((entry): entry is string => typeof entry === 'string')
            .slice(0, EVIDENCE_LIMITS.contextItemCount)
            .map((entry) => clamp(entry, EVIDENCE_LIMITS.contextItemChars))
        : [];
    facts.push(fact('inventory.schemaTypes', 'Schema types already declared on this page', contextJson({
        schemaTypes,
        hasSchemaOrgArticle: derived?.hasSchemaOrgArticle === true,
    }), true));
}
async function pushFetchedFacts(facts: EvidenceFact[], url: string, safeFetch: SafeFetch): Promise<void> {
    const response = await safeFetch(url, { method: 'GET' }, {
        maxResponseBytes: EVIDENCE_LIMITS.responseBytes,
        deadlineMs: EVIDENCE_LIMITS.deadlineMs,
        maxRedirects: EVIDENCE_LIMITS.maxRedirects,
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!/^text\/html\b/i.test(contentType.trim()))
        throw new SchemaEvidenceError('not_html');
    const extracted = extractPageFacts(await response.text());
    pushText(facts, 'page.title', 'Page title', extracted.title, EVIDENCE_LIMITS.titleChars);
    pushText(facts, 'page.metaDescription', 'Meta description', extracted.metaDescription, EVIDENCE_LIMITS.metaDescriptionChars);
    pushList(facts, 'page.h1', 'Heading 1', extracted.h1, EVIDENCE_LIMITS.h1Count, EVIDENCE_LIMITS.h1Chars);
    pushList(facts, 'page.h2', 'Heading 2', extracted.h2, EVIDENCE_LIMITS.h2Count, EVIDENCE_LIMITS.h2Chars);
    for (const answer of extracted.faqAnswers) {
        facts.push(fact(`page.faqAnswers[${answer.headingIndex}]`, `FAQ answer #${answer.headingIndex + 1}`, clamp(answer.text, EVIDENCE_LIMITS.faqAnswerChars)));
    }
    pushText(facts, 'page.language', 'Page language', extracted.language, EVIDENCE_LIMITS.languageChars);
    pushText(facts, 'page.articlePublishedTime', 'Article published time', extracted.articlePublishedTime, EVIDENCE_LIMITS.metaDateChars);
    pushText(facts, 'page.articleModifiedTime', 'Article modified time', extracted.articleModifiedTime, EVIDENCE_LIMITS.metaDateChars);
}
// ---------------------------------------------------------------------------
// Stored lookups
// ---------------------------------------------------------------------------
async function latestSucceededRunId(siteId: string, accountId: string, runId?: string) {
    const filter = runId
        ? { _id: runId, siteId, accountId, status: 'succeeded' }
        : { siteId, accountId, status: 'succeeded' };
    const run = await AuditRun.findOne(filter).sort({ createdAt: -1 }).lean();
    return run ? String(run._id) : null;
}
async function attachAuditedFacts(facts: EvidenceFact[], runId: string, url: string): Promise<boolean> {
    const page = await AuditedPage.findOne({ runId, url }).lean();
    if (!page)
        return false;
    pushAuditedPageFacts(facts, page as AuditedPageRecord);
    const snapshot = await ReportSnapshot.findOne({ runId }).lean();
    if (snapshot)
        pushSnapshotContext(facts, snapshot as SnapshotRecord, url);
    return true;
}
/**
 * Assemble the frozen fact set for one generation.
 *
 * `source: 'url'` is the ONLY path that performs network I/O, and it does so
 * exclusively through the shared SSRF authority.
 */
export async function assembleEvidence(input: AssembleEvidenceInput): Promise<AssembledEvidence> {
    const site = await Site.findOne({
        _id: input.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    }).lean();
    if (!site)
        throw new SchemaEvidenceError('site_not_found');
    const facts: EvidenceFact[] = [];
    pushSiteFacts(facts, site as SiteRecord);
    if (input.source === 'url') {
        const url = safeUrlString.parse(input.pageUrl);
        facts.push(fact('page.url', 'Page URL', url));
        await pushFetchedFacts(facts, url, input.fetchUrl ?? fetchPublicUrlSafe);
        return { source: input.source, siteId: input.siteId, pageUrl: url, facts };
    }
    facts.push(fact('page.url', 'Page URL', input.pageUrl));
    const inventoryRow = await ContentInventoryPage.findOne({
        siteId: input.siteId,
        accountId: input.accountId,
        url: input.pageUrl,
    })
        .sort({ createdAt: -1 })
        .lean();
    if (input.source === 'inventory-page' && !inventoryRow)
        throw new SchemaEvidenceError('page_not_found');
    const runId = await latestSucceededRunId(input.siteId, input.accountId, input.runId);
    if (input.source === 'audited-page' && runId === null)
        throw new SchemaEvidenceError('run_not_found');
    const attached = runId === null ? false : await attachAuditedFacts(facts, runId, input.pageUrl);
    if (input.source === 'audited-page' && !attached)
        throw new SchemaEvidenceError('page_not_found');
    if (inventoryRow)
        pushInventoryContext(facts, inventoryRow);
    return { source: input.source, siteId: input.siteId, pageUrl: input.pageUrl, facts };
}
