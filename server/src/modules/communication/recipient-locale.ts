import { env } from '../../config/env.js';
import { isSupportedLocale, type SupportedLocale, } from '../../shared/i18n/index.js';
export class InvalidOutboundLocaleError extends Error {
    constructor(source: 'artifact' | 'request') {
        super(`invalid explicit outbound ${source} locale`);
        this.name = 'InvalidOutboundLocaleError';
    }
}
export interface RecipientLocaleInput {
    /** Deliberate artifact/schedule/subscription locale. */
    artifactLocale?: unknown;
    /** Deliberate request locale for actor-triggered security work. */
    requestLocale?: unknown;
    /** Stored preference read for the intended recipient at event acceptance. */
    recipientLocale?: unknown;
}
/**
 * Resolve locale once at the communication acceptance boundary.
 *
 * Explicit resource/request values fail closed when invalid. A corrupt or
 * absent optional user preference safely falls through to the zod-validated
 * deployment default instead of becoming an implicit per-template fallback.
 */
export function resolveRecipientLocale(input: RecipientLocaleInput): SupportedLocale {
    if (input.artifactLocale !== undefined) {
        if (!isSupportedLocale(input.artifactLocale)) {
            throw new InvalidOutboundLocaleError('artifact');
        }
        return input.artifactLocale;
    }
    if (input.requestLocale !== undefined) {
        if (!isSupportedLocale(input.requestLocale)) {
            throw new InvalidOutboundLocaleError('request');
        }
        return input.requestLocale;
    }
    if (isSupportedLocale(input.recipientLocale))
        return input.recipientLocale;
    return env.DEFAULT_LOCALE;
}
