import { STALE_UPDATE_DAYS } from './store-limits.js';
import type { ListingFinding, ListingRule } from './types.js';
export const evaluateFreshnessRules: ListingRule = (input) => {
    const observedMs = Date.parse(input.observedAt);
    const updatedMs = input.updatedAt === null ? Number.NaN : Date.parse(input.updatedAt);
    const ageDays = Number.isFinite(observedMs) && Number.isFinite(updatedMs)
        ? Math.max(0, Math.floor((observedMs - updatedMs) / 86400000))
        : null;
    const status: ListingFinding['status'] = ageDays === null
        ? 'notEvaluated'
        : ageDays > STALE_UPDATE_DAYS
            ? 'finding'
            : 'passed';
    return [{
            id: 'stale-update',
            scope: input.store,
            severity: 'advisory',
            status,
            copyKey: 'appSeo.listing.findings.stale-update',
            params: { ageDays: ageDays ?? 0, maximum: STALE_UPDATE_DAYS },
            provenance: 'store-observation',
        }];
};
