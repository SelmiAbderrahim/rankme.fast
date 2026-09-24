/**
 * Weekly Pulse — HTTP controllers.
 *
 * All routes are behind `[requireAuth, requireVerified]` (mounted at app
 * level). Cross-account access → 404. Preview is read-only.
 */
import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { db as productionDb } from '../../db/client.js';
import type { Queue } from 'bullmq';
import { DEFAULT_LOCALE, isSupportedLocale, toSupportedLocale } from '../../shared/i18n/index.js';
import { getPulseHistoryDetail, getPulseHistoryPage, getPulseState, previewPulseSpend, setPulseSubscription, } from './weekly-pulse.service.js';
import { historyCursorQuerySchema, pulseIdParamsSchema, setSubscriptionBodySchema, siteIdParamsSchema, } from './weekly-pulse.schema.js';
// ---------------------------------------------------------------------------
// Holder — the app boot wires the queue + db; tests inject overrides.
// ---------------------------------------------------------------------------
let holderDb: ApplicationDb | null = null;
let holderQueue: Queue | null = null;
export function setWeeklyPulseDb(db: ApplicationDb | null): void {
    holderDb = db;
}
export function setWeeklyPulseQueue(queue: Queue | null): void {
    holderQueue = queue;
}
export function resolveWeeklyPulseDb(): ApplicationDb {
    return holderDb ?? (productionDb as unknown as ApplicationDb);
}
function requireUser(req: Request) {
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    return req.user;
}
function resolveLocale(req: Request): string {
    const language = (req as unknown as {
        language?: string;
    }).language;
    if (typeof language === 'string' && isSupportedLocale(language))
        return language;
    return DEFAULT_LOCALE;
}
// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------
export const getPulseStateController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const user = requireUser(req);
    const params = siteIdParamsSchema.parse(req.params);
    const view = await getPulseState({ accountId: accountId, siteId: params.siteId, userId: user.id }, { db: resolveWeeklyPulseDb(), queue: holderQueue });
    res.status(200).json(view);
});
export const previewPulseController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const user = requireUser(req);
    const params = siteIdParamsSchema.parse(req.params);
    const preview = await previewPulseSpend({ accountId: accountId, siteId: params.siteId, userId: user.id });
    res.status(200).json(preview);
});
export const setPulseSubscriptionController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const user = requireUser(req);
    const params = siteIdParamsSchema.parse(req.params);
    const body = setSubscriptionBodySchema.parse(req.body);
    const resolvedLocale = resolveLocale(req);
    const view = await setPulseSubscription({
        accountId: accountId,
        siteId: params.siteId,
        userId: user.id,
        enabled: body.enabled,
        ...(body.acknowledgedPreviewAt
            ? { acknowledgedPreviewAt: body.acknowledgedPreviewAt }
            : {}),
        ...(body.locale ? { locale: body.locale } : {}),
        resolvedLocale,
    }, { db: resolveWeeklyPulseDb(), queue: holderQueue });
    res.status(200).json(view);
});
export const getPulseHistoryController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const user = requireUser(req);
    const params = siteIdParamsSchema.parse(req.params);
    const query = historyCursorQuerySchema.parse(req.query);
    const page = await getPulseHistoryPage({
        accountId: accountId,
        siteId: params.siteId,
        userId: user.id,
        limit: query.limit,
        ...(query.cursor ? { cursor: query.cursor } : {}),
    }, { db: resolveWeeklyPulseDb(), queue: holderQueue });
    res.status(200).json(page);
});
export const getPulseHistoryDetailController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const user = requireUser(req);
    const params = pulseIdParamsSchema.parse(req.params);
    const locale = toSupportedLocale(req.language);
    const detail = await getPulseHistoryDetail({
        accountId: accountId,
        siteId: params.siteId,
        userId: user.id,
        pulseId: params.pulseId,
        locale,
    }, { db: resolveWeeklyPulseDb(), queue: holderQueue });
    res.setHeader('Content-Language', locale);
    res.status(200).json(detail);
});
