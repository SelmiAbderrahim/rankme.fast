/**
 * DB / queue holders for the MCP module.
 *
 * MCP tools call through to feature modules (audits, sites, ranks,
 * content-intelligence) which already own their own DB/queue holders — this
 * indirection just lets tests inject a `startAuditForSite` deps object without
 * reaching across module boundaries.
 */
import type { Queue } from 'bullmq';
import { getApiKeysDb } from '../api-keys/index.js';
import type { Db } from '../../db/client.js';
import { getAuditsQueue } from '../audits/index.js';
/**
 * MCP shares the api-keys Postgres handle — the same one that resolved the
 * bearer token in `createApiKeyAuth` — so tests only need to seed one DB.
 */
export function getMcpDb(): Db {
    return getApiKeysDb();
}
export function getMcpAuditsQueue(): Queue | null {
    return getAuditsQueue();
}
