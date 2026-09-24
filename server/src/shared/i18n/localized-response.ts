import type { Request, Response } from 'express';
import { renderTranslation, toSupportedLocale, type TranslationKey } from './errors.js';
import type { TranslationVars } from './index.js';
/**
 * Write an authored success/acknowledgement without changing the owning DTO.
 * `message` remains the existing human field; `messageKey` and
 * `Content-Language` are additive. Machine/status/source fields supplied in
 * `body` are copied unchanged.
 */
export function sendLocalizedMessage<T extends Record<string, unknown>>(req: Request, res: Response, status: number, messageKey: TranslationKey, body: T, vars?: TranslationVars): void {
    const locale = toSupportedLocale(req.language);
    res.setHeader('Content-Language', locale);
    res.status(status).json({
        ...body,
        message: renderTranslation(locale, messageKey, vars),
        messageKey,
    });
}
