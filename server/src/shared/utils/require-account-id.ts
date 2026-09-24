import type { Request } from 'express';
import { HttpError } from './http-error.js';
/**
 * The account that OWNS the data this request touches
 * (`rankme-enterprise-orgs` 02).
 *
 * Every product module scopes its resources and meters its spend with this,
 * so an accepted member working inside the owner's workspace draws the
 * OWNER's caps and credit ledger. Audit rows keep
 * `actorUserId = req.user.id` — the human who acted. The two are different
 * axes and must never be swapped.
 *
 * `req.workspaceAccountId` is populated by `workspaceContext()`. The
 * fallback keeps routes mounted without it (bearer-key `/api/v1`, MCP,
 * admin/superadmin panels) behaving exactly as before.
 *
 * Controllers call this as their FIRST statement, before any zod parse, so an
 * unauthenticated request answers 401 rather than falling through to a 400.
 * The message is an i18n key — unlike `requireUserId`, which still throws a
 * raw English literal — because this replaced per-module guards that were
 * already localized.
 */
export function requireAccountId(req: Request): string {
    if (req.workspaceAccountId !== undefined)
        return req.workspaceAccountId;
    if (!req.user)
        throw HttpError.unauthorized({ code: 'ERRORS_UNAUTHORIZED', messageKey: 'errors.unauthorized' });
    return req.user.id;
}
