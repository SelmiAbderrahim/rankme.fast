import { sha256CanonicalLandscape } from './landscape.canonical.js';
import { LANDSCAPE_ROWS_PER_LEG, type LandscapeLeg } from './landscape.schemas.js';
export const LANDSCAPE_CACHE_OPERATION = 'domain_comparison_leg_v1';
export interface LandscapeCacheKeyInput {
    accountId: string;
    siteId: string;
    ownedDomain: string;
    competitorDomain: string;
    locationCode: number;
    languageCode: string;
    leg: LandscapeLeg;
    providerVersion: string;
    schemaVersion: string;
}
/** Account/site deliberately participate: the target pair is private intent. */
export function landscapeCacheKey(input: LandscapeCacheKeyInput): string {
    return sha256CanonicalLandscape({
        accountId: input.accountId,
        siteId: input.siteId,
        ownedDomain: input.ownedDomain,
        competitorDomain: input.competitorDomain,
        locationCode: input.locationCode,
        languageCode: input.languageCode.toLowerCase(),
        leg: input.leg,
        itemTypes: ['organic'],
        limit: LANDSCAPE_ROWS_PER_LEG,
        providerVersion: input.providerVersion,
        schemaVersion: input.schemaVersion,
    });
}
/** Cache lifetime is bounded to the next UTC midnight after capture. */
export function nextUtcMidnight(capturedAt: Date): Date {
    return new Date(Date.UTC(capturedAt.getUTCFullYear(), capturedAt.getUTCMonth(), capturedAt.getUTCDate() + 1));
}
