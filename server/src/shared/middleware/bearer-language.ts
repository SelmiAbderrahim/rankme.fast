import type { Request, RequestHandler, Response } from 'express';
import { LANGUAGE_HEADER, resolveLanguage, translate, type SupportedLocale, type TranslationVars, } from '../i18n/index.js';
export const BEARER_DEFAULT_LOCALE: SupportedLocale = 'en';
export function resolveBearerLanguage(languageHeader?: string | null, acceptLanguage?: string | null): SupportedLocale {
    return resolveLanguage({
        override: languageHeader,
        acceptLanguage,
        defaultLocale: BEARER_DEFAULT_LOCALE,
    });
}
export function setBearerLanguage(req: Request, res: Response, locale: SupportedLocale): void {
    req.language = locale;
    req.t = (key: string, vars?: TranslationVars) => translate(locale, key, vars);
    res.setHeader('Content-Language', locale);
}
export const bearerLanguage: RequestHandler = (req, res, next) => {
    const locale = resolveBearerLanguage(req.get(LANGUAGE_HEADER), req.get('Accept-Language'));
    setBearerLanguage(req, res, locale);
    res.vary(LANGUAGE_HEADER);
    res.vary('Accept-Language');
    next();
};
