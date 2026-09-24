import type { SpendPreview } from '../../shared/safety/operation-preview.js';
/**
 * Read-only spend preview for one Review Intelligence sync.
 *
 * ONE sync covers the whole request regardless of how many sources (1..3) or
 * what depth (1..100) was requested. The breakdown therefore carries a single
 * operation whose `productUnits` is 1.
 *
 * MUST NOT mutate, enqueue, or call a provider.
 */
import { assertReviewIntelligenceEnabled, loadOwnedProfile, } from './review-sync.service.js';
import type { ReviewPreviewInput } from './review-sync.schema.js';
export interface ReviewPreviewDeps {
    now?: () => Date;
}
export async function previewReviewSyncSpend(accountId: string, input: ReviewPreviewInput, deps: ReviewPreviewDeps = {}): Promise<SpendPreview> {
    await loadOwnedProfile(accountId, input.profileId);
    assertReviewIntelligenceEnabled();
    const now = (deps.now ?? (() => new Date()))();
    return {
        deploymentMode: 'community',
        capacityEnforced: false,
        feature: 'review_intelligence',
        operation: 'review-sync',
        metric: 'review_syncs',
        productUnits: 1,
        // Reviews are never served from the cross-user vendor cache — a sync
        // always makes a fresh per-account fetch.
        cachedStatus: 'miss',
        breakdown: [
            {
                operationKey: `review-sync:${input.sources.join('+')}`.slice(0, 64),
                metric: 'review_syncs',
                productUnits: 1,
                cachedStatus: 'miss',
            },
        ],
        coverage: [
            {
                observationType: 'public-review-listing',
                state: 'supported',
                coverageNoteKey: 'observations.coverage.publicReviewsOnly',
            },
        ],
        estimatedAt: now.toISOString(),
    };
}
