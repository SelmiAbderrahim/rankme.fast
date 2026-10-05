/**
 * Site-level probe.
 *
 * The on-page vendor reports a handful of site-wide booleans but never says
 * whether `robots.txt` declares the sitemap or whether `/llms.txt` exists, and
 * its "canonicalization" flag carries no evidence of WHICH address variant is
 * wrong. Those rules therefore always landed in "Not evaluated", or as a
 * warning the user could not act on.
 *
 * The probe reads the few public URLs those checks are about, through the
 * shared SSRF authority, after the crawl finishes:
 *
 *   - `robots.txt`  → is a `Sitemap:` directive declared?
 *   - `sitemap.xml` → is a sitemap served at the conventional path?
 *   - `llms.txt`    → is the file served (not an HTML soft-404)?
 *   - the four http/https × apex/www origins → where does each one end up?
 *
 * `robots.txt`, `sitemap.xml` and `llms.txt` are read from the origin the
 * start page ended on, and independently of whether that page could be read
 * (a bot-blocked or erroring home page must not hide them).
 *
 * Every read is bounded (deadline, redirect ceiling, response size). A read
 * that fails leaves its signal absent, so the rule keeps its
 * "insufficient data" behaviour instead of inventing a verdict — and the
 * failure (HTTP status / unreachable / blocked) is recorded so the report
 * can say what happened.
 */
import type { AddressVariantResult, AuditHostRedirect, SiteProbeFailure, SiteProbeFailures } from '../../shared/providers/index.js';
import { fetchPublicUrlSafeWithFinalUrl, type FetchPublicUrlSafeOptions } from '../../shared/security/url-safety.js';

export interface SiteProbeResult {
    /** Final URL of the site's own https start page; absent when it could not be read. */
    startPageFinalUrl?: string;
    sitemapReferencedInRobots?: boolean;
    /** `/sitemap.xml` is served (not an HTML soft-404), or robots.txt declares one. */
    sitemapFound?: boolean;
    llmsTxtFound?: boolean;
    /** Why a root file gave no verdict; independent of the start page. */
    failures?: SiteProbeFailures;
    /** Absent when the site's own https address could not be read. */
    addressVariants?: AddressVariantResult[];
}

export type SiteProbe = (target: { domain: string; url: string }) => Promise<SiteProbeResult>;

/** Minimal response view the probe needs — lets tests fake the network. */
export interface ProbeResponse {
    status: number;
    finalUrl: string;
    contentType: string;
    /** Response body as text; only read for text resources. */
    text: () => Promise<string>;
}

export interface SiteProbeOptions {
    /** Returns the terminal response, or null when the URL did not answer. */
    fetchUrl?: (url: string) => Promise<ProbeResponse | null>;
    /** DNS / transport seams for the default SSRF-safe reader (tests only). */
    safety?: Pick<FetchPublicUrlSafeOptions, 'resolver' | 'transport'>;
}

const DEADLINE_MS = 8000;
const MAX_REDIRECTS = 5;
const MAX_TEXT_BYTES = 256 * 1024;
/** Statuses that mean the site refused us (bot protection, auth, rate limit). */
const BLOCKED_STATUSES: ReadonlySet<number> = new Set([401, 403, 429]);

const defaultFetchUrl = (safety: SiteProbeOptions['safety']) => (url: string): Promise<ProbeResponse | null> =>
    fetchPublicUrlSafeWithFinalUrl(url, { method: 'GET', headers: { accept: 'text/plain,text/html;q=0.8,*/*;q=0.5' } }, {
        ...safety,
        // The http:// variants are exactly what this check is about.
        allowHttp: true,
        deadlineMs: DEADLINE_MS,
        maxRedirects: MAX_REDIRECTS,
        maxResponseBytes: MAX_TEXT_BYTES,
    }).then(({ response, finalUrl }) => ({
        status: response.status,
        finalUrl: finalUrl.href,
        contentType: response.headers.get('content-type') ?? '',
        text: () => response.text(),
    }), () => null);

/** Bare hostname without a leading `www.`. */
function apexOf(hostname: string): string {
    return hostname.toLowerCase().replace(/^www\./, '');
}

/** `Sitemap:` directives declared in a robots.txt body. */
export function robotsSitemapDirectives(body: string): string[] {
    const out: string[] = [];
    for (const line of body.split(/\r?\n/)) {
        const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
        if (match)
            out.push(match[1]!);
    }
    return out;
}

/**
 * Where did the crawl really land? Both signals name a hostname other than
 * the site's own: the start page's final URL after redirects (probe), and the
 * hostnames of the crawled pages themselves (vendor). When no crawled page is
 * on the site's host, the dominant crawled host wins because that is what
 * every finding's affected URLs point at. Returns null when the crawl stayed
 * on the site's host or no evidence exists.
 */
export function detectHostRedirect(siteHost: string, startPageFinalUrl: string | undefined, pageUrls: readonly string[]): AuditHostRedirect | null {
    const from = siteHost.toLowerCase();
    const counts = new Map<string, number>();
    for (const url of pageUrls) {
        try {
            const host = new URL(url).hostname.toLowerCase();
            counts.set(host, (counts.get(host) ?? 0) + 1);
        }
        catch {
            // A malformed vendor URL carries no host evidence.
        }
    }
    if (counts.size > 0 && !counts.has(from)) {
        const [dominant] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
        return { from, to: dominant };
    }
    if (startPageFinalUrl) {
        const to = new URL(startPageFinalUrl).hostname.toLowerCase();
        if (to !== from)
            return { from, to };
    }
    return null;
}

const isHtml = (contentType: string): boolean => /\bhtml\b/i.test(contentType);

/**
 * What went wrong reading one root file. Only reads that did not give a
 * usable verdict (a 404 / 410 is a verdict: the file is not there).
 */
function failureOf(response: ProbeResponse | null): SiteProbeFailure {
    if (!response)
        return { reason: 'unreachable' };
    const reason = BLOCKED_STATUSES.has(response.status) ? 'blocked' : 'http-error';
    return { reason, status: response.status };
}

export function createSiteProbe(opts: SiteProbeOptions = {}): SiteProbe {
    const fetchUrl = opts.fetchUrl ?? defaultFetchUrl(opts.safety);
    return async ({ domain, url }) => {
        let siteHost: string;
        try {
            siteHost = new URL(url).hostname.toLowerCase();
        }
        catch {
            siteHost = domain.toLowerCase();
        }
        const apex = apexOf(siteHost);
        const home = await fetchUrl(`https://${siteHost}/`);
        const out: SiteProbeResult = {};
        // The root files below do not depend on the start page being
        // readable: a bot-blocked or erroring home page must not hide them.
        // They are read from the origin the start page ended on — the
        // redirected host when it answered, the site's own host otherwise.
        let origin = `https://${siteHost}`;
        const homeUsable = home !== null && home.status < 400;
        if (home) {
            const final = new URL(home.finalUrl);
            if (homeUsable || apexOf(final.hostname) === apex)
                origin = final.origin;
        }
        if (homeUsable)
            out.startPageFinalUrl = new URL(home.finalUrl).href;

        const [robots, sitemap, llms] = await Promise.all([
            fetchUrl(`${origin}/robots.txt`),
            fetchUrl(`${origin}/sitemap.xml`),
            fetchUrl(`${origin}/llms.txt`),
        ]);

        const failures: NonNullable<SiteProbeResult['failures']> = {};
        let robotsDeclaresSitemap = false;
        if (robots && robots.status === 200 && !isHtml(robots.contentType)) {
            try {
                robotsDeclaresSitemap = robotsSitemapDirectives(await robots.text()).length > 0;
                out.sitemapReferencedInRobots = robotsDeclaresSitemap;
            }
            catch {
                // Unreadable body — leave the signal absent.
                failures.robots = { reason: 'unreachable' };
            }
        }
        else if (robots && (robots.status === 200 || robots.status === 404 || robots.status === 410)) {
            // Missing, or an app answering every path with its HTML shell:
            // either way no robots.txt declares a sitemap.
            out.sitemapReferencedInRobots = false;
        }
        else {
            failures.robots = failureOf(robots);
        }

        if (sitemap && sitemap.status === 200 && !isHtml(sitemap.contentType))
            out.sitemapFound = true;
        else if (robotsDeclaresSitemap)
            out.sitemapFound = true;

        if (llms && llms.status === 200) {
            // An app that answers every path with its HTML shell is not
            // serving an llms.txt file.
            out.llmsTxtFound = !isHtml(llms.contentType);
        }
        else if (llms && (llms.status === 404 || llms.status === 410)) {
            out.llmsTxtFound = false;
        }
        else {
            failures.llms = failureOf(llms);
        }
        if (failures.robots || failures.llms)
            out.failures = failures;

        // Address variants judge every other origin against the site's own
        // https address, so they need a readable start page.
        if (!homeUsable)
            return out;
        const canonical = new URL(home.finalUrl);
        if (canonical.protocol !== 'https:')
            return out;
        const variantUrls = [
            `http://${apex}/`,
            `http://www.${apex}/`,
            `https://${apex}/`,
            `https://www.${apex}/`,
        ];
        out.addressVariants = await Promise.all(variantUrls.map(async (variant): Promise<AddressVariantResult> => {
            const response = variant === `https://${siteHost}/` ? home : await fetchUrl(variant);
            if (!response)
                return { url: variant, status: null, finalUrl: null, ok: null };
            const final = new URL(response.finalUrl);
            return {
                url: variant,
                status: response.status,
                finalUrl: final.href,
                ok: final.origin === canonical.origin && response.status < 400,
            };
        }));
        return out;
    };
}
