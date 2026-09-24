import type { RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { getAuth } from '../../modules/auth/index.js';
import { continueWithAccountWorkLease } from '../../modules/legal/account-lifecycle.middleware.js';
// Direct import — the users/index barrel sits in the require-auth ↔ auth ↔ users
// cycle and pulling it here breaks users.routes middleware init at boot.
import { User } from '../../modules/users/users.model.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
/**
 * Session guard. Resolves the Better Auth session from the request cookies
 * and attaches the identity to `req.user`. Missing/expired/tampered sessions
 * get a localized 401; a suspended account gets a localized 403 — mirroring
 * the bearer-key path (`public-api/api-key-auth.ts`) so both auth channels
 * cut suspended access immediately, not on the next revoke.
 */
export const requireAuth: RequestHandler = asyncHandler(async (req, res, next) => {
    const session = await getAuth().api.getSession({
        headers: fromNodeHeaders(req.headers),
    });
    if (!session) {
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    }
    // Consult the Mongo mirror — the single source of truth for the suspended
    // flag. A missing mirror doc (mirror-lag on a brand-new signup) is NOT a
    // block; only an explicit `suspended === true` throws.
    const mirror = await User.findById(session.user.id)
        .select('suspended deletionStartedAt')
        .lean();
    if (mirror?.suspended || mirror?.deletionStartedAt) {
        throw HttpError.forbidden({ code: 'AUTH_SUSPENDED', messageKey: 'auth.suspended' });
    }
    const rawTwoFactor = (session.user as {
        twoFactorEnabled?: unknown;
    }).twoFactorEnabled;
    const rawMustChangePassword = (session.user as {
        mustChangePassword?: unknown;
    }).mustChangePassword;
    const rawProvisionalAccount = (session.user as {
        provisionalAccount?: unknown;
    }).provisionalAccount;
    const rawSessionCreatedAt = (session.session as {
        createdAt?: unknown;
    } | undefined)?.createdAt;
    let recentAuthAt: string | undefined;
    if (rawSessionCreatedAt instanceof Date) {
        recentAuthAt = rawSessionCreatedAt.toISOString();
    }
    else if (typeof rawSessionCreatedAt === 'string') {
        recentAuthAt = rawSessionCreatedAt;
    }
    req.user = {
        id: session.user.id,
        email: session.user.email,
        role: typeof session.user.role === 'string' ? session.user.role : undefined,
        emailVerified: session.user.emailVerified,
        mustChangePassword: typeof rawMustChangePassword === 'boolean' ? rawMustChangePassword : false,
        provisionalAccount: typeof rawProvisionalAccount === 'boolean' ? rawProvisionalAccount : false,
        /* c8 ignore next -- Better Auth's twoFactor plugin adds the column with
           defaultValue: false, so this is always a boolean at runtime; the
           fallback exists only to satisfy the type. */
        twoFactorEnabled: typeof rawTwoFactor === 'boolean' ? rawTwoFactor : false,
        ...(recentAuthAt ? { recentAuthAt } : {}),
    };
    // A missing mirror can occur briefly during Better Auth signup. Existing
    // identities always have one; once account purge starts the atomic lease
    // acquisition fails even if this read raced the deletion claim.
    if (mirror) {
        const acquired = await continueWithAccountWorkLease(session.user.id, req.id, res, next);
        if (!acquired)
            throw HttpError.forbidden({ code: 'AUTH_SUSPENDED', messageKey: 'auth.suspended' });
        return;
    }
    next();
});
