/**
 * Per-account keyword-research history.
 *
 * Every successful research call, including long-tail discovery, lands one row
 * in `keyword_research_history` — cache hits included, because history answers
 * "what did I search", not "what did we pay the vendor for". The shared
 * cross-user cache stays account-agnostic in `vendor_cache`; this table is the
 * only user-attributable record of research activity.
 *
 * `recordResearchHistory` NEVER throws: the user already paid quota for the
 * lookup, so a failed bookkeeping insert logs and moves on rather than turning
 * a delivered result into a 500.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keywordResearchHistory, type KeywordResearchKind, } from '../../db/schema/index.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../shared/utils/http-error.js';
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export interface ResearchHistoryItem {
    id: string;
    kind: KeywordResearchKind;
    phrases: string[];
    locationCode: number;
    languageCode: string;
    resultCount: number;
    cached: boolean;
    createdAt: string;
}
export interface RecordResearchHistoryInput {
    accountId: string;
    kind: KeywordResearchKind;
    phrases: string[];
    locationCode: number;
    languageCode: string;
    resultCount: number;
    cached: boolean;
}
export async function recordResearchHistory(db: Db, input: RecordResearchHistoryInput): Promise<void> {
    try {
        await db.insert(keywordResearchHistory).values({
            accountId: input.accountId,
            kind: input.kind,
            phrases: input.phrases,
            locationCode: input.locationCode,
            languageCode: input.languageCode.toLowerCase(),
            resultCount: input.resultCount,
            cached: input.cached,
        });
    }
    catch (err) {
        logger.error({ err, accountId: input.accountId, kind: input.kind }, 'keyword-research history write failed');
    }
}
export interface ListResearchHistoryInput {
    accountId: string;
    cursor?: string;
    limit: number;
}
export interface ResearchHistoryPage {
    items: ResearchHistoryItem[];
    nextCursor: string | null;
}
export async function listResearchHistory(db: Db, input: ListResearchHistoryInput): Promise<ResearchHistoryPage> {
    const filters = [eq(keywordResearchHistory.accountId, input.accountId)];
    if (input.cursor !== undefined) {
        if (!UUID_RE.test(input.cursor)) {
            throw HttpError.badRequest({ code: 'KEYWORD_RESEARCH_ERRORS_UNKNOWN_CURSOR', messageKey: 'keywordResearch.errors.unknownCursor' });
        }
        const cursorRow = await db
            .select({ createdAt: keywordResearchHistory.createdAt })
            .from(keywordResearchHistory)
            .where(and(eq(keywordResearchHistory.id, input.cursor), eq(keywordResearchHistory.accountId, input.accountId)))
            .limit(1);
        // A cursor belonging to another account reads exactly like an unknown
        // cursor — no existence leak (same policy as the ranks keyword list).
        if (cursorRow.length === 0) {
            throw HttpError.badRequest({ code: 'KEYWORD_RESEARCH_ERRORS_UNKNOWN_CURSOR', messageKey: 'keywordResearch.errors.unknownCursor' });
        }
        // Tuple compare: rows sharing `created_at` are still totally ordered by
        // `(created_at desc, id desc)`, so pagination never skips.
        filters.push(sql `(${keywordResearchHistory.createdAt}, ${keywordResearchHistory.id}) < (select created_at, id from ${keywordResearchHistory} where id = ${input.cursor} and account_id = ${input.accountId})`);
    }
    const rows = await db
        .select()
        .from(keywordResearchHistory)
        .where(and(...filters))
        .orderBy(desc(keywordResearchHistory.createdAt), desc(keywordResearchHistory.id))
        .limit(input.limit + 1);
    const pageRows = rows.slice(0, input.limit);
    const hasMore = rows.length > input.limit;
    /* c8 ignore next -- `?? null` arm satisfies noUncheckedIndexedAccess; `pageRows.at(-1)` is defined whenever hasMore. */
    const nextCursor = hasMore ? (pageRows.at(-1)?.id ?? null) : null;
    return {
        items: pageRows.map((row) => ({
            id: row.id,
            kind: row.kind,
            phrases: row.phrases,
            locationCode: row.locationCode,
            languageCode: row.languageCode,
            resultCount: row.resultCount,
            cached: row.cached,
            createdAt: row.createdAt.toISOString(),
        })),
        nextCursor,
    };
}
