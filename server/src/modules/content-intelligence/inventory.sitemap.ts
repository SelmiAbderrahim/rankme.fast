/**
 * Content inventory — dependency-free, XXE-safe sitemap `<loc>` scanner.
 *
 * Sitemaps are attacker-influenceable XML. This scanner:
 *   - is a LINEAR text scan — no DTD, no external-entity resolution, no
 *     parameter-entity expansion, so an XML-bomb or SSRF-via-external-entity
 *     can never fire (there is no entity engine to exploit);
 *   - hard-rejects a document that contains a DOCTYPE or ENTITY declaration
 *     (`<!DOCTYPE`, `<!ENTITY`) rather than silently ignoring it;
 *   - enforces a byte cap on the input and a URL-count cap on the output;
 *   - extracts only `<loc>…</loc>` text and rejects any non-`http(s)` scheme.
 *
 * It returns validated absolute http(s) URLs (deduped, order-preserving). It
 * NEVER fetches anything — the caller fetches the sitemap through
 * `fetchPublicUrlSafe` and validates each returned URL through
 * `assertPublicUrlSafe` before crawling.
 */
export const SITEMAP_MAX_BYTES = 5000000; // 5 MB — well beyond any real sitemap.
export const SITEMAP_MAX_URLS = 500;
export interface ParseSitemapOptions {
    maxBytes?: number;
    maxUrls?: number;
}
export type ParseSitemapReason = 'too_large' | 'dtd_forbidden';
export interface ParseSitemapResult {
    urls: string[];
    /** True when the URL cap was hit and later `<loc>` entries were dropped. */
    truncated: boolean;
    rejected: ParseSitemapReason | null;
}
const LOC_OPEN = '<loc>';
const LOC_CLOSE = '</loc>';
/** Decode the five predefined XML entities only — no custom-entity engine. */
function decodeXmlText(raw: string): string {
    return raw
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}
function isHttpUrl(value: string): boolean {
    // Length-cap BEFORE constructing a URL (bounded, no regex over the input).
    if (value.length === 0 || value.length > 2048)
        return false;
    let parsed: URL;
    try {
        parsed = new URL(value);
    }
    catch {
        return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}
/**
 * Parse `<loc>` entries from a sitemap document. Deterministic, allocation-
 * bounded, single forward pass.
 */
export function parseSitemapLocs(xml: string, options: ParseSitemapOptions = {}): ParseSitemapResult {
    const maxBytes = options.maxBytes ?? SITEMAP_MAX_BYTES;
    const maxUrls = options.maxUrls ?? SITEMAP_MAX_URLS;
    // Byte cap (UTF-8 byte length, not code-point length).
    if (Buffer.byteLength(xml, 'utf8') > maxBytes) {
        return { urls: [], truncated: false, rejected: 'too_large' };
    }
    // Hard-reject DTD / entity declarations — case-insensitive, but a plain
    // `indexOf` on the lowercased copy keeps this a linear scan with no regex.
    const lowered = xml.toLowerCase();
    if (lowered.includes('<!doctype') || lowered.includes('<!entity')) {
        return { urls: [], truncated: false, rejected: 'dtd_forbidden' };
    }
    const urls: string[] = [];
    const seen = new Set<string>();
    let truncated = false;
    let cursor = 0;
    while (cursor < lowered.length) {
        const openAt = lowered.indexOf(LOC_OPEN, cursor);
        if (openAt === -1)
            break;
        const contentStart = openAt + LOC_OPEN.length;
        const closeAt = lowered.indexOf(LOC_CLOSE, contentStart);
        if (closeAt === -1)
            break;
        // Slice from the ORIGINAL (case-preserving) string.
        const rawValue = xml.slice(contentStart, closeAt).trim();
        cursor = closeAt + LOC_CLOSE.length;
        const value = decodeXmlText(rawValue);
        if (!isHttpUrl(value) || seen.has(value))
            continue;
        if (urls.length >= maxUrls) {
            truncated = true;
            break;
        }
        seen.add(value);
        urls.push(value);
    }
    return { urls, truncated, rejected: null };
}
