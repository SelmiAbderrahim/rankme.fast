import type { ZodError } from 'zod';
import { assertPublicUrlSafe, type PublicUrlResolver, } from '../security/url-safety.js';
import { crawlSiteInputSchema, createContentHash, scrapePageInputSchema, type ContentDocument, type ContentHeading, type ContentLink, type ContentSourceProvider, type CrawlSiteInput, type ScrapePageInput, type StructuredDataFact, } from './content-source.js';
import { ProviderError, VendorMalformedError, VendorQuotaError, VendorTimeoutError, } from './errors.js';
export type FakeContentSourceMode = 'cancelled' | 'malformed' | 'partial' | 'quota' | 'redirect-rejection' | 'robots' | 'timeout';
export interface FakeContentSourceOptions {
    clock?: () => Date;
    resolver?: PublicUrlResolver;
    mode?: FakeContentSourceMode;
    headings?: ContentHeading[];
    metadataKeywords?: string[];
    links?: ContentLink[];
    structuredData?: StructuredDataFact[];
    language?: string;
    costMicrosPerCredit?: bigint;
}
const fakeResolver: PublicUrlResolver = async () => [{ address: '8.8.8.8', family: 4 }];
const fakeClock = (): Date => new Date('2026-01-01T00:00:00.000Z');
const ctx = { provider: 'fake', operation: 'content-source' };
export function fakeContentSourceInjection(mode: FakeContentSourceMode): FakeContentSourceOptions {
    return { mode };
}
function malformedInput(error: ZodError): VendorMalformedError {
    return new VendorMalformedError(`invalid content-source input: ${error.message}`, {
        ...ctx,
        cause: error,
    });
}
function throwInjected(mode: FakeContentSourceMode | undefined): void {
    if (mode === 'timeout')
        throw new VendorTimeoutError('injected timeout', ctx);
    if (mode === 'malformed')
        throw new VendorMalformedError('injected malformed response', ctx);
    if (mode === 'quota')
        throw new VendorQuotaError('injected quota', { ...ctx, retryAfterSeconds: 60 });
    if (mode === 'robots')
        throw new ProviderError('blocked by robots.txt', false, ctx);
}
function toDocument(url: URL, index: number, maxCharacters: number, opts: FakeContentSourceOptions): ContentDocument {
    const competitor = url.hostname.startsWith('competitor.');
    const title = competitor ? `Competitor example ${index + 1}` : `Owned example ${index + 1}`;
    const headings = opts.headings ?? [
        { level: 1, text: title },
        { level: 2, text: 'Deterministic evidence' },
    ];
    const markdown = [`# ${title}`, '', 'Synthetic content for provider tests.', '', '## Deterministic evidence']
        .join('\n')
        .slice(0, maxCharacters);
    const text = markdown.replace(/^#+\s*/gm, '').slice(0, maxCharacters);
    const sourceUrl = url.toString();
    return {
        sourceUrl,
        statusCode: 200,
        title,
        description: 'Synthetic provider fixture.',
        metadataKeywords: opts.metadataKeywords ?? [
            'seo audit tool',
            'website audit checklist',
            'technical seo scanner',
            'site health check',
        ],
        canonical: sourceUrl,
        robots: ['index', 'follow'],
        language: opts.language ?? 'en',
        markdown,
        text,
        headings,
        links: opts.links ?? [{ url: new URL('/reference', url).toString(), external: false }],
        structuredData: opts.structuredData ?? [
            { type: 'Article', property: 'headline', value: title },
        ],
        contentHash: createContentHash(sourceUrl, markdown, text),
        capturedAt: (opts.clock ?? fakeClock)(),
    };
}
async function validateTarget(raw: string, opts: FakeContentSourceOptions): Promise<URL> {
    return assertPublicUrlSafe(raw, { allowHttp: true, resolver: opts.resolver ?? fakeResolver });
}
export function createFakeContentSourceProvider(opts: FakeContentSourceOptions = {}): ContentSourceProvider {
    const cost = opts.costMicrosPerCredit ?? 1000n;
    return {
        async scrapePage(input: ScrapePageInput) {
            const parsed = scrapePageInputSchema.safeParse(input);
            if (!parsed.success)
                throw malformedInput(parsed.error);
            throwInjected(opts.mode);
            if (opts.mode === 'cancelled')
                throw new ProviderError('request cancelled', false, ctx);
            if (opts.mode === 'redirect-rejection')
                await validateTarget('https://127.0.0.1/', opts);
            const url = await validateTarget(parsed.data.url, opts);
            return {
                document: toDocument(url, 0, parsed.data.maxCharacters, opts),
                usage: { credits: 1, estimatedCostMicros: cost, estimated: true },
            };
        },
        async crawlSite(input: CrawlSiteInput) {
            const parsed = crawlSiteInputSchema.safeParse(input);
            if (!parsed.success)
                throw malformedInput(parsed.error);
            throwInjected(opts.mode);
            if (opts.mode === 'redirect-rejection')
                await validateTarget('https://127.0.0.1/', opts);
            const origin = await validateTarget(parsed.data.origin, opts);
            if (opts.mode === 'cancelled' || parsed.data.signal?.aborted) {
                return {
                    documents: [],
                    failures: [],
                    completion: 'cancelled',
                    usage: { credits: 0, estimatedCostMicros: 0n, estimated: true },
                };
            }
            const paths = ['/', '/guides', '/pricing'].filter((path) => parsed.data.allowlistedPaths.length === 0
                ? true
                : parsed.data.allowlistedPaths.some((allowed) => path.startsWith(allowed.replace(/\*$/, ''))));
            const documents = paths
                .slice(0, parsed.data.maxPages)
                .map((path, index) => toDocument(new URL(path, origin), index, 100000, opts));
            const failures = opts.mode === 'partial'
                ? [{ url: new URL('/blocked', origin).toString(), reason: 'robots' as const, message: 'blocked by robots.txt' }]
                : [];
            return {
                documents,
                failures,
                completion: failures.length === 0 ? 'complete' : 'partial',
                usage: {
                    credits: documents.length,
                    estimatedCostMicros: BigInt(documents.length) * cost,
                    estimated: true,
                },
            };
        },
    };
}
