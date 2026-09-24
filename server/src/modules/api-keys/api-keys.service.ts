/**
 * API-key lifecycle (workstream C).
 *
 * Keys are `rmf_` + base64url(randomBytes(30)) — a 40-char secret part
 * (240 bits of entropy). Only the sha256 hex digest is persisted; a plain
 * (unsalted, single-round) sha256 is deliberate and correct here: the input
 * is a 240-bit random secret, not a human password, so brute-forcing the
 * digest is infeasible and a constant-time-friendly index lookup stays
 * possible. The full key is returned EXACTLY ONCE from `createApiKey`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, count, desc, eq, isNull, lt, or } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { apiKeys } from '../../db/schema/api-keys.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { parseStoredScopes, type McpPermissionSpec, } from '../../shared/mcp-permissions/types.js';
/** Hard ceiling on non-revoked keys per account. */
export const MAX_ACTIVE_API_KEYS = 10;
/** Skip the `last_used_at` write when the stored value is younger than this. */
export const LAST_USED_THROTTLE_MS = 60000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function generateApiKey(): {
    key: string;
    prefix: string;
} {
    // 30 random bytes → exactly 40 base64url chars (no padding).
    const secret = randomBytes(30).toString('base64url');
    return { key: `rmf_${secret}`, prefix: `rmf_${secret.slice(0, 8)}` };
}
export function hashApiKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
}
export interface CreatedApiKey {
    id: string;
    name: string;
    /** The full secret — surfaced exactly once, never retrievable again. */
    key: string;
    prefix: string;
    createdAt: string;
    scopes: McpPermissionSpec | null;
}
export async function createApiKey(db: Db, input: {
    accountId: string;
    name: string;
    scopes?: McpPermissionSpec | null;
}): Promise<CreatedApiKey> {
    const [active] = await db
        .select({ count: count() })
        .from(apiKeys)
        .where(and(eq(apiKeys.accountId, input.accountId), isNull(apiKeys.revokedAt)));
    /* c8 ignore next -- drizzle's count() always yields a row; `?? 0` satisfies noUncheckedIndexedAccess. */
    if (Number(active?.count ?? 0) >= MAX_ACTIVE_API_KEYS) {
        throw HttpError.conflict({ code: 'API_KEYS_ERRORS_TOO_MANY', messageKey: 'apiKeys.errors.tooMany' });
    }
    const { key, prefix } = generateApiKey();
    const [row] = await db
        .insert(apiKeys)
        .values({
        accountId: input.accountId,
        name: input.name,
        keyHash: hashApiKey(key),
        prefix,
        scopes: input.scopes ?? null,
    })
        .returning();
    /* c8 ignore next -- INSERT … RETURNING always yields the row; guard satisfies noUncheckedIndexedAccess. */
    if (!row)
        throw HttpError.internal({ code: 'ERRORS_INTERNAL', messageKey: 'errors.internal' });
    return {
        id: row.id,
        name: row.name,
        key,
        prefix: row.prefix,
        createdAt: row.createdAt.toISOString(),
        scopes: parseStoredScopes(row.scopes),
    };
}
export interface ApiKeySummary {
    id: string;
    name: string;
    prefix: string;
    createdAt: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    /** Per-key MCP scopes; null = unscoped (fully permissive). */
    scopes: McpPermissionSpec | null;
}
/** List every key for the account — NEVER the key or its hash. */
export async function listApiKeys(db: Db, accountId: string): Promise<ApiKeySummary[]> {
    const rows = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.accountId, accountId))
        .orderBy(desc(apiKeys.createdAt), desc(apiKeys.id));
    return rows.map((row) => ({
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
        revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
        scopes: parseStoredScopes(row.scopes),
    }));
}
/**
 * Replace a key's scopes wholesale (null clears → unscoped). Missing,
 * cross-account, and revoked keys all resolve to the same 404 — no
 * existence leak (per rules/better-auth-integration).
 */
export async function updateApiKeyScopes(db: Db, input: {
    accountId: string;
    id: string;
    scopes: McpPermissionSpec | null;
}): Promise<ApiKeySummary> {
    if (!UUID_PATTERN.test(input.id)) {
        throw HttpError.notFound({ code: 'API_KEYS_ERRORS_NOT_FOUND', messageKey: 'apiKeys.errors.notFound' });
    }
    const [row] = await db
        .update(apiKeys)
        .set({ scopes: input.scopes })
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.accountId, input.accountId), isNull(apiKeys.revokedAt)))
        .returning();
    if (!row)
        throw HttpError.notFound({ code: 'API_KEYS_ERRORS_NOT_FOUND', messageKey: 'apiKeys.errors.notFound' });
    return {
        id: row.id,
        name: row.name,
        prefix: row.prefix,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
        revokedAt: null,
        scopes: parseStoredScopes(row.scopes),
    };
}
/**
 * Soft-revoke. Missing, cross-account, or already-revoked keys all resolve to
 * the same 404 — no existence leak (per rules/better-auth-integration).
 */
export async function revokeApiKey(db: Db, input: {
    accountId: string;
    id: string;
}): Promise<void> {
    // Guard before the query: a non-UUID id would raise a Postgres 22P02.
    if (!UUID_PATTERN.test(input.id)) {
        throw HttpError.notFound({ code: 'API_KEYS_ERRORS_NOT_FOUND', messageKey: 'apiKeys.errors.notFound' });
    }
    const updated = await db
        .update(apiKeys)
        .set({ revokedAt: new Date() })
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.accountId, input.accountId), isNull(apiKeys.revokedAt)))
        .returning({ id: apiKeys.id });
    if (updated.length === 0)
        throw HttpError.notFound({ code: 'API_KEYS_ERRORS_NOT_FOUND', messageKey: 'apiKeys.errors.notFound' });
}
export interface ResolvedApiKey {
    accountId: string;
    keyId: string;
    /**
     * Per-key MCP permission scopes. null = unscoped (fully permissive, the
     * pre-scopes behavior). Malformed stored blobs also collapse to null.
     */
    scopes: McpPermissionSpec | null;
}
/** Non-revoked hash lookup. Unknown / revoked → null (caller emits the 401). */
export async function resolveApiKey(db: Db, bearerKey: string): Promise<ResolvedApiKey | null> {
    const rows = await db
        .select({ id: apiKeys.id, accountId: apiKeys.accountId, scopes: apiKeys.scopes })
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, hashApiKey(bearerKey)), isNull(apiKeys.revokedAt)))
        .limit(1);
    const row = rows[0];
    return row
        ? { accountId: row.accountId, keyId: row.id, scopes: parseStoredScopes(row.scopes) }
        : null;
}
/**
 * Best-effort `last_used_at` bump. The WHERE clause skips the write when the
 * stored value is younger than the throttle window, so a chatty integration
 * does not amplify one SELECT per request into one UPDATE per request.
 */
export async function touchLastUsed(db: Db, keyId: string): Promise<void> {
    await db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(and(eq(apiKeys.id, keyId), or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, new Date(Date.now() - LAST_USED_THROTTLE_MS)))));
}
