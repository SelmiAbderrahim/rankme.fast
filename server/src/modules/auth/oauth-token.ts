import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { and, asc, eq, gt, isNotNull, ne, or, sql } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { account } from '../../db/schema/auth.js';
import type { AuthDatabase } from './auth.js';
const BETTER_AUTH_ENVELOPE_PREFIX = '$ba$';
const LEGACY_BETTER_AUTH_CIPHERTEXT = /^[0-9a-f]+$/i;
/**
 * Better Auth 1.6 stores OAuth ciphertext as bare hexadecimal when configured
 * with the single `secret` option used by RankMeFast. The prefix is accepted
 * as well so a malformed/future rotated-key envelope fails closed instead of
 * ever being mistaken for a legacy plaintext bearer token.
 */
export function looksLikeBetterAuthOAuthCiphertext(value: string): boolean {
    return (value.startsWith(BETTER_AUTH_ENVELOPE_PREFIX) ||
        (value.length % 2 === 0 && LEGACY_BETTER_AUTH_CIPHERTEXT.test(value)));
}
/**
 * Return a token in the exact at-rest format used by the installed Better
 * Auth release. Already-encrypted values are authenticated before being kept
 * byte-for-byte; malformed encrypted-looking values fail closed and are never
 * re-encrypted as if they were plaintext.
 */
export async function ensureStoredOAuthTokenEncrypted(value: string | null | undefined): Promise<string | null> {
    if (!value)
        return null;
    if (looksLikeBetterAuthOAuthCiphertext(value)) {
        try {
            await symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: value });
            return value;
        }
        catch {
            throw new OAuthTokenDecryptionError();
        }
    }
    return symmetricEncrypt({ key: env.BETTER_AUTH_SECRET, data: value });
}
export class OAuthTokenDecryptionError extends Error {
    constructor() {
        super('Stored OAuth token cannot be decrypted.');
        this.name = 'OAuthTokenDecryptionError';
    }
}
/**
 * Decode one Better Auth OAuth column without rewriting legacy plaintext.
 * This mirrors Better Auth's own encrypted-token detection contract. Token
 * values are deliberately absent from the error and from every log surface.
 */
export async function resolveStoredOAuthToken(value: string | null | undefined): Promise<string | null> {
    if (!value)
        return null;
    if (!looksLikeBetterAuthOAuthCiphertext(value))
        return value;
    try {
        return await symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: value });
    }
    catch {
        throw new OAuthTokenDecryptionError();
    }
}
type OAuthAccountMutation = {
    accessToken?: string | null;
    refreshToken?: string | null;
    idToken?: string | null;
} & Record<string, unknown>;
/**
 * Better Auth 1.6.23 does not protect every account-write path itself:
 * direct ID-token linking can bypass its access/refresh helper, and ID tokens
 * are stored verbatim. This database-hook transformer closes both gaps. ID
 * tokens are deliberately not retained because RankMeFast does not consume
 * Better Auth's optional account-token APIs.
 */
export async function hardenOAuthAccountMutation(mutation: OAuthAccountMutation): Promise<{
    data: OAuthAccountMutation;
}> {
    const data: OAuthAccountMutation = { idToken: null };
    if (Object.hasOwn(mutation, 'accessToken')) {
        data.accessToken = await ensureStoredOAuthTokenEncrypted(mutation.accessToken);
    }
    if (Object.hasOwn(mutation, 'refreshToken')) {
        data.refreshToken = await ensureStoredOAuthTokenEncrypted(mutation.refreshToken);
    }
    return { data };
}
export interface OAuthTokenBackfillResult {
    scannedRows: number;
    changedRows: number;
    encryptedTokens: number;
    clearedIdTokens: number;
}
const OAUTH_BACKFILL_LOCK = 'rankme:oauth-token-at-rest:v1';
const OAUTH_BACKFILL_PAGE_SIZE = 250;
/**
 * Idempotently upgrades legacy Better Auth account rows before this process
 * begins accepting HTTP traffic. The shipped topology has one API process;
 * a mixed-version rolling fleet must quiesce old auth writers (or add a DB
 * constraint) before this pass. Counts are safe to log, while token material
 * never leaves this module.
 */
export async function backfillStoredOAuthTokens(database: AuthDatabase): Promise<OAuthTokenBackfillResult> {
    return database.transaction(async (tx: AuthDatabase) => {
        await tx.execute(sql `select pg_advisory_xact_lock(hashtext(${OAUTH_BACKFILL_LOCK}))`);
        const result: OAuthTokenBackfillResult = {
            scannedRows: 0,
            changedRows: 0,
            encryptedTokens: 0,
            clearedIdTokens: 0,
        };
        let cursor = '';
        while (true) {
            const rows = await tx
                .select({
                id: account.id,
                accessToken: account.accessToken,
                refreshToken: account.refreshToken,
                idToken: account.idToken,
            })
                .from(account)
                .where(and(ne(account.providerId, 'credential'), gt(account.id, cursor), or(isNotNull(account.accessToken), isNotNull(account.refreshToken), isNotNull(account.idToken))))
                .orderBy(asc(account.id))
                .limit(OAUTH_BACKFILL_PAGE_SIZE)
                .for('update');
            if (rows.length === 0)
                break;
            for (const row of rows) {
                result.scannedRows += 1;
                const accessToken = await ensureStoredOAuthTokenEncrypted(row.accessToken);
                const refreshToken = await ensureStoredOAuthTokenEncrypted(row.refreshToken);
                const accessChanged = accessToken !== row.accessToken;
                const refreshChanged = refreshToken !== row.refreshToken;
                const idChanged = row.idToken !== null;
                if (accessChanged || refreshChanged || idChanged) {
                    await tx
                        .update(account)
                        .set({ accessToken, refreshToken, idToken: null })
                        .where(and(ne(account.providerId, 'credential'), eq(account.id, row.id)));
                    result.changedRows += 1;
                    result.encryptedTokens += Number(accessChanged) + Number(refreshChanged);
                    result.clearedIdTokens += Number(idChanged);
                }
            }
            cursor = rows[rows.length - 1]!.id;
        }
        return result;
    });
}
