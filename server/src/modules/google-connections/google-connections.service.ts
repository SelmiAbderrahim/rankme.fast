/**
 * google-connections service.
 *
 * Owns the encrypted lifecycle of a user's GSC refresh token:
 *   - upsert on connect (encrypt with `MASTER_ENCRYPTION_KEY`).
 *   - resolve a fresh access token per request (refresh + record lastUsedAt).
 *   - mark `needs_reconnect` on `invalid_grant` OR on decryption failure
 *     (rotated master key path — no crash, no plaintext in the error).
 *   - revoke + delete on disconnect (best-effort for a user disconnect,
 *     fail-closed for an account-erasure purge).
 *
 * Pino redaction: every service log passes through a child logger with
 * `refreshToken`, `encryptedRefreshToken`, and nested `*.refreshToken`
 * paths redacted so an accidentally-logged connection surfaces `[REDACTED]`
 * instead of the plaintext.
 */
import type { Logger } from 'pino';
import { and, eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/client.js';
import { account, user as userTable } from '../../db/schema/auth.js';
import type { Db } from '../../db/client.js';
import { GscReconnectRequiredError, ProviderError, VendorAuthError, VendorQuotaError, } from '../../shared/providers/index.js';
import type { Ga4Property, Ga4Provider, GscProperty, GscSearchAnalyticsResult, GscSearchAnalyticsRow, GscSearchEvaluationInput, GscSitemapEntry, GscSitemapsEvaluationInput, GscUrlInspection, IndexStatusEvaluationInput, IndexStatusSample, } from '../../shared/providers/index.js';
import type { GoogleGscProvider } from '../../shared/providers/google/gsc.js';
import { decryptSecret, encryptSecret, type EncryptedSecret, } from '../../shared/crypto/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { GoogleConnection, type GoogleConnectionHydrated, } from './google-connection.model.js';
import { SCOPE_GA4 } from './google-connections.schema.js';
import { OAuthTokenDecryptionError, resolveStoredOAuthToken, } from '../auth/index.js';
// User docs: `/docs/google-search-console.<locale>.md` (all 7 locales).
/**
 * Wrap a logger with redaction paths for token fields. Every module log
 * MUST use this so a mistake never leaks the refresh token to disk. The
 * redaction test (`google-connections.test.ts`) proves the contract holds.
 */
export function redactedLogger(logger: Logger): Logger {
    return logger.child({}, {
        redact: {
            paths: [
                'accessToken',
                '*.accessToken',
                'refreshToken',
                '*.refreshToken',
                'idToken',
                '*.idToken',
                'access_token',
                '*.access_token',
                'refresh_token',
                '*.refresh_token',
                'id_token',
                '*.id_token',
                'encryptedRefreshToken',
                '*.encryptedRefreshToken',
            ],
            censor: '[REDACTED]',
        },
    });
}
export interface UpsertConnectionInput {
    accountId: string;
    googleAccountEmail: string;
    refreshToken: string;
    scopes: string[];
    logger?: Logger;
}
export interface ResolvedGoogleAccount {
    refreshToken: string;
    googleAccountEmail: string;
    scopes: string[];
}
/** Safe, token-free signal used when account erasure cannot decrypt a token. */
export class GoogleTokenDecryptionError extends Error {
    constructor() {
        super('Stored Google token cannot be decrypted for revocation.');
        this.name = 'GoogleTokenDecryptionError';
    }
}
/**
 * Injectable Drizzle handle (same pattern as `setSitesDb` / `setSummaryDb`).
 * Production reads the lazy singleton from `db/client.js`; tests swap in the
 * in-process PGlite handle via `setGoogleConnectionsDb(getTestDb())`.
 */
let googleConnectionsDb: Db = defaultDb;
export function setGoogleConnectionsDb(handle: Db): void {
    googleConnectionsDb = handle;
}
/** Read the module's Drizzle handle (search-summary route → gsc-snapshots reads). */
export function getGoogleConnectionsDb(): Db {
    return googleConnectionsDb;
}
/**
 * Read the Google OAuth refresh token + granted scopes + account email from
 * the Better Auth `account` row. This is the production path: after
 * `linkSocial({ provider: 'google', scopes: [GSC_SCOPE] })` the refresh
 * token lives in the `account` table — the client never sees it and sends
 * placeholder fields to `POST /connect/complete`.
 *
 * Throws `google.errors.notConnected` when no Google account row exists for
 * the user (the link step did not land a row).
 */
export async function resolveGoogleAccountFromBetterAuth(userId: string, resolveToken: typeof resolveStoredOAuthToken = resolveStoredOAuthToken): Promise<ResolvedGoogleAccount> {
    const rows = await googleConnectionsDb
        .select({
        refreshToken: account.refreshToken,
        scope: account.scope,
        email: userTable.email,
    })
        .from(account)
        .innerJoin(userTable, eq(userTable.id, account.userId))
        .where(and(eq(account.userId, userId), eq(account.providerId, 'google')));
    const row = rows[0];
    if (!row || !row.refreshToken) {
        throw HttpError.notFound({ code: 'GOOGLE_ERRORS_NOT_CONNECTED', messageKey: 'google.errors.notConnected' });
    }
    let refreshToken: string | null;
    try {
        refreshToken = await resolveToken(row.refreshToken);
    }
    catch (error) {
        if (error instanceof OAuthTokenDecryptionError) {
            throw HttpError.notFound({ code: 'GOOGLE_ERRORS_NOT_CONNECTED', messageKey: 'google.errors.notConnected' });
        }
        throw error;
    }
    if (!refreshToken) {
        throw HttpError.notFound({ code: 'GOOGLE_ERRORS_NOT_CONNECTED', messageKey: 'google.errors.notConnected' });
    }
    // Better Auth stores the granted scopes COMMA-joined in `account.scope`
    // (e.g. `webmasters.readonly,openid,userinfo.email`); the OAuth wire format
    // is space-delimited. Split on either so a multi-scope row is parsed into
    // real elements — a whitespace-only split collapses the comma-joined string
    // into ONE element and `scopes.includes(SCOPE_GSC)` never matches, which
    // surfaced as a spurious `missingScope` on every real connection.
    const scopes = row.scope ? row.scope.split(/[\s,]+/).filter(Boolean) : [];
    return {
        refreshToken,
        googleAccountEmail: row.email,
        scopes,
    };
}
/**
 * Revoke Google credentials that exist only in Better Auth. Social-login
 * accounts may never create our Mongo GSC envelope, so account erasure must
 * inspect this authoritative identity table as well. Auth write hooks and the
 * startup backfill discard ID tokens; they are not valid inputs to Google's
 * revocation endpoint.
 */
export async function revokeBetterAuthGoogleTokens(userId: string, gscProvider: GoogleGscProvider | null): Promise<number> {
    const rows = await googleConnectionsDb
        .select({
        accessToken: account.accessToken,
        refreshToken: account.refreshToken,
    })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, 'google')));
    const tokens = new Set<string>();
    for (const row of rows) {
        const [accessToken, refreshToken] = await Promise.all([
            resolveStoredOAuthToken(row.accessToken),
            resolveStoredOAuthToken(row.refreshToken),
        ]);
        if (accessToken)
            tokens.add(accessToken);
        if (refreshToken)
            tokens.add(refreshToken);
    }
    if (tokens.size === 0)
        return 0;
    if (!gscProvider)
        throw new Error('Google token revocation is unavailable');
    // Stable order makes retries and fault-injection deterministic. Values stay
    // in process memory only and are never logged or retained.
    for (const token of [...tokens].sort()) {
        await gscProvider.revokeToken(token);
    }
    return tokens.size;
}
/**
 * Encrypt the refresh token and upsert the connection row. Scope validation
 * is enforced by the controller (before encryption) so this stays a pure
 * persistence helper.
 *
 * After the ciphertext lands in Mongo, the plaintext refresh token in the
 * Better Auth `account` row is nullified — the envelope is now the single
 * authoritative store. This closes the window where a read-only Postgres
 * compromise (backup leak, SQL injection, snapshot) exposes a live Google
 * refresh token without needing the master encryption key.
 */
/**
 * AAD context binding for the GSC refresh-token envelope. `<collection>:
 * <recordId>:<field>` so a swap into another account's row (or a different
 * field) fails GCM verification, not just an application-level check.
 */
function gscRefreshTokenAad(accountId: string): string {
    return `google_connections:${accountId}:refreshToken`;
}
export async function upsertConnection(input: UpsertConnectionInput): Promise<GoogleConnectionHydrated> {
    const encrypted = encryptSecret(input.refreshToken, {
        aad: gscRefreshTokenAad(input.accountId),
    });
    const now = new Date();
    // An incremental scope grant (e.g. adding GA4 to an existing GSC link)
    // re-runs the whole connect flow. Union the scopes and PRESERVE the chosen
    // credential metadata while Site resource bindings remain untouched.
    const existing = await GoogleConnection.findOne({
        accountId: input.accountId,
    });
    if (existing &&
        existing.googleAccountEmail.toLowerCase() !==
            input.googleAccountEmail.toLowerCase()) {
        throw HttpError.conflict({
            code: 'GOOGLE_ERRORS_ACCOUNT_MISMATCH',
            messageKey: 'google.errors.accountMismatch',
        });
    }
    const scopes = [...new Set([...(existing?.scopes ?? []), ...input.scopes])];
    const doc = await GoogleConnection.findOneAndUpdate({ accountId: input.accountId }, {
        $set: {
            googleAccountEmail: input.googleAccountEmail,
            encryptedRefreshToken: encrypted,
            scopes,
            status: 'connected',
            connectedAt: now,
        },
    }, { upsert: true, new: true });
    await clearPlaintextRefreshToken(input.accountId, input.logger);
    input.logger?.info({ accountId: input.accountId }, 'google connection upserted');
    return doc as GoogleConnectionHydrated;
}
/**
 * Nullify the plaintext `account.refresh_token` column once the encrypted
 * envelope owns the token. Safe to call multiple times — a row with no Google
 * account or an already-null token is a no-op. Errors are logged and swallowed
 * so a Postgres hiccup cannot block the Mongo-side connection that already
 * succeeded.
 */
export async function clearPlaintextRefreshToken(userId: string, logger?: Logger): Promise<void> {
    try {
        await googleConnectionsDb
            .update(account)
            .set({ refreshToken: null })
            .where(and(eq(account.userId, userId), eq(account.providerId, 'google')));
    }
    catch (err) {
        logger?.warn({ userId, err: (err as Error).message }, 'google: failed to nullify plaintext refresh_token in account table');
    }
}
export async function getConnection(accountId: string): Promise<GoogleConnectionHydrated | null> {
    const doc = await GoogleConnection.findOne({ accountId });
    return (doc as GoogleConnectionHydrated | null) ?? null;
}
export async function markNeedsReconnect(accountId: string): Promise<void> {
    await GoogleConnection.updateOne({ accountId }, { $set: { status: 'needs_reconnect' } });
}
/**
 * Revoke the refresh token with Google and drop the ciphertext. Idempotent
 * — a second call after the row is gone resolves without error.
 * Ordinary user disconnect remains best-effort. Account erasure opts into
 * fail-closed mode: decryption/provider failures retain the record so the
 * purge can retry instead of falsely completing with a live remote token.
 */
export async function revokeAndDelete(accountId: string, gscProvider: GoogleGscProvider, logger?: Logger, options: {
    failClosed?: boolean;
} = {}): Promise<void> {
    const doc = await getConnection(accountId);
    if (!doc)
        return;
    const encrypted = doc.encryptedRefreshToken as unknown as EncryptedSecret;
    let plaintext: string | null = null;
    try {
        plaintext = decryptSecret(encrypted, { aad: gscRefreshTokenAad(accountId) });
    }
    catch {
        logger?.warn({ accountId }, options.failClosed
            ? 'gsc revoke blocked: ciphertext undecryptable; retaining for purge retry'
            : 'gsc revoke skipped: ciphertext undecryptable');
        if (options.failClosed)
            throw new GoogleTokenDecryptionError();
    }
    if (plaintext !== null) {
        try {
            await gscProvider.revokeToken(plaintext);
        }
        catch (err) {
            logger?.warn({ accountId, err: (err as Error).message }, options.failClosed
                ? 'gsc revoke call failed — retaining the local record for purge retry'
                : 'gsc revoke call failed — proceeding to drop the local record anyway');
            if (options.failClosed)
                throw err;
        }
    }
    await GoogleConnection.deleteOne({ accountId });
    logger?.info({ accountId }, 'google connection revoked and deleted');
}
/**
 * Decrypt + refresh a fresh access token. On `GscReconnectRequiredError`
 * (invalid_grant OR 401) marks the connection `needs_reconnect` and
 * rethrows. On decryption failure (rotated master key) marks
 * `needs_reconnect` and throws `GscReconnectRequiredError` — the user must
 * re-consent to seed a new ciphertext under the current key.
 */
export async function resolveAccessToken(accountId: string, gscProvider: GoogleGscProvider, logger?: Logger): Promise<string> {
    const doc = await getConnection(accountId);
    if (!doc || doc.status === 'revoked') {
        throw HttpError.notFound({ code: 'GOOGLE_ERRORS_NOT_CONNECTED', messageKey: 'google.errors.notConnected' });
    }
    const encrypted = doc.encryptedRefreshToken as unknown as EncryptedSecret;
    let plaintext: string;
    try {
        plaintext = decryptSecret(encrypted, { aad: gscRefreshTokenAad(accountId) });
    }
    catch {
        await markNeedsReconnect(accountId);
        logger?.warn({ accountId }, 'gsc refresh-token decryption failed — marking needs_reconnect');
        throw new GscReconnectRequiredError('refresh token ciphertext could not be decrypted', { provider: 'google', operation: 'gsc-token-refresh' });
    }
    try {
        const { accessToken } = await gscProvider.refreshAccessToken(plaintext);
        await GoogleConnection.updateOne({ accountId }, { $set: { lastUsedAt: new Date() } });
        return accessToken;
    }
    catch (err) {
        if (err instanceof GscReconnectRequiredError) {
            await markNeedsReconnect(accountId);
            logger?.warn({ accountId }, 'gsc refresh returned invalid_grant — marking needs_reconnect');
        }
        throw err;
    }
}
/** Fetch the account's GSC properties list (fresh access token per call). */
export async function listPropertiesFor(accountId: string, gscProvider: GoogleGscProvider, logger?: Logger): Promise<GscProperty[]> {
    const accessToken = await resolveAccessToken(accountId, gscProvider, logger);
    return gscProvider.listProperties({ accessToken });
}
// ---------------------------------------------------------------------------
// GA4 property discovery — bindings are stored on Site.
// ---------------------------------------------------------------------------
/**
 * Translate a GA4 provider-layer failure into an actionable `HttpError` so the
 * `analytics-properties` / set-property surfaces return a localized 4xx (the
 * picker renders it + Retry) instead of leaking a raw `ProviderError` to the
 * error handler as a generic 500. Non-`ProviderError` throws (e.g. the
 * `HttpError` from `resolveAccessToken`) pass straight through. The original
 * error rides along as `cause` so operators still see the raw status in logs.
 */
function toGa4HttpError(err: unknown): unknown {
    if (err instanceof VendorAuthError) {
        // HTTP 403 — Analytics access is not effective on the shared grant (scope
        // stale, Admin/Data API disabled, or no accessible property). Same user
        // action as a never-granted scope: (re-)grant Google Analytics access.
        return new HttpError(400, { code: 'GOOGLE_ERRORS_MISSING_GA4_SCOPE', messageKey: 'google.errors.missingGa4Scope' }, undefined, {
            cause: err,
        });
    }
    if (err instanceof GscReconnectRequiredError) {
        // Shared refresh token is dead — `resolveAccessToken` already flagged the
        // connection `needs_reconnect`; tell the user to reconnect.
        return new HttpError(400, { code: 'GOOGLE_RECONNECT_TO_SEE_DATA', messageKey: 'google.reconnectToSeeData' }, undefined, {
            cause: err,
        });
    }
    if (err instanceof VendorQuotaError) {
        return new HttpError(429, { code: 'GOOGLE_ERRORS_QUOTA_EXCEEDED', messageKey: 'google.errors.quotaExceeded' }, undefined, {
            cause: err,
        });
    }
    if (err instanceof ProviderError) {
        // Timeout / unavailable / malformed — transient or contract drift. Surface
        // a clean localized message, not the scary generic `errors.internal` 500.
        return new HttpError(500, { code: 'GOOGLE_ERRORS_UNAVAILABLE', messageKey: 'google.errors.unavailable' }, undefined, {
            cause: err,
        });
    }
    return err;
}
/**
 * Fetch the account's GA4 property summaries (fresh access token per call).
 * Requires the GA4 scope on the connection — a link that only granted GSC
 * gets a localized 400 telling the client to run the incremental grant. Any
 * vendor-layer failure past the guards is mapped to an actionable `HttpError`
 * (`toGa4HttpError`) so the picker never sees a raw 500.
 */
export async function listGa4PropertiesFor(accountId: string, ga4Provider: Ga4Provider, gscProvider: GoogleGscProvider, logger?: Logger): Promise<Ga4Property[]> {
    const doc = await getConnection(accountId);
    if (!doc || doc.status !== 'connected') {
        throw HttpError.notFound({ code: 'GOOGLE_ERRORS_NOT_CONNECTED', messageKey: 'google.errors.notConnected' });
    }
    if (!doc.scopes.includes(SCOPE_GA4)) {
        throw HttpError.badRequest({ code: 'GOOGLE_ERRORS_MISSING_GA4_SCOPE', messageKey: 'google.errors.missingGa4Scope' });
    }
    try {
        const accessToken = await resolveAccessToken(accountId, gscProvider, logger);
        return await ga4Provider.listProperties({ accessToken });
    }
    catch (err) {
        throw toGa4HttpError(err);
    }
}
export interface InspectUrlForInput {
    accountId: string;
    siteUrl: string;
    inspectionUrl: string;
}
/**
 * Vendor-response archiver for GSC data (generic vendor layer). GSC payloads
 * are PRIVATE per-account Search Console data: archive-only with the owning
 * accountId, never written to the cross-user `vendor_cache`.
 */
export type GscVendorArchive = (input: {
    capability: 'gsc';
    operation: string;
    params: Record<string, unknown>;
    payload: unknown;
    accountId: string;
    fetchedAt: Date;
}) => Promise<void>;
/** Inspect ONE URL against a property. */
export async function inspectUrlFor(input: InspectUrlForInput, gscProvider: GoogleGscProvider, logger?: Logger, archive?: GscVendorArchive): Promise<GscUrlInspection> {
    const accessToken = await resolveAccessToken(input.accountId, gscProvider, logger);
    const inspection = await gscProvider.inspectUrl({ accessToken }, { inspectionUrl: input.inspectionUrl, siteUrl: input.siteUrl });
    if (archive) {
        await archive({
            capability: 'gsc',
            operation: 'inspect-url',
            params: {
                accountId: input.accountId,
                siteUrl: input.siteUrl,
                inspectionUrl: input.inspectionUrl,
            },
            payload: inspection,
            accountId: input.accountId,
            fetchedAt: new Date(),
        });
    }
    return inspection;
}
/**
 * Shared collector preamble: load the Site binding, then
 * resolve the shared credential and access token. It never discovers a
 * property inline: manual selection and the background matcher are the only
 * writers of Site bindings. Failures resolve to a degradation status the
 * caller maps into its evaluation input.
 */
type GscSessionResolution = {
    kind: 'ok';
    accessToken: string;
    siteUrl: string;
    bindingGenerationId: string;
} | {
    kind: 'not-connected' | 'needs-reconnect' | 'unavailable';
};
async function resolveGscSession(accountId: string, siteId: string, gscProvider: GoogleGscProvider, logger?: Logger): Promise<GscSessionResolution> {
    const { Site } = await import('../sites/index.js');
    const site = await Site.findOne({
        _id: siteId,
        accountId,
        deletionStartedAt: null,
    }).select('gscPropertyUrl gscBindingGenerationId');
    if (!site?.gscPropertyUrl)
        return { kind: 'not-connected' };
    const connection = await getConnection(accountId);
    if (!connection || connection.status !== 'connected') {
        return {
            kind: connection?.status === 'needs_reconnect'
                ? 'needs-reconnect'
                : 'not-connected',
        };
    }
    let accessToken: string;
    try {
        accessToken = await resolveAccessToken(accountId, gscProvider, logger);
    }
    catch (err) {
        if (err instanceof GscReconnectRequiredError) {
            return { kind: 'needs-reconnect' };
        }
        logger?.warn({ err: (err as Error).message }, 'gsc access-token resolution failed');
        return { kind: 'unavailable' };
    }
    return {
        kind: 'ok',
        accessToken,
        siteUrl: site.gscPropertyUrl,
        bindingGenerationId: site.gscBindingGenerationId ?? 'legacy',
    };
}
/**
 * Build the audit-processor `collectIndexStatus` callback.
 *
 * Contract: NEVER throws. Every path resolves to an
 * `IndexStatusEvaluationInput` so the audit still finishes. Reasons live
 * in the `status` field:
 *   - no connection → `not-connected`
 *   - refresh returned invalid_grant → `needs-reconnect`
 *   - 429 → `quota-exceeded`
 *   - any other error → `unavailable`
 *   - ok → per-URL samples[].
 */
export function createCollectIndexStatus(gscProvider: GoogleGscProvider, logger?: Logger, archive?: GscVendorArchive) {
    // Archive failures are OUR database failing — logged, never allowed to
    // break this callback's NEVER-throws contract (the audit must finish).
    const archiveSafely = async (input: Parameters<GscVendorArchive>[0]): Promise<void> => {
        if (!archive)
            return;
        try {
            await archive(input);
        }
        catch (err) {
            logger?.warn({ err: (err as Error).message, operation: input.operation }, 'gsc vendor-response archive failed');
        }
    };
    return async (input: {
        accountId: string;
        siteId: string;
        domain: string;
        urls: readonly string[];
    }): Promise<IndexStatusEvaluationInput> => {
        const session = await resolveGscSession(input.accountId, input.siteId, gscProvider, logger);
        if (session.kind !== 'ok') {
            return { status: session.kind, samples: [] };
        }
        const { accessToken, siteUrl } = session;
        const samples: IndexStatusSample[] = [];
        for (const url of input.urls) {
            try {
                const inspection = await gscProvider.inspectUrl({ accessToken }, { inspectionUrl: url, siteUrl });
                await archiveSafely({
                    capability: 'gsc',
                    operation: 'inspect-url',
                    params: { accountId: input.accountId, siteUrl, inspectionUrl: url },
                    payload: inspection,
                    accountId: input.accountId,
                    fetchedAt: new Date(),
                });
                samples.push({ url, inspection });
            }
            catch (err) {
                if (err instanceof GscReconnectRequiredError) {
                    await markNeedsReconnect(input.accountId);
                    return { status: 'needs-reconnect', samples: [] };
                }
                // The provider surfaces quota-hit as VendorQuotaError; a
                // partial-success sample list stays useful for the rules.
                if ((err as Error & {
                    name?: string;
                })?.name === 'VendorQuotaError') {
                    return { status: 'quota-exceeded', samples };
                }
                logger?.warn({ url, err: (err as Error).message }, 'gsc url-inspection failed on a sample');
            }
        }
        return { status: 'ok', samples };
    };
}
// ---------------------------------------------------------------------------
// Search Analytics + Sitemaps collector
// ---------------------------------------------------------------------------
/** Search Analytics window: 28 days ending 3 days ago (Google's data lag —
 * the last 2–3 days are unreliable, so they are always excluded). */
export const GSC_SEARCH_LAG_DAYS = 3;
export const GSC_SEARCH_WINDOW_DAYS = 28;
/**
 * Windows synced per run — the `?range=` options. Aggregate dimensions
 * (query/page/country/device) get one snapshot per window; the `date`
 * dimension is fetched ONCE at the widest window and sliced on read.
 */
export const GSC_RANGE_WINDOWS = [7, 28, 90] as const;
export const GSC_DATE_WINDOW = 90;
const DAY_MS = 86400000;
export function toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}
/**
 * The six Search Analytics dimension sets snapshotted per sync. `date` gives
 * the daily time series (one row per day in the window); `query`/`page` back
 * the summary + report; `country`/`device` back the panel breakdowns;
 * `query,page` backs cannibalization detection and the content-inventory
 * evidence loader. All are distinct `dimension_set` TEXT values in the same
 * `gsc_search_analytics` table — no schema change is needed to add them, and a
 * comma-joined value round-trips through the existing `dimension_key`
 * U+001F join.
 */
export const GSC_DIMENSION_SETS = [
    'date',
    'query',
    'page',
    'country',
    'device',
    'query,page',
] as const;
export type GscDimensionSet = (typeof GSC_DIMENSION_SETS)[number];
/**
 * Per-dimension row cap. `date` (≤28), `country`, and `device` are bounded but
 * we take the API max to never truncate; `query`/`page` keep the historical
 * 1000 cap (only the top five are surfaced), and the `query,page` cross
 * product — the widest set — takes the same 1000 cap so one sync can never
 * balloon a site's snapshot.
 */
function rowLimitForDimension(dimension: string): number {
    return dimension === 'query' || dimension === 'page' || dimension === 'query,page'
        ? 1000
        : 25000;
}
/** Search Analytics window: `windowDays` ending `GSC_SEARCH_LAG_DAYS` ago. */
function searchWindow(fetchedAt: Date, windowDays: number = GSC_SEARCH_WINDOW_DAYS): {
    startDate: string;
    endDate: string;
} {
    const endDate = toIsoDate(new Date(fetchedAt.getTime() - GSC_SEARCH_LAG_DAYS * DAY_MS));
    const startDate = toIsoDate(new Date(fetchedAt.getTime() - (GSC_SEARCH_LAG_DAYS + windowDays - 1) * DAY_MS));
    return { startDate, endDate };
}
export interface GscInsights {
    search: GscSearchEvaluationInput;
    sitemaps: GscSitemapsEvaluationInput;
}
/**
 * Postgres persistence seam for the collector — wired from `worker.ts` to the
 * `gsc-snapshots` module so this module never imports another module's
 * internals. Optional: unit tests run without it.
 */
export interface GscInsightsPersistence {
    upsertSearchAnalytics(input: {
        siteId: string;
        accountId: string;
        bindingGenerationId?: string;
        snapshotDate: string;
        dimensionSet: string;
        /** Window length in days ending at snapshotDate; storage defaults to 28. */
        windowDays?: number;
        rows: readonly GscSearchAnalyticsRow[];
    }): Promise<void>;
    upsertSitemaps(input: {
        siteId: string;
        accountId: string;
        bindingGenerationId?: string;
        snapshotDate: string;
        entries: readonly GscSitemapEntry[];
    }): Promise<void>;
    /** Previous-period totals for the delta — null on first run. */
    readPreviousTotals(siteId: string, beforeDate: string, bindingGenerationId?: string): Promise<{
        clicks: number;
        impressions: number;
    } | null>;
}
export interface CreateCollectGscInsightsOptions {
    logger?: Logger;
    archive?: GscVendorArchive;
    persist?: GscInsightsPersistence;
    /** Clock seam for tests. */
    now?: () => Date;
}
interface TopAggregate {
    key: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}
function topByClicks(rows: readonly GscSearchAnalyticsRow[], n: number): TopAggregate[] {
    return [...rows]
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, n)
        .map((row) => ({
        key: row.keys[0] ?? '',
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
    }));
}
/**
 * Impression-weighted aggregates over the query-dimension rows. Weighting by
 * impressions matches how Google itself averages position/CTR across rows.
 */
function weightedAggregates(rows: readonly GscSearchAnalyticsRow[]): {
    totalClicks: number;
    totalImpressions: number;
    averageCtr: number;
    averagePosition: number;
} {
    let totalClicks = 0;
    let totalImpressions = 0;
    let ctrSum = 0;
    let positionSum = 0;
    for (const row of rows) {
        totalClicks += row.clicks;
        totalImpressions += row.impressions;
        ctrSum += row.ctr * row.impressions;
        positionSum += row.position * row.impressions;
    }
    return {
        totalClicks,
        totalImpressions,
        averageCtr: totalImpressions === 0 ? 0 : ctrSum / totalImpressions,
        averagePosition: totalImpressions === 0 ? 0 : positionSum / totalImpressions,
    };
}
const UNAVAILABLE_SEARCH: Omit<GscSearchEvaluationInput, 'status'> = {
    totalClicks: 0,
    totalImpressions: 0,
    averageCtr: 0,
    averagePosition: 0,
    topQueries: [],
    topPages: [],
    delta: { clicks: null, impressions: null },
};
function emptySearch(status: GscSearchEvaluationInput['status']): GscSearchEvaluationInput {
    return { status, ...UNAVAILABLE_SEARCH };
}
/** Archive wrapper that swallows its own failures (best-effort audit trail). */
type ArchiveSafely = (input: Parameters<GscVendorArchive>[0]) => Promise<void>;
function makeArchiveSafely(archive: GscVendorArchive | undefined, logger: Logger | undefined): ArchiveSafely {
    return async (input) => {
        if (!archive)
            return;
        try {
            await archive(input);
        }
        catch (err) {
            logger?.warn({ err: (err as Error).message, operation: input.operation }, 'gsc vendor-response archive failed');
        }
    };
}
type DimensionCollection = {
    ok: true;
    results: Map<string, GscSearchAnalyticsRow[]>;
} | {
    ok: false;
    reason: 'needs-reconnect' | 'unavailable';
};
/**
 * One (dimension, window) fetch plan entry. Aggregate dimensions get every
 * range window; the `date` dimension is fetched once at `GSC_DATE_WINDOW`
 * (daily rows subsume the narrower ranges — readers slice).
 */
function searchFetchPlan(dimensionSets: readonly string[]): Array<{
    dimension: string;
    windowDays: number;
}> {
    return dimensionSets.flatMap((dimension) => dimension === 'date'
        ? [{ dimension, windowDays: GSC_DATE_WINDOW }]
        : GSC_RANGE_WINDOWS.map((windowDays) => ({ dimension, windowDays })));
}
/**
 * Fetch one Search Analytics call per (dimension set, range window), archive
 * the raw payloads once, and REPLACE-persist every combination for
 * `(siteId, snapshotDate=endDate)`. Shared by the audit collector and
 * `runGscSync`. The returned `results` map carries the PRIMARY (28-day)
 * window per aggregate dimension — and the 90-day daily rows for `date` — so
 * the audit rules + summary aggregates keep their historical meaning.
 * Never throws:
 *   - a vendor `invalid_grant`/401 marks the connection + returns `needs-reconnect`
 *   - any other vendor error returns `unavailable` (no archive, no persist)
 *   - a persist failure wipes EVERY (dimension, window) (never a partial
 *     snapshot) and returns `unavailable`
 */
async function collectSearchAnalyticsDimensions(args: {
    gscProvider: GoogleGscProvider;
    accessToken: string;
    siteUrl: string;
    siteId: string;
    accountId: string;
    bindingGenerationId: string;
    endDate: string;
    dimensionSets: readonly string[];
    persist?: GscInsightsPersistence;
    archive: ArchiveSafely;
    fetchedAt: Date;
    logger?: Logger;
}): Promise<DimensionCollection> {
    const { gscProvider, accessToken, siteUrl, siteId, accountId, bindingGenerationId, endDate, dimensionSets, persist, archive, fetchedAt, logger, } = args;
    const plan = searchFetchPlan(dimensionSets);
    const results = new Map<string, GscSearchAnalyticsRow[]>();
    const collected = new Map<string, GscSearchAnalyticsRow[]>();
    const raw: Record<string, GscSearchAnalyticsResult> = {};
    try {
        for (const { dimension, windowDays } of plan) {
            const { startDate } = searchWindow(fetchedAt, windowDays);
            const result = await gscProvider.querySearchAnalytics({ accessToken }, {
                siteUrl,
                startDate,
                endDate,
                // A dimension SET may be comma-joined (`query,page`); the vendor
                // request always takes the individual keys. Single-key sets split
                // to themselves, so the five historical sets are untouched.
                dimensions: dimension.split(','),
                rowLimit: rowLimitForDimension(dimension),
            });
            raw[`${dimension}@${windowDays}`] = result;
            collected.set(`${dimension}@${windowDays}`, [...result.rows]);
            // Primary rows: 28d aggregates, 90d daily series.
            if (windowDays === GSC_SEARCH_WINDOW_DAYS ||
                (dimension === 'date' && windowDays === GSC_DATE_WINDOW)) {
                results.set(dimension, [...result.rows]);
            }
        }
    }
    catch (err) {
        if (err instanceof GscReconnectRequiredError) {
            await markNeedsReconnect(accountId);
            return { ok: false, reason: 'needs-reconnect' };
        }
        logger?.warn({ err: (err as Error).message }, 'gsc search-analytics collection failed');
        return { ok: false, reason: 'unavailable' };
    }
    await archive({
        capability: 'gsc',
        operation: 'search-analytics',
        params: {
            accountId,
            siteUrl,
            endDate,
            windows: [...GSC_RANGE_WINDOWS],
        },
        payload: raw,
        accountId,
        fetchedAt,
    });
    if (persist) {
        try {
            for (const { dimension, windowDays } of plan) {
                await persist.upsertSearchAnalytics({
                    siteId,
                    accountId,
                    bindingGenerationId,
                    snapshotDate: endDate,
                    dimensionSet: dimension,
                    windowDays,
                    /* c8 ignore next -- collected holds every plan entry (populated in the fetch loop above); the ?? [] fallback is unreachable. */
                    rows: collected.get(`${dimension}@${windowDays}`) ?? [],
                });
            }
        }
        catch (err) {
            logger?.warn({ err: (err as Error).message }, 'gsc search-analytics persistence failed — degrading section');
            // Never leave a partial snapshot: wipe every (dimension, window).
            for (const { dimension, windowDays } of plan) {
                try {
                    await persist.upsertSearchAnalytics({
                        siteId,
                        accountId,
                        bindingGenerationId,
                        snapshotDate: endDate,
                        dimensionSet: dimension,
                        windowDays,
                        rows: [],
                    });
                }
                catch {
                    // Best-effort — the replace-on-write upsert of the next run clears
                    // any remnant anyway.
                }
            }
            return { ok: false, reason: 'unavailable' };
        }
    }
    return { ok: true, results };
}
/**
 * Fetch + archive + REPLACE-persist the sitemap list for one snapshot. Shared
 * by the audit collector and `runGscSync`. Never throws — degrades to a status.
 */
async function collectAndPersistSitemaps(args: {
    gscProvider: GoogleGscProvider;
    accessToken: string;
    siteUrl: string;
    siteId: string;
    accountId: string;
    bindingGenerationId: string;
    endDate: string;
    persist?: GscInsightsPersistence;
    archive: ArchiveSafely;
    fetchedAt: Date;
    logger?: Logger;
}): Promise<{
    status: GscSitemapsEvaluationInput['status'];
    entries: GscSitemapEntry[];
}> {
    const { gscProvider, accessToken, siteUrl, siteId, accountId, bindingGenerationId, endDate, persist, archive, fetchedAt, logger, } = args;
    try {
        const entries = await gscProvider.listSitemaps({ accessToken }, { siteUrl });
        await archive({
            capability: 'gsc',
            operation: 'list-sitemaps',
            params: { accountId, siteUrl },
            payload: entries,
            accountId,
            fetchedAt,
        });
        if (persist) {
            try {
                await persist.upsertSitemaps({
                    siteId,
                    accountId,
                    bindingGenerationId,
                    snapshotDate: endDate,
                    entries,
                });
            }
            catch (err) {
                logger?.warn({ err: (err as Error).message }, 'gsc sitemaps persistence failed — degrading section');
                return { status: 'unavailable', entries: [] };
            }
        }
        return {
            status: entries.length === 0 ? 'no-sitemaps' : 'ok',
            entries: [...entries],
        };
    }
    catch (err) {
        if (err instanceof GscReconnectRequiredError) {
            await markNeedsReconnect(accountId);
            return { status: 'needs-reconnect', entries: [] };
        }
        logger?.warn({ err: (err as Error).message }, 'gsc sitemaps collection failed');
        return { status: 'unavailable', entries: [] };
    }
}
/**
 * Build the audit-processor `collectGscInsights` callback.
 *
 * Contract mirrors `createCollectIndexStatus`: NEVER throws — every failure
 * degrades the affected section so the core audit always finishes:
 *   - no connection → `not-connected` (both sections)
 *   - refresh/API `invalid_grant` → `needs-reconnect` (both) + row marked
 *   - any other vendor error (incl. quota — one call per audit sits far
 *     inside the 1200/min budget, so a 429 is transient) → `unavailable`
 *   - zero Search Analytics rows → `no-data`; zero sitemaps → `no-sitemaps`
 *
 * On success the daily snapshot is persisted to Postgres (replace-on-conflict
 * per `(siteId, snapshotDate, dimensionSet)`); a persistence failure degrades
 * the section to `unavailable` and best-effort wipes the half-written
 * snapshot so a partial row set never masquerades as a full one.
 */
export function createCollectGscInsights(gscProvider: GoogleGscProvider, opts: CreateCollectGscInsightsOptions = {}) {
    const { logger, archive, persist } = opts;
    const now = opts.now ?? (() => new Date());
    const archiveSafely = makeArchiveSafely(archive, logger);
    return async (input: {
        accountId: string;
        siteId: string;
        domain: string;
    }): Promise<GscInsights> => {
        const session = await resolveGscSession(input.accountId, input.siteId, gscProvider, logger);
        if (session.kind !== 'ok') {
            return {
                search: emptySearch(session.kind),
                sitemaps: { status: session.kind, sitemaps: [] },
            };
        }
        const { accessToken, siteUrl, bindingGenerationId } = session;
        const fetchedAt = now();
        const { endDate } = searchWindow(fetchedAt);
        // --- Search Analytics: five dimension sets (date/query/page/country/
        // device) across the range windows. Fetch + archive + persist is shared
        // with `runGscSync`. ----------------------------------------------------
        let search: GscSearchEvaluationInput;
        let reconnectSeen = false;
        const outcome = await collectSearchAnalyticsDimensions({
            gscProvider,
            accessToken,
            siteUrl,
            siteId: input.siteId,
            accountId: input.accountId,
            bindingGenerationId,
            endDate,
            dimensionSets: GSC_DIMENSION_SETS,
            ...(persist ? { persist } : {}),
            archive: archiveSafely,
            fetchedAt,
            ...(logger ? { logger } : {}),
        });
        if (!outcome.ok) {
            reconnectSeen = outcome.reason === 'needs-reconnect';
            search = emptySearch(outcome.reason);
        }
        else {
            /* c8 ignore next -- outcome.results holds all five dimension sets; the ?? [] fallback is unreachable. */
            const queryRows = outcome.results.get('query') ?? [];
            /* c8 ignore next -- outcome.results holds all five dimension sets; the ?? [] fallback is unreachable. */
            const pageRows = outcome.results.get('page') ?? [];
            const aggregates = weightedAggregates(queryRows);
            const delta = persist
                ? await persist
                    .readPreviousTotals(input.siteId, endDate, bindingGenerationId)
                    .then((previous) => previous
                    ? {
                        clicks: aggregates.totalClicks - previous.clicks,
                        impressions: aggregates.totalImpressions - previous.impressions,
                    }
                    : { clicks: null, impressions: null })
                    .catch((err: Error) => {
                    logger?.warn({ err: err.message }, 'gsc previous-totals read failed — delta omitted');
                    return { clicks: null, impressions: null };
                })
                : { clicks: null, impressions: null };
            search = {
                status: queryRows.length === 0 && pageRows.length === 0 ? 'no-data' : 'ok',
                ...aggregates,
                topQueries: topByClicks(queryRows, 5).map((t) => ({
                    query: t.key,
                    clicks: t.clicks,
                    impressions: t.impressions,
                    ctr: t.ctr,
                    position: t.position,
                })),
                topPages: topByClicks(pageRows, 5).map((t) => ({
                    url: t.key,
                    clicks: t.clicks,
                    impressions: t.impressions,
                    ctr: t.ctr,
                    position: t.position,
                })),
                delta,
            };
        }
        // --- Sitemaps: one GET, independent of the analytics outcome. ---------
        let sitemaps: GscSitemapsEvaluationInput;
        if (reconnectSeen) {
            // The token is already known-dead — skip the doomed call.
            sitemaps = { status: 'needs-reconnect', sitemaps: [] };
        }
        else {
            const sm = await collectAndPersistSitemaps({
                gscProvider,
                accessToken,
                siteUrl,
                siteId: input.siteId,
                accountId: input.accountId,
                bindingGenerationId,
                endDate,
                ...(persist ? { persist } : {}),
                archive: archiveSafely,
                fetchedAt,
                ...(logger ? { logger } : {}),
            });
            sitemaps = {
                status: sm.status,
                sitemaps: sm.entries.map((entry) => ({
                    path: entry.path,
                    errors: entry.errors,
                    warnings: entry.warnings,
                    processed: entry.processed,
                    lastDownloaded: entry.lastDownloaded,
                })),
            };
        }
        return { search, sitemaps };
    };
}
// ---------------------------------------------------------------------------
// On-demand / queue-driven GSC sync (independent of the audit)
// ---------------------------------------------------------------------------
export interface GscSyncDeps {
    gscProvider: GoogleGscProvider;
    persist: GscInsightsPersistence;
    archive?: GscVendorArchive;
    logger?: Logger;
    /** Clock seam for tests. */
    now?: () => Date;
}
export interface GscSyncResult {
    status: 'ok' | 'no-data' | 'not-connected' | 'needs-reconnect' | 'unavailable';
    /** Snapshot date written, or null when nothing was persisted. */
    snapshotDate: string | null;
    counts: Record<GscDimensionSet, number>;
    sitemaps: number;
}
const ZERO_COUNTS: Record<GscDimensionSet, number> = {
    date: 0,
    query: 0,
    page: 0,
    country: 0,
    device: 0,
    'query,page': 0,
};
/** In-flight coalescer: concurrent syncs for one (account, site) share a run. */
const gscSyncInFlight = new Map<string, Promise<GscSyncResult>>();
/**
 * Sync all five Search Analytics dimension sets + sitemaps for one site,
 * independent of an audit. Used by the manual refresh endpoint (inline) and
 * the `gsc-sync` queue consumer. Free (Google quota); never throws — degrades
 * to a status. Concurrent calls for the same site are coalesced so a
 * double-click makes one Google round-trip.
 */
export function runGscSync(accountId: string, siteId: string, domain: string, deps: GscSyncDeps): Promise<GscSyncResult> {
    const key = `${accountId}:${siteId}`;
    const existing = gscSyncInFlight.get(key);
    if (existing)
        return existing;
    const promise = runGscSyncInner(accountId, siteId, domain, deps).finally(() => {
        gscSyncInFlight.delete(key);
    });
    gscSyncInFlight.set(key, promise);
    return promise;
}
async function runGscSyncInner(accountId: string, siteId: string, domain: string, deps: GscSyncDeps): Promise<GscSyncResult> {
    const { gscProvider, persist, logger } = deps;
    const now = deps.now ?? (() => new Date());
    const archiveSafely = makeArchiveSafely(deps.archive, logger);
    const session = await resolveGscSession(accountId, siteId, gscProvider, logger);
    if (session.kind !== 'ok') {
        return {
            status: session.kind,
            snapshotDate: null,
            counts: { ...ZERO_COUNTS },
            sitemaps: 0,
        };
    }
    const { accessToken, siteUrl, bindingGenerationId } = session;
    const fetchedAt = now();
    const { endDate } = searchWindow(fetchedAt);
    const outcome = await collectSearchAnalyticsDimensions({
        gscProvider,
        accessToken,
        siteUrl,
        siteId,
        accountId,
        bindingGenerationId,
        endDate,
        dimensionSets: GSC_DIMENSION_SETS,
        persist,
        archive: archiveSafely,
        fetchedAt,
        ...(logger ? { logger } : {}),
    });
    if (!outcome.ok) {
        return {
            status: outcome.reason,
            snapshotDate: null,
            counts: { ...ZERO_COUNTS },
            sitemaps: 0,
        };
    }
    const counts: Record<GscDimensionSet, number> = {
        /* c8 ignore start -- outcome.results holds all six dimension sets; the ?? [] fallbacks are unreachable. */
        date: (outcome.results.get('date') ?? []).length,
        query: (outcome.results.get('query') ?? []).length,
        page: (outcome.results.get('page') ?? []).length,
        country: (outcome.results.get('country') ?? []).length,
        device: (outcome.results.get('device') ?? []).length,
        'query,page': (outcome.results.get('query,page') ?? []).length,
        /* c8 ignore stop */
    };
    const sm = await collectAndPersistSitemaps({
        gscProvider,
        accessToken,
        siteUrl,
        siteId,
        accountId,
        bindingGenerationId,
        endDate,
        persist,
        archive: archiveSafely,
        fetchedAt,
        ...(logger ? { logger } : {}),
    });
    return {
        status: counts.query === 0 && counts.page === 0 ? 'no-data' : 'ok',
        snapshotDate: endDate,
        counts,
        sitemaps: sm.entries.length,
    };
}
// ---------------------------------------------------------------------------
// ?tab=google search summary
// ---------------------------------------------------------------------------
export interface GoogleSearchSummary {
    totalClicks: number;
    totalImpressions: number;
    averageCtr: number;
    averagePosition: number;
    topQueries: Array<{
        query: string;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
    }>;
    topPages: Array<{
        url: string;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
    }>;
    /** Daily clicks/impressions over the window (ascending by date). */
    timeseries: Array<{
        date: string;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
    }>;
    /** Top countries by clicks (ISO-3166-1 alpha-3 key). */
    countries: Array<{
        country: string;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
    }>;
    /** Per-device totals (DESKTOP/MOBILE/TABLET key). */
    devices: Array<{
        device: string;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
    }>;
    /** ISO date of the snapshot the summary was read from. */
    asOf: string;
    previousPeriod: {
        totalClicks: number;
        totalImpressions: number;
    } | null;
}
interface SummaryRow {
    dimensionKey: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
}
function summarizeRows(rows: readonly SummaryRow[]) {
    let totalClicks = 0;
    let totalImpressions = 0;
    let ctrSum = 0;
    let positionSum = 0;
    for (const row of rows) {
        totalClicks += row.clicks;
        totalImpressions += row.impressions;
        ctrSum += row.ctr * row.impressions;
        positionSum += row.position * row.impressions;
    }
    return {
        totalClicks,
        totalImpressions,
        averageCtr: totalImpressions === 0 ? 0 : ctrSum / totalImpressions,
        averagePosition: totalImpressions === 0 ? 0 : positionSum / totalImpressions,
    };
}
function topFive(rows: readonly SummaryRow[]) {
    return [...rows]
        .sort((a, b) => b.clicks - a.clicks)
        .slice(0, 5)
        .map((row) => ({
        key: row.dimensionKey,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
    }));
}
/**
 * Shared 404 ladder for every per-site GSC data read (localized):
 *   - site not owned by the caller → `sites.errors.notFound` (cross-account
 *     reads never learn the site exists — the standard cross-account convention)
 *   - connection flagged needs_reconnect → `google.reconnectToSeeData`
 *   - no connected row → `google.noDataYet`
 */
async function assertSiteAndConnectedFor(accountId: string, siteId: string): Promise<void> {
    const { Site } = await import('../sites/index.js');
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    const connection = await getConnection(accountId);
    if (connection?.status === 'needs_reconnect') {
        throw HttpError.notFound({ code: 'GOOGLE_RECONNECT_TO_SEE_DATA', messageKey: 'google.reconnectToSeeData' });
    }
    if (!connection || connection.status !== 'connected') {
        throw HttpError.notFound({ code: 'GOOGLE_NO_DATA_YET', messageKey: 'google.noDataYet' });
    }
    if (!site.gscPropertyUrl) {
        throw HttpError.notFound({
            code: 'GOOGLE_NO_DATA_YET',
            messageKey: 'google.noDataYet',
        });
    }
}
/** Stored-export access seam: ownership and readable GSC connection only. */
export async function assertGscStoredReadAccess(accountId: string, siteId: string): Promise<void> {
    await assertSiteAndConnectedFor(accountId, siteId);
}
/** Windowed read deps shared by the summary + drill-in readers. */
export interface GscSummaryReadDeps {
    readLatestSnapshotDate: (siteId: string, dimensionSet: string, windowDays: number) => Promise<string | null>;
    readSearchAnalytics: (siteId: string, dimensionSet: string, range: {
        since?: string;
        until?: string;
    }, windowDays: number) => Promise<SummaryRow[]>;
    readPreviousTotals: (siteId: string, beforeDate: string, windowDays: number) => Promise<{
        clicks: number;
        impressions: number;
    } | null>;
}
export type GscRange = '7d' | '28d' | '90d';
function windowDaysForRange(range: GscRange): number {
    return range === '7d' ? 7 : range === '90d' ? 90 : 28;
}
/** ISO date `days - 1` before `endDate` (inclusive window start). */
function sliceStartFor(endDate: string, days: number): string {
    const end = new Date(`${endDate}T00:00:00.000Z`);
    return toIsoDate(new Date(end.getTime() - (days - 1) * DAY_MS));
}
/**
 * Daily rows backing the timeseries: stored once at `GSC_DATE_WINDOW`, sliced
 * to the requested window. Falls back to legacy pre-range snapshots (written
 * with windowDays=28) so existing data keeps charting until the next sync.
 */
async function readTimeseriesRows(siteId: string, windowDays: number, deps: GscSummaryReadDeps): Promise<SummaryRow[]> {
    let dateWindow = GSC_DATE_WINDOW;
    let dateAsOf = await deps.readLatestSnapshotDate(siteId, 'date', dateWindow);
    if (dateAsOf === null) {
        dateWindow = GSC_SEARCH_WINDOW_DAYS;
        dateAsOf = await deps.readLatestSnapshotDate(siteId, 'date', dateWindow);
    }
    if (dateAsOf === null)
        return [];
    const rows = await deps.readSearchAnalytics(siteId, 'date', { since: dateAsOf, until: dateAsOf }, dateWindow);
    const from = sliceStartFor(dateAsOf, windowDays);
    return rows.filter((row) => row.dimensionKey >= from);
}
/**
 * Read the latest persisted Search Analytics snapshot for a site — a pure
 * Postgres read; NEVER a vendor call (the audit processor wrote the rows).
 * 404 paths: see `assertSiteAndConnectedFor`, plus no snapshot yet →
 * `google.noDataYet`.
 */
export async function getSearchSummaryFor(accountId: string, siteId: string, deps: GscSummaryReadDeps, range: GscRange = '28d'): Promise<GoogleSearchSummary> {
    await assertSiteAndConnectedFor(accountId, siteId);
    const windowDays = windowDaysForRange(range);
    const asOf = await deps.readLatestSnapshotDate(siteId, 'query', windowDays);
    if (asOf === null)
        throw HttpError.notFound({ code: 'GOOGLE_NO_DATA_YET', messageKey: 'google.noDataYet' });
    const at = { since: asOf, until: asOf };
    const queryRows = await deps.readSearchAnalytics(siteId, 'query', at, windowDays);
    const pageRows = await deps.readSearchAnalytics(siteId, 'page', at, windowDays);
    const dateRows = await readTimeseriesRows(siteId, windowDays, deps);
    const countryRows = await deps.readSearchAnalytics(siteId, 'country', at, windowDays);
    const deviceRows = await deps.readSearchAnalytics(siteId, 'device', at, windowDays);
    const previous = await deps.readPreviousTotals(siteId, asOf, windowDays);
    return {
        ...summarizeRows(queryRows),
        topQueries: topFive(queryRows).map(({ key, ...rest }) => ({
            query: key,
            ...rest,
        })),
        topPages: topFive(pageRows).map(({ key, ...rest }) => ({
            url: key,
            ...rest,
        })),
        // `date` rows arrive clicks-DESC from the reader — re-sort chronologically
        // (YYYY-MM-DD sorts lexically) for the time-series chart.
        timeseries: [...dateRows]
            /* c8 ignore start -- date keys are unique within one snapshot, so the comparator's equal (0) branch is unreachable. */
            .sort((a, b) => a.dimensionKey < b.dimensionKey
            ? -1
            : a.dimensionKey > b.dimensionKey
                ? 1
                : 0)
            /* c8 ignore stop */
            .map((row) => ({
            date: row.dimensionKey,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
        })),
        countries: countryRows.slice(0, 10).map((row) => ({
            country: row.dimensionKey,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
        })),
        devices: deviceRows.map((row) => ({
            device: row.dimensionKey,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
        })),
        asOf,
        previousPeriod: previous
            ? {
                totalClicks: previous.clicks,
                totalImpressions: previous.impressions,
            }
            : null,
    };
}
// ---------------------------------------------------------------------------
// ?tab=google drill-in reads (full snapshot tables + sitemaps)
// ---------------------------------------------------------------------------
export interface GoogleSearchAnalyticsDetail {
    /** ISO date of the snapshot the rows were read from. */
    asOf: string;
    /** Full latest snapshot for the dimension, clicks-DESC (≤1000 rows). */
    rows: Array<{
        key: string;
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
    }>;
}
/**
 * Full latest snapshot for ONE dimension set — the "View all" drill-in behind
 * the summary card. Pure Postgres read; same 404 ladder as the summary.
 */
export async function getSearchAnalyticsDetailFor(accountId: string, siteId: string, dimension: string, deps: Pick<GscSummaryReadDeps, 'readLatestSnapshotDate' | 'readSearchAnalytics'>, range: GscRange = '28d'): Promise<GoogleSearchAnalyticsDetail> {
    await assertSiteAndConnectedFor(accountId, siteId);
    const windowDays = windowDaysForRange(range);
    const asOf = await deps.readLatestSnapshotDate(siteId, dimension, windowDays);
    if (asOf === null)
        throw HttpError.notFound({ code: 'GOOGLE_NO_DATA_YET', messageKey: 'google.noDataYet' });
    const rows = await deps.readSearchAnalytics(siteId, dimension, { since: asOf, until: asOf }, windowDays);
    return {
        asOf,
        rows: rows.map((row) => ({
            key: row.dimensionKey,
            clicks: row.clicks,
            impressions: row.impressions,
            ctr: row.ctr,
            position: row.position,
        })),
    };
}
/** Structural shape of a `gsc_sitemaps` row as read by `readSitemaps`. */
export interface SitemapSnapshotRowLike {
    snapshotDate: string;
    path: string;
    type: string;
    lastSubmitted: Date | null;
    lastDownloaded: Date | null;
    isPending: boolean;
    isSitemapsIndex: boolean;
    errors: number;
    warnings: number;
    processed: number;
}
export interface GoogleSitemapsResult {
    /** ISO date of the sitemap snapshot; null when none has been written yet. */
    asOf: string | null;
    sitemaps: Array<{
        path: string;
        type: string;
        lastSubmitted: Date | null;
        lastDownloaded: Date | null;
        isPending: boolean;
        isSitemapsIndex: boolean;
        errors: number;
        warnings: number;
        processed: number;
    }>;
}
/**
 * Latest sitemap snapshot for a site. Unlike the analytics reads, an empty
 * list is a legitimate 200 (a connected site can simply have no sitemaps) —
 * only the ownership/connection ladder 404s.
 */
export async function getSitemapsFor(accountId: string, siteId: string, deps: {
    readSitemaps: (siteId: string) => Promise<SitemapSnapshotRowLike[]>;
}): Promise<GoogleSitemapsResult> {
    await assertSiteAndConnectedFor(accountId, siteId);
    const rows = await deps.readSitemaps(siteId);
    return {
        asOf: rows[0]?.snapshotDate ?? null,
        sitemaps: rows.map((row) => ({
            path: row.path,
            type: row.type,
            lastSubmitted: row.lastSubmitted,
            lastDownloaded: row.lastDownloaded,
            isPending: row.isPending,
            isSitemapsIndex: row.isSitemapsIndex,
            errors: row.errors,
            warnings: row.warnings,
            processed: row.processed,
        })),
    };
}
