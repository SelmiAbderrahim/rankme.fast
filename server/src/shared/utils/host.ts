/**
 * Host normalization shared by every "is this the same site?" comparison
 * (competitor self-add guard, www/non-www site aliases).
 *
 * Accepts a bare host (`WWW.Example.com.`) or an absolute URL
 * (`https://www.example.com/path`) and returns the comparable host: lowercase,
 * trailing dot dropped, one leading `www.` stripped. Scheme, port, path, query
 * and hash never take part, so http/https variants and www/non-www aliases
 * collapse to the same value. Returns `''` when no host can be read.
 */
export function normalizeHost(hostOrUrl: string): string {
    const raw = hostOrUrl.trim();
    let host = raw;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        try {
            host = new URL(raw).hostname;
        }
        catch {
            return '';
        }
    }
    return host
        .toLowerCase()
        .replace(/\.+$/, '')
        .replace(/^www\./, '');
}
/** True when both inputs normalize to the same non-empty host. */
export function isSameHost(a: string, b: string): boolean {
    const left = normalizeHost(a);
    return left !== '' && left === normalizeHost(b);
}
