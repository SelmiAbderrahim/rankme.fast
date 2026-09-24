import { Types } from 'mongoose';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site, type SiteDocument, type SiteHydrated } from './sites.model.js';
// Deliberately dependency-light: this file imports ONLY the Site model and
// HttpError so every spend entry point across modules can import it directly
// (`../sites/sites.guard.js`) without risking a barrel cycle — sites/index.ts
// re-exports sites.service.ts, which reaches into audits/ranks internals, and
// audits/auto-rerun.service.ts imports the sites barrel back.
/**
 * Throws a localized 409 when the site is paused. Spend entry points call
 * this after their existing ownership load; reads never do — stored results
 * stay available while paused (kill-switch philosophy).
 */
export function assertSiteNotPaused(site: Pick<SiteDocument, 'paused'>): void {
    if (site.paused === true) {
        throw HttpError.conflict({ code: 'SITES_ERRORS_PAUSED', messageKey: 'sites.errors.paused' });
    }
}
/**
 * Ownership load + pause gate in one step. Malformed ids and cross-account
 * reads surface 404 (never 403 — no existence leaks); paused sites surface
 * 409 unless `allowPaused` is set (read paths, pause/resume themselves).
 */
export async function loadOwnedSite(accountId: string, siteId: string, opts?: {
    allowPaused?: boolean;
}): Promise<SiteHydrated> {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.findOne({
        _id: siteId,
        accountId,
        deletionStartedAt: null,
    });
    if (!site) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    if (!opts?.allowPaused) {
        assertSiteNotPaused(site);
    }
    return site;
}
/**
 * Sweep helper: one `$in` query resolving which of the given siteIds are
 * currently paused. Invalid ids are ignored (they cannot match a paused doc).
 */
export async function filterPausedSiteIds(siteIds: string[]): Promise<Set<string>> {
    const valid = [...new Set(siteIds.filter((id) => Types.ObjectId.isValid(id)))];
    if (valid.length === 0) {
        return new Set();
    }
    const paused = await Site.find({ _id: { $in: valid }, paused: true }, { _id: 1 }).lean();
    return new Set(paused.map((doc) => String(doc._id)));
}
