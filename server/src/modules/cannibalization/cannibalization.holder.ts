/**
 * Injectable Drizzle handle (mirrors content-intelligence.holders). Null until
 * a test wires a PGlite client; the controller falls back to the production
 * client so the api needs no extra boot wiring.
 */
import type { Db } from '../../db/client.js';
let currentDb: Db | null = null;
export function setCannibalizationDb(db: Db | null): void {
    currentDb = db;
}
export function getCannibalizationDb(): Db | null {
    return currentDb;
}
