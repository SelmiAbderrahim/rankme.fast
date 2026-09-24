import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './schema/index.js';
import { aiProfileRunEvents } from './schema/ai-profile-run-events.js';
import type { AiProfileRunEvent, RecordAiProfileRun } from '../shared/ai-profiles/index.js';
export type AiProfileRunDb<TQueryResult extends PgQueryResultHKT> = PgDatabase<TQueryResult, typeof schema>;
export async function writeAiProfileRunEvent<TQueryResult extends PgQueryResultHKT>(db: AiProfileRunDb<TQueryResult>, event: AiProfileRunEvent): Promise<boolean> {
    const inserted = await db
        .insert(aiProfileRunEvents)
        .values({
        accountId: event.accountId,
        siteId: event.siteId,
        jobId: event.jobId,
        correlationId: event.correlationId,
        task: event.task,
        profileVersion: event.profileVersion,
        outputSchemaVersion: event.outputSchemaVersion,
        promptTemplateId: event.promptTemplateId,
        promptTemplateVersion: event.promptTemplateVersion,
        status: event.status,
        provider: event.provider,
        model: event.model,
        attempts: event.attempts,
        fallbackUsed: event.fallbackUsed,
        latencyMs: event.latencyMs,
        costMicros: event.costMicros,
        qualityFlags: event.qualityFlags,
        createdAt: event.createdAt,
    })
        .onConflictDoNothing({
        target: [aiProfileRunEvents.accountId, aiProfileRunEvents.correlationId],
    })
        .returning({ id: aiProfileRunEvents.id });
    return inserted.length === 1;
}
export function createAiProfileRunRecorder<TQueryResult extends PgQueryResultHKT>(db: AiProfileRunDb<TQueryResult>): RecordAiProfileRun {
    return async (event) => {
        await writeAiProfileRunEvent(db, event);
    };
}
