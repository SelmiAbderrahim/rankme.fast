/**
 * Audit job processor — runs in the WORKER deployable only.
 *
 * Vendor access goes exclusively through the provider registry:
 * startAudit → poll getAuditStatus → getAuditResult → persist the
 * normalized result on the AuditRun domain record + `audited_pages`
 * documents. No browser, no crawler — the vendor does the crawling.
 *
 * Error mapping (provider taxonomy → BullMQ):
 *   - retryable ProviderError (timeout / quota / 5xx) → rethrown, BullMQ
 *     retries with backoff; on exhaustion `onAuditJobExhausted` marks the
 *     run `unavailable` and the dead-letter handler archives the payload.
 *   - non-retryable ProviderError (auth / malformed vendor payload) and
 *     vendor-reported crawl failures → run marked `failed`, then
 *     UnrecoverableError so no attempts are wasted.
 *   - run-level deadline (AUDIT_RUN_TIMEOUT_MS) → run marked `failed` and
 *     an UnrecoverableError — retrying will not make a slow vendor faster.
 *
 * Idempotency (release gate): re-processing the same runId replaces any
 * previously persisted pages before writing the fresh set — a retried job
 * never leaves partial data alongside the final report.
 */
import { UnrecoverableError, type Job } from 'bullmq';
import type { Logger } from 'pino';
import { ProviderError, captureVendorCost, type AuditPage, type AuditProvider, type AuditResult, type GscSearchEvaluationInput, type GscSitemapsEvaluationInput, type IndexStatusEvaluationInput, type PageSpeedProvider, } from '../../shared/providers/index.js';
import { PAGESPEED_CONCURRENCY_PER_AUDIT, PAGESPEED_STAGE_DEADLINE_BUDGET_MS, } from "../../shared/safety/pagespeed-defaults.js";
import { auditJobSchema, parseConsumedPayload, type AuditJob } from '../../shared/queue/payloads.js';
import { Site } from '../sites/index.js';
import { AuditRun } from './audit-run.model.js';
import { completeAuditRun, failAuditRun, markAuditRunRunning } from './audit-run.service.js';
import { replaceAuditedPages } from './audits.service.js';
import { writeReportSnapshot } from './report.service.js';
import type { PageSpeedEvaluationInput, PageSpeedSample, } from './rules/index.js';
export interface AuditProcessorDeps {
    provider: AuditProvider;
    logger: Logger;
    /** Vendor poll cadence — injectable so tests never sleep for real. */
    pollIntervalMs?: number;
    /** Poll budget before the attempt is declared timed out (retryable). */
    maxPolls?: number;
    /** Overall wall-clock deadline for one processor attempt (non-retryable). */
    runTimeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    /** Injectable clock so the run-timeout branch is deterministic in tests. */
    now?: () => number;
    /**
     * PageSpeed provider — Lighthouse lab data plus optional CrUX.
     * Optional: when omitted, no page-speed section is written. A provider
     * failure NEVER fails the core audit (release-gate contract); it degrades
     * to `status: 'unavailable'` and the rules land in watch with
     * `insufficientData` meta.
     */
    pageSpeedProvider?: PageSpeedProvider;
    /** Number of additional pages after the always-sampled root. Default 3. */
    pageSpeedSampleSize?: number;
    /**
     * GSC index-status collector. Given the account + site + a
     * sampled URL set, it decrypts the stored refresh token, refreshes an
     * access token, and runs URL inspection per URL. The module owns the
     * mongo lookups; this dependency stays a plain function so the audits
     * module keeps its feature-module isolation. When omitted (or on any
     * failure), `indexStatus` is left off the snapshot and the rules land
     * in watch with `insufficientData` — the audit ALWAYS finishes.
     */
    collectIndexStatus?: (input: {
        accountId: string;
        siteId: string;
        domain: string;
        rootUrl: string;
        urls: readonly string[];
    }) => Promise<IndexStatusEvaluationInput>;
    /** Root URL + up to N pages inspected via GSC per audit. Default 10. */
    gscInspectSampleSize?: number;
    /**
     * GSC Search Analytics + Sitemaps collector. Same contract as
     * `collectIndexStatus`: the google-connections module owns the lookups
     * and NEVER throws — but the processor still guards with a try/catch so
     * an unexpected error degrades both sections instead of failing the run.
     * When omitted, neither section is written (pre-feature snapshot shape).
     */
    collectGscInsights?: (input: {
        accountId: string;
        siteId: string;
        domain: string;
    }) => Promise<{
        search: GscSearchEvaluationInput;
        sitemaps: GscSitemapsEvaluationInput;
    }>;
    /**
     * Vendor-response archiver (generic vendor layer). When present, the
     * normalized crawl result is appended to the `vendor_responses` table
     * (capability `audit`, per-account — never served cross-user) right after
     * the vendor hands it over. Optional so the processor stays bootable
     * without Postgres wiring (unit tests).
     */
    archiveVendorResponse?: (input: {
        capability: 'audit';
        operation: string;
        params: Record<string, unknown>;
        payload: unknown;
        accountId: string;
        /** Summed vendor spend across the crawl's post + polls + result fetch. */
        costMicros?: bigint | null;
        fetchedAt: Date;
    }) => Promise<void>;
}
export interface AuditJobOutcome {
    runId: string;
    pagesCrawled: number;
}
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
// ---------------------------------------------------------------------------
// Crawl-target resolution.
//
// Runs read the Site document (account-scoped — a cross-account or deleted
// site is permanent, never worth a retry).
// ---------------------------------------------------------------------------
export interface ResolvedAuditTarget {
    domain: string;
    url: string;
}
/** Public for tests. */
export async function resolveAuditTarget(payload: AuditJob): Promise<ResolvedAuditTarget> {
    const site = await Site.findOne({
        _id: payload.siteId,
        accountId: payload.accountId,
        deletionStartedAt: null,
    });
    if (site)
        return { domain: site.domain, url: site.url };
    throw new UnrecoverableError('site not found for audit job');
}
// ---------------------------------------------------------------------------
// Page-speed sampling.
//
// Lighthouse/optional CrUX is slow or paid — sample, NEVER run per-page. Selection:
//   1. The site's root URL (from Site.domain / Site.url).
//   2. Up to N additional pages picked by "centrality":
//      - shallowest URL path (proxy for "internal-link-count" until the
//        crawler populates that field explicitly),
//      - tiebreak by highest vendor `onPageScore` (higher = more content).
//      - only indexable pages, no duplicates.
// ---------------------------------------------------------------------------
/** Public for tests — path depth = number of non-empty `/`-separated segments. */
export function urlPathDepth(url: string): number {
    try {
        const path = new URL(url).pathname;
        return path.split('/').filter((seg) => seg.length > 0).length;
    }
    catch {
        return Number.MAX_SAFE_INTEGER;
    }
}
/**
 * Choose the URLs to analyze: root URL first, then up to N others by
 * centrality heuristic. `rootUrl` is always included even if it's not one
 * of the crawled pages (e.g. the vendor crawled deeper URLs but the root
 * still exists).
 */
export function selectPageSpeedSampleUrls(rootUrl: string, pages: readonly AuditPage[], sampleSize: number): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    out.push(rootUrl);
    seen.add(rootUrl);
    const ranked = pages
        .filter((p) => p.isIndexable)
        .filter((p) => !seen.has(p.url))
        .slice()
        .sort((a, b) => {
        const da = urlPathDepth(a.url);
        const db = urlPathDepth(b.url);
        if (da !== db)
            return da - db;
        return (b.onPageScore ?? 0) - (a.onPageScore ?? 0);
    });
    for (const page of ranked) {
        if (out.length >= sampleSize + 1)
            break;
        if (seen.has(page.url))
            continue;
        out.push(page.url);
        seen.add(page.url);
    }
    return out;
}
/** Bound on concurrent PageSpeed-provider calls per run. */
export const PAGESPEED_CONCURRENCY = PAGESPEED_CONCURRENCY_PER_AUDIT;
async function runPageSpeedSampling(provider: PageSpeedProvider, urls: readonly string[], logger: Logger): Promise<PageSpeedEvaluationInput> {
    // Ordered slots so `samples` preserves input URL order regardless of the
    // completion order of the bounded-concurrency queue.
    const slots: (PageSpeedSample | null)[] = new Array(urls.length).fill(null);
    let failures = 0;
    const analyzeAt = async (idx: number): Promise<void> => {
        const url = urls[idx]!;
        try {
            const analyzed = await provider.analyze({ url, strategy: 'mobile' });
            const analyzedAny = analyzed as unknown as {
                fieldDataLevel?: PageSpeedSample['fieldDataLevel'];
            };
            const sample: PageSpeedSample = {
                url,
                strategy: 'mobile',
                labScores: analyzed.labScores,
                fieldDataLevel: analyzedAny.fieldDataLevel ?? (analyzed.coreWebVitals ? 'url' : 'none'),
            };
            if (analyzed.coreWebVitals)
                sample.coreWebVitals = analyzed.coreWebVitals;
            if (typeof analyzed.mobileFriendly === 'boolean')
                sample.mobileFriendly = analyzed.mobileFriendly;
            slots[idx] = sample;
        }
        catch {
            failures += 1;
            logger.warn({ sampleIndex: idx }, 'page-speed sample failed — degrading to insufficient-data');
        }
    };
    const bound = Math.max(1, PAGESPEED_CONCURRENCY);
    for (let start = 0; start < urls.length; start += bound) {
        const chunk: Promise<void>[] = [];
        for (let i = start; i < Math.min(start + bound, urls.length); i += 1) {
            chunk.push(analyzeAt(i));
        }
        await Promise.allSettled(chunk);
    }
    const samples = slots.filter((s): s is PageSpeedSample => s !== null);
    const status: PageSpeedEvaluationInput['status'] = samples.length === 0 && failures > 0 ? 'unavailable' : 'ok';
    return { status, samples };
}
export function createAuditProcessor(deps: AuditProcessorDeps) {
    const pollIntervalMs = deps.pollIntervalMs ?? 2000;
    const maxPolls = deps.maxPolls ?? 150;
    const runTimeoutMs = deps.runTimeoutMs ?? 30 * 60 * 1000;
    const sleep = deps.sleep ?? defaultSleep;
    const now = deps.now ?? (() => Date.now());
    const pageSpeedSampleSize = deps.pageSpeedSampleSize ?? 3;
    const gscInspectSampleSize = deps.gscInspectSampleSize ?? 10;
    return async (job: Job): Promise<AuditJobOutcome> => {
        const payload = parseConsumedPayload(auditJobSchema, job.data);
        const deadline = now() + runTimeoutMs;
        try {
            const target = await resolveAuditTarget(payload);
            // The whole vendor conversation (task post, every poll, result fetch)
            // runs inside one cost-capture scope so the archive row below carries
            // the crawl's summed actual spend.
            const { value: crawl, costMicros } = await captureVendorCost(async () => {
                // Retry-resume: a BullMQ retry after the crawl was posted must NOT
                // post a second billed crawl (each task_post bills its crawled
                // pages). The vendor task id lands on the run the moment task_post
                // succeeds, so a retry that finds it resumes polling the SAME task.
                // Residual double-spend window: a crash between the vendor accepting
                // the task and the mongo write can re-post once — unavoidable
                // without vendor-side idempotency keys.
                const priorRun = await AuditRun.findById(payload.runId);
                let vendorTaskId: string;
                if (priorRun?.status === 'running' && priorRun.vendorTaskId) {
                    vendorTaskId = priorRun.vendorTaskId;
                    deps.logger.info({ runId: payload.runId, vendorTaskId }, 'audit retry resumes the existing vendor task — no new crawl posted');
                }
                else {
                    const started = await deps.provider.startAudit({
                        domain: target.domain,
                        pageCap: payload.pageCap,
                    });
                    vendorTaskId = started.vendorTaskId;
                    await markAuditRunRunning(payload.runId, vendorTaskId);
                }
                let finished = false;
                for (let poll = 0; poll < maxPolls && !finished; poll += 1) {
                    if (now() >= deadline) {
                        throw new UnrecoverableError(`audit ${vendorTaskId} exceeded ${runTimeoutMs}ms deadline`);
                    }
                    const status = await deps.provider.getAuditStatus(vendorTaskId);
                    if (status.state === 'finished') {
                        finished = true;
                    }
                    else if (status.state === 'failed') {
                        throw new UnrecoverableError(`vendor audit failed: ${status.error ?? 'unknown'}`);
                    }
                    else {
                        await sleep(pollIntervalMs);
                    }
                }
                if (!finished) {
                    // Poll budget exhausted — transient by definition; let BullMQ retry.
                    throw new Error(`audit ${vendorTaskId} still running after ${maxPolls} polls`);
                }
                const result: AuditResult = await deps.provider.getAuditResult(vendorTaskId);
                return { vendorTaskId, result };
            });
            const { vendorTaskId, result } = crawl;
            // Save-everything: the normalized crawl result is archived append-only
            // the moment the vendor hands it over (per-account — audit data is
            // never served cross-user). An archive failure is OUR database failing
            // and is retryable, same class as the snapshot write below.
            if (deps.archiveVendorResponse) {
                await deps.archiveVendorResponse({
                    capability: 'audit',
                    operation: 'crawl-result',
                    params: {
                        accountId: payload.accountId,
                        domain: target.domain,
                        vendorTaskId,
                        // Page counts are archived with the response: audit cost is per
                        // crawled page, so the requested ceiling and the actual count
                        // are both kept for operator cost review.
                        pageCap: payload.pageCap,
                        pagesCrawled: result.pages.length,
                    },
                    payload: result,
                    accountId: payload.accountId,
                    costMicros,
                    fetchedAt: new Date(now()),
                });
            }
            // Page-speed sampling — Lighthouse + optional CrUX on a
            // sampled subset.
            // Provider failure is degradation, NOT audit failure (release-gate
            // contract): a caught error yields `status: 'unavailable'` and the
            // rules land in watch, but the run still finishes.
            let pageSpeed: PageSpeedEvaluationInput | undefined;
            if (deps.pageSpeedProvider) {
                const remainingBudgetMs = deadline - now();
                if (remainingBudgetMs < PAGESPEED_STAGE_DEADLINE_BUDGET_MS) {
                    deps.logger.warn({
                        remainingBudgetMs,
                        requiredBudgetMs: PAGESPEED_STAGE_DEADLINE_BUDGET_MS,
                    }, 'page-speed skipped — insufficient audit deadline remains');
                    pageSpeed = { status: 'unavailable', samples: [] };
                }
                else {
                    const sampleUrls = selectPageSpeedSampleUrls(target.url, result.pages, pageSpeedSampleSize);
                    pageSpeed = await runPageSpeedSampling(deps.pageSpeedProvider, sampleUrls, deps.logger);
                }
            }
            // GSC index-status sampling. Same release-gate contract as
            // PageSpeed: any failure degrades to insufficientData, run still finishes.
            let indexStatus: IndexStatusEvaluationInput | undefined;
            if (deps.collectIndexStatus && gscInspectSampleSize > 0) {
                const gscUrls = selectPageSpeedSampleUrls(target.url, result.pages, gscInspectSampleSize);
                try {
                    indexStatus = await deps.collectIndexStatus({
                        accountId: payload.accountId,
                        siteId: payload.siteId,
                        domain: target.domain,
                        rootUrl: target.url,
                        urls: gscUrls,
                    });
                }
                catch (err) {
                    deps.logger.warn({
                        siteId: payload.siteId,
                        err: (err as Error).message,
                    }, 'gsc index-status collection failed — degrading to unavailable');
                    indexStatus = { status: 'unavailable', samples: [] };
                }
            }
            // GSC Search Analytics + Sitemaps. Same release-gate
            // contract: any failure degrades both sections to 'unavailable' and
            // the run still finishes.
            let gscSearch: GscSearchEvaluationInput | undefined;
            let gscSitemaps: GscSitemapsEvaluationInput | undefined;
            if (deps.collectGscInsights) {
                try {
                    const insights = await deps.collectGscInsights({
                        accountId: payload.accountId,
                        siteId: payload.siteId,
                        domain: target.domain,
                    });
                    gscSearch = insights.search;
                    gscSitemaps = insights.sitemaps;
                }
                catch (err) {
                    deps.logger.warn({
                        siteId: payload.siteId,
                        err: (err as Error).message,
                    }, 'gsc insights collection failed — degrading to unavailable');
                    gscSearch = {
                        status: 'unavailable',
                        totalClicks: 0,
                        totalImpressions: 0,
                        averageCtr: 0,
                        averagePosition: 0,
                        topQueries: [],
                        topPages: [],
                        delta: { clicks: null, impressions: null },
                    };
                    gscSitemaps = { status: 'unavailable', sitemaps: [] };
                }
            }
            // Idempotent persistence (release gate): drop prior pages → run the
            // rules → write the snapshot → flip the run status. A retried job
            // never leaves partial data, and the report is ALWAYS available the
            // moment a run reads `succeeded`.
            await replaceAuditedPages(payload.runId, result.pages);
            await writeReportSnapshot({
                runId: payload.runId,
                siteId: payload.siteId,
                accountId: payload.accountId,
                result,
                ...(pageSpeed ? { pageSpeed } : {}),
                ...(indexStatus ? { indexStatus } : {}),
                ...(gscSearch ? { gscSearch } : {}),
                ...(gscSitemaps ? { gscSitemaps } : {}),
            });
            await completeAuditRun(payload.runId, result);
            deps.logger.info({ runId: payload.runId, siteId: payload.siteId, pages: result.pages.length }, 'audit run succeeded');
            return { runId: payload.runId, pagesCrawled: result.pages.length };
        }
        catch (err) {
            if (err instanceof UnrecoverableError) {
                await failAuditRun(payload.runId, err.message);
                throw err;
            }
            if (err instanceof ProviderError && !err.retryable) {
                await failAuditRun(payload.runId, err.message);
                throw new UnrecoverableError(err.message);
            }
            throw err; // retryable — BullMQ backoff; exhaustion handled below
        }
    };
}
/**
 * Terminal-failure hook for the dead-letter wiring: marks the domain record
 * once retries are exhausted. Retryable provider errors mean "the vendor
 * was unavailable", everything else is a plain failure. No-ops on payloads
 * that never parsed (there is no run to update) and on runs a competing
 * writer already finalized (guarded transition).
 */
export async function onAuditJobExhausted(job: Job, err: Error): Promise<void> {
    const parsed = auditJobSchema.safeParse(job.data);
    if (!parsed.success)
        return;
    const unavailable = err instanceof ProviderError && err.retryable;
    await failAuditRun(parsed.data.runId, err.message, { unavailable });
}
