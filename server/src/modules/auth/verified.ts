import type { RequestHandler } from 'express';
import { HttpError } from '../../shared/utils/http-error.js';
/**
 * Hard gate: an authenticated user whose email is not verified is blocked
 * from product routes. Runs after `requireAuth`, which copies
 * `emailVerified` off the Better Auth session — no extra DB round-trip. The
 * `code` in details lets the client branch on the machine-readable reason
 * rather than translated text.
 */
export const requireVerified: RequestHandler = (req, _res, next) => {
    if (!req.user) {
        next(HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' }));
        return;
    }
    if (!req.user.emailVerified) {
        next(HttpError.forbidden({ code: 'ERRORS_EMAIL_NOT_VERIFIED', messageKey: 'errors.emailNotVerified' }, { code: 'EMAIL_NOT_VERIFIED' }));
        return;
    }
    next();
};
