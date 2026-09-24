/**
 * Content Intelligence — competitor URL selection.
 *
 * Given a raw SERP `serpTopUrls` list, return up to `ceiling` competitor URLs
 * that survive all deterministic filters:
 *   - not the owned domain (case-insensitive host match, `www.` stripped);
 *   - not a duplicate (per normalized origin+path);
 *   - not a PDF / binary asset (extension allowlist);
 *   - not an obvious login-wall / auth path;
 *   - safe per an injectable `assertSafe` (SEC-URL authority in production).
 *
 * Pure — no I/O beyond the injected `assertSafe` promise.
 */
const BINARY_EXTS = new Set([
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.zip',
    '.gz',
    '.tar',
    '.7z',
    '.mp3',
    '.mp4',
    '.mov',
    '.avi',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
]);
const LOGIN_PATTERNS = [
    '/login',
    '/signin',
    '/sign-in',
    '/auth',
    '/account/login',
    '/user/login',
];
export interface SelectCompetitorInput {
    serpTopUrls: readonly string[];
    ownedDomain: string;
    ceiling: number;
    assertSafe: (url: string) => Promise<unknown>;
}
export interface SelectedCompetitor {
    url: string;
    host: string;
}
export interface CompetitorRejection {
    url: string;
    reason: 'invalid-url' | 'owned-domain' | 'duplicate' | 'binary-asset' | 'login-wall' | 'unsafe';
}
export interface SelectCompetitorResult {
    selected: SelectedCompetitor[];
    rejected: CompetitorRejection[];
}
function normalizeHost(host: string): string {
    return host.toLowerCase().replace(/^www\./, '');
}
function normalizeKey(u: URL): string {
    return `${normalizeHost(u.hostname)}${u.pathname.replace(/\/+$/, '') || '/'}`;
}
function lastExtension(pathname: string): string {
    const lastSlash = pathname.lastIndexOf('/');
    const tail = pathname.slice(lastSlash + 1).toLowerCase();
    const dot = tail.lastIndexOf('.');
    if (dot < 0)
        return '';
    return tail.slice(dot);
}
function looksLikeLogin(pathname: string): boolean {
    const lower = pathname.toLowerCase();
    return LOGIN_PATTERNS.some((p) => lower.startsWith(p));
}
/**
 * Filter + safety-check up to `ceiling` competitor URLs. Runs each candidate's
 * `assertSafe` sequentially so a single unsafe URL is caught before it counts
 * toward the ceiling.
 */
export async function selectCompetitorCandidates(input: SelectCompetitorInput): Promise<SelectCompetitorResult> {
    const ownedHost = normalizeHost(input.ownedDomain);
    const seen = new Set<string>();
    const selected: SelectedCompetitor[] = [];
    const rejected: CompetitorRejection[] = [];
    for (const raw of input.serpTopUrls) {
        if (selected.length >= input.ceiling)
            break;
        let parsed: URL;
        try {
            parsed = new URL(raw);
        }
        catch {
            rejected.push({ url: raw, reason: 'invalid-url' });
            continue;
        }
        const host = normalizeHost(parsed.hostname);
        if (host === ownedHost) {
            rejected.push({ url: raw, reason: 'owned-domain' });
            continue;
        }
        const key = normalizeKey(parsed);
        if (seen.has(key)) {
            rejected.push({ url: raw, reason: 'duplicate' });
            continue;
        }
        if (BINARY_EXTS.has(lastExtension(parsed.pathname))) {
            rejected.push({ url: raw, reason: 'binary-asset' });
            continue;
        }
        if (looksLikeLogin(parsed.pathname)) {
            rejected.push({ url: raw, reason: 'login-wall' });
            continue;
        }
        try {
            await input.assertSafe(raw);
        }
        catch {
            rejected.push({ url: raw, reason: 'unsafe' });
            continue;
        }
        seen.add(key);
        selected.push({ url: raw, host });
    }
    return { selected, rejected };
}
