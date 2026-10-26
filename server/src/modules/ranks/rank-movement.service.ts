import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { domainStates, type RankCadenceKind } from '../../db/schema/keywords.js';
import { rankMovementBucket } from './rank-movement.classify.js';
import { readLatestOutcomes } from './rank-outcomes.repo.js';
import { RANK_STATE_READ_LIMIT, readKeywordRankStates } from './rank-state.repo.js';

export interface SiteRankMovement {
  tracked: number; compared: number;
  notCompared: { failed: number; skipped: number; noPair: number; unranked: number };
  improved: number; declined: number; unchanged: number;
  latestCheckedAt: Date | null; cadence: RankCadenceKind;
}

/** One stored-only movement summary for Dashboard and other site readers. */
export async function readRankMovementForSite(db: Db, input: { accountId: string;
  siteId: string }): Promise<SiteRankMovement> {
  const [cadence] = await db.select({ cadence: domainStates.cadence }).from(domainStates)
    .where(eq(domainStates.siteId, input.siteId)).limit(1);
  const result: SiteRankMovement = { tracked: 0, compared: 0,
    notCompared: { failed: 0, skipped: 0, noPair: 0, unranked: 0 },
    improved: 0, declined: 0, unchanged: 0, latestCheckedAt: null,
    cadence: cadence?.cadence ?? 'weekly' };
  let rows: Awaited<ReturnType<typeof readKeywordRankStates>>;
  do {
    rows = await readKeywordRankStates(db, { ...input, offset: result.tracked });
    const outcomes = await readLatestOutcomes(db, { ...input,
      keywordIds: rows.map((row) => row.keywordId) });
    for (const row of rows) {
      const state = row.rankState;
      const outcome = outcomes.get(row.keywordId);
      for (const value of [state.checkedAt, state.failedAt, outcome?.at]) {
        if (value) { const date = new Date(value);
          if (!result.latestCheckedAt || date > result.latestCheckedAt) result.latestCheckedAt = date; }
      }
      const bucket = rankMovementBucket(state);
      if (bucket === 'failed') result.notCompared.failed += 1;
      else if (bucket === 'noPair' || bucket === 'unranked') {
        if (outcome?.status === 'skipped') result.notCompared.skipped += 1;
        else result.notCompared[bucket] += 1;
      } else { result[bucket] += 1; result.compared += 1; }
    }
    result.tracked += rows.length;
  } while (rows.length === RANK_STATE_READ_LIMIT);
  return result;
}
