/**
 * Content inventory — deterministic topic + similarity analysis.
 *
 * Fully explainable, allocation-bounded, and reproducible: same inputs → same
 * findings. NO AI is required for any finding here (the optional
 * `opportunity_explanation` pass runs separately in the processor and never
 * changes these results).
 *
 * Security posture (SEC-INJECT / ReDoS): every string fed to tokenization is
 * length-capped BEFORE any split, tokenization uses a single FIXED character
 * class (never a regex built from crawled content), and per-page term sets are
 * bounded (`maxTermsPerPage`). The pairwise comparison is a linear scan.
 *
 * Evidence posture: cannibalization + gap confidence is LOWERED
 * when GSC / rank evidence is absent, and NO finding is produced from keyword
 * density alone — a cannibalization candidate always requires a shared QUERY
 * (a tracked target query, a GSC query, or a rank keyword), never mere
 * term-frequency overlap (that drives clustering, not cannibalization).
 */
import { buildCannibalizationCandidates } from '../../shared/cannibalization/index.js';
import { INVENTORY_SCHEMA_VERSION, INVENTORY_THRESHOLDS, type CannibalizationCandidate, type DuplicateGroup, type FlaggedPage, type InventoryConfidence, type InventoryFindings, type InventoryPageFacts, type InventoryThresholds, type TopicCluster, type TopicalGap, } from './inventory.schemas.js';
// A single FIXED split class — never derived from crawled content (SEC-INJECT).
const TERM_SPLIT = /[^a-z0-9]+/;
export interface GscQueryEvidence {
    query: string;
    impressions: number;
    clicks: number;
    position: number;
}
export interface RankEvidence {
    url: string;
    position: number;
}
export interface InventoryEvidence {
    /** Normalized page URL → GSC query rows for that page. */
    gscByUrl: Map<string, GscQueryEvidence[]>;
    /** Normalized query → owned page URLs ranking for it (from rank tracking). */
    rankByQuery: Map<string, RankEvidence[]>;
    /** Tracked target queries (keyword catalog) for gap detection. */
    trackedQueries: string[];
}
export function emptyEvidence(): InventoryEvidence {
    return { gscByUrl: new Map(), rankByQuery: new Map(), trackedQueries: [] };
}
/** Canonical URL key for cross-referencing links / evidence to pages. */
export function normalizeUrlKey(raw: string): string {
    let parsed: URL;
    try {
        parsed = new URL(raw);
    }
    catch {
        return raw.trim().toLowerCase();
    }
    let path = parsed.pathname;
    if (path.length > 1 && path.endsWith('/'))
        path = path.slice(0, -1);
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`.toLowerCase();
}
/** Lowercase + whitespace-collapse a query, bounded (no unbounded regex). */
export function normalizeQuery(raw: string): string {
    return raw.slice(0, 400).trim().toLowerCase().split(TERM_SPLIT).filter(Boolean).join(' ');
}
function tokenize(strings: Array<string | null>, thresholds: InventoryThresholds): Set<string> {
    const terms = new Set<string>();
    for (const s of strings) {
        if (!s)
            continue;
        const capped = s.slice(0, thresholds.maxTokenizedChars).toLowerCase();
        for (const raw of capped.split(TERM_SPLIT)) {
            if (raw.length < 3)
                continue;
            terms.add(raw);
            if (terms.size >= thresholds.maxTermsPerPage)
                return terms;
        }
    }
    return terms;
}
function jaccard(a: Set<string>, b: Set<string>): number {
    // Both-empty is the only way `union` could be 0; handle it up front so the
    // division below never divides by zero (no dead guard branch remains).
    if (a.size === 0 && b.size === 0)
        return 0;
    let intersection = 0;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const term of small) {
        if (large.has(term))
            intersection += 1;
    }
    return intersection / (a.size + b.size - intersection);
}
/** Union-find over page indices (recursive find + path compression). */
class DisjointSet {
    private readonly parent: number[];
    constructor(size: number) {
        this.parent = Array.from({ length: size }, (_, i) => i);
    }
    find(x: number): number {
        if (this.parent[x] === x)
            return x;
        const root = this.find(this.parent[x]!);
        this.parent[x] = root;
        return root;
    }
    union(a: number, b: number): void {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra !== rb)
            this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
}
interface PageIndex {
    facts: InventoryPageFacts;
    key: string;
    terms: Set<string>;
    titleTerms: Set<string>;
    headingTerms: Set<string>;
    queries: Set<string>;
}
function indexPages(pages: InventoryPageFacts[], thresholds: InventoryThresholds): PageIndex[] {
    return pages.map((facts) => ({
        facts,
        key: normalizeUrlKey(facts.url),
        terms: tokenize([facts.title, ...facts.headings, ...facts.primaryTopics, ...facts.secondaryTopics], thresholds),
        titleTerms: tokenize([facts.title], thresholds),
        headingTerms: tokenize(facts.headings, thresholds),
        queries: new Set(facts.targetQueries.map(normalizeQuery).filter(Boolean)),
    }));
}
function buildClusters(indexed: PageIndex[], thresholds: InventoryThresholds): TopicCluster[] {
    const ds = new DisjointSet(indexed.length);
    for (let i = 0; i < indexed.length; i += 1) {
        for (let j = i + 1; j < indexed.length; j += 1) {
            if (jaccard(indexed[i]!.terms, indexed[j]!.terms) >= thresholds.clusterJaccard) {
                ds.union(i, j);
            }
        }
    }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < indexed.length; i += 1) {
        const root = ds.find(i);
        const list = groups.get(root) ?? [];
        list.push(i);
        groups.set(root, list);
    }
    const clusters: TopicCluster[] = [];
    for (const [root, members] of groups) {
        if (members.length < 2)
            continue;
        const urls = members.map((i) => indexed[i]!.facts.url).sort();
        // Shared terms = intersection across all members (bounded, deterministic).
        // `members.length >= 2` guarantees a first element, so the accumulator is
        // never null — no dead fallback branch.
        const [first, ...rest] = members;
        const shared = new Set(indexed[first!]!.terms);
        for (const i of rest) {
            const terms = indexed[i]!.terms;
            for (const t of [...shared])
                if (!terms.has(t))
                    shared.delete(t);
        }
        const sharedTerms = [...shared].sort().slice(0, 40);
        clusters.push({
            id: `cluster-${root}`,
            label: sharedTerms[0] ?? urls[0]!,
            urls,
            sharedTerms,
        });
    }
    return clusters.sort((a, b) => a.id.localeCompare(b.id));
}
function buildDuplicates(indexed: PageIndex[], thresholds: InventoryThresholds): DuplicateGroup[] {
    const duplicates: DuplicateGroup[] = [];
    // Exact duplicates — identical content hash.
    const byHash = new Map<string, string[]>();
    for (const page of indexed) {
        const list = byHash.get(page.facts.contentHash) ?? [];
        list.push(page.facts.url);
        byHash.set(page.facts.contentHash, list);
    }
    let exactSeq = 0;
    const exactUrls = new Set<string>();
    for (const [, urls] of byHash) {
        if (urls.length < 2)
            continue;
        const sorted = [...urls].sort();
        for (const u of sorted)
            exactUrls.add(u);
        duplicates.push({
            id: `dup-exact-${exactSeq}`,
            kind: 'exact',
            field: 'content',
            urls: sorted,
            similarity: 1,
        });
        exactSeq += 1;
    }
    // Near duplicates — high title/heading similarity but NOT exact-content.
    let nearSeq = 0;
    for (let i = 0; i < indexed.length; i += 1) {
        for (let j = i + 1; j < indexed.length; j += 1) {
            const a = indexed[i]!;
            const b = indexed[j]!;
            if (a.facts.contentHash === b.facts.contentHash)
                continue;
            const titleSim = jaccard(a.titleTerms, b.titleTerms);
            const headingSim = jaccard(a.headingTerms, b.headingTerms);
            const field = titleSim >= headingSim ? 'title' : 'headings';
            const similarity = Math.max(titleSim, headingSim);
            if (similarity >= thresholds.nearDuplicateJaccard) {
                duplicates.push({
                    id: `dup-near-${nearSeq}`,
                    kind: 'near',
                    field,
                    urls: [a.facts.url, b.facts.url].sort(),
                    similarity,
                });
                nearSeq += 1;
            }
        }
    }
    return duplicates;
}
function buildThinAndOrphans(indexed: PageIndex[], thresholds: InventoryThresholds): {
    thinPages: FlaggedPage[];
    orphanPages: FlaggedPage[];
} {
    const inbound = buildInventoryInboundCounts(indexed.map((page) => page.facts));
    const thinPages: FlaggedPage[] = [];
    const orphanPages: FlaggedPage[] = [];
    indexed.forEach((page) => {
        const inb = inbound.get(page.key)!;
        if (page.facts.wordCount < thresholds.thinWordCount) {
            thinPages.push({
                url: page.facts.url,
                reason: 'thin',
                wordCount: page.facts.wordCount,
                internalLinkCount: inb,
            });
        }
        if (inb <= thresholds.orphanInboundLinks) {
            orphanPages.push({
                url: page.facts.url,
                reason: 'orphan',
                wordCount: page.facts.wordCount,
                internalLinkCount: inb,
            });
        }
        else if (inb <= thresholds.weakInboundLinks) {
            orphanPages.push({
                url: page.facts.url,
                reason: 'weakly_linked',
                wordCount: page.facts.wordCount,
                internalLinkCount: inb,
            });
        }
    });
    return {
        thinPages: thinPages.sort((a, b) => a.url.localeCompare(b.url)),
        orphanPages: orphanPages.sort((a, b) => a.url.localeCompare(b.url)),
    };
}
/**
 * Canonical content-inventory in-link graph.
 *
 * One source page contributes at most one inbound edge to a target, even when
 * its stored out-link list repeats the URL. Self-links and links to pages that
 * are not present in the supplied inventory are ignored. `buildThinAndOrphans`
 * calls this exported helper so downstream guidance can reuse the exact same
 * graph authority instead of reimplementing the thresholds.
 */
export function buildInventoryInboundCounts(pages: readonly InventoryPageFacts[]): Map<string, number> {
    const inventoryKeys = new Set(pages.map((page) => normalizeUrlKey(page.url)));
    const inbound = new Map<string, number>([...inventoryKeys].map((key) => [key, 0]));
    for (const page of pages) {
        const sourceKey = normalizeUrlKey(page.url);
        const seenTargets = new Set<string>();
        for (const link of page.internalOutLinks) {
            const targetKey = normalizeUrlKey(link);
            if (targetKey === sourceKey ||
                !inventoryKeys.has(targetKey) ||
                seenTargets.has(targetKey)) {
                continue;
            }
            seenTargets.add(targetKey);
            inbound.set(targetKey, inbound.get(targetKey)! + 1);
        }
    }
    return inbound;
}
/** All queries a page is associated with (targets + GSC + rank), normalized. */
function queriesForPages(indexed: PageIndex[], evidence: InventoryEvidence): Map<string, {
    urls: Set<string>;
    gscUrls: Set<string>;
    rankUrls: Set<string>;
}> {
    const byQuery = new Map<string, {
        urls: Set<string>;
        gscUrls: Set<string>;
        rankUrls: Set<string>;
    }>();
    const ensure = (q: string) => {
        let entry = byQuery.get(q);
        if (!entry) {
            entry = { urls: new Set(), gscUrls: new Set(), rankUrls: new Set() };
            byQuery.set(q, entry);
        }
        return entry;
    };
    const inventoryKeys = new Set(indexed.map((p) => p.key));
    for (const page of indexed) {
        for (const q of page.queries)
            ensure(q).urls.add(page.facts.url);
        const gscRows = evidence.gscByUrl.get(page.key);
        if (gscRows) {
            for (const row of gscRows) {
                const q = normalizeQuery(row.query);
                if (!q)
                    continue;
                const entry = ensure(q);
                entry.urls.add(page.facts.url);
                if (row.impressions > 0)
                    entry.gscUrls.add(page.facts.url);
            }
        }
    }
    for (const [rawQuery, rows] of evidence.rankByQuery) {
        const q = normalizeQuery(rawQuery);
        if (!q)
            continue;
        for (const row of rows) {
            const key = normalizeUrlKey(row.url);
            if (!inventoryKeys.has(key))
                continue;
            const entry = ensure(q);
            entry.urls.add(row.url);
            entry.rankUrls.add(row.url);
        }
    }
    return byQuery;
}
/**
 * Group the portfolio's queries, then hand them to the ONE shared scoring
 * authority (`shared/cannibalization/`). The grading rules live there so the
 * cannibalization report and this inventory can never drift apart.
 */
function buildCannibalization(indexed: PageIndex[], evidence: InventoryEvidence): CannibalizationCandidate[] {
    return buildCannibalizationCandidates(queriesForPages(indexed, evidence));
}
function buildGaps(indexed: PageIndex[], evidence: InventoryEvidence): TopicalGap[] {
    const covered = new Set<string>();
    for (const page of indexed) {
        for (const q of page.queries)
            covered.add(q);
        const gscRows = evidence.gscByUrl.get(page.key);
        if (gscRows)
            for (const row of gscRows)
                covered.add(normalizeQuery(row.query));
    }
    const inventoryKeys = new Set(indexed.map((p) => p.key));
    for (const [rawQuery, rows] of evidence.rankByQuery) {
        if (rows.some((r) => inventoryKeys.has(normalizeUrlKey(r.url)))) {
            covered.add(normalizeQuery(rawQuery));
        }
    }
    // Demand catalog: tracked queries + any GSC query with impressions.
    const demand = new Map<string, {
        gsc: boolean;
        rank: boolean;
    }>();
    const mark = (q: string, kind: 'gsc' | 'rank' | 'tracked') => {
        const norm = normalizeQuery(q);
        if (!norm)
            return;
        const entry = demand.get(norm) ?? { gsc: false, rank: false };
        if (kind === 'gsc')
            entry.gsc = true;
        if (kind === 'rank')
            entry.rank = true;
        demand.set(norm, entry);
    };
    for (const q of evidence.trackedQueries)
        mark(q, 'tracked');
    for (const rows of evidence.gscByUrl.values()) {
        for (const row of rows)
            if (row.impressions > 0)
                mark(row.query, 'gsc');
    }
    for (const q of evidence.rankByQuery.keys())
        mark(q, 'rank');
    const gaps: TopicalGap[] = [];
    let seq = 0;
    for (const [query, signals] of [...demand].sort((a, b) => a[0].localeCompare(b[0]))) {
        if (covered.has(query))
            continue;
        let confidence: InventoryConfidence;
        const evidenceSourceIds: string[] = [];
        if (signals.gsc) {
            confidence = 'high';
            evidenceSourceIds.push(`gsc-demand:${query}`);
        }
        else if (signals.rank) {
            confidence = 'medium';
            evidenceSourceIds.push(`rank-demand:${query}`);
        }
        else {
            confidence = 'low';
            evidenceSourceIds.push(`tracked:${query}`);
        }
        gaps.push({ id: `gap-${seq}`, query, confidence, evidenceSourceIds });
        seq += 1;
    }
    return gaps;
}
/**
 * Analyze the crawled portfolio. Pure + deterministic — the returned findings
 * validate against `inventoryFindingsSchema`.
 */
export function analyzeInventory(pages: InventoryPageFacts[], evidence: InventoryEvidence, thresholds: InventoryThresholds = INVENTORY_THRESHOLDS): InventoryFindings {
    const indexed = indexPages(pages, thresholds);
    const { thinPages, orphanPages } = buildThinAndOrphans(indexed, thresholds);
    return {
        version: INVENTORY_SCHEMA_VERSION,
        thresholdsVersion: thresholds.version,
        clusters: buildClusters(indexed, thresholds),
        duplicates: buildDuplicates(indexed, thresholds),
        thinPages,
        orphanPages,
        cannibalization: buildCannibalization(indexed, evidence),
        gaps: buildGaps(indexed, evidence),
        opportunityExplanation: null,
    };
}
