/**
 * `serp_observations` repository.
 *
 * Owns the write + prune + read of the durable SERP-feature / top-100 store.
 * The rank processor calls `recordObservation` once per COMPLETED check; the
 * read surface calls `readLatestForKeywords` / `readHistoryForKeyword`.
 *
 * Nothing here talks to a vendor: every byte comes from the SERP payload the
 * rank check already fetched.
 */
import { and, asc, desc, eq, inArray, lt, notInArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../db/client.js";
import { SERP_OBSERVATION_MAX_PER_KEYWORD, SERP_OBSERVATION_RETENTION_DAYS, serpObservations, } from "../../db/schema/serp-observations.js";
import { RANKING_SOURCES, type RankingSource, type SerpTopResult, } from "../../db/schema/keywords.js";
import { MAX_PAA_QUESTIONS, MAX_STORED_TOP_RESULTS, SERP_FEATURE_TYPES, type SerpFeatureSnapshot, } from "../../shared/providers/index.js";
/** Empty snapshot — "checked, nothing observed". NEVER "absent on Google". */
export const EMPTY_SERP_FEATURE_SNAPSHOT: SerpFeatureSnapshot = {
    features: [],
    featuredSnippet: null,
    paa: [],
};
const featureSnapshotSchema = z.object({
    features: z.array(z.object({
        type: z.enum(SERP_FEATURE_TYPES),
        rankAbsolute: z.number().nullable(),
    })),
    featuredSnippet: z
        .object({
        domain: z.string().nullable(),
        url: z.string().nullable(),
        title: z.string().nullable(),
    })
        .nullable(),
    paa: z.array(z.object({
        question: z.string(),
        answerDomain: z.string().nullable(),
        answerUrl: z.string().nullable(),
    })),
});
const topResultsSchema = z.array(z.object({
    domain: z.string(),
    url: z.string(),
    rankGroup: z.number(),
    rankAbsolute: z.number(),
}));
const rankingSourceSchema = z.enum(RANKING_SOURCES);
/**
 * Clamp a snapshot to the stored bounds before it ever reaches Postgres
 * (SEC-BOUND). Dedupe is the adapter's job; this is defence in depth against
 * a hostile or drifted payload.
 */
export function clampFeatureSnapshot(input: SerpFeatureSnapshot): SerpFeatureSnapshot {
    return {
        features: input.features.slice(0, SERP_FEATURE_TYPES.length),
        featuredSnippet: input.featuredSnippet,
        paa: input.paa.slice(0, MAX_PAA_QUESTIONS),
    };
}
/** Clamp the stored organic set to the configured SERP depth. */
export function clampTopResults(rows: readonly SerpTopResult[]): SerpTopResult[] {
    return rows.slice(0, MAX_STORED_TOP_RESULTS);
}
export interface RecordObservationInput {
    accountId: string;
    siteId: string;
    keywordId: string;
    engine?: string;
    checkedAt: Date;
    source: RankingSource;
    features: SerpFeatureSnapshot;
    topResults: readonly SerpTopResult[];
}
export interface StoredObservation {
    id: string;
    keywordId: string;
    engine: string;
    checkedAt: Date;
    source: RankingSource;
    features: SerpFeatureSnapshot;
    topResults: SerpTopResult[];
}
function parseRow(row: {
    id: string;
    keywordId: string;
    engine: string;
    checkedAt: Date;
    source: string;
    features: unknown;
    topResults: unknown;
}): StoredObservation {
    const features = featureSnapshotSchema.safeParse(row.features);
    const topResults = topResultsSchema.safeParse(row.topResults);
    const source = rankingSourceSchema.safeParse(row.source);
    return {
        id: row.id,
        keywordId: row.keywordId,
        engine: row.engine,
        checkedAt: row.checkedAt,
        // Source is storage-only on this read surface, but still crosses the SQL
        // trust boundary. A drifted value must not escape via a type assertion.
        source: source.success ? source.data : "fresh",
        // A drifted/tampered jsonb payload degrades to "nothing observed" rather
        // than throwing — the same stale-shape policy the SERP cache uses.
        features: features.success ? features.data : EMPTY_SERP_FEATURE_SNAPSHOT,
        topResults: topResults.success ? topResults.data : [],
    };
}
/**
 * Insert one observation (idempotent per `(keywordId, engine, checkedAt)`)
 * and prune the keyword's history back inside both bounds.
 */
export async function recordObservation(db: Db, input: RecordObservationInput, now: Date): Promise<{
    inserted: boolean;
}> {
    const engine = input.engine ?? "google";
    const rows = await db
        .insert(serpObservations)
        .values({
        accountId: input.accountId,
        siteId: input.siteId,
        keywordId: input.keywordId,
        engine,
        checkedAt: input.checkedAt,
        source: input.source,
        features: clampFeatureSnapshot(input.features),
        topResults: clampTopResults(input.topResults),
    })
        .onConflictDoNothing({
        target: [
            serpObservations.keywordId,
            serpObservations.engine,
            serpObservations.checkedAt,
        ],
    })
        .returning({ id: serpObservations.id });
    const inserted = rows.length > 0;
    if (inserted) {
        await pruneObservations(db, input.keywordId, engine, now);
    }
    return { inserted };
}
/**
 * Enforce the retention window AND the newest-N row bound for one
 * (keyword, engine) pair. Both arms run on every insert so a long-lived
 * daily keyword can never grow unbounded.
 */
export async function pruneObservations(db: Db, keywordId: string, engine: string, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - SERP_OBSERVATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const expired = await db
        .delete(serpObservations)
        .where(and(eq(serpObservations.keywordId, keywordId), eq(serpObservations.engine, engine), lt(serpObservations.checkedAt, cutoff)))
        .returning({ id: serpObservations.id });
    const keep = await db
        .select({ id: serpObservations.id })
        .from(serpObservations)
        .where(and(eq(serpObservations.keywordId, keywordId), eq(serpObservations.engine, engine)))
        .orderBy(desc(serpObservations.checkedAt))
        .limit(SERP_OBSERVATION_MAX_PER_KEYWORD);
    const keepIds = keep.map((row) => row.id);
    // On the insert path `keep` always has at least the row just written, but
    // `pruneObservations` is exported and can be called for a keyword with no
    // surviving rows (e.g. every row expired). Guarding keeps `notInArray` from
    // emitting an empty-list predicate. Covered directly, not ignored.
    if (keepIds.length === 0)
        return expired.length;
    const overflow = await db
        .delete(serpObservations)
        .where(and(eq(serpObservations.keywordId, keywordId), eq(serpObservations.engine, engine), notInArray(serpObservations.id, keepIds)))
        .returning({ id: serpObservations.id });
    return expired.length + overflow.length;
}
/**
 * Newest observation per keyword for a site. One query, ordered newest-first;
 * the first row seen per keyword wins (Postgres DISTINCT ON would be tighter
 * but Drizzle has no portable builder for it, and the per-keyword row bound
 * keeps the scanned set small).
 */
export async function readLatestForKeywords(db: Db, siteId: string, keywordIds: readonly string[]): Promise<Map<string, StoredObservation>> {
    const out = new Map<string, StoredObservation>();
    if (keywordIds.length === 0)
        return out;
    const rows = await db
        .select()
        .from(serpObservations)
        .where(and(eq(serpObservations.siteId, siteId), inArray(serpObservations.keywordId, [...keywordIds])))
        .orderBy(desc(serpObservations.checkedAt));
    for (const row of rows) {
        if (out.has(row.keywordId))
            continue;
        out.set(row.keywordId, parseRow(row));
    }
    return out;
}
/** Full stored history for one keyword, oldest-first (chart order). */
export async function readHistoryForKeyword(db: Db, keywordId: string): Promise<StoredObservation[]> {
    const rows = await db
        .select()
        .from(serpObservations)
        .where(eq(serpObservations.keywordId, keywordId))
        .orderBy(asc(serpObservations.checkedAt))
        .limit(SERP_OBSERVATION_MAX_PER_KEYWORD);
    return rows.map(parseRow);
}
