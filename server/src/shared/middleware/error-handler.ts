import type { ErrorRequestHandler, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../utils/http-error.js';
import { logger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { localizeZodError, resolveLocalizedError, toSupportedLocale, type LocalizedErrorPayload, } from '../i18n/errors.js';
/**
 * Additive fields that ride alongside the localized message. `details` keeps
 * its established per-feature shape; `stack` exists only in development.
 */
interface ErrorEnvelopeExtras {
    details?: unknown;
    stack?: string;
}
/**
 * One writer for every error envelope. The ordinary object family stays
 * `{ error: { message, details? } }` and gains the stable `code` / `messageKey`
 * metadata, and the response advertises the locale it was rendered in.
 */
function sendLocalizedError(req: Request, res: Response, status: number, payload: LocalizedErrorPayload, extras: ErrorEnvelopeExtras = {}): void {
    res.setHeader('Content-Language', toSupportedLocale(req.language));
    res.status(status).json({
        error: {
            message: payload.message,
            ...(extras.details === undefined ? {} : { details: extras.details }),
            ...(extras.stack === undefined ? {} : { stack: extras.stack }),
            code: payload.code,
            messageKey: payload.messageKey,
        },
    });
}
/** Safe cause label for operator logs — the class name only, never its message. */
function causeName(value: unknown): string | undefined {
    return value instanceof Error ? value.name : undefined;
}
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    if (err instanceof HttpError) {
        const payload = resolveLocalizedError({
            status: err.status,
            locale: req.language,
            messageKey: err.messageKey,
            code: err.code,
            vars: err.vars,
        });
        // Structured metadata only: no translated copy, no interpolation values,
        // no upstream/cause message, no response payload.
        logger.warn({
            reqId: req.id,
            status: err.status,
            code: payload.code,
            messageKey: payload.messageKey,
            causeName: causeName(err.cause),
        }, 'http error');
        sendLocalizedError(req, res, err.status, payload, { details: err.details });
        return;
    }
    if (err instanceof ZodError) {
        sendLocalizedError(req, res, 400, resolveLocalizedError({
            status: 400,
            locale: req.language,
            messageKey: 'errors.validationFailed',
            code: 'VALIDATION_FAILED',
        }), { details: localizeZodError(req.language, err) });
        return;
    }
    // body-parser errors (JSON payload malformed, body too large, aborted, etc.)
    // carry a `type` string and a numeric `status`. Honor the 4xx status with a
    // localized generic message instead of falling through to 500.
    const bodyParserErr = err as {
        type?: unknown;
        status?: unknown;
        statusCode?: unknown;
    };
    const bpStatus = typeof bodyParserErr.status === 'number'
        ? bodyParserErr.status
        : typeof bodyParserErr.statusCode === 'number'
            ? bodyParserErr.statusCode
            : undefined;
    if (typeof bodyParserErr.type === 'string' &&
        typeof bpStatus === 'number' &&
        bpStatus >= 400 &&
        bpStatus < 500) {
        const payload = bodyParserErr.type === 'entity.parse.failed'
            ? resolveLocalizedError({
                status: bpStatus,
                locale: req.language,
                messageKey: 'errors.malformedJson',
            })
            : // Any other parser refusal gets the plain status-family copy — the
                // parser's own English reason is an operator diagnostic.
                resolveLocalizedError({ status: bpStatus, locale: req.language });
        logger.warn({
            reqId: req.id,
            status: bpStatus,
            code: payload.code,
            messageKey: payload.messageKey,
            type: bodyParserErr.type,
        }, 'body parser rejected request');
        sendLocalizedError(req, res, bpStatus, payload);
        return;
    }
    const payload = resolveLocalizedError({ status: 500, locale: req.language });
    logger.error({
        reqId: req.id,
        status: 500,
        code: payload.code,
        messageKey: payload.messageKey,
        causeName: causeName(err),
    }, 'unhandled error');
    sendLocalizedError(req, res, 500, payload, {
        ...(env.NODE_ENV === 'development' && err instanceof Error
            ? { stack: err.stack }
            : {}),
    });
};
