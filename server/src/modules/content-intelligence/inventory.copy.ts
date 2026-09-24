import { localizeSemanticCopy, type SupportedLocale, type TranslationKey, } from '../../shared/i18n/index.js';
import type { InventoryFindings } from './inventory.schemas.js';
const WARNING_KEYS = {
    inventory_partial_crawl: 'contentIntelligence.inventory.warnings.partialCrawl',
    inventory_stopped_early: 'contentIntelligence.inventory.warnings.stoppedEarly',
    inventory_evidence_missing: 'contentIntelligence.inventory.warnings.evidenceMissing',
    inventory_explanation_skipped: 'contentIntelligence.inventory.warnings.explanationSkipped',
} as const satisfies Record<string, TranslationKey>;
const REASON_KEYS = {
    thin: 'contentIntelligence.inventory.reasons.thin',
    orphan: 'contentIntelligence.inventory.reasons.orphan',
    weakly_linked: 'contentIntelligence.inventory.reasons.weaklyLinked',
} as const satisfies Record<string, TranslationKey>;
export function localizeInventoryWarning(locale: SupportedLocale, warning: {
    code: string;
    messageKey: string;
}) {
    const messageKey = WARNING_KEYS[warning.code as keyof typeof WARNING_KEYS] ??
        'contentIntelligence.inventory.warnings.unknown';
    const copy = localizeSemanticCopy(locale, messageKey);
    return { code: warning.code, messageKey: copy.messageKey, message: copy.message };
}
export function localizeInventoryFindings(locale: SupportedLocale, findings: InventoryFindings) {
    const localizeFlag = (item: InventoryFindings['thinPages'][number]) => {
        const reasonKey = REASON_KEYS[item.reason];
        const copy = localizeSemanticCopy(locale, reasonKey);
        return { ...item, reasonKey, reasonText: copy.message };
    };
    return {
        ...findings,
        thinPages: findings.thinPages.map(localizeFlag),
        orphanPages: findings.orphanPages.map(localizeFlag),
    };
}
export const inventoryCopyTestables = Object.freeze({ REASON_KEYS, WARNING_KEYS });
