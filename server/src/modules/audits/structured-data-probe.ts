/**
 * JSON-LD structured-data probe.
 *
 * The on-page vendor's `has_micromarkup` flag only detects inline HTML
 * microdata (`itemscope` / `itemprop`). A page that ships its schema.org
 * markup as a server-rendered JSON-LD `<script>` block —
 * the format Google recommends — is reported as "no micromarkup", which made
 * the `structured-data-missing` rule flag every page of such a site.
 *
 * The probe re-checks ONLY the pages the vendor reported without structured
 * data: it fetches the initial HTML (no JavaScript execution) through the
 * shared SSRF authority and looks for a parseable JSON-LD block that names a
 * schema.org type, including `@graph`-style documents. It is bounded in page
 * count, concurrency, per-page deadline, response size, and total stage
 * time; a page it cannot fetch keeps the vendor verdict.
 */
import { JSON_LD_MEDIA_TYPE } from '../../shared/security/json-ld.js';
import { fetchPublicUrlSafe } from '../../shared/security/url-safety.js';

/** Upper bound on pages re-checked per audit. */
export const STRUCTURED_DATA_PROBE_MAX_PAGES = 200;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_PAGE_DEADLINE_MS = 8000;
const DEFAULT_STAGE_BUDGET_MS = 60000;
const DEFAULT_MAX_RESPONSE_BYTES = 3 * 1024 * 1024;

const JSON_LD_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
// Read-only detection: the media type comes from the shared JSON-LD module so
// this file never names it (no module may build JSON-LD by concatenation).
const MEDIA = JSON_LD_MEDIA_TYPE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const JSON_LD_TYPE_ATTR = new RegExp(`\\btype\\s*=\\s*(?:"\\s*${MEDIA}\\s*"|'\\s*${MEDIA}\\s*'|${MEDIA}(?=[\\s>/]|$))`, 'i');

function hasSchemaType(node: unknown, depth = 0): boolean {
    if (depth > 8 || node === null || typeof node !== 'object')
        return false;
    if (Array.isArray(node))
        return node.some((item) => hasSchemaType(item, depth + 1));
    const record = node as Record<string, unknown>;
    const type = record['@type'];
    if ((typeof type === 'string' && type.trim() !== '') ||
        (Array.isArray(type) && type.some((t) => typeof t === 'string' && t.trim() !== ''))) {
        return true;
    }
    return hasSchemaType(record['@graph'], depth + 1);
}

/**
 * True when the HTML carries at least one parseable JSON-LD block naming a
 * schema.org `@type` (top-level, in an array, or inside `@graph`).
 */
export function htmlHasJsonLd(html: string): boolean {
    for (const match of html.matchAll(JSON_LD_SCRIPT)) {
        if (!JSON_LD_TYPE_ATTR.test(match[1]!))
            continue;
        const body = match[2]!
            .trim()
            .replace(/^<!--/, '')
            .replace(/-->$/, '')
            .trim();
        try {
            if (hasSchemaType(JSON.parse(body)))
                return true;
        }
        catch {
            // Unparseable block — keep looking; broken markup is not "present".
        }
    }
    return false;
}

export type StructuredDataProbe = (urls: readonly string[]) => Promise<ReadonlySet<string>>;

export interface StructuredDataProbeOptions {
    /** Returns the page HTML, or null when it could not be read. */
    fetchHtml?: (url: string, signal: AbortSignal) => Promise<string | null>;
    maxPages?: number;
    concurrency?: number;
    pageDeadlineMs?: number;
    stageBudgetMs?: number;
    maxResponseBytes?: number;
    now?: () => number;
}

function defaultFetchHtml(pageDeadlineMs: number, maxResponseBytes: number) {
    return async (url: string, signal: AbortSignal): Promise<string | null> => {
        const response = await fetchPublicUrlSafe(url, {
            method: 'GET',
            headers: { accept: 'text/html,application/xhtml+xml' },
            signal,
        }, { deadlineMs: pageDeadlineMs, maxResponseBytes });
        if (!response.ok)
            return null;
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType && !/html|xml/i.test(contentType))
            return null;
        return response.text();
    };
}

/** Build the probe the audit processor calls after the vendor crawl. */
export function createStructuredDataProbe(opts: StructuredDataProbeOptions = {}): StructuredDataProbe {
    const maxPages = opts.maxPages ?? STRUCTURED_DATA_PROBE_MAX_PAGES;
    const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
    const stageBudgetMs = opts.stageBudgetMs ?? DEFAULT_STAGE_BUDGET_MS;
    const now = opts.now ?? Date.now;
    const fetchHtml = opts.fetchHtml ?? defaultFetchHtml(opts.pageDeadlineMs ?? DEFAULT_PAGE_DEADLINE_MS, opts.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES);
    return async (urls) => {
        const queue = [...new Set(urls)].slice(0, maxPages);
        const found = new Set<string>();
        const controller = new AbortController();
        const stopAt = now() + stageBudgetMs;
        let next = 0;
        const worker = async (): Promise<void> => {
            while (next < queue.length && now() < stopAt) {
                const url = queue[next++]!;
                try {
                    const html = await fetchHtml(url, controller.signal);
                    if (html !== null && htmlHasJsonLd(html))
                        found.add(url);
                }
                catch {
                    // Unreachable page keeps the vendor verdict.
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
        controller.abort();
        return found;
    };
}
