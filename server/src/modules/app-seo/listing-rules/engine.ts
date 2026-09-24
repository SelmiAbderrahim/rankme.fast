import type { AppStoreKind } from '../../../shared/providers/app-data.js';
import { evaluateEngagementRules } from './engagement.js';
import { evaluateFreshnessRules } from './freshness.js';
import { evaluateMetadataRules } from './metadata.js';
import { evaluateParityRules } from './parity.js';
import { normalizeAppInfoForListingRules } from './store-limits.js';
import { APP_LISTING_ENGINE_VERSION, listingEngineOutputSchema, type ListingEngineInput, type ListingEngineOutput, type ListingFinding, type ListingNotObservedNote, type NormalizedListingInput, } from './types.js';
const STORES: readonly AppStoreKind[] = ['google_play', 'app_store'];
const SEVERITY_ORDER: Record<ListingFinding['severity'], number> = {
    fixNow: 0,
    watch: 1,
    advisory: 2,
};
const STATUS_ORDER: Record<ListingFinding['status'], number> = {
    finding: 0,
    notEvaluated: 1,
    passed: 2,
};
const SCOPE_ORDER: Record<ListingFinding['scope'], number> = {
    google_play: 0,
    app_store: 1,
    parity: 2,
};
function compareFindings(left: ListingFinding, right: ListingFinding): number {
    return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
        || STATUS_ORDER[left.status] - STATUS_ORDER[right.status]
        || SCOPE_ORDER[left.scope] - SCOPE_ORDER[right.scope]
        || left.id.localeCompare(right.id);
}
function notesFor(store: AppStoreKind, listing: NormalizedListingInput | null): ListingNotObservedNote[] {
    if (!listing)
        return [{ store, field: 'listing', copyKey: 'appSeo.listing.notObserved.storeFailed' }];
    const notes: ListingNotObservedNote[] = [];
    if (store === 'google_play' && listing.shortDescription === null) {
        notes.push({ store, field: 'shortDescription', copyKey: 'appSeo.listing.notObserved.shortDescription' });
    }
    if (store === 'app_store' && listing.subtitle === null) {
        notes.push({ store, field: 'subtitle', copyKey: 'appSeo.listing.notObserved.subtitle' });
    }
    if (listing.screenshotCount === null) {
        notes.push({ store, field: 'screenshots', copyKey: 'appSeo.listing.notObserved.screenshots' });
    }
    if (listing.installLowerBound === null) {
        notes.push({ store, field: 'installs', copyKey: 'appSeo.listing.notObserved.installs' });
    }
    return notes;
}
/** Pure, deterministic rule fan-out over normalized stored evidence. */
export function evaluateAppListing(input: ListingEngineInput): ListingEngineOutput {
    const normalized: Record<AppStoreKind, NormalizedListingInput | null> = {
        google_play: input.byStore.google_play
            ? normalizeAppInfoForListingRules(input.byStore.google_play)
            : null,
        app_store: input.byStore.app_store
            ? normalizeAppInfoForListingRules(input.byStore.app_store)
            : null,
    };
    const findings: ListingFinding[] = [];
    const notObserved: ListingNotObservedNote[] = [];
    for (const store of STORES) {
        const listing = normalized[store];
        const registered = store === 'google_play'
            ? Boolean(input.profile.playPackageId)
            : Boolean(input.profile.appStoreId);
        if (!registered)
            continue;
        notObserved.push(...notesFor(store, listing));
        if (!listing)
            continue;
        findings.push(...evaluateMetadataRules(listing, input.trackedPhrases), ...evaluateEngagementRules(listing, input.trackedPhrases), ...evaluateFreshnessRules(listing, input.trackedPhrases));
    }
    if (input.profile.paired) {
        findings.push(...evaluateParityRules(normalized.google_play, normalized.app_store));
    }
    return listingEngineOutputSchema.parse({
        findings: findings.sort(compareFindings),
        notObserved: notObserved.sort((left, right) => left.store.localeCompare(right.store) || left.field.localeCompare(right.field)),
        engineVersion: APP_LISTING_ENGINE_VERSION,
    });
}
export { APP_LISTING_ENGINE_VERSION, listingEngineOutputSchema, type ListingEngineInput, type ListingEngineOutput, type ListingFinding, type ListingNotObservedNote, };
