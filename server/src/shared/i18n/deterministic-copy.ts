import type { SupportedLocale } from './locales.js';
import type { TranslationVars } from './index.js';
import { renderTranslation, sanitizeTranslationVars, type TranslationKey, } from './errors.js';
/** Locale-neutral metadata retained beside deterministic human copy. */
export interface SemanticCopy {
    messageKey: TranslationKey;
    messageVars?: TranslationVars;
}
/** A semantic descriptor rendered exactly once for a response or artifact. */
export interface LocalizedSemanticCopy extends SemanticCopy {
    message: string;
}
export function semanticCopy(messageKey: TranslationKey, vars?: unknown): SemanticCopy {
    const messageVars = sanitizeTranslationVars(vars);
    return messageVars ? { messageKey, messageVars } : { messageKey };
}
export function localizeSemanticCopy(locale: SupportedLocale, messageKey: TranslationKey, vars?: unknown): LocalizedSemanticCopy {
    const copy = semanticCopy(messageKey, vars);
    return {
        ...copy,
        message: renderTranslation(locale, copy.messageKey, copy.messageVars),
    };
}
