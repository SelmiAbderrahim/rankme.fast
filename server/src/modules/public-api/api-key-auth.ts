/**
 * Bearer-key authentication for the public read-only API (/api/v1).
 *
 * Replaces the cookie chain: the caller presents `Authorization: Bearer
 * rmf_…`; we hash it, look the digest up in `api_keys`, and populate
 * `req.user` with the owning account so the downstream `requireFeature` /
 * `requireUserId` plumbing works unchanged. Unknown, malformed, revoked,
 * suspended-account, and deletion-scheduled keys all collapse into the SAME
 * localized 401 — no oracle for which keys exist.
 */
import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { Db } from '../../db/client.js';
import { resolveApiKey, touchLastUsed } from '../api-keys/index.js';
import { markTokenAuthenticated } from '../../shared/middleware/rate-limit.js';
import { User } from '../users/index.js';
import { continueWithAccountWorkLease } from '../legal/account-lifecycle.middleware.js';
const BEARER_PATTERN = /^Bearer\s+(rmf_[A-Za-z0-9_-]+)$/;
export function createApiKeyAuth(resolveDb: () => Db): RequestHandler {
    return asyncHandler(async (req, res, next) => {
        const header = req.get('authorization');
        if (!header)
            throw HttpError.unauthorized({ code: 'PUBLIC_API_ERRORS_MISSING', messageKey: 'publicApi.errors.missingKey' });
        const match = BEARER_PATTERN.exec(header);
        const bearerKey = match?.[1];
        if (!bearerKey)
            throw HttpError.unauthorized({ code: 'PUBLIC_API_ERRORS_INVALID', messageKey: 'publicApi.errors.invalidKey' });
        const db = resolveDb();
        const resolved = await resolveApiKey(db, bearerKey);
        if (!resolved)
            throw HttpError.unauthorized({ code: 'PUBLIC_API_ERRORS_INVALID', messageKey: 'publicApi.errors.invalidKey' });
        // A key for a suspended, soft-deleted, or purge-claimed account reads as
        // invalid — suspension must cut API access immediately, not at the next
        // revoke, and `deletionScheduledAt` alone already means soft-deleted.
        const owner = await User.findById(resolved.accountId)
            .select('suspended deletionScheduledAt deletionStartedAt')
            .lean();
        if (!owner ||
            owner.suspended ||
            owner.deletionScheduledAt ||
            owner.deletionStartedAt) {
            throw HttpError.unauthorized({ code: 'PUBLIC_API_ERRORS_INVALID', messageKey: 'publicApi.errors.invalidKey' });
        }
        req.user = { id: resolved.accountId };
        req.apiKeyId = resolved.keyId;
        // Per-key MCP permission scopes (null = unscoped legacy key). The MCP
        // endpoint intersects these with the account defaults; unscoped keys
        // stay fully permissive so existing integrations keep working.
        req.apiKeyScopes = resolved.scopes;
        // Mark this token as "proven" so the per-token limiter allocates a
        // bucket for it. Unproven tokens fall through to the IP-keyed bucket
        // in `apiRateLimitKey` — prevents random bearer values from allocating
        // one MemoryStore bucket each.
        markTokenAuthenticated(createHash('sha256').update(bearerKey).digest('hex'));
        const acquired = await continueWithAccountWorkLease(resolved.accountId, req.id, res, next);
        if (!acquired)
            throw HttpError.unauthorized({ code: 'PUBLIC_API_ERRORS_INVALID', messageKey: 'publicApi.errors.invalidKey' });
        // Fire-and-forget freshness bump — must never delay or fail the request.
        void touchLastUsed(db, resolved.keyId).catch(() => { });
    });
}
