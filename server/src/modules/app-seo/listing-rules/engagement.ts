import { LOW_RATING_THRESHOLD, MIN_RECOMMENDED_SCREENSHOTS } from './store-limits.js';
import type { ListingFinding, ListingRule, NormalizedListingInput } from './types.js';
function outcome(input: NormalizedListingInput, id: string, severity: ListingFinding['severity'], status: ListingFinding['status'], params: ListingFinding['params']): ListingFinding {
    return {
        id,
        scope: input.store,
        severity,
        status,
        copyKey: `appSeo.listing.findings.${id}`,
        params,
        provenance: 'store-observation',
    };
}
export const evaluateEngagementRules: ListingRule = (input) => [
    outcome(input, 'screenshots-few', 'watch', input.screenshotCount === null
        ? 'notEvaluated'
        : input.screenshotCount < MIN_RECOMMENDED_SCREENSHOTS
            ? 'finding'
            : 'passed', { actual: input.screenshotCount ?? 0, minimum: MIN_RECOMMENDED_SCREENSHOTS }),
    outcome(input, 'rating-low', 'watch', input.rating === null
        ? 'notEvaluated'
        : input.rating < LOW_RATING_THRESHOLD
            ? 'finding'
            : 'passed', { actual: input.rating ?? 0, minimum: LOW_RATING_THRESHOLD }),
];
