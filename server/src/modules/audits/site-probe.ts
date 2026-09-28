/**
 * Site-level probe.
 *
 * The on-page vendor reports a handful of site-wide booleans but never says
 * whether `robots.txt` declares the sitemap or whether `/llms.txt` exists.
 * Those rules therefore always landed in "Not evaluated".
 *
 * The probe reads the few public URLs those checks are about, through the
 * shared SSRF authority, after the crawl finishes:
 *
 *   - `robots.txt`  → is a `Sitemap:` directive declared?
 *   - `llms.txt`    → is the file served (not an HTML soft-404)?
 *
 * Every read is bounded (deadline, redirect ceiling, response size). A read
 * that fails leaves its signal absent, so the rule keeps its
 * "insufficient data" behaviour instead of inventing a verdict.
 */
import { fetchPublicUrlSafeWithFinalUrl, type FetchPublicUrlSafeOptions } from '../../shared/security/url-safety.js';

export interface SiteProbeResult {
    sitemapReferencedInRobots?: boolean;
    llmsTxtFound?: boolean;
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

const defaultFetchUrl = (safety: SiteProbeOptions['safety']) => (url: string): Promise<ProbeResponse | null> =>
    fetchPublicUrlSafeWithFinalUrl(url, { method: 'GET', headers: { accept: 'text/plain,text/html;q=0.8,*/*;q=0.5' } }, {
        ...safety,
        deadlineMs: DEADLINE_MS,
        maxRedirects: MAX_REDIRECTS,
        maxResponseBytes: MAX_TEXT_BYTES,
    }).then(({ response, finalUrl }) => ({
        status: response.status,
        finalUrl: finalUrl.href,
        contentType: response.headers.get('content-type') ?? '',
        text: () => response.text(),
    }), () => null);

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

const isHtml = (contentType: string): boolean => /\bhtml\b/i.test(contentType);

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
        const home = await fetchUrl(`https://${siteHost}/`);
        // The site's own https address is the reference for every other
        // check; without it nothing here can be judged.
        if (!home || home.status >= 400)
            return {};
        const canonical = new URL(home.finalUrl);
        if (canonical.protocol !== 'https:')
            return {};
        const origin = canonical.origin;
        const out: SiteProbeResult = {};

        const robots = await fetchUrl(`${origin}/robots.txt`);
        if (robots && robots.status === 200 && !isHtml(robots.contentType)) {
            try {
                out.sitemapReferencedInRobots = robotsSitemapDirectives(await robots.text()).length > 0;
            }
            catch {
                // Unreadable body — leave the signal absent.
            }
        }
        else if (robots && (robots.status === 404 || robots.status === 410)) {
            out.sitemapReferencedInRobots = false;
        }

        const llms = await fetchUrl(`${origin}/llms.txt`);
        if (llms && llms.status === 200) {
            // An app that answers every path with its HTML shell is not
            // serving an llms.txt file.
            out.llmsTxtFound = !isHtml(llms.contentType);
        }
        else if (llms && (llms.status === 404 || llms.status === 410)) {
            out.llmsTxtFound = false;
        }
        return out;
    };
}
