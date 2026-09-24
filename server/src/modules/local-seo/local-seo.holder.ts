import type { Queue } from 'bullmq';
import type { Db } from '../../db/client.js';
import { createInMemoryCooldown, type Cooldown } from '../../shared/cooldown/index.js';
import type { LocalListingsProvider, RankProvider } from '../../shared/providers/index.js';
let currentDb: Db | null = null;
let currentProvider: LocalListingsProvider | null = null;
let currentRankProvider: RankProvider | null = null;
let currentCooldown: Cooldown | null = null;
let currentReviewSyncQueue: Queue | null = null;
export const LOCAL_SEO_REFRESH_COOLDOWN_MS = 60000;
export function setLocalSeoDb(db: Db | null): void {
    currentDb = db;
}
export function getLocalSeoDb(): Db {
    if (currentDb)
        return currentDb;
    throw new Error('local seo db not configured — call setLocalSeoDb() at boot');
}
export function setLocalSeoProvider(provider: LocalListingsProvider | null): void {
    currentProvider = provider;
}
export function getLocalSeoProvider(): LocalListingsProvider {
    if (currentProvider)
        return currentProvider;
    throw new Error('local seo provider not configured — call setLocalSeoProvider() at boot');
}
/**
 * The local-pack rank check reuses the RankProvider — same vendor capability
 * that already backs organic rank checks (`checkLocalPackRank` lives on
 * `RankProvider`, not `LocalListingsProvider`). Wired separately so the
 * module can be tested without wiring the whole ranks stack.
 */
export function setLocalSeoRankProvider(provider: RankProvider | null): void {
    currentRankProvider = provider;
}
export function getLocalSeoRankProvider(): RankProvider {
    if (currentRankProvider)
        return currentRankProvider;
    throw new Error('local seo rank provider not configured — call setLocalSeoRankProvider() at boot');
}
/**
 * Null until the api process wires the queue at boot. A null queue makes the
 * paid sync route answer with the localized product-unavailable response
 * instead of accepting work nothing will ever consume.
 */
export function setReviewSyncQueue(queue: Queue | null): void {
    currentReviewSyncQueue = queue;
}
export function getReviewSyncQueue(): Queue | null {
    return currentReviewSyncQueue;
}
export function setLocalSeoCooldown(cooldown: Cooldown | null): void {
    currentCooldown = cooldown;
}
export function getLocalSeoCooldown(): Cooldown {
    if (!currentCooldown) {
        currentCooldown = createInMemoryCooldown({ defaultMs: LOCAL_SEO_REFRESH_COOLDOWN_MS });
    }
    return currentCooldown;
}
