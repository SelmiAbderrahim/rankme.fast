/**
 * DataForSEO Lighthouse Live adapter.
 *
 * This provider returns Lighthouse LAB observations only. It deliberately
 * never maps Lighthouse metrics onto `coreWebVitals`, which is reserved for
 * real-user CrUX field data by the vendor-neutral PageSpeed contract.
 */
import { z } from 'zod';
import { VendorMalformedError, VendorUnavailableError, } from '../errors.js';
import { dataForSeoRequest, type DataForSeoConfig } from '../http.js';
import type { PageSpeedInput, PageSpeedProvider, PageSpeedResult, PageSpeedStrategy, } from '../types.js';
/** DataForSEO aborts Lighthouse work at 120 seconds; allow response transit. */
export const DEFAULT_DATAFORSEO_LIGHTHOUSE_TIMEOUT_MS = 130000;
const lighthouseCategorySchema = z
    .object({
    score: z.number().min(0).max(1),
})
    .passthrough();
const lighthouseAuditSchema = z
    .object({
    score: z.number().min(0).max(1).nullable().optional(),
})
    .passthrough();
const lighthouseResultSchema = z
    .array(z
    .object({
    categories: z
        .object({
        performance: lighthouseCategorySchema,
        seo: lighthouseCategorySchema,
        accessibility: lighthouseCategorySchema,
        'best-practices': lighthouseCategorySchema,
    })
        .passthrough(),
    audits: z.record(z.string(), lighthouseAuditSchema).optional(),
})
    .passthrough())
    .min(1);
export type DataForSeoLighthousePayload = z.infer<typeof lighthouseResultSchema>;
export interface DataForSeoPageSpeedProviderConfig extends DataForSeoConfig {
    /** Per-request deadline; defaults beyond the vendor's 120-second ceiling. */
    lighthouseTimeoutMs?: number;
}
export interface DataForSeoPageSpeedResult extends PageSpeedResult {
    /** Lighthouse is lab-only; DataForSEO does not supply CrUX field data. */
    fieldDataLevel: 'none';
}
function toIntegerScore(score: number): number {
    return Math.round(score * 100);
}
export function extractDataForSeoMobileFriendly(payload: DataForSeoLighthousePayload[number], strategy: PageSpeedStrategy): boolean | undefined {
    if (strategy !== 'mobile')
        return undefined;
    const audits = payload.audits;
    if (!audits)
        return undefined;
    const scores = [
        audits.viewport?.score,
        audits['viewport-insight']?.score,
        audits['tap-targets']?.score,
    ].filter((score): score is number => typeof score === 'number');
    if (scores.length === 0)
        return undefined;
    return scores.every((score) => score >= 0.9);
}
function normalizeLighthouseResult(payload: DataForSeoLighthousePayload[number], strategy: PageSpeedStrategy): DataForSeoPageSpeedResult {
    const result: DataForSeoPageSpeedResult = {
        labScores: {
            performance: toIntegerScore(payload.categories.performance.score),
            seo: toIntegerScore(payload.categories.seo.score),
            accessibility: toIntegerScore(payload.categories.accessibility.score),
            bestPractices: toIntegerScore(payload.categories['best-practices'].score),
        },
        fieldDataLevel: 'none',
    };
    const mobileFriendly = extractDataForSeoMobileFriendly(payload, strategy);
    if (mobileFriendly !== undefined)
        result.mobileFriendly = mobileFriendly;
    return result;
}
export function createDataForSeoPageSpeedProvider(cfg: DataForSeoPageSpeedProviderConfig): PageSpeedProvider {
    return {
        async analyze(input: PageSpeedInput): Promise<DataForSeoPageSpeedResult> {
            const outcomes = await dataForSeoRequest(
            // A timed-out Live request may already have been accepted and billed.
            // Reissuing it would multiply spend with no idempotency key, so this
            // capability deliberately disables the shared client's default
            // transient retries. The audit degrades this optional signal instead.
            { ...cfg, maxRetries: 0 }, '/on_page/lighthouse/live/json', [
                {
                    url: input.url,
                    for_mobile: input.strategy === 'mobile',
                    categories: ['performance', 'accessibility', 'best_practices', 'seo'],
                },
            ], lighthouseResultSchema, {
                operation: 'on-page-lighthouse-live',
                timeoutMs: cfg.lighthouseTimeoutMs ?? DEFAULT_DATAFORSEO_LIGHTHOUSE_TIMEOUT_MS,
            });
            const outcome = outcomes[0];
            if (!outcome) {
                throw new VendorMalformedError('Lighthouse Live returned no tasks', {
                    provider: 'dataforseo',
                    operation: 'on-page-lighthouse-live',
                });
            }
            if (outcome.status !== 'ok') {
                throw new VendorUnavailableError(`Lighthouse Live returned non-terminal status: ${outcome.status}`, {
                    provider: 'dataforseo',
                    operation: 'on-page-lighthouse-live',
                });
            }
            return normalizeLighthouseResult(outcome.result[0]!, input.strategy);
        },
    };
}
