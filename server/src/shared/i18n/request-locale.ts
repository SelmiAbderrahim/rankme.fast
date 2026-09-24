import { LANGUAGE_COOKIE, LANGUAGE_HEADER, resolveLanguage } from './index.js';
import type { SupportedLocale } from './index.js';
import { env } from '../../config/env.js';
import { readCookie } from '../utils/cookies.js';
/**
 * Resolve the preferred locale from a WHATWG fetch `Request` (the shape Better
 * Auth hands to its email hooks). Mirrors the express `language` middleware:
 * `x-lang` header > `lang` cookie > `Accept-Language` > DEFAULT_LOCALE.
 */
export function localeFromFetchRequest(request?: Request): SupportedLocale {
    const headers = request?.headers;
    return resolveLanguage({
        override: headers?.get(LANGUAGE_HEADER) ?? undefined,
        cookieValue: readCookie(headers?.get('cookie'), LANGUAGE_COOKIE),
        acceptLanguage: headers?.get('accept-language') ?? undefined,
        defaultLocale: env.DEFAULT_LOCALE,
    });
}
