import type { Queue } from 'bullmq';
import type { Db } from '../../db/client.js';
import type { AiProfileRunner } from '../../shared/ai-profiles/index.js';
import type { AiGenerationProviderKey } from '../../shared/providers/ai-generation.js';
let currentDb: Db | null = null;
let currentQueue: Queue | null = null;
let currentAi: AiProfileRunner | null = null;
let currentAiProviderOrder: readonly AiGenerationProviderKey[] = ['fake'];
export function setContentBriefDb(db: Db | null): void {
    currentDb = db;
}
export function getContentBriefDb(): Db {
    if (!currentDb)
        throw new Error('content-brief db not configured');
    return currentDb;
}
export function setContentBriefQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getContentBriefQueue(): Queue | null {
    return currentQueue;
}
export function setContentBriefAi(runner: AiProfileRunner | null, providerOrder: readonly AiGenerationProviderKey[] = ['fake']): void {
    currentAi = runner;
    currentAiProviderOrder = providerOrder;
}
export function getContentBriefAi(): {
    runner: AiProfileRunner | null;
    providerOrder: readonly AiGenerationProviderKey[];
} {
    return { runner: currentAi, providerOrder: currentAiProviderOrder };
}
