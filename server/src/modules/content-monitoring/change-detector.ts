/**
 * Public-page change detection.
 *
 * Deterministic, versioned comparison of a freshly-observed monitor check
 * against the monitor's stored last state. We run OUR OWN detection (the vendor
 * AI judge is disabled) so a change only counts as MATERIAL when the normalized
 * content fingerprint actually moved — timestamp/ads/nav churn that the vendor
 * folds into `status: 'changed'` is suppressed when the normalized hash is
 * unchanged.
 *
 * Pure module: no DB, no env, no clock. The processor feeds it the previous
 * fingerprint + the new event and persists the returned decision.
 */
import { createHash } from 'node:crypto';
import type { PageChangeStatus } from '../../shared/providers/index.js';
/** Bump when the normalization rules below change (stored on each decision). */
export const CHANGE_DETECTOR_VERSION = 'v1';
export interface ChangeInput {
    /** Vendor per-page status. */
    status: PageChangeStatus;
    /** Vendor content fingerprint for this snapshot (may be null). */
    contentHash: string | null;
    /** Bounded, already-sanitized diff text (may be null). */
    diffText: string | null;
}
export interface PreviousState {
    /** Normalized fingerprint stored from the last MATERIAL observation. */
    normalizedHash: string | null;
    /** Last accepted non-error page state; optional for legacy callers/rows. */
    status?: PageChangeStatus | null;
}
interface ChangeDecisionResult {
    /** The normalized fingerprint to persist as the new last state (null keeps prior). */
    normalizedHash: string | null;
    /** Non-error page state to persist with the monotonic baseline. */
    normalizedStatus: PageChangeStatus | null;
    detectorVersion: string;
}
/**
 * Materiality and reason are a discriminated pair. This prevents a durable
 * notification plan from ever storing a non-material reason by construction.
 */
export type ChangeDecision = ChangeDecisionResult & ({
    material: true;
    reason: 'hash_changed' | 'page_removed' | 'page_restored';
} | {
    material: false;
    reason: 'first_observation' | 'noise_suppressed' | 'unchanged' | 'error_status';
});
/**
 * Normalize a vendor content hash to our stored fingerprint. When the vendor
 * gives no hash we derive one from the sanitized diff text so a diff-only
 * delivery still moves the fingerprint deterministically.
 */
export function normalizeFingerprint(input: ChangeInput): string | null {
    if (input.contentHash && input.contentHash.trim().length > 0) {
        return createHash('sha256')
            .update(`${CHANGE_DETECTOR_VERSION}|${input.contentHash.trim()}`)
            .digest('hex');
    }
    if (input.diffText && input.diffText.trim().length > 0) {
        return createHash('sha256')
            .update(`${CHANGE_DETECTOR_VERSION}|diff|${input.diffText.trim()}`)
            .digest('hex');
    }
    return null;
}
/**
 * Decide whether an observation is a material change. Rules (in order):
 *   1. `error` status → never material (a fetch failure is surfaced separately).
 *   2. `removed` → always material (the page is gone), keeps the prior hash.
 *   3. no prior hash → first observation is recorded but never notifies.
 *   4. new normalized hash differs from prior → MATERIAL change.
 *   5. vendor said `changed`/`new` but the normalized hash is identical →
 *      NOISE (timestamp/ads/nav churn), suppressed.
 *   6. otherwise unchanged.
 */
export function detectChange(previous: PreviousState, input: ChangeInput): ChangeDecision {
    const base = { detectorVersion: CHANGE_DETECTOR_VERSION };
    if (input.status === 'error') {
        return {
            material: false,
            reason: 'error_status',
            normalizedHash: previous.normalizedHash,
            normalizedStatus: previous.status ?? null,
            ...base,
        };
    }
    if (input.status === 'removed') {
        if (previous.status === 'removed') {
            return {
                material: false,
                reason: 'unchanged',
                normalizedHash: previous.normalizedHash,
                normalizedStatus: 'removed',
                ...base,
            };
        }
        return {
            material: true,
            reason: 'page_removed',
            normalizedHash: previous.normalizedHash,
            normalizedStatus: 'removed',
            ...base,
        };
    }
    const next = normalizeFingerprint(input);
    if (previous.status === 'removed') {
        return {
            material: true,
            reason: 'page_restored',
            normalizedHash: next ?? previous.normalizedHash,
            normalizedStatus: input.status,
            ...base,
        };
    }
    if (previous.normalizedHash === null) {
        // First time we have a fingerprint for this page — record it, never notify.
        return {
            material: false,
            reason: 'first_observation',
            normalizedHash: next,
            normalizedStatus: input.status,
            ...base,
        };
    }
    if (next !== null && next !== previous.normalizedHash) {
        return {
            material: true,
            reason: 'hash_changed',
            normalizedHash: next,
            normalizedStatus: input.status,
            ...base,
        };
    }
    // Vendor flagged a change but the normalized fingerprint did not move —
    // suppress it as noise. `same` with an identical hash is simply unchanged.
    if (input.status === 'changed' || input.status === 'new') {
        return {
            material: false,
            reason: 'noise_suppressed',
            normalizedHash: previous.normalizedHash,
            normalizedStatus: input.status,
            ...base,
        };
    }
    return {
        material: false,
        reason: 'unchanged',
        normalizedHash: previous.normalizedHash,
        normalizedStatus: input.status,
        ...base,
    };
}
