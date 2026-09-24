/**
 * Deterministic confidence tuple.
 *
 * high:   ≥3 independent registrable domains AND ≥2 source types AND
 *         ≥1 cited source observedAt within 12 months of the run createdAt.
 * medium: ≥2 independent domains OR ≥2 source types.
 * low:    otherwise; reasonCode='anecdotal_coverage'.
 *
 * AI never emits confidence — service code computes it AFTER validation.
 */
import type { PublicPageSourceHint } from '../../shared/providers/types.js';
export type Confidence = 'high' | 'medium' | 'low';
export type ConfidenceReasonCode = 'anecdotal_coverage';
export interface ConfidenceCitedSource {
    registrableDomain: string;
    sourceType: PublicPageSourceHint;
    observedAt: string | null;
}
export interface ComputeConfidenceInput {
    citedSources: readonly ConfidenceCitedSource[];
    runCreatedAt: Date;
}
export interface ConfidenceResult {
    confidence: Confidence;
    reasonCode: ConfidenceReasonCode | null;
    independentDomainCount: number;
    sourceTypeCount: number;
    mostRecentSourceObservedAt: string | null;
}
const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
export function computeConfidence(input: ComputeConfidenceInput): ConfidenceResult {
    const domains = new Set<string>();
    const types = new Set<PublicPageSourceHint>();
    let mostRecent: string | null = null;
    let recentTs: number | null = null;
    for (const s of input.citedSources) {
        if (s.registrableDomain.length > 0)
            domains.add(s.registrableDomain);
        types.add(s.sourceType);
        if (s.observedAt) {
            const ts = Date.parse(s.observedAt);
            if (!Number.isNaN(ts)) {
                if (recentTs === null || ts > recentTs) {
                    recentTs = ts;
                    mostRecent = s.observedAt;
                }
            }
        }
    }
    const independentDomainCount = domains.size;
    const sourceTypeCount = types.size;
    const runTs = input.runCreatedAt.getTime();
    const hasRecent = recentTs !== null && runTs - recentTs <= TWELVE_MONTHS_MS && runTs - recentTs >= -TWELVE_MONTHS_MS;
    let confidence: Confidence;
    let reasonCode: ConfidenceReasonCode | null = null;
    if (independentDomainCount >= 3 && sourceTypeCount >= 2 && hasRecent) {
        confidence = 'high';
    }
    else if (independentDomainCount >= 2 || sourceTypeCount >= 2) {
        confidence = 'medium';
    }
    else {
        confidence = 'low';
        reasonCode = 'anecdotal_coverage';
    }
    return {
        confidence,
        reasonCode,
        independentDomainCount,
        sourceTypeCount,
        mostRecentSourceObservedAt: mostRecent,
    };
}
