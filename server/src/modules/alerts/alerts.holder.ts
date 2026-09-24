/**
 * Injectable module handles (mirrors `cannibalization.holder`).
 *
 * `db` is null until a test wires a PGlite client; controllers fall back to the
 * production client so the api needs no extra boot wiring.
 *
 * `urlSafety` is the DNS/clock seam threaded into the shared SSRF authority.
 * Production leaves it null — the authority then uses the real resolver — while
 * tests inject a deterministic resolver so no suite ever touches live DNS.
 */
import type { Db } from '../../db/client.js';
import type { AssertPublicUrlSafeOptions } from '../../shared/security/url-safety.js';
let currentDb: Db | null = null;
let currentUrlSafety: AssertPublicUrlSafeOptions | null = null;
export function setAlertsDb(db: Db | null): void {
    currentDb = db;
}
export function getAlertsDb(): Db | null {
    return currentDb;
}
export function setAlertsUrlSafety(opts: AssertPublicUrlSafeOptions | null): void {
    currentUrlSafety = opts;
}
export function getAlertsUrlSafety(): AssertPublicUrlSafeOptions | null {
    return currentUrlSafety;
}
