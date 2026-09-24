import { createHash } from 'node:crypto';
export const PAGE_URL_MAX_BYTES = 2048;
export type PageUrlDropReason = 'malformed_url' | 'offsite_url';
export interface CanonicalPageUrl {
    canonicalUrl: string;
    displayUrl: string;
    pageHash: string;
}
export type CanonicalPageUrlResult = {
    ok: true;
    value: CanonicalPageUrl;
} | {
    ok: false;
    reason: PageUrlDropReason;
};
function utf8Length(value: string): number {
    return Buffer.byteLength(value, 'utf8');
}
function parseHttpUrl(value: string): URL | null {
    if (value.length === 0 || utf8Length(value) > PAGE_URL_MAX_BYTES)
        return null;
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return null;
        if (parsed.username !== '' || parsed.password !== '')
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
function isAllowedHost(candidate: string, stored: string): boolean {
    if (candidate === stored)
        return true;
    if (stored.startsWith('www.'))
        return candidate === stored.slice(4);
    return candidate === `www.${stored}`;
}
function sortedSearch(searchParams: URLSearchParams): URLSearchParams {
    const pairs = [...searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => Buffer.compare(Buffer.from(leftKey, 'utf8'), Buffer.from(rightKey, 'utf8')) ||
        Buffer.compare(Buffer.from(leftValue, 'utf8'), Buffer.from(rightValue, 'utf8')));
    const result = new URLSearchParams();
    for (const [key, value] of pairs)
        result.append(key, value);
    return result;
}
/**
 * Pure same-site canonicalization for untrusted provider ranking URLs. It
 * performs no DNS lookup or network request. HTTP/HTTPS and the single www
 * counterpart converge onto the stored site's normalized origin; arbitrary
 * subdomains, lookalikes, credentials, and non-default ports are rejected.
 */
export function canonicalizePageUrl(candidate: string, storedSiteUrl: string): CanonicalPageUrlResult {
    const stored = parseHttpUrl(storedSiteUrl);
    const parsed = parseHttpUrl(candidate);
    if (!stored || !parsed)
        return { ok: false, reason: 'malformed_url' };
    const storedHost = stored.hostname.toLowerCase();
    const candidateHost = parsed.hostname.toLowerCase();
    if (!isAllowedHost(candidateHost, storedHost) || parsed.port !== stored.port) {
        return { ok: false, reason: 'offsite_url' };
    }
    const canonical = new URL(stored.origin);
    canonical.pathname = parsed.pathname;
    canonical.search = '';
    for (const [key, value] of sortedSearch(parsed.searchParams)) {
        canonical.searchParams.append(key, value);
    }
    canonical.hash = '';
    const canonicalUrl = canonical.toString();
    if (utf8Length(canonicalUrl) > PAGE_URL_MAX_BYTES) {
        return { ok: false, reason: 'malformed_url' };
    }
    return {
        ok: true,
        value: {
            canonicalUrl,
            displayUrl: canonicalUrl.replace(/^https?:\/\//, ''),
            pageHash: createHash('sha256').update(canonicalUrl, 'utf8').digest('base64url'),
        },
    };
}
