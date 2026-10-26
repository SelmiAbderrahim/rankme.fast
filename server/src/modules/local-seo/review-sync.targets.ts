/**
 * Per-source review target rules.
 *
 * `normalizeReviewTarget` is the single server authority; the client mirrors
 * it in `client/src/features/local-seo/reviews/targets.ts` and BOTH test
 * suites run the same case table (`review-target-cases.json`). Keep the two
 * in lockstep.
 *
 * Why these rules exist: the old schema accepted any non-blank token, so a
 * typo such as `abc` was saved and later sent to the vendor as a SEARCH
 * keyword, where it matches some unrelated business and spends a sync.
 *
 * Google Place ID — Google documents NO fixed length or alphabet ("there is no
 * maximum length for place IDs"; IDs "may change over time"), so this is a
 * deliberate HEURISTIC, not a guarantee. It is permissive on purpose:
 *   - known ID families by prefix: `ChIJ` (standard), `GhIJ` / `EhIJ`
 *     (legacy encodings, e.g. GhIJQWDl0CIeQUARxks3icF8U8A), `Ei` (route /
 *     address-style IDs, base64 payloads such as `Eicx…`);
 *   - a base64url body (`A-Z a-z 0-9 _ -`, optional trailing `=` padding);
 *   - at least 20 characters in total (real IDs are 27+; shorter strings are
 *     typos or business names);
 *   - the provider-prefixed forms the contract has always allowed:
 *     `place_id:<id>` and `cid:<digits>` (a numeric Google customer id).
 * A format-valid ID is only "saved": whether Google/the vendor can resolve it
 * is known after a sync, never at save time.
 *
 * Tripadvisor — the numeric location id (`23462501`). `d23462501` (the form in
 * Tripadvisor page URLs) and the legacy `location_id:23462501` prefix are
 * accepted and normalized to the bare digits.
 *
 * Test seam — when the reviews provider is the in-process fake (the keyless
 * dev / CI / e2e stack), `__scenario-<name>` targets are also accepted so the
 * composed stack can drive the fake's failure and hostile-content scenarios
 * through the real HTTP surface. Real deployments never opt in. The browser
 * form has no such seam: it applies the strict rules above.
 *
 * Trustpilot — the reviewed business domain, normalized through the shared
 * site-URL validator (`WWW.Example.COM` and `example.com` are one target).
 */
import { validateSiteUrl } from '../../shared/validation/site-url.js';
import { REVIEW_TARGET_MAX_CHARS, type ReviewSourceName } from './review-sync.model.js';

export const GOOGLE_PLACE_ID_MIN_LENGTH = 20;

const GOOGLE_PLACE_ID_PATTERN = /^(?:ChIJ|GhIJ|EhIJ|Ei)[A-Za-z0-9_-]+={0,2}$/;
const GOOGLE_CID_PATTERN = /^cid:\d{1,20}$/;
const TRIPADVISOR_LOCATION_PATTERN = /^(?:location_id:|d)?(\d{1,12})$/i;

function normalizeGoogle(value: string): string | null {
    if (GOOGLE_CID_PATTERN.test(value)) return value;
    const id = value.startsWith('place_id:') ? value.slice('place_id:'.length) : value;
    return id.length >= GOOGLE_PLACE_ID_MIN_LENGTH && GOOGLE_PLACE_ID_PATTERN.test(id)
        ? value
        : null;
}

function normalizeTrustpilot(value: string): string | null {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(value)) return null;
    const parsed = validateSiteUrl(`https://${value}`);
    if (!parsed.ok || parsed.domain.length > REVIEW_TARGET_MAX_CHARS) return null;
    return parsed.domain.toLowerCase().replace(/^www\./, '');
}

function normalizeTripadvisor(value: string): string | null {
    const match = TRIPADVISOR_LOCATION_PATTERN.exec(value);
    return match?.[1] ?? null;
}

const FAKE_SCENARIO_PATTERN = /^__scenario-[a-z-]+$/;

export interface NormalizeReviewTargetOptions {
    /** True only while `PROVIDER_REVIEWS=fake` (see "Test seam" above). */
    allowFakeScenarios?: boolean;
}

/** The stored target for `raw`, or `null` when it cannot identify a business. */
export function normalizeReviewTarget(
    source: ReviewSourceName,
    raw: string,
    options: NormalizeReviewTargetOptions = {},
): string | null {
    const value = raw.trim();
    if (value.length === 0 || value.length > REVIEW_TARGET_MAX_CHARS) return null;
    if (options.allowFakeScenarios === true && FAKE_SCENARIO_PATTERN.test(value)) return value;
    if (source === 'google') return normalizeGoogle(value);
    if (source === 'trustpilot') return normalizeTrustpilot(value);
    return normalizeTripadvisor(value);
}
