import type { Logger } from 'pino';
import { z } from 'zod';
import { assertPublicUrlSafe, type PublicUrlResolver, } from '../../security/url-safety.js';
import { crawlSiteInputSchema, createContentHash, scrapePageInputSchema, type ContentDocument, type ContentHeading, type ContentLink, type ContentPageFailure, type ContentSourceProvider, type ContentSourceUsage, type CrawlSiteInput, type ScrapePageInput, type StructuredDataFact, } from '../content-source.js';
import { ProviderError, VendorMalformedError, VendorTimeoutError, VendorUnavailableError, } from '../errors.js';
import type { VendorHttpClient } from '../http.js';
import { createFirecrawlCredentialPool } from './credential-pool.js';
const metadataSchema = z.object({
    title: z.string().max(1024).nullable().optional(),
    description: z.string().max(8192).nullable().optional(),
    keywords: z
        .union([z.string().max(8192), z.array(z.string().max(512)).max(100)])
        .nullable()
        .optional(),
    language: z.string().max(64).nullable().optional(),
    sourceURL: z.string().max(2048),
    statusCode: z.number().int().min(100).max(599),
    canonical: z.string().max(2048).nullable().optional(),
    canonicalUrl: z.string().max(2048).nullable().optional(),
    robots: z
        .union([z.string().max(2048), z.array(z.string().max(256)).max(20)])
        .optional(),
    error: z.string().max(2048).optional(),
    jsonLd: z
        .union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))])
        .optional(),
});
const firecrawlDocumentSchema = z.object({
    markdown: z.string().max(2000000),
    links: z.array(z.string().max(2048)).max(1000),
    metadata: metadataSchema,
});
const scrapeResponseSchema = z.object({
    success: z.literal(true),
    data: firecrawlDocumentSchema,
    creditsUsed: z.number().int().nonnegative().max(1000000).optional(),
});
const crawlStartSchema = z.object({
    success: z.literal(true),
    id: z.string().uuid(),
});
const crawlStatusSchema = z.object({
    status: z.enum(['scraping', 'completed', 'failed', 'cancelled']),
    total: z.number().int().nonnegative().max(1000000),
    completed: z.number().int().nonnegative().max(1000000),
    creditsUsed: z.number().int().nonnegative().max(1000000),
    next: z.string().max(4096).nullable().optional(),
    data: z.array(firecrawlDocumentSchema).max(1000),
});
const crawlErrorsSchema = z.object({
    errors: z
        .array(z.object({ url: z.string().max(2048), error: z.string().max(2048) }))
        .max(1000),
    robotsBlocked: z.array(z.string().max(2048)).max(1000),
});
const cancelSchema = z.object({ status: z.literal('cancelled') });
export interface FirecrawlContentSourceConfig {
    apiKey: string;
    fallbackApiKeys?: readonly string[];
    baseUrl: string;
    timeoutMs: number;
    maxPageCharacters: number;
    maxCrawlPages: number;
    costMicrosPerCredit: number;
    /**
     * Operator attestation that every configured Firecrawl Cloud account has
     * Zero Data Retention enabled (Enterprise ZDR entitlement). Every
     * scrape/crawl request still sends `zeroDataRetention: true`, but the live
     * provider fails closed at construction time when this is not `true` — env
     * validation, direct construction from tests, and the registry all enforce
     * the same gate so no code path can build a live Firecrawl provider that
     * silently retains content.
     */
    zdrEnabled: boolean;
    logger?: Logger;
    fetchImpl?: typeof fetch;
    resolver?: PublicUrlResolver;
    pollIntervalMs?: number;
    wait?: (ms: number) => Promise<void>;
    now?: () => number;
    clock?: () => Date;
    maxRetries?: number;
}
const defaultWait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const ctx = { provider: 'firecrawl', operation: 'content-source' };
function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
        throw new VendorMalformedError(`invalid content-source input: ${parsed.error.message}`, {
            ...ctx,
            cause: parsed.error,
        });
    }
    return parsed.data;
}
function sanitizeMarkdown(value: string, maxCharacters: number): string {
    const bounded = value.slice(0, maxCharacters * 2);
    return bounded
        .replace(/<(script|style|form)\b[^>]{0,512}>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<[^>]{0,512}\b(?:hidden|aria-hidden\s*=\s*["']?true)[^>]{0,512}>[\s\S]*?<\/[^>]{1,64}>/gi, '')
        .replace(/\[([^\]]{0,512})\]\(\s*(?:javascript|data|vbscript):[^)]{0,2048}\)/gi, '$1')
        .replace(/<[^>]{1,512}>/g, '')
        .slice(0, maxCharacters)
        .trim();
}
function sanitizeMetadataText(value: string | null | undefined, maxCharacters: number): string | null {
    if (value === null || value === undefined)
        return null;
    return markdownToText(sanitizeMarkdown(value, maxCharacters), maxCharacters);
}
function markdownToText(markdown: string, maxCharacters: number): string {
    return markdown
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/!?\[([^\]]{0,512})\]\([^)]{0,2048}\)/g, '$1')
        .replace(/[*_`~]/g, '')
        .slice(0, maxCharacters)
        .trim();
}
function extractHeadings(markdown: string): ContentHeading[] {
    const headings: ContentHeading[] = [];
    for (const line of markdown.split('\n')) {
        const match = /^(#{1,6})\s+(.{1,512})$/.exec(line.trim());
        if (match)
            headings.push({ level: match[1]!.length as ContentHeading['level'], text: match[2]!.trim() });
    }
    return headings;
}
function normalizeLinks(values: string[], sourceUrl: URL): ContentLink[] {
    const links: ContentLink[] = [];
    const seen = new Set<string>();
    for (const value of values.slice(0, 1000)) {
        try {
            const url = new URL(value, sourceUrl);
            if ((url.protocol !== 'http:' && url.protocol !== 'https:') || seen.has(url.toString()))
                continue;
            seen.add(url.toString());
            links.push({ url: url.toString(), external: url.origin !== sourceUrl.origin });
        }
        catch {
            // Malformed and dangerous vendor links are dropped, never returned.
        }
    }
    return links;
}
function normalizeStructuredData(value: z.infer<typeof metadataSchema>['jsonLd']): StructuredDataFact[] {
    const blocks = value === undefined ? [] : Array.isArray(value) ? value : [value];
    const facts: StructuredDataFact[] = [];
    for (const block of blocks.slice(0, 25)) {
        const type = typeof block['@type'] === 'string' ? block['@type'].slice(0, 128) : 'Unknown';
        for (const [property, raw] of Object.entries(block).slice(0, 25)) {
            if (property === '@type' ||
                /(?:^|[_-])(?:prompt|instruction|system|completion)(?:$|[_-])/i.test(property) ||
                !['boolean', 'number', 'string'].includes(typeof raw))
                continue;
            facts.push({ type, property: property.slice(0, 128), value: raw as string | number | boolean });
        }
    }
    return facts;
}
function normalizeRobots(value: z.infer<typeof metadataSchema>['robots']): string[] {
    if (value === undefined)
        return [];
    return (Array.isArray(value) ? value : value.split(','))
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 20);
}
function normalizeMetadataKeywords(value: z.infer<typeof metadataSchema>['keywords']): string[] {
    if (value === undefined || value === null)
        return [];
    const values = Array.isArray(value) ? value : value.split(/[,;\n]+/u);
    const keywords: string[] = [];
    const seen = new Set<string>();
    for (const raw of values) {
        const keyword = markdownToText(sanitizeMarkdown(raw, 512), 512)
            .normalize('NFKC')
            .replace(/\s+/gu, ' ')
            .trim();
        const key = keyword.toLowerCase();
        if (keyword.length === 0 || seen.has(key))
            continue;
        seen.add(key);
        keywords.push(keyword);
        if (keywords.length >= 100)
            break;
    }
    return keywords;
}
function usage(credits: number, costMicrosPerCredit: number): ContentSourceUsage {
    return {
        credits,
        estimatedCostMicros: BigInt(credits) * BigInt(costMicrosPerCredit),
        estimated: true,
    };
}
async function normalizeDocument(raw: z.infer<typeof firecrawlDocumentSchema>, fallbackUrl: URL, maxCharacters: number, cfg: FirecrawlContentSourceConfig): Promise<ContentDocument> {
    if (raw.metadata.error && /robots|forbidden|access denied/i.test(raw.metadata.error)) {
        throw new ProviderError(raw.metadata.error, false, ctx);
    }
    const sourceUrl = await assertPublicUrlSafe(raw.metadata.sourceURL || fallbackUrl, {
        allowHttp: true,
        ...(cfg.resolver ? { resolver: cfg.resolver } : {}),
    });
    const markdown = sanitizeMarkdown(raw.markdown, maxCharacters);
    const text = markdownToText(markdown, maxCharacters);
    const canonicalRaw = raw.metadata.canonicalUrl ?? raw.metadata.canonical;
    let canonical: string | null = null;
    if (canonicalRaw) {
        try {
            canonical = (await assertPublicUrlSafe(new URL(canonicalRaw, sourceUrl), {
                allowHttp: true,
                ...(cfg.resolver ? { resolver: cfg.resolver } : {}),
            })).toString();
        }
        catch {
            canonical = null;
        }
    }
    return {
        sourceUrl: sourceUrl.toString(),
        statusCode: raw.metadata.statusCode,
        title: sanitizeMetadataText(raw.metadata.title, 1024),
        description: sanitizeMetadataText(raw.metadata.description, 8192),
        metadataKeywords: normalizeMetadataKeywords(raw.metadata.keywords),
        canonical,
        robots: normalizeRobots(raw.metadata.robots),
        language: raw.metadata.language ?? null,
        markdown,
        text,
        headings: extractHeadings(markdown),
        links: normalizeLinks(raw.links, sourceUrl),
        structuredData: normalizeStructuredData(raw.metadata.jsonLd),
        contentHash: createContentHash(sourceUrl.toString(), markdown, text),
        capturedAt: (cfg.clock ?? (() => new Date()))(),
    };
}
function validateBaseUrl(raw: string): string {
    const url = new URL(raw);
    if (url.protocol !== 'https:' ||
        url.hostname !== 'api.firecrawl.dev' ||
        url.username !== '' ||
        url.password !== '' ||
        (url.pathname !== '/' && url.pathname !== '') ||
        url.search !== '' ||
        url.hash !== '') {
        throw new Error('FIRECRAWL_BASE_URL must be the HTTPS Firecrawl Cloud API origin; self-hosted endpoints are unsupported.');
    }
    return url.origin;
}
function validateConfigBounds(cfg: FirecrawlContentSourceConfig): void {
    if (!Number.isInteger(cfg.timeoutMs) || cfg.timeoutMs <= 0) {
        throw new Error('FIRECRAWL_TIMEOUT_MS must be a positive integer.');
    }
    if (!Number.isInteger(cfg.maxPageCharacters) || cfg.maxPageCharacters <= 0) {
        throw new Error('FIRECRAWL_MAX_PAGE_CHARS must be a positive integer.');
    }
    if (!Number.isInteger(cfg.maxCrawlPages) || cfg.maxCrawlPages <= 0) {
        throw new Error('FIRECRAWL_MAX_CRAWL_PAGES must be a positive integer.');
    }
    if (!Number.isInteger(cfg.costMicrosPerCredit) || cfg.costMicrosPerCredit < 0) {
        throw new Error('FIRECRAWL_COST_MICROS_PER_CREDIT must be a non-negative integer.');
    }
}
function nextPath(raw: string, baseUrl: string, jobId: string): string {
    const next = new URL(raw);
    if (next.origin !== baseUrl || !next.pathname.startsWith(`/v2/crawl/${jobId}`)) {
        throw new VendorMalformedError('crawl pagination URL escaped the Cloud crawl endpoint', ctx);
    }
    return `${next.pathname}${next.search}`;
}
async function collectFailures(client: VendorHttpClient, jobId: string, signal: AbortSignal | undefined, cfg: FirecrawlContentSourceConfig): Promise<ContentPageFailure[]> {
    const response = await client.request({
        operation: 'crawl-errors',
        path: `/v2/crawl/${encodeURIComponent(jobId)}/errors`,
        method: 'GET',
        schema: crawlErrorsSchema,
        signal,
    });
    const failures: ContentPageFailure[] = [];
    for (const entry of response.errors) {
        const url = await assertPublicUrlSafe(entry.url, {
            allowHttp: true,
            ...(cfg.resolver ? { resolver: cfg.resolver } : {}),
        });
        failures.push({ url: url.toString(), reason: 'unavailable', message: entry.error });
    }
    for (const rawUrl of response.robotsBlocked) {
        const url = await assertPublicUrlSafe(rawUrl, {
            allowHttp: true,
            ...(cfg.resolver ? { resolver: cfg.resolver } : {}),
        });
        failures.push({
            url: url.toString(),
            reason: 'robots',
            message: 'blocked by robots.txt',
        });
    }
    return failures;
}
export function createFirecrawlContentSourceProvider(cfg: FirecrawlContentSourceConfig): ContentSourceProvider {
    if (!cfg.apiKey)
        throw new Error('PROVIDER_CONTENT_SOURCE=firecrawl requires FIRECRAWL_API_KEY.');
    if (cfg.zdrEnabled !== true) {
        throw new Error('PROVIDER_CONTENT_SOURCE=firecrawl requires FIRECRAWL_ZDR_ENABLED=true (operator attestation that Firecrawl Cloud Zero Data Retention is enabled on every configured account).');
    }
    validateConfigBounds(cfg);
    const baseUrl = validateBaseUrl(cfg.baseUrl);
    const credentialPool = createFirecrawlCredentialPool({
        apiKey: cfg.apiKey,
        fallbackApiKeys: cfg.fallbackApiKeys,
        baseUrl,
        timeoutMs: cfg.timeoutMs,
        ...(cfg.logger ? { logger: cfg.logger } : {}),
        ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}),
        ...(cfg.maxRetries !== undefined ? { maxRetries: cfg.maxRetries } : {}),
    });
    const resolverOptions = cfg.resolver ? { resolver: cfg.resolver } : {};
    return {
        async scrapePage(input: ScrapePageInput) {
            const parsed = parseInput(scrapePageInputSchema, input);
            const target = await assertPublicUrlSafe(parsed.url, { allowHttp: true, ...resolverOptions });
            const maxCharacters = Math.min(parsed.maxCharacters, cfg.maxPageCharacters);
            const { value: response } = await credentialPool.executeWithFailover('scrape', ({ failoverClient }) => failoverClient.request({
                operation: 'scrape',
                path: '/v2/scrape',
                body: {
                    url: target.toString(),
                    formats: ['markdown', 'links'],
                    onlyMainContent: true,
                    skipTlsVerification: false,
                    removeBase64Images: true,
                    blockAds: true,
                    proxy: 'basic',
                    storeInCache: false,
                    timeout: Math.min(parsed.timeoutMs, cfg.timeoutMs),
                    zeroDataRetention: true,
                    ...(parsed.freshnessKey ? { maxAge: 0 } : {}),
                },
                schema: scrapeResponseSchema,
                timeoutMs: Math.min(parsed.timeoutMs, cfg.timeoutMs),
            }));
            return {
                document: await normalizeDocument(response.data, target, maxCharacters, cfg),
                usage: usage(response.creditsUsed ?? 1, cfg.costMicrosPerCredit),
            };
        },
        async crawlSite(input: CrawlSiteInput) {
            const parsed = parseInput(crawlSiteInputSchema, input);
            const origin = await assertPublicUrlSafe(parsed.origin, { allowHttp: true, ...resolverOptions });
            const maxPages = Math.min(parsed.maxPages, cfg.maxCrawlPages);
            const startedAt = (cfg.now ?? Date.now)();
            const { value: start, credential } = await credentialPool.executeWithFailover('crawl-start', ({ failoverClient }) => failoverClient.request({
                operation: 'crawl-start',
                path: '/v2/crawl',
                body: {
                    url: origin.toString(),
                    includePaths: parsed.allowlistedPaths,
                    maxDiscoveryDepth: parsed.depth,
                    limit: maxPages,
                    maxConcurrency: parsed.concurrency,
                    allowExternalLinks: false,
                    allowSubdomains: false,
                    ignoreRobotsTxt: false,
                    scrapeOptions: {
                        formats: ['markdown', 'links'],
                        onlyMainContent: true,
                        skipTlsVerification: false,
                        removeBase64Images: true,
                        blockAds: true,
                        proxy: 'basic',
                        storeInCache: false,
                    },
                    zeroDataRetention: true,
                },
                schema: crawlStartSchema,
                timeoutMs: Math.min(parsed.timeoutMs, cfg.timeoutMs),
                signal: parsed.signal,
            }));
            // Firecrawl crawl IDs are scoped to the account that created them. Once
            // a start is accepted, every status, pagination, error, and cancellation
            // request must remain pinned to that credential; restarting with another
            // key could duplicate spend and create a second remote crawl.
            const client = credential.pinnedClient;
            const documents: ContentDocument[] = [];
            const seen = new Set<string>();
            let credits = 0;
            let polls = 0;
            const pollInterval = cfg.pollIntervalMs ?? 500;
            const maxPolls = Math.max(1, Math.ceil(parsed.timeoutMs / Math.max(1, pollInterval)));
            let path = `/v2/crawl/${encodeURIComponent(start.id)}`;
            for (;;) {
                if (parsed.signal?.aborted) {
                    await client.request({
                        operation: 'crawl-cancel',
                        path: `/v2/crawl/${encodeURIComponent(start.id)}`,
                        method: 'DELETE',
                        schema: cancelSchema,
                    });
                    return { documents, failures: [], completion: 'cancelled', usage: usage(credits, cfg.costMicrosPerCredit) };
                }
                if (polls >= maxPolls || (cfg.now ?? Date.now)() - startedAt >= parsed.timeoutMs) {
                    throw new VendorTimeoutError('crawl did not finish before its deadline', ctx);
                }
                polls += 1;
                const status = await client.request({
                    operation: 'crawl-status',
                    path,
                    method: 'GET',
                    schema: crawlStatusSchema,
                    timeoutMs: Math.min(parsed.timeoutMs, cfg.timeoutMs),
                    signal: parsed.signal,
                });
                credits = Math.max(credits, status.creditsUsed);
                for (const raw of status.data) {
                    if (documents.length >= maxPages)
                        break;
                    const document = await normalizeDocument(raw, origin, cfg.maxPageCharacters, cfg);
                    if (!seen.has(document.sourceUrl)) {
                        seen.add(document.sourceUrl);
                        documents.push(document);
                    }
                }
                if (status.next) {
                    path = nextPath(status.next, baseUrl, start.id);
                    continue;
                }
                if (status.status === 'scraping') {
                    await (cfg.wait ?? defaultWait)(pollInterval);
                    continue;
                }
                if (status.status === 'cancelled') {
                    return { documents, failures: [], completion: 'cancelled', usage: usage(credits, cfg.costMicrosPerCredit) };
                }
                const failures = await collectFailures(client, start.id, parsed.signal, cfg);
                if (status.status === 'failed' && documents.length === 0) {
                    throw new VendorUnavailableError('crawl failed without usable pages', ctx);
                }
                return {
                    documents,
                    failures,
                    completion: failures.length > 0 || status.status === 'failed' ? 'partial' : 'complete',
                    usage: usage(credits, cfg.costMicrosPerCredit),
                };
            }
        },
    };
}
export const firecrawlSchemas = {
    scrapeResponseSchema,
    crawlStartSchema,
    crawlStatusSchema,
    crawlErrorsSchema,
};
export const firecrawlNormalization = {
    extractHeadings,
    markdownToText,
    normalizeLinks,
    normalizeMetadataKeywords,
    normalizeRobots,
    normalizeStructuredData,
    sanitizeMarkdown,
};
