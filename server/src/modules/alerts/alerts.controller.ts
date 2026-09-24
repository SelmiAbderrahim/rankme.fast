import type { Request, Response } from 'express';
import { db as productionDb } from '../../db/client.js';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { requireAccountId } from '../../shared/utils/require-account-id.js';
import { getAlertsDb, getAlertsUrlSafety } from './alerts.holder.js';
import { createRuleBodySchema, listDeliveriesQuerySchema, listRulesQuerySchema, ruleIdParamsSchema, updateRuleBodySchema, } from './alerts.schema.js';
import { createRule, deleteRule, listDeliveriesForRule, listRulesForAccount, updateRule, type AlertsServiceDeps, } from './alerts.service.js';
import { findRule } from './alerts.repo.js';
import { allowedTeamSiteIds } from '../../shared/middleware/team-site-access.js';
export function resolveAlertsDb() {
    return getAlertsDb() ?? productionDb;
}
/**
 * Service deps for every controller. The SSRF seam is only threaded when a test
 * installed one, so production keeps the authority's real resolver.
 */
export function resolveAlertsDeps(): AlertsServiceDeps {
    const urlSafety = getAlertsUrlSafety();
    return {
        db: resolveAlertsDb(),
        ...(urlSafety === null ? {} : { urlSafety }),
    };
}
/** Resolve a resource-scoped alert URL to its owning Site for lifecycle leases. */
export async function resolveOwnedAlertRuleSiteId(accountId: string, ruleId: string): Promise<string | null> {
    // PostgreSQL's uuid comparison rejects malformed input before the route's
    // normal zod handler can shape the response, so malformed ids fall through.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ruleId)) {
        return null;
    }
    const rule = await findRule(resolveAlertsDb(), accountId, ruleId);
    return rule?.siteId ?? null;
}
/** GET /api/alerts/rules — masked reads; survives the kill switch. */
export const listRulesController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const query = listRulesQuerySchema.parse(req.query);
    const page = await listRulesForAccount({
        accountId: accountId,
        query,
        allowedSiteIds: allowedTeamSiteIds(req),
    }, resolveAlertsDeps());
    res.status(200).json(page);
});
/** POST /api/alerts/rules — SSRF; show-once webhook secret. */
export const createRuleController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const body = createRuleBodySchema.parse(req.body);
    const rule = await createRule({ accountId: accountId, body }, resolveAlertsDeps());
    res.status(201).json(rule);
});
/** PATCH /api/alerts/rules/:ruleId — re-validates any changed channel URL. */
export const updateRuleController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = ruleIdParamsSchema.parse(req.params);
    const body = updateRuleBodySchema.parse(req.body);
    const rule = await updateRule({ accountId: accountId, ruleId: params.ruleId, body }, resolveAlertsDeps());
    res.status(200).json(rule);
});
/** DELETE /api/alerts/rules/:ruleId — cascades the delivery log. */
export const deleteRuleController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = ruleIdParamsSchema.parse(req.params);
    await deleteRule({ accountId: accountId, ruleId: params.ruleId }, resolveAlertsDeps());
    res.status(204).end();
});
/** GET /api/alerts/rules/:ruleId/deliveries — evidence pair included. */
export const listDeliveriesController = asyncHandler(async (req: Request, res: Response) => {
    // Resolve the account FIRST: an unauthenticated call must 401 here,
    // never fall through to a schema parse and surface as a 400.
    const accountId = requireAccountId(req);
    const params = ruleIdParamsSchema.parse(req.params);
    const query = listDeliveriesQuerySchema.parse(req.query);
    const page = await listDeliveriesForRule({ accountId: accountId, ruleId: params.ruleId, query }, resolveAlertsDeps());
    res.status(200).json(page);
});
