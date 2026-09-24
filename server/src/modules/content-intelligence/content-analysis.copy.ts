import { hasTranslationKey, localizeSemanticCopy, type SupportedLocale, type TranslationKey, } from '../../shared/i18n/index.js';
import type { Recommendation, Scorecard } from './content-analysis.schemas.js';
const WARNING_KEYS = {
    serp_unavailable: 'contentIntelligence.warnings.serpUnavailable',
    competitors_partial: 'contentIntelligence.warnings.competitorsPartial',
    stuffing_suspected: 'contentIntelligence.warnings.stuffingSuspected',
    ai_budget_exhausted: 'contentIntelligence.warnings.aiBudgetExhausted',
    brief_failed: 'contentIntelligence.warnings.briefFailed',
    draft_failed: 'contentIntelligence.warnings.draftFailed',
} as const satisfies Record<string, TranslationKey>;
function allowlistedKey(value: string, prefix: 'contentIntelligence.reasons.' | 'contentIntelligence.rules.', fallback: TranslationKey): TranslationKey {
    const candidate = value as TranslationKey;
    return value.startsWith(prefix) && hasTranslationKey(candidate) ? candidate : fallback;
}
export function localizeContentAnalysisWarning(locale: SupportedLocale, warning: {
    code: string;
    messageKey: string;
}) {
    const messageKey = WARNING_KEYS[warning.code as keyof typeof WARNING_KEYS] ??
        'contentIntelligence.warnings.unknown';
    const copy = localizeSemanticCopy(locale, messageKey);
    return { code: warning.code, messageKey: copy.messageKey, message: copy.message };
}
export function localizeScorecard(locale: SupportedLocale, scorecard: Scorecard) {
    return {
        ...scorecard,
        sections: scorecard.sections.map((section) => {
            const reasonKey = allowlistedKey(section.reason, 'contentIntelligence.reasons.', 'contentIntelligence.reasons.unknown');
            const copy = localizeSemanticCopy(locale, reasonKey);
            return { ...section, reasonKey, reasonText: copy.message };
        }),
    };
}
export function localizeRecommendation(locale: SupportedLocale, recommendation: Recommendation) {
    const messageKey = allowlistedKey(recommendation.messageKey, 'contentIntelligence.rules.', 'contentIntelligence.rules.unknown');
    const copy = localizeSemanticCopy(locale, messageKey);
    return { ...recommendation, messageKey, message: copy.message };
}
export const contentAnalysisCopyTestables = Object.freeze({
    WARNING_KEYS,
    allowlistedKey,
});
