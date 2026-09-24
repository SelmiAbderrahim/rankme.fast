/**
 * Injectable holder — mirrors backlinks.holder.
 */
import type { Db } from '../../db/client.js';
import type { Queue } from 'bullmq';
import { createInMemoryCooldown, type Cooldown } from '../../shared/cooldown/index.js';
import type { CompetitorProvider } from '../../shared/providers/index.js';
let currentDb: Db | null = null;
export function setCompetitorsDb(db: Db | null): void {
    currentDb = db;
}
export function getCompetitorsDb(): Db {
    if (currentDb)
        return currentDb;
    throw new Error('competitors db not configured — call setCompetitorsDb() at boot');
}
let currentProvider: CompetitorProvider | null = null;
export function setCompetitorProvider(provider: CompetitorProvider | null): void {
    currentProvider = provider;
}
export function getCompetitorProvider(): CompetitorProvider {
    if (currentProvider)
        return currentProvider;
    throw new Error('competitor provider not configured — call setCompetitorProvider() at boot');
}
let trafficSnapshotsQueue: Queue | null = null;
export function setTrafficSnapshotsQueue(queue: Queue | null): void {
    trafficSnapshotsQueue = queue;
}
export function getTrafficSnapshotsQueue(): Queue | null {
    return trafficSnapshotsQueue;
}
/**
 * Per-site refresh cooldown — mirrors backlinks.holder. The
 * getter lazily self-heals with the 60s default; tests substitute a
 * fake-clock instance via the setter (null restores the default).
 */
export const COMPETITORS_REFRESH_COOLDOWN_MS = 60000;
let currentCooldown: Cooldown | null = null;
export function setCompetitorsCooldown(cooldown: Cooldown | null): void {
    currentCooldown = cooldown;
}
export function getCompetitorsCooldown(): Cooldown {
    if (!currentCooldown) {
        currentCooldown = createInMemoryCooldown({ defaultMs: COMPETITORS_REFRESH_COOLDOWN_MS });
    }
    return currentCooldown;
}
