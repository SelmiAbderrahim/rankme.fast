/**
 * Cookie header parser shared by every middleware that reads a single named
 * cookie from a raw `Cookie:` header (csrf, language, request-locale). Takes
 * the raw header string — an Express `Request` caller passes
 * `req.headers.cookie`, a fetch caller passes `headers.get('cookie')`.
 *
 * Semantics preserved from the three prior copies:
 *   - malformed percent-encoding falls back to the raw value
 *   - `a=b=c` keeps everything after the first `=` (value = `b=c`)
 *   - a fragment with no `=` is skipped
 *   - missing header or missing named cookie both return `null`
 */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
    if (!cookieHeader)
        return null;
    for (const part of cookieHeader.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1)
            continue;
        if (part.slice(0, idx).trim() !== name)
            continue;
        const raw = part.slice(idx + 1).trim();
        try {
            return decodeURIComponent(raw);
        }
        catch {
            return raw;
        }
    }
    return null;
}
