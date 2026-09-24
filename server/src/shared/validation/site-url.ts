/**
 * Strict Site URL input validation.
 *
 * This is INPUT validation, not an SSRF boundary — vendors crawl the target
 * on their own infra; we only guard API-credit spend and data quality. No
 * outbound fetch happens here, and no custom headers/cookies are ever
 * accepted for the target.
 *
 * Mirrored on the client in `client/src/features/sites/validation.ts` —
 * keep the two in lockstep.
 */
export const SITE_URL_MAX_LENGTH = 2048;
export type SiteUrlRejectReason = 'required' | 'tooLong' | 'invalid' | 'scheme' | 'userinfo' | 'ipLiteral' | 'noTld';
export type SiteUrlResult = {
    ok: true;
    url: string;
    domain: string;
} | {
    ok: false;
    reason: SiteUrlRejectReason;
};
export interface SiteUrlOptions {
    /** Test-env escape hatch only — never enabled in production paths. */
    allowLocalhost?: boolean;
}
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;
/**
 * Validate + normalize a user-supplied site URL.
 *
 * Accepts only `http:`/`https:`; rejects userinfo, IP literals (v4/v6),
 * dotless hostnames (unless `localhost` is explicitly allowed for tests),
 * and inputs over 2048 chars. Normalizes to the origin: lowercase hostname,
 * default ports stripped, path/query/hash dropped.
 */
export function validateSiteUrl(input: string, options: SiteUrlOptions = {}): SiteUrlResult {
    const trimmed = input.trim();
    if (trimmed.length === 0)
        return { ok: false, reason: 'required' };
    if (trimmed.length > SITE_URL_MAX_LENGTH)
        return { ok: false, reason: 'tooLong' };
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    }
    catch {
        return { ok: false, reason: 'invalid' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, reason: 'scheme' };
    }
    if (parsed.username !== '' || parsed.password !== '') {
        return { ok: false, reason: 'userinfo' };
    }
    const hostname = parsed.hostname;
    /* c8 ignore next -- unreachable defence: WHATWG URL rejects empty hosts for http/https ('http://' throws above). */
    if (hostname.length === 0)
        return { ok: false, reason: 'invalid' };
    // IPv6 literals surface bracketed ('[::1]'); IPv4 as dotted quads.
    if (hostname.startsWith('[') || IPV4_PATTERN.test(hostname)) {
        return { ok: false, reason: 'ipLiteral' };
    }
    if (!hostname.includes('.') && !(options.allowLocalhost === true && hostname === 'localhost')) {
        return { ok: false, reason: 'noTld' };
    }
    // `URL.origin` already lowercases the hostname (punycoding IDNs) and
    // strips default ports — store the origin, hostname as the domain.
    return { ok: true, url: parsed.origin, domain: hostname };
}
