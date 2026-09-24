import type { Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { resolveLocalizedError, toSupportedLocale } from '../../shared/i18n/errors.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { pagesDetailParamsSchema, pagesDetailQuerySchema, pagesListQuerySchema, pagesRefreshBodySchema, pagesSiteParamsSchema, } from './pages.schema.js';
import { PagesError, type PagesService } from './pages.service.js';
/**
 * Pages keeps its own coded envelope (`{ error: { code, message } }` plus the
 * optional stale-state sibling). It now renders through the shared fail-closed
 * resolver, so the stable `PAGES_*` code survives, `messageKey` is additive,
 * and an unresolvable key produces localized status-family copy instead of the
 * raw key.
 */
function sendPagesError(req: Request, res: Response, error: PagesError): void {
    const locale = toSupportedLocale(req.language);
    const payload = resolveLocalizedError({
        status: error.status,
        locale,
        messageKey: error.messageKey,
        code: error.code,
    });
    res.setHeader('Content-Language', locale);
    res.status(error.status).json({
        error: {
            code: payload.code,
            message: payload.message,
            messageKey: payload.messageKey,
            ...(error.details ? { details: error.details } : {}),
        },
        ...(error.state ? { state: error.state } : {}),
    });
}
function handler(run: (req: Request, res: Response) => Promise<void>): RequestHandler {
    return (req, res, next) => {
        run(req, res).catch((error: unknown) => {
            if (error instanceof PagesError) {
                sendPagesError(req, res, error);
                return;
            }
            if (error instanceof ZodError) {
                sendPagesError(req, res, new PagesError(400, 'PAGES_INVALID_REQUEST', 'pages.errors.invalidRequest', { field: error.issues[0]!.path.join('.') }));
                return;
            }
            next(error);
        });
    };
}
export function createPagesController(service: PagesService) {
    const list = handler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = pagesSiteParamsSchema.parse(req.params);
        const query = pagesListQuerySchema.parse(req.query);
        res.status(200).json(await service.list(accountId, siteId, query));
    });
    const detail = handler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId, pageId } = pagesDetailParamsSchema.parse(req.params);
        const { range } = pagesDetailQuerySchema.parse(req.query);
        res.status(200).json(await service.detail(accountId, siteId, pageId, range));
    });
    const refresh = handler(async (req, res) => {
        const accountId = requireAccountId(req);
        const { siteId } = pagesSiteParamsSchema.parse(req.params);
        pagesRefreshBodySchema.parse(req.body);
        res.status(200).json(await service.refresh(accountId, siteId));
    });
    return { list, detail, refresh };
}
