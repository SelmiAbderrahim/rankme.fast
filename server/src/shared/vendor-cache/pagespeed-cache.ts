/**
 * Read-through decorator for the PageSpeed capability.
 *
 * PageSpeed is the one capability whose interface input ({url, strategy}) is
 * public and account-free, so the caching wraps the provider itself and the
 * audit processor stays untouched. The selected provider + adapter-contract
 * version is also part of the key: a live DataForSEO run must never reuse a
 * prior fake payload or Google/CrUX payload after an operator switch. One
 * analyze() per (namespace, url, strategy) per TTL window serves every
 * account auditing that URL; every fresh result also lands in the
 * `vendor_responses` archive.
 *
 * The payload schema is PASSTHROUGH on purpose: the Google adapter returns
 * an extra `fieldDataLevel` marker outside `PageSpeedResult` that the audit
 * processor consumes via cast — dropping it on cache hits would silently
 * degrade CrUX labeling in reports.
 */
import { z } from 'zod';
import type { PageSpeedProvider, PageSpeedResult } from '../providers/index.js';
import type { ReadThrough } from './read-through.js';
const pageSpeedPayloadSchema = z
    .object({
    labScores: z.object({
        performance: z.number(),
        seo: z.number(),
        accessibility: z.number(),
        bestPractices: z.number(),
    }),
    coreWebVitals: z
        .object({
        lcpMs: z.number(),
        inp: z.number(),
        cls: z.number(),
        category: z.enum(['good', 'needs-improvement', 'poor']),
    })
        .optional(),
    mobileFriendly: z.boolean().optional(),
})
    .passthrough();
type PageSpeedPayload = z.infer<typeof pageSpeedPayloadSchema>;
export interface CachedPageSpeedProviderDeps {
    inner: PageSpeedProvider;
    readThrough: ReadThrough;
    /** Selected provider + adapter-contract version, e.g. dataforseo-lighthouse-live:v1. */
    cacheNamespace: string;
    ttlMs: number;
    now?: () => Date;
}
export function createCachedPageSpeedProvider(deps: CachedPageSpeedProviderDeps): PageSpeedProvider {
    const nowFn = deps.now ?? (() => new Date());
    return {
        async analyze(input) {
            const result = await deps.readThrough<PageSpeedPayload>({
                capability: 'pagespeed',
                operation: 'analyze',
                params: {
                    cacheNamespace: deps.cacheNamespace,
                    url: input.url,
                    strategy: input.strategy,
                },
                ttlMs: deps.ttlMs,
                payloadSchema: pageSpeedPayloadSchema,
                now: nowFn(),
                fetch: async () => (await deps.inner.analyze(input)) as PageSpeedPayload,
            });
            return result.value as PageSpeedResult;
        },
    };
}
