import type { Db } from '../../db/client.js';
import { createInMemoryCooldown, type Cooldown } from '../../shared/cooldown/index.js';
import type { AiVisibilityProvider, SummaryProvider } from '../../shared/providers/index.js';
let currentDb: Db | null = null;
let currentProvider: AiVisibilityProvider | null = null;
let currentSummaryProvider: SummaryProvider | null = null;
let currentCooldown: Cooldown | null = null;
export const AI_VISIBILITY_REFRESH_COOLDOWN_MS = 60000;
export function setAiVisibilityDb(db: Db | null): void {
    currentDb = db;
}
export function getAiVisibilityDb(): Db {
    if (currentDb)
        return currentDb;
    throw new Error('ai visibility db not configured — call setAiVisibilityDb() at boot');
}
export function setAiVisibilityProvider(provider: AiVisibilityProvider | null): void {
    currentProvider = provider;
}
export function getAiVisibilityProvider(): AiVisibilityProvider {
    if (currentProvider)
        return currentProvider;
    throw new Error('ai visibility provider not configured — call setAiVisibilityProvider() at boot');
}
export function setAiVisibilitySummaryProvider(provider: SummaryProvider | null): void {
    currentSummaryProvider = provider;
}
export function getAiVisibilitySummaryProvider(): SummaryProvider | null {
    return currentSummaryProvider;
}
export function setAiVisibilityCooldown(cooldown: Cooldown | null): void {
    currentCooldown = cooldown;
}
export function getAiVisibilityCooldown(): Cooldown {
    if (!currentCooldown) {
        currentCooldown = createInMemoryCooldown({ defaultMs: AI_VISIBILITY_REFRESH_COOLDOWN_MS });
    }
    return currentCooldown;
}
