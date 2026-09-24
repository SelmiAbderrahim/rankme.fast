/**
 * Competitor content intelligence — deterministic evidence loader.
 *
 * Reads the account's already-collected DataForSEO competitor evidence for one
 * site — the `competitors` snapshot rows and the `competitor_intersections`
 * gap-analysis cache the competitors module already persisted — and normalizes
 * them into per-competitor-domain shared "like intent" queries + demand
 * evidence. NO vendor call happens here (management alone spends no Firecrawl
 * credits); the loader only reads Postgres rows the platform
 * already has. When no evidence exists the maps stay empty and the deterministic
 * comparison downgrades confidence on its own.
 *
 * The competitors module is consumed READ-ONLY through its Postgres tables (via
 * the shared schema barrel) — never by reaching into its service internals.
 * The `keywords` jsonb is parsed with a lenient, bounded zod schema so a shape
 * drift degrades to "no evidence" rather than throwing.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { competitorIntersections, competitors, } from '../../db/schema/index.js';
/** Bounded shared-query + demand evidence for one competitor domain. */
export interface CompetitorDomainEvidence {
    /** Distinct intersecting queries (owned ↔ competitor), bounded. */
    sharedQueries: string[];
    /** Demand queries with search volume for target-keyword opportunities. */
    demandQueries: Array<{
        query: string;
        searchVolume: number | null;
    }>;
    /** True when a `competitors` snapshot row backs this domain. */
    hasSnapshot: boolean;
}
export type CompetitorEvidenceMap = Map<string, CompetitorDomainEvidence>;
const MAX_QUERIES_PER_DOMAIN = 50;
// Lenient — the competitors module stores `DomainIntersectionRow[]`
// (`{ keyword, target1Position, target2Position, searchVolume }`), but parse
// defensively so a future shape drift degrades to "no evidence".
const intersectionRowSchema = z
    .object({
    keyword: z.string().min(1).max(400),
    searchVolume: z.number().nullable().optional(),
})
    .passthrough();
function emptyEvidence(): CompetitorDomainEvidence {
    return { sharedQueries: [], demandQueries: [], hasSnapshot: false };
}
export interface LoadCompetitorEvidenceInput {
    siteId: string;
    domains: readonly string[];
}
/**
 * Load per-domain shared-query + demand evidence for a site's competitor set.
 * Deterministic and side-effect-free.
 */
export async function loadCompetitorEvidence(db: ApplicationDb, input: LoadCompetitorEvidenceInput): Promise<CompetitorEvidenceMap> {
    const map: CompetitorEvidenceMap = new Map();
    const domains = [...new Set(input.domains.map((d) => d.toLowerCase()))];
    for (const domain of domains)
        map.set(domain, emptyEvidence());
    if (domains.length === 0)
        return map;
    // Which domains have a DataForSEO competitor snapshot (evidence exists).
    const snapshotRows = await db
        .select({ competitorDomain: competitors.competitorDomain })
        .from(competitors)
        .where(and(eq(competitors.siteId, input.siteId), inArray(competitors.competitorDomain, domains)));
    for (const row of snapshotRows) {
        // The `inArray(competitorDomain, domains)` filter guarantees every returned
        // domain is one of the lowercased map keys, so the lookup always hits.
        map.get(row.competitorDomain.toLowerCase())!.hasSnapshot = true;
    }
    // Latest intersection row per domain → shared + demand queries.
    for (const domain of domains) {
        const rows = await db
            .select({ keywords: competitorIntersections.keywords })
            .from(competitorIntersections)
            .where(and(eq(competitorIntersections.siteId, input.siteId), eq(competitorIntersections.competitorDomain, domain)))
            .orderBy(desc(competitorIntersections.fetchedAt))
            .limit(1);
        const raw = rows[0]?.keywords;
        if (!Array.isArray(raw))
            continue;
        const entry = map.get(domain)!;
        const seen = new Set<string>();
        for (const item of raw) {
            const parsed = intersectionRowSchema.safeParse(item);
            if (!parsed.success)
                continue;
            const query = parsed.data.keyword.trim();
            if (query.length === 0 || seen.has(query.toLowerCase()))
                continue;
            seen.add(query.toLowerCase());
            entry.sharedQueries.push(query);
            entry.demandQueries.push({ query, searchVolume: parsed.data.searchVolume ?? null });
            if (entry.sharedQueries.length >= MAX_QUERIES_PER_DOMAIN)
                break;
        }
    }
    return map;
}
