import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { aiCompetitorMentions, aiMentionSnapshots, aiPromptSuggestionRuns, aiTrackedPrompts, competitors, gscSearchAnalytics, keywords, parseAiPromptSuggestionSeeds, parseAiPromptSuggestionSet, rankings, type AiPromptSuggestionSeeds, type AiPromptSuggestionSet, type NewAiCompetitorMentionRow, type NewAiMentionSnapshotRow, } from '../../db/schema/index.js';
import { Site } from '../sites/index.js';
import type { SupportedLocale } from '../../shared/i18n/locales.js';
export const MAX_TRACKED_AI_PROMPTS = 10;
export class PromptCapReachedError extends Error {
    constructor() {
        super('ai visibility tracked prompt cap reached');
    }
}
export interface TrackedPrompt {
    id: string;
    prompt: string;
    createdAt: string;
}
export async function listTrackedPrompts(db: Db, input: {
    accountId: string;
    siteId: string;
}): Promise<TrackedPrompt[]> {
    const rows = await db
        .select()
        .from(aiTrackedPrompts)
        .where(and(eq(aiTrackedPrompts.accountId, input.accountId), eq(aiTrackedPrompts.siteId, input.siteId)))
        .orderBy(desc(aiTrackedPrompts.createdAt));
    return rows.map((row) => ({
        id: row.id,
        prompt: row.prompt,
        createdAt: row.createdAt.toISOString(),
    }));
}
export async function addTrackedPrompt(db: Db, input: {
    accountId: string;
    siteId: string;
    prompt: string;
}): Promise<TrackedPrompt> {
    const existing = await listTrackedPrompts(db, input);
    const normalized = input.prompt.trim();
    const duplicate = existing.find((row) => row.prompt.toLowerCase() === normalized.toLowerCase());
    if (duplicate)
        return duplicate;
    if (existing.length >= MAX_TRACKED_AI_PROMPTS)
        throw new PromptCapReachedError();
    const rows = await db
        .insert(aiTrackedPrompts)
        .values({
        accountId: input.accountId,
        siteId: input.siteId,
        prompt: normalized,
    })
        .onConflictDoNothing({
        target: [aiTrackedPrompts.siteId, aiTrackedPrompts.prompt],
    })
        .returning();
    const row = rows[0];
    if (!row) {
        const [after] = await listTrackedPrompts(db, input);
        if (after)
            return after;
        throw new Error('tracked prompt insert failed');
    }
    return { id: row.id, prompt: row.prompt, createdAt: row.createdAt.toISOString() };
}
export async function removeTrackedPrompt(db: Db, input: {
    accountId: string;
    siteId: string;
    promptId: string;
}): Promise<boolean> {
    const rows = await db
        .delete(aiTrackedPrompts)
        .where(and(eq(aiTrackedPrompts.id, input.promptId), eq(aiTrackedPrompts.accountId, input.accountId), eq(aiTrackedPrompts.siteId, input.siteId)))
        .returning({ id: aiTrackedPrompts.id });
    return rows.length > 0;
}
export async function upsertMentionSnapshot(db: Db, input: NewAiMentionSnapshotRow): Promise<void> {
    await db.insert(aiMentionSnapshots).values(input);
}
export async function upsertCompetitorMentions(db: Db, rows: NewAiCompetitorMentionRow[]): Promise<void> {
    if (rows.length === 0)
        return;
    await db.insert(aiCompetitorMentions).values(rows);
}
export async function readRecentMentions(db: Db, input: {
    accountId?: string;
    siteId: string;
    since: Date;
}) {
    return db
        .select()
        .from(aiMentionSnapshots)
        .where(and(eq(aiMentionSnapshots.siteId, input.siteId), gte(aiMentionSnapshots.checkedAt, input.since), ...(input.accountId ? [eq(aiMentionSnapshots.accountId, input.accountId)] : [])))
        .orderBy(desc(aiMentionSnapshots.checkedAt));
}
export async function readRecentCompetitorMentions(db: Db, input: {
    accountId?: string;
    siteId: string;
    since: Date;
}) {
    return db
        .select()
        .from(aiCompetitorMentions)
        .where(and(eq(aiCompetitorMentions.siteId, input.siteId), gte(aiCompetitorMentions.checkedAt, input.since), ...(input.accountId ? [eq(aiCompetitorMentions.accountId, input.accountId)] : [])))
        .orderBy(desc(aiCompetitorMentions.checkedAt));
}
export async function listStoredCompetitorDomains(db: Db, input: {
    accountId: string;
    siteId: string;
    limit?: number;
}): Promise<string[]> {
    const rows = await db
        .select({ domain: competitors.competitorDomain })
        .from(competitors)
        .where(and(eq(competitors.accountId, input.accountId), eq(competitors.siteId, input.siteId)))
        .orderBy(desc(competitors.fetchedAt))
        .limit(input.limit ?? 20);
    return Array.from(new Set(rows.map((row) => row.domain.toLowerCase())));
}
export async function listKeywordPhrases(db: Db, input: {
    accountId: string;
    siteId: string;
    limit?: number;
}): Promise<string[]> {
    const rows = await db
        .select({ phrase: keywords.phrase })
        .from(keywords)
        .where(and(eq(keywords.accountId, input.accountId), eq(keywords.siteId, input.siteId), eq(keywords.active, true)))
        .orderBy(desc(keywords.createdAt))
        .limit(input.limit ?? 25);
    return rows.map((row) => row.phrase);
}
/**
 * Real Google Search Console queries for one owned site, best-performing
 * first. The highest-signal seed available for prompt suggestion and free —
 * the rows are already stored by the daily GSC snapshot, so reading them costs
 * no vendor call.
 *
 * Filters on BOTH `accountId` and `siteId`, matching `listKeywordPhrases` and
 * `listStoredCompetitorDomains` above. The `gsc-snapshots` module's own
 * `readSearchAnalytics` filters on `siteId` alone, so it must NOT be used
 * here: the site is owner-checked upstream, but a repository read that can
 * cross accounts on its own is one refactor away from leaking.
 *
 * `dimensionSet` is pinned to the query-only rollup because `query,page` rows
 * repeat each query once per landing page, which would crowd out distinct
 * queries under the seed cap.
 */
export async function listGscQuerySeeds(db: Db, input: {
    accountId: string;
    siteId: string;
    limit?: number;
}): Promise<string[]> {
    const site = await Site.findOne({
        _id: input.siteId,
        accountId: input.accountId,
        deletionStartedAt: null,
    })
        .select('gscPropertyUrl gscBindingGenerationId')
        .lean();
    if (!site?.gscPropertyUrl)
        return [];
    const bindingGenerationId = site.gscBindingGenerationId ?? 'legacy';
    const rows = await db
        .select({
        query: gscSearchAnalytics.dimensionKey,
        clicks: gscSearchAnalytics.clicks,
        impressions: gscSearchAnalytics.impressions,
    })
        .from(gscSearchAnalytics)
        .where(and(eq(gscSearchAnalytics.accountId, input.accountId), eq(gscSearchAnalytics.siteId, input.siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId), eq(gscSearchAnalytics.dimensionSet, 'query')))
        .orderBy(desc(gscSearchAnalytics.clicks), desc(gscSearchAnalytics.impressions))
        .limit((input.limit ?? 15) * 4);
    const seen = new Set<string>();
    const queries: string[] = [];
    for (const row of rows) {
        const query = row.query.trim();
        const key = query.toLowerCase();
        if (!query || query.length > 200 || seen.has(key))
            continue;
        seen.add(key);
        queries.push(query);
        if (queries.length >= (input.limit ?? 15))
            break;
    }
    return queries;
}
/**
 * Newest stored suggestion run for one owned site, or `null` when the account
 * has never generated. That null IS the "never generated" signal the panel
 * uses to distinguish an untouched tab from a run that produced nothing.
 */
export async function readLatestSuggestionRun(db: Db, input: {
    accountId: string;
    siteId: string;
    outputLocale: SupportedLocale;
}): Promise<{
    generatedAt: Date;
    prompts: AiPromptSuggestionSet;
    outputLocale: SupportedLocale;
} | null> {
    const rows = await db
        .select({
        generatedAt: aiPromptSuggestionRuns.generatedAt,
        prompts: aiPromptSuggestionRuns.prompts,
        outputLocale: aiPromptSuggestionRuns.outputLocale,
    })
        .from(aiPromptSuggestionRuns)
        .where(and(eq(aiPromptSuggestionRuns.accountId, input.accountId), eq(aiPromptSuggestionRuns.siteId, input.siteId), eq(aiPromptSuggestionRuns.outputLocale, input.outputLocale)))
        .orderBy(desc(aiPromptSuggestionRuns.generatedAt))
        .limit(1);
    const row = rows[0];
    if (!row)
        return null;
    return {
        generatedAt: row.generatedAt,
        prompts: parseAiPromptSuggestionSet(row.prompts),
        outputLocale: row.outputLocale,
    };
}
/**
 * Append one settled suggestion run. Append-only on purpose: a generation that
 * fails after the AI call writes nothing, so the account's previous good set
 * survives — an upsert would clobber it.
 */
export async function insertSuggestionRun(db: Db, input: {
    id: string;
    accountId: string;
    siteId: string;
    outputLocale: SupportedLocale;
    prompts: AiPromptSuggestionSet;
    seeds: AiPromptSuggestionSeeds;
    generator: 'ai' | 'template';
    model: string | null;
    generatedAt: Date;
}): Promise<void> {
    await db.insert(aiPromptSuggestionRuns).values({
        id: input.id,
        accountId: input.accountId,
        siteId: input.siteId,
        outputLocale: input.outputLocale,
        generatedAt: input.generatedAt,
        prompts: parseAiPromptSuggestionSet(input.prompts),
        seeds: parseAiPromptSuggestionSeeds(input.seeds),
        generator: input.generator,
        model: input.model,
    });
}
export interface MentionDailyBucket {
    day: string;
    mentioned: number;
    total: number;
}
/**
 * Brand mention rows bucketed per UTC day — feeds the trend endpoint. The
 * `(site_id, checked_at)` index serves the range scan; grouping stays in SQL
 * so a long window never streams raw rows into the process.
 */
export async function readMentionDailyBuckets(db: Db, input: {
    accountId: string;
    siteId: string;
    since: Date;
}): Promise<MentionDailyBucket[]> {
    const day = sql<string> `to_char(date_trunc('day', ${aiMentionSnapshots.checkedAt}), 'YYYY-MM-DD')`;
    return db
        .select({
        day,
        mentioned: sql<number> `sum(case when ${aiMentionSnapshots.mentioned} then 1 else 0 end)::int`,
        total: sql<number> `count(*)::int`,
    })
        .from(aiMentionSnapshots)
        .where(and(eq(aiMentionSnapshots.accountId, input.accountId), eq(aiMentionSnapshots.siteId, input.siteId), gte(aiMentionSnapshots.checkedAt, input.since)))
        .groupBy(day)
        .orderBy(day);
}
export async function readCompetitorDailyBuckets(db: Db, input: {
    accountId: string;
    siteId: string;
    since: Date;
}): Promise<Array<{
    day: string;
    mentioned: number;
}>> {
    const day = sql<string> `to_char(date_trunc('day', ${aiCompetitorMentions.checkedAt}), 'YYYY-MM-DD')`;
    return db
        .select({
        day,
        mentioned: sql<number> `sum(case when ${aiCompetitorMentions.mentioned} then 1 else 0 end)::int`,
    })
        .from(aiCompetitorMentions)
        .where(and(eq(aiCompetitorMentions.accountId, input.accountId), eq(aiCompetitorMentions.siteId, input.siteId), gte(aiCompetitorMentions.checkedAt, input.since)))
        .groupBy(day)
        .orderBy(day);
}
export async function readAiOverviewRollup(db: Db, input: {
    accountId: string;
    siteId: string;
    since: Date;
}): Promise<{
    citedCount: number;
    totalChecked: number;
}> {
    const keywordRows = await db
        .select({ id: keywords.id })
        .from(keywords)
        .where(and(eq(keywords.accountId, input.accountId), eq(keywords.siteId, input.siteId), eq(keywords.active, true)));
    const ids = keywordRows.map((row) => row.id);
    if (ids.length === 0)
        return { citedCount: 0, totalChecked: 0 };
    const rows = await db
        .select({
        totalChecked: sql<number> `count(*)::int`,
        citedCount: sql<number> `sum(case when ${rankings.aiCited} = true then 1 else 0 end)::int`,
    })
        .from(rankings)
        .where(and(inArray(rankings.keywordId, ids), gte(rankings.checkedAt, input.since), sql `${rankings.aiOverviewPresent} is not null`));
    return {
        citedCount: Number(rows[0]?.citedCount ?? 0),
        /* c8 ignore next -- unreachable fallback: an ungrouped aggregate SELECT always returns exactly one row and count(*)::int is never null, so neither the ?. short-circuit nor the ?? 0 can fire (unlike citedCount, whose sum() legitimately returns null). */
        totalChecked: Number(rows[0]?.totalChecked ?? 0),
    };
}
