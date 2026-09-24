/** Deterministic, stored-inventory-only internal-link candidate generation. */
import { createHash } from 'node:crypto';
import { buildInventoryInboundCounts, normalizeUrlKey, type InventoryPageFacts, } from '../content-intelligence/index.js';
import { INTERNAL_LINK_MAX_ANCHOR_CODE_POINTS, INTERNAL_LINK_MAX_CANDIDATES, INTERNAL_LINK_MAX_EVIDENCE_ITEMS, INTERNAL_LINK_MAX_SOURCES_PER_TARGET, internalLinkSuggestionSetSchema, type InternalLinkConfidence, type InternalLinkSuggestion, type InternalLinkTargetFlag, } from './internal-links.schemas.js';
const HEADING_SPLIT = /[^\p{L}\p{N}]+/gu;
const QUERY_SPACE = /\s+/gu;
const CANDIDATE_SEPARATOR = '\u001F';
function compareText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
export function truncateCodePoints(value: string, maximum: number): string {
    return [...value].slice(0, maximum).join('');
}
export function normalizeInternalLinkText(raw: string): string {
    return raw
        .slice(0, 4000)
        .normalize('NFKC')
        .toLowerCase()
        .replace(QUERY_SPACE, ' ')
        .trim();
}
function headingTokens(headings: readonly string[]): Set<string> {
    const tokens = new Set<string>();
    for (const heading of headings) {
        const normalized = normalizeInternalLinkText(heading);
        for (const token of normalized.split(HEADING_SPLIT)) {
            if ([...token].length < 3)
                continue;
            tokens.add(token);
        }
    }
    return tokens;
}
function intersectSorted(left: ReadonlySet<string>, right: ReadonlySet<string>): string[] {
    const [small, large] = left.size <= right.size ? [left, right] : [right, left];
    const values: string[] = [];
    for (const value of small) {
        if (large.has(value))
            values.push(value);
    }
    return values.sort(compareText).slice(0, INTERNAL_LINK_MAX_EVIDENCE_ITEMS);
}
function confidenceFor(sharedQueries: readonly string[], headingMatches: readonly string[]): InternalLinkConfidence {
    if (sharedQueries.length > 0 && headingMatches.length >= 2)
        return 'high';
    if (sharedQueries.length > 0 || headingMatches.length >= 4)
        return 'medium';
    return 'low';
}
export function sourceSectionForUrl(raw: string): string {
    try {
        const url = new URL(raw);
        const first = url.pathname.split('/').filter(Boolean)[0];
        if (!first)
            return '/';
        try {
            return truncateCodePoints(`/${decodeURIComponent(first)}`, 256);
        }
        catch {
            return truncateCodePoints(`/${first}`, 256);
        }
    }
    catch {
        return '/';
    }
}
function fallbackAnchorFor(page: InventoryPageFacts): string {
    const heading = page.headings.find((value) => value.trim().length > 0);
    let value = heading ?? page.title ?? '';
    if (value.trim().length === 0) {
        try {
            const url = new URL(page.url);
            const segment = url.pathname.split('/').filter(Boolean).at(-1);
            value = segment ? decodeURIComponent(segment).replace(/[-_]+/gu, ' ') : url.hostname;
        }
        catch {
            value = page.url;
        }
    }
    const normalized = value.normalize('NFKC').replace(QUERY_SPACE, ' ').trim();
    return truncateCodePoints(normalized.length > 0 ? normalized : '/', INTERNAL_LINK_MAX_ANCHOR_CODE_POINTS);
}
function candidateId(sourceKey: string, targetKey: string): string {
    return `link-${createHash('sha256')
        .update(`${sourceKey}${CANDIDATE_SEPARATOR}${targetKey}`, 'utf8')
        .digest('hex')
        .slice(0, 20)}`;
}
function candidateCompare(a: InternalLinkSuggestion, b: InternalLinkSuggestion): number {
    const order: Record<InternalLinkConfidence, number> = {
        high: 0,
        medium: 1,
        low: 2,
    };
    return (order[a.confidence] - order[b.confidence] ||
        b.sharedQueries.length - a.sharedQueries.length ||
        b.headingMatches.length - a.headingMatches.length ||
        b.sourceWordCount - a.sourceWordCount ||
        compareText(a.sourceUrl, b.sourceUrl) ||
        compareText(a.targetUrl, b.targetUrl));
}
function querySetsByUrl(input: ReadonlyMap<string, readonly string[]>): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    for (const [url, queries] of input) {
        const key = normalizeUrlKey(url);
        const set = result.get(key) ?? new Set<string>();
        for (const query of queries) {
            const normalized = normalizeInternalLinkText(query).slice(0, 400);
            if (normalized.length > 0)
                set.add(normalized);
        }
        result.set(key, set);
    }
    return result;
}
export interface GenerateInternalLinkCandidatesInput {
    pages: readonly InventoryPageFacts[];
    gscQueriesByUrl: ReadonlyMap<string, readonly string[]>;
    inventoryDate: string;
}
/**
 * Exported pure generator. It has no clock, random source, database, provider,
 * or crawler dependency; every output value is reproducible from the arguments.
 */
export function generateInternalLinkCandidates(input: GenerateInternalLinkCandidatesInput): InternalLinkSuggestion[] {
    const orderedPages = [...input.pages].sort((a, b) => compareText(normalizeUrlKey(a.url), normalizeUrlKey(b.url)) ||
        compareText(a.url, b.url));
    const pagesByKey = new Map<string, InventoryPageFacts>();
    for (const page of orderedPages) {
        const key = normalizeUrlKey(page.url);
        if (!pagesByKey.has(key))
            pagesByKey.set(key, page);
    }
    const pages = [...pagesByKey.values()];
    const inbound = buildInventoryInboundCounts(pages);
    const querySets = querySetsByUrl(input.gscQueriesByUrl);
    const tokensByKey = new Map(pages.map((page) => [normalizeUrlKey(page.url), headingTokens(page.headings)]));
    const candidatesByTarget = new Map<string, InternalLinkSuggestion[]>();
    for (const target of pages) {
        if (target.qualityFlags.includes('noindex'))
            continue;
        const targetKey = normalizeUrlKey(target.url);
        // The shared graph builder initializes every inventoried URL, including
        // zero-inbound pages, before walking edges.
        const targetInboundCount = inbound.get(targetKey)!;
        let targetFlag: InternalLinkTargetFlag;
        if (targetInboundCount === 0)
            targetFlag = 'orphan';
        else if (targetInboundCount === 1)
            targetFlag = 'weakly_linked';
        else
            continue;
        for (const source of pages) {
            const sourceKey = normalizeUrlKey(source.url);
            if (sourceKey === targetKey || source.qualityFlags.includes('noindex'))
                continue;
            const existingTargets = new Set(source.internalOutLinks.map(normalizeUrlKey));
            if (existingTargets.has(targetKey))
                continue;
            const sharedQueries = intersectSorted(querySets.get(sourceKey) ?? new Set(), querySets.get(targetKey) ?? new Set());
            const headingMatches = intersectSorted(tokensByKey.get(sourceKey)!, tokensByKey.get(targetKey)!);
            if (sharedQueries.length === 0 && headingMatches.length < 2)
                continue;
            const candidate: InternalLinkSuggestion = {
                id: candidateId(sourceKey, targetKey),
                sourceUrl: source.url,
                sourceSection: sourceSectionForUrl(source.url),
                sourceWordCount: source.wordCount,
                targetUrl: target.url,
                targetFlag,
                targetInboundCount,
                confidence: confidenceFor(sharedQueries, headingMatches),
                sharedQueries,
                headingMatches,
                anchorText: fallbackAnchorFor(target),
                inventoryDate: input.inventoryDate,
                rank: null,
                rankingSource: 'deterministic',
            };
            const list = candidatesByTarget.get(targetKey) ?? [];
            list.push(candidate);
            candidatesByTarget.set(targetKey, list);
        }
    }
    const retained = [...candidatesByTarget.entries()]
        .sort(([a], [b]) => compareText(a, b))
        .flatMap(([, candidates]) => candidates.sort(candidateCompare).slice(0, INTERNAL_LINK_MAX_SOURCES_PER_TARGET))
        .sort(candidateCompare)
        .slice(0, INTERNAL_LINK_MAX_CANDIDATES);
    return internalLinkSuggestionSetSchema.parse(retained);
}
