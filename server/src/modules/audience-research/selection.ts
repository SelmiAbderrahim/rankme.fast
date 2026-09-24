/**
 * Deterministic candidate selection.
 *
 * Selection is a STABLE lexicographic tuple — NOT an AI score:
 *   1. query-token relevance desc (integer overlap tokens ∩ URL path + title)
 *   2. organic position asc
 *   3. known recency desc (observedAt desc; nulls sort after non-nulls)
 *   4. source-type diversity (round-robin — force ≥1 of each type first)
 *   5. registrable-domain diversity (round-robin; ≤ MAX_PER_DOMAIN)
 *   6. canonical URL asc (final tie-break)
 *
 * The fetch ceiling is `MAX_CANDIDATES = 20`.
 * Canonical dedupe happens BEFORE fetch; content-hash dedupe AFTER fetch.
 */
import type { PublicPageDiscoveryRow, PublicPageSourceHint, } from '../../shared/providers/types.js';
import { classifySourceType, registrableDomain } from './source-classifier.js';
export const MAX_CANDIDATES = 20;
export const MAX_PER_REGISTRABLE_DOMAIN = 3;
export interface Candidate {
    canonicalUrl: string;
    title: string;
    organicPosition: number;
    observedAt: string | null;
    sourceType: PublicPageSourceHint;
    registrableDomain: string;
    discoveryQueryIds: string[];
    /** Provider-supplied hint, kept only for reference. */
    providerHint: PublicPageSourceHint | null;
}
export interface SelectCandidatesInput {
    rows: readonly PublicPageDiscoveryRow[];
    queries: ReadonlyArray<{
        id: string;
        text: string;
    }>;
    maxCandidates?: number;
    maxPerRegistrableDomain?: number;
}
const TOKEN_RE = /[a-z0-9]+/g;
function tokenize(value: string): Set<string> {
    const out = new Set<string>();
    for (const m of value.toLowerCase().matchAll(TOKEN_RE)) {
        out.add(m[0]);
    }
    return out;
}
function extractPathAndHost(canonical: string): {
    host: string;
    path: string;
} {
    try {
        const u = new URL(canonical);
        return { host: u.hostname, path: u.pathname };
    }
    catch {
        return { host: '', path: canonical };
    }
}
function relevance(row: PublicPageDiscoveryRow, queryTokens: Map<string, Set<string>>): number {
    const qTokens = queryTokens.get(row.queryId);
    if (!qTokens || qTokens.size === 0)
        return 0;
    const { host, path } = extractPathAndHost(row.canonicalUrl);
    const rowTokens = new Set<string>([
        ...tokenize(path),
        ...tokenize(host),
        ...tokenize(row.title),
    ]);
    let overlap = 0;
    for (const t of qTokens) {
        if (rowTokens.has(t))
            overlap += 1;
    }
    return overlap;
}
/**
 * Fold multiple discovery rows that point at the same canonical URL into a
 * single logical row that references every discovering query id.
 * The best (lowest organicPosition; earliest observedAt if tied) survives.
 */
export function dedupeByCanonical(rows: readonly PublicPageDiscoveryRow[]): Array<PublicPageDiscoveryRow & {
    discoveryQueryIds: string[];
}> {
    const grouped = new Map<string, {
        best: PublicPageDiscoveryRow;
        queryIds: string[];
    }>();
    for (const row of rows) {
        const key = row.canonicalUrl;
        const entry = grouped.get(key);
        if (!entry) {
            grouped.set(key, { best: row, queryIds: [row.queryId] });
            continue;
        }
        if (!entry.queryIds.includes(row.queryId))
            entry.queryIds.push(row.queryId);
        if (row.organicPosition < entry.best.organicPosition) {
            entry.best = row;
        }
    }
    return [...grouped.values()].map((entry) => ({
        ...entry.best,
        discoveryQueryIds: [...entry.queryIds].sort(),
    }));
}
/**
 * Collapse post-fetch source rows that share a content hash.
 * Same-hash syndicated copies count once and do NOT inflate
 * `independentDomainCount`.
 */
export function dedupeByContentHash<T extends {
    contentHash: string;
    canonicalUrl: string;
}>(sources: readonly T[]): T[] {
    const seen = new Map<string, T>();
    for (const s of sources) {
        if (!seen.has(s.contentHash))
            seen.set(s.contentHash, s);
    }
    return [...seen.values()];
}
interface Scored {
    row: PublicPageDiscoveryRow & {
        discoveryQueryIds: string[];
    };
    relevance: number;
    sourceType: PublicPageSourceHint;
    registrable: string;
}
function observedAtCompare(a: string | null, b: string | null): number {
    if (a === b)
        return 0;
    if (a === null)
        return 1;
    if (b === null)
        return -1;
    return a > b ? -1 : 1;
}
function tupleCompare(a: Scored, b: Scored): number {
    if (a.relevance !== b.relevance)
        return b.relevance - a.relevance;
    if (a.row.organicPosition !== b.row.organicPosition) {
        return a.row.organicPosition - b.row.organicPosition;
    }
    const rec = observedAtCompare(a.row.observedAt, b.row.observedAt);
    if (rec !== 0)
        return rec;
    return a.row.canonicalUrl < b.row.canonicalUrl ? -1 : 1;
}
export function selectCandidates(input: SelectCandidatesInput): Candidate[] {
    const maxCand = input.maxCandidates ?? MAX_CANDIDATES;
    const maxPerDomain = input.maxPerRegistrableDomain ?? MAX_PER_REGISTRABLE_DOMAIN;
    const queryTokens = new Map<string, Set<string>>();
    for (const q of input.queries)
        queryTokens.set(q.id, tokenize(q.text));
    const deduped = dedupeByCanonical(input.rows);
    const scored: Scored[] = deduped.map((row) => {
        const { host, path } = extractPathAndHost(row.canonicalUrl);
        return {
            row,
            relevance: relevance(row, queryTokens),
            sourceType: classifySourceType(host, path),
            registrable: registrableDomain(host),
        };
    });
    scored.sort(tupleCompare);
    // Round-robin across source types + registrable domains under a per-domain cap.
    const perDomainCount = new Map<string, number>();
    const remaining: Scored[] = [...scored];
    const picked: Scored[] = [];
    function tryPick(pred: (s: Scored) => boolean): boolean {
        for (let i = 0; i < remaining.length; i += 1) {
            const c = remaining[i]!;
            const used = perDomainCount.get(c.registrable) ?? 0;
            if (used >= maxPerDomain)
                continue;
            if (!pred(c))
                continue;
            picked.push(c);
            remaining.splice(i, 1);
            perDomainCount.set(c.registrable, used + 1);
            return true;
        }
        return false;
    }
    // Pass A: force ≥1 of each source type when available. typeOrder is unique
    // so no dead-code same-type guard is required.
    const typeOrder: readonly PublicPageSourceHint[] = [
        'forum',
        'review',
        'question',
        'comparison',
        'other',
    ];
    for (const t of typeOrder) {
        if (picked.length >= maxCand)
            break;
        tryPick((s) => s.sourceType === t);
    }
    // Pass B: fill by strict tuple order, honoring the per-domain cap.
    while (picked.length < maxCand && remaining.length > 0) {
        if (!tryPick(() => true))
            break;
    }
    return picked.map((s) => ({
        canonicalUrl: s.row.canonicalUrl,
        title: s.row.title,
        organicPosition: s.row.organicPosition,
        observedAt: s.row.observedAt,
        sourceType: s.sourceType,
        registrableDomain: s.registrable,
        discoveryQueryIds: s.row.discoveryQueryIds,
        providerHint: s.row.sourceTypeHint,
    }));
}
