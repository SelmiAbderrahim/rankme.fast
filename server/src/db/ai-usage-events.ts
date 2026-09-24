import { eq, gte, lt, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema/index.js';
import { aiUsageEvents, type NewAiUsageEventRow } from './schema/ai-usage-events.js';
import type { AiAttemptBatch, AiSpendGuard } from '../shared/providers/ai-sdk/runtime.js';
export type AiUsageDb<TQueryResult extends PgQueryResultHKT> = PgDatabase<TQueryResult, typeof schema>;
function toRows(batch: AiAttemptBatch): NewAiUsageEventRow[] {
    return batch.attempts.map((attempt) => ({
        accountId: batch.accountId,
        siteId: batch.siteId,
        jobId: batch.jobId,
        task: batch.task,
        correlationId: batch.correlationId,
        profileName: batch.profileMetadata?.name ?? null,
        profileVersion: batch.profileMetadata?.version ?? null,
        outputSchemaVersion: batch.profileMetadata?.outputSchemaVersion ?? null,
        promptTemplateId: batch.profileMetadata?.promptTemplateId ?? null,
        promptTemplateVersion: batch.profileMetadata?.promptTemplateVersion ?? null,
        qualityFlags: batch.profileMetadata?.qualityFlags ?? null,
        provider: attempt.provider,
        model: attempt.model,
        attemptOrdinal: attempt.ordinal,
        status: attempt.status,
        inputTokens: attempt.tokens.input,
        outputTokens: attempt.tokens.output,
        cachedInputTokens: attempt.tokens.cachedInput,
        reasoningTokens: attempt.tokens.reasoning,
        latencyMs: attempt.latencyMs,
        configuredEstimateCostMicros: attempt.configuredEstimateCostMicros,
        actualCostMicros: attempt.costSource === 'actual' ? attempt.actualOrEstimatedCostMicros : null,
        actualOrEstimatedCostMicros: attempt.actualOrEstimatedCostMicros,
        costSource: attempt.costSource,
        errorCategory: attempt.errorCategory,
        errorCode: attempt.errorCode,
        createdAt: batch.createdAt,
    }));
}
/** One idempotent statement for the entire attempt batch. */
export async function writeAiUsageEvents<TQueryResult extends PgQueryResultHKT>(db: AiUsageDb<TQueryResult>, batch: AiAttemptBatch): Promise<number> {
    const rows = toRows(batch);
    if (rows.length === 0)
        return 0;
    const inserted = await db
        .insert(aiUsageEvents)
        .values(rows)
        .onConflictDoNothing({
        target: [
            aiUsageEvents.accountId,
            aiUsageEvents.correlationId,
            aiUsageEvents.attemptOrdinal,
        ],
    })
        .returning({ id: aiUsageEvents.id });
    return inserted.length;
}
export async function getAccountAiSpendMicros<TQueryResult extends PgQueryResultHKT>(db: AiUsageDb<TQueryResult>, accountId: string, since: Date): Promise<bigint> {
    const rows = await db
        .select({
        total: sql<string> `coalesce(sum(${aiUsageEvents.actualOrEstimatedCostMicros}), 0)::text`,
    })
        .from(aiUsageEvents)
        .where(sql `${eq(aiUsageEvents.accountId, accountId)} and ${gte(aiUsageEvents.createdAt, since)}`);
    return BigInt(rows[0]!.total);
}
export interface AiUsageStore {
    persistAttempts(batch: AiAttemptBatch): Promise<void>;
    getAccountSpendMicros(accountId: string, since: Date): Promise<bigint>;
}
export const AI_USAGE_PRUNE_QUEUE = 'ai-usage-prune';
export const AI_USAGE_PRUNE_JOB = 'sweep';
export const AI_USAGE_PRUNE_SCHEDULER_KEY = 'ai-usage-prune-sweep';
export const AI_USAGE_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export function createAiUsageStore<TQueryResult extends PgQueryResultHKT>(db: AiUsageDb<TQueryResult>): AiUsageStore {
    return {
        async persistAttempts(batch) {
            await writeAiUsageEvents(db, batch);
        },
        getAccountSpendMicros(accountId, since) {
            return getAccountAiSpendMicros(db, accountId, since);
        },
    };
}
export function createAiSpendGuard(store: AiUsageStore, windowMs: number, limitMicros: bigint): AiSpendGuard {
    return {
        windowMs,
        limitMicros,
        getAccountSpendMicros: store.getAccountSpendMicros,
    };
}
/** Daily scheduled purge keeps this content-free time series bounded. */
export async function pruneOldAiUsageEvents<TQueryResult extends PgQueryResultHKT>(db: AiUsageDb<TQueryResult>, retentionDays: number, now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const deleted = await db
        .delete(aiUsageEvents)
        .where(lt(aiUsageEvents.createdAt, cutoff))
        .returning({ id: aiUsageEvents.id });
    return deleted.length;
}
export function createAiUsagePruneProcessor<TQueryResult extends PgQueryResultHKT>(db: AiUsageDb<TQueryResult>, retentionDays: number) {
    return async (): Promise<{
        pruned: number;
    }> => ({
        pruned: await pruneOldAiUsageEvents(db, retentionDays),
    });
}
