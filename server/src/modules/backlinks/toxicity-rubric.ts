import type { ToxicityBand } from '../../db/schema/index.js';
export const TOXICITY_RUBRIC_VERSION = 'toxicity-rubric-v1' as const;
export const TOXICITY_SIGNALS = [
    'spam_clean',
    'spam_watch',
    'spam_toxic',
    'broken',
    'dofollow',
    'nofollow',
] as const;
export type ToxicitySignal = (typeof TOXICITY_SIGNALS)[number];
export interface ToxicityRubricInput {
    spamScore: number;
    dofollow: boolean;
    isBroken: boolean;
}
export interface ToxicityRubricResult {
    band: ToxicityBand;
    rubricVersion: typeof TOXICITY_RUBRIC_VERSION;
    sourceKind: 'provider_observation';
    signals: readonly ToxicitySignal[];
}
function boundedSpamScore(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
        throw new RangeError('spamScore must be an integer from 0 to 100');
    }
    return value;
}
/** Deterministic rubric v1. It reports observations; it predicts no action. */
export function classifyToxicity(input: ToxicityRubricInput): ToxicityRubricResult {
    const spamScore = boundedSpamScore(input.spamScore);
    const basePoints = spamScore >= 60 ? 2 : spamScore >= 30 ? 1 : 0;
    const adjusted = Math.max(0, Math.min(2, basePoints + (input.isBroken ? 1 : 0) - (input.dofollow ? 0 : 1)));
    const band = (['clean', 'watch', 'toxic'] as const)[adjusted]!;
    const spamSignal = (spamScore >= 60
        ? 'spam_toxic'
        : spamScore >= 30
            ? 'spam_watch'
            : 'spam_clean') satisfies ToxicitySignal;
    return {
        band,
        rubricVersion: TOXICITY_RUBRIC_VERSION,
        sourceKind: 'provider_observation',
        signals: [
            spamSignal,
            ...(input.isBroken ? (['broken'] as const) : []),
            input.dofollow ? 'dofollow' : 'nofollow',
        ],
    };
}
