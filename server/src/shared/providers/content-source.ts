import { createHash } from 'node:crypto';
import { z } from 'zod';
export const CONTENT_SOURCE_FORMATS = ['markdown', 'metadata'] as const;
export const scrapePageInputSchema = z.object({
    url: z.string().min(1).max(2048),
    formats: z.array(z.enum(CONTENT_SOURCE_FORMATS)).min(1).max(2),
    timeoutMs: z.number().int().positive().max(120000),
    maxCharacters: z.number().int().positive().max(1000000),
    freshnessKey: z.string().min(1).max(128).optional(),
});
export const crawlSiteInputSchema = z.object({
    origin: z.string().min(1).max(2048),
    allowlistedPaths: z.array(z.string().regex(/^\/[\w./*-]*$/).max(256)).max(50),
    maxPages: z.number().int().positive().max(1000),
    depth: z.number().int().min(0).max(10),
    concurrency: z.number().int().positive().max(20),
    timeoutMs: z.number().int().positive().max(600000),
    signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
});
export type ScrapePageInput = z.infer<typeof scrapePageInputSchema>;
export type CrawlSiteInput = z.infer<typeof crawlSiteInputSchema>;
export interface ContentHeading {
    level: 1 | 2 | 3 | 4 | 5 | 6;
    text: string;
}
export interface ContentLink {
    url: string;
    external: boolean;
}
export interface StructuredDataFact {
    type: string;
    property: string;
    value: string | number | boolean;
}
export interface ContentSourceUsage {
    credits: number;
    estimatedCostMicros: bigint;
    estimated: true;
}
export interface ContentDocument {
    sourceUrl: string;
    statusCode: number;
    title: string | null;
    description: string | null;
    /** Normalized page-level keyword metadata, when the source exposes it. */
    metadataKeywords?: string[];
    canonical: string | null;
    robots: string[];
    language: string | null;
    markdown: string;
    text: string;
    headings: ContentHeading[];
    links: ContentLink[];
    structuredData: StructuredDataFact[];
    contentHash: string;
    capturedAt: Date;
}
export interface ContentPageFailure {
    url: string;
    reason: 'access-denied' | 'malformed' | 'robots' | 'unavailable';
    message: string;
}
export interface ScrapePageResult {
    document: ContentDocument;
    usage: ContentSourceUsage;
}
export interface CrawlSiteResult {
    documents: ContentDocument[];
    failures: ContentPageFailure[];
    completion: 'complete' | 'partial' | 'cancelled';
    usage: ContentSourceUsage;
}
export interface ContentSourceProvider {
    scrapePage(input: ScrapePageInput): Promise<ScrapePageResult>;
    crawlSite(input: CrawlSiteInput): Promise<CrawlSiteResult>;
}
export function createContentHash(sourceUrl: string, markdown: string, text: string): string {
    return createHash('sha256').update(JSON.stringify([sourceUrl, markdown, text])).digest('hex');
}
