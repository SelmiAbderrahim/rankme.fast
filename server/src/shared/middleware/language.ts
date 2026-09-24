import type { RequestHandler } from 'express';
import { LANGUAGE_COOKIE, LANGUAGE_HEADER, resolveLanguage, translate, type TranslationVars, } from '../i18n/index.js';
import { env } from '../../config/env.js';
import { readCookie } from '../utils/cookies.js';
export const language: RequestHandler = (req, res, next) => {
    const headerOverride = req.headers[LANGUAGE_HEADER];
    const override = Array.isArray(headerOverride) ? headerOverride[0] : headerOverride;
    const cookieValue = readCookie(req.headers.cookie, LANGUAGE_COOKIE);
    const acceptLanguage = req.headers['accept-language'];
    const resolved = resolveLanguage({
        override,
        cookieValue,
        acceptLanguage: Array.isArray(acceptLanguage) ? acceptLanguage[0] : acceptLanguage,
        defaultLocale: env.DEFAULT_LOCALE,
    });
    req.language = resolved;
    req.t = (key: string, vars?: TranslationVars) => translate(resolved, key, vars);
    // Every API response declares the language negotiated for presentation
    // copy. Artifact controllers may replace this with their pinned output
    // locale after successful access checks.
    res.setHeader('Content-Language', resolved);
    next();
};
