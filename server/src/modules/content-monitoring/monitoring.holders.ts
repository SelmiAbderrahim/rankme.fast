/**
 * Injectable holders for the content-monitoring module.
 *
 * Mirrors the competitor-content pattern: production boot calls the
 * setters once with the real Queue / Postgres client; unit tests inject fakes.
 * Reading a nulled holder is legal — the service surfaces a 503 for the queue
 * and falls back to the production client for the db (event recording + reads),
 * and the webhook controller 503s a queue-less delivery so the vendor retries.
 * The provider holder lets the app layer resolve the concrete
 * `ContentMonitorProvider` per request (real adapter in prod, fake in tests).
 */
import type { Queue } from 'bullmq';
import type { ContentMonitorProvider } from '../../shared/providers/index.js';
let currentQueue: Queue | null = null;
let currentDb: ApplicationDb | null = null;
let currentProvider: ContentMonitorProvider | null = null;
export function setContentMonitorQueue(queue: Queue | null): void {
    currentQueue = queue;
}
export function getContentMonitorQueue(): Queue | null {
    return currentQueue;
}
export function setContentMonitorDb(db: ApplicationDb | null): void {
    currentDb = db;
}
export function getContentMonitorDb(): ApplicationDb | null {
    return currentDb;
}
export function setContentMonitorProvider(provider: ContentMonitorProvider | null): void {
    currentProvider = provider;
}
export function getContentMonitorProvider(): ContentMonitorProvider | null {
    return currentProvider;
}
