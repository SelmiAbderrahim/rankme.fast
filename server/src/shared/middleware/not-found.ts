import type { RequestHandler } from 'express';
import { HttpError } from '../utils/http-error.js';
import { logger } from '../../config/logger.js';
export const notFound: RequestHandler = (req, _res, next) => {
    // Unknown paths can contain bearer tokens, email addresses, or arbitrary
    // query text. The request id is enough to correlate this line with the
    // access log without copying attacker/customer-controlled content.
    logger.info({ reqId: req.id, method: req.method }, 'route not found');
    next(HttpError.notFound({ code: 'ERRORS_NOT_FOUND', messageKey: 'errors.notFound' }));
};
