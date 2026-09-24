import type { RequestHandler } from 'express';
import { HttpError } from '../../shared/utils/http-error.js';
/**
 * Product-chain guard. Invitation inbox/decisions and Better Auth password
 * rotation are mounted outside this chain, so provisional identities can do
 * exactly those operations and nothing else until an invitation is accepted.
 */
export const requireClaimedAccount: RequestHandler = (req, _res, next) => {
    if (req.user?.provisionalAccount) {
        next(HttpError.forbidden({ code: 'TEAM_ERRORS_PROVISIONAL_RESTRICTED', messageKey: 'team.errors.provisionalRestricted' }));
        return;
    }
    next();
};
