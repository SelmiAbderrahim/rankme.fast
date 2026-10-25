import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { keywords, rankings, type RankEngineKind } from '../../db/schema/keywords.js';
import { addToRankMovementTally, emptyRankMovementTally, rankMovementBucket,
  type RankMovementTally } from './rank-movement.classify.js';
import { classifyKeywordRankState, countKeywordRankStates, type KeywordRankStateCounts,
  type KeywordRankStateResult, type RankStateBaseline, type RankStateHistoryEntry } from './rank-state.js';

export const RANK_STATE_READ_LIMIT = 2_000;
export interface KeywordRankStateRow { keywordId: string; phrase: string; rankState: KeywordRankStateResult }
export interface ReadKeywordRankStatesInput {
  accountId?: string; siteId: string; keywordIds?: readonly string[];
  engine?: RankEngineKind; limit?: number; offset?: number; baseline?: RankStateBaseline;
}

/** Stored-only read; the caller must enforce site access before omitting accountId. */
export async function readKeywordRankStates(db: Db, input: ReadKeywordRankStatesInput): Promise<KeywordRankStateRow[]> {
  const filters = [eq(keywords.siteId, input.siteId), eq(keywords.active, true)];
  if (input.accountId !== undefined) filters.push(eq(keywords.accountId, input.accountId));
  if (input.engine !== undefined) filters.push(eq(keywords.engine, input.engine));
  if (input.keywordIds?.length) filters.push(inArray(keywords.id, [...input.keywordIds]));
  const rows = await db.select({ id: keywords.id, phrase: keywords.phrase,
    lastFailedCheckAt: keywords.lastFailedCheckAt }).from(keywords).where(and(...filters))
    .orderBy(asc(keywords.phrase), asc(keywords.id)).limit(Math.min(input.limit ?? RANK_STATE_READ_LIMIT,
      RANK_STATE_READ_LIMIT)).offset(input.offset ?? 0);
  if (rows.length === 0) return [];
  const ranked = await db.select({ keywordId: rankings.keywordId, position: rankings.position,
    checkedAt: rankings.checkedAt,
    rn: sql<number>`row_number() over (partition by ${rankings.keywordId} order by ${rankings.checkedAt} desc)`.as('rn') })
    .from(rankings).where(inArray(rankings.keywordId, rows.map((row) => row.id)));
  const history = new Map<string, RankStateHistoryEntry[]>();
  for (const row of ranked) {
    if (input.baseline !== 'best_ever' && Number(row.rn) > 2) continue;
    const bucket = history.get(row.keywordId) ?? [];
    bucket.push({ position: row.position, checkedAt: row.checkedAt });
    history.set(row.keywordId, bucket);
  }
  return rows.map((row) => ({ keywordId: row.id, phrase: row.phrase,
    rankState: classifyKeywordRankState(row, history.get(row.id) ?? [], input.baseline) }));
}

export interface SiteRankStateSummary { baseline: RankStateBaseline; total: number;
  counts: KeywordRankStateCounts; movement: RankMovementTally }
export async function summarizeSiteRankStates(db: Db, input: { accountId: string; siteId: string }): Promise<SiteRankStateSummary> {
  const counts = countKeywordRankStates([]);
  const movement = emptyRankMovementTally();
  let total = 0;
  let page: KeywordRankStateRow[];
  do {
    page = await readKeywordRankStates(db, { ...input, offset: total });
    for (const { rankState } of page) {
      counts[rankState.state] += 1;
      addToRankMovementTally(movement, rankMovementBucket(rankState));
    }
    total += page.length;
  } while (page.length === RANK_STATE_READ_LIMIT);
  return { baseline: 'previous_check', total, counts, movement };
}
