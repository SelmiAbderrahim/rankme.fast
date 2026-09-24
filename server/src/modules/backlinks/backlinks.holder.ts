/**
 * Injectable holder. Mirrors keyword-research.holder.ts: the api process owns
 * the singleton db + provider; the router reads through this holder so unit
 * tests can swap in PGlite + a fake provider.
 */
import type { Db } from '../../db/client.js';
import { createInMemoryCooldown, type Cooldown } from '../../shared/cooldown/index.js';
import type { BacklinkProvider } from '../../shared/providers/index.js';
import type { Queue } from 'bullmq';
let currentDb: Db | null = null;
export function setBacklinksDb(db: Db | null): void {
    currentDb = db;
}
export function getBacklinksDb(): Db {
    if (currentDb)
        return currentDb;
    throw new Error('backlinks db not configured — call setBacklinksDb() at boot');
}
let currentProvider: BacklinkProvider | null = null;
export function setBacklinkProvider(provider: BacklinkProvider | null): void {
    currentProvider = provider;
}
export function getBacklinkProvider(): BacklinkProvider {
    if (currentProvider)
        return currentProvider;
    throw new Error('backlink provider not configured — call setBacklinkProvider() at boot');
}
let currentDeepQueue: Queue | null = null;
export function setBacklinkDeepQueue(queue: Queue | null): void {
    currentDeepQueue = queue;
}
export function getBacklinkDeepQueue(): Queue | null {
    return currentDeepQueue;
}
/**
 * Per-site refresh cooldown. Unlike db/provider there is no boot
 * wiring to forget — a fresh in-memory instance with the 60s default is
 * always valid, so the getter lazily self-heals instead of throwing. Tests
 * substitute a fake-clock instance via the setter (null restores the default).
 */
export const BACKLINKS_REFRESH_COOLDOWN_MS = 60000;
let currentCooldown: Cooldown | null = null;
export function setBacklinksCooldown(cooldown: Cooldown | null): void {
    currentCooldown = cooldown;
}
export function getBacklinksCooldown(): Cooldown {
    if (!currentCooldown) {
        currentCooldown = createInMemoryCooldown({ defaultMs: BACKLINKS_REFRESH_COOLDOWN_MS });
    }
    return currentCooldown;
}
