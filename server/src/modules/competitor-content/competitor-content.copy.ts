import { localizeSemanticCopy, type SupportedLocale, type TranslationKey, } from '../../shared/i18n/index.js';
import type { CompetitorContentFindings } from './competitor-content.schemas.js';
const WARNING_KEYS = {
    competitor_partial: 'contentIntelligence.competitorContent.warnings.partialPortfolio',
    competitor_stopped_early: 'contentIntelligence.competitorContent.warnings.stoppedEarly',
    competitor_ai_rejected: 'contentIntelligence.competitorContent.warnings.aiCopyRejected',
} as const satisfies Record<string, TranslationKey>;
const AI_WARNING_KEYS = new Set<TranslationKey>([
    'contentIntelligence.competitorContent.warnings.aiBudgetExhausted',
    'contentIntelligence.competitorContent.warnings.aiUnavailable',
]);
export function localizeCompetitorContentWarning(locale: SupportedLocale, warning: {
    code: string;
    messageKey: string;
}) {
    const candidate = warning.code === 'competitor_ai_skipped' &&
        AI_WARNING_KEYS.has(warning.messageKey as TranslationKey)
        ? warning.messageKey as TranslationKey
        : WARNING_KEYS[warning.code as keyof typeof WARNING_KEYS] ??
            'contentIntelligence.competitorContent.warnings.unknown';
    const copy = localizeSemanticCopy(locale, candidate);
    return { code: warning.code, messageKey: copy.messageKey, message: copy.message };
}
export function localizeCompetitorContentFindings(locale: SupportedLocale, findings: CompetitorContentFindings) {
    return {
        ...findings,
        opportunities: findings.opportunities.map((opportunity) => {
            const copy = localizeSemanticCopy(locale, opportunity.messageKey, opportunity.messageVars);
            return {
                ...opportunity,
                ...(copy.messageVars ? { messageVars: copy.messageVars } : {}),
                label: copy.message,
            };
        }),
    };
}
export const competitorContentCopyTestables = Object.freeze({
    AI_WARNING_KEYS,
    WARNING_KEYS,
});
