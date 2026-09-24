import type { ObservationMeta } from '../../shared/observations/types.js';
import type { ActionSourceType, ActionState } from '../../db/schema/action-events.js';
import type { SemanticCopy, TranslationKey, TranslationVars, } from '../../shared/i18n/index.js';
import type { Confidence, Effort, FirstPartyImpact, Severity, } from './actions.orders.js';
export type { ActionSourceType, ActionState } from '../../db/schema/action-events.js';
export interface ActionEvidence {
    sourceRef: string;
    url?: string;
    observation: ObservationMeta;
}
export interface ActionCopyKeys {
    problem: TranslationKey;
    whyItMatters: TranslationKey;
    nextStep: TranslationKey;
}
// Provider-neutral candidate emitted by an adapter. Never persisted.
export interface CandidateAction {
    sourceType: ActionSourceType;
    sourceId: string;
    affectedUrls: readonly string[];
    evidence: readonly ActionEvidence[];
    severity: Severity;
    firstPartyImpact: FirstPartyImpact;
    confidence: Confidence;
    effort: Effort;
    // Default source state — overlaid by user event history for non-content sources
    // and mapped from source truth for content_recommendation / citation_gap.
    sourceState: ActionState;
    observedAt: string;
    lastVerifiedAt: string | null;
    retestAvailable: boolean;
    retestReasonKey?: TranslationKey;
    copyKeys: ActionCopyKeys;
    copyVars?: TranslationVars;
    codeFixPrompt?: {
        reference: string;
        recommendedFixKey: TranslationKey;
        affectedUrlCount: number;
    };
}
export interface ActionItem {
    id: string;
    siteId: string;
    sourceType: ActionSourceType;
    sourceId: string;
    sourceLink: string;
    problem: string;
    whyItMatters: string;
    nextStep: string;
    copy: {
        problem: SemanticCopy;
        whyItMatters: SemanticCopy;
        nextStep: SemanticCopy;
    };
    affectedUrls: readonly string[];
    evidence: readonly ActionEvidence[];
    severity: Severity;
    firstPartyImpact: FirstPartyImpact;
    confidence: Confidence;
    effort: Effort;
    state: ActionState;
    version: number;
    /**
     * True when the action is `completed` yet its source still emits it from an
     * observation made AFTER the user marked it done — the fix did not hold, or
     * the problem came back. Derived per read; never persisted.
     */
    reappearedAfterFix: boolean;
    observedAt: string;
    lastVerifiedAt: string | null;
    retest: {
        available: boolean;
        reason?: string;
        code?: 'RETEST_UNSUPPORTED';
        messageKey?: TranslationKey;
        messageVars?: TranslationVars;
    };
    codeFixPrompt?: {
        reference: string;
        recommendedFix: string;
        affectedUrlCount: number;
    };
}
export type SourceStatus = 'available' | 'stale' | 'unavailable';
export interface SourceStatusEntry {
    status: SourceStatus;
    lastObservedAt?: string;
}
export type SourceStatusEnvelope = Partial<Record<ActionSourceType, SourceStatusEntry>>;
// Runtime confidence mapper: freshness → high|medium|low.
// Deterministic; no AI.
export function confidenceFromFreshness(freshness: ObservationMeta['freshness']): Confidence {
    switch (freshness) {
        case 'fresh':
            return 'high';
        case 'stale':
            return 'medium';
        default:
            return 'low';
    }
}
