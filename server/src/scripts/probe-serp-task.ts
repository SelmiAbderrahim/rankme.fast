// Operator diagnostic for the DataForSEO async SERP task path (the path a
// production rank check actually takes — see `callProviderForItems`).
//
// It answers one question that logs alone could not: when a "Check failed"
// appears, was the task queue slower than `SERP_TASK_MAX_POLL_ATTEMPTS x
// SERP_TASK_POLL_INTERVAL_MS`, were the credentials rejected, or was that one
// keyword rejected outright? It posts ONE task and polls it, recording the
// elapsed milliseconds and the outcome of every attempt.
//
// It deliberately reuses `dataForSeoRequest` — the same helper the rank
// adapter uses — so what it measures is what production does, including the
// error classification. It never writes fixtures, never touches the database,
// and records no vendor payload beyond item counts.
//
// SPENDS REAL VENDOR MONEY: one `task_post` at the configured depth
// (~$0.006 at depth 100). Composed as `probeSerpTask(deps, input)` with
// injected clock/wait/request so it is unit-tested end to end and needs no
// coverage exclusion. Production api/worker images are bundled `dist` on a
// read-only rootfs, so this never runs inside them — invoke it from a
// throwaway container on the same network.
import { z } from 'zod';
import { dataForSeoRequest, type DataForSeoConfig } from '../shared/providers/http.js';
import { ProviderError } from '../shared/providers/errors.js';
/** Deliberately permissive: a probe must report shape drift, not die of it. */
const looseResultSchema = z.array(z.object({}).passthrough()).nullable().optional();
export interface SerpTaskProbeInput {
    keyword: string;
    /** DataForSEO location code. 2840 = United States. */
    locationCode?: number;
    languageCode?: string;
    device?: 'desktop' | 'mobile';
    /** Matches `SERP_DEPTH` so the probe bills what a real check bills. */
    depth?: number;
    pollIntervalMs?: number;
    maxPollAttempts?: number;
}
export interface SerpTaskProbeDeps {
    cfg: DataForSeoConfig;
    /** Monotonic-enough millisecond clock; injected so tests stay deterministic. */
    now: () => number;
    wait: (ms: number) => Promise<void>;
    /** Injection seam for the vendor call. Defaults to the shared helper. */
    request?: typeof dataForSeoRequest;
}
export interface SerpTaskProbeAttempt {
    attempt: number;
    /** Milliseconds since the probe started, not since this attempt started. */
    elapsedMs: number;
    /** `ok` / `created` / `in_queue`, or null when the attempt threw. */
    taskStatus: string | null;
    /** Error class name when the attempt threw, else null. */
    errorClass: string | null;
    /** Error message — carries the vendor status code — else null. */
    errorMessage: string | null;
}
export type SerpTaskProbeOutcome = 'ok' | 'exhausted' | 'error';
export interface SerpTaskProbeResult {
    keyword: string;
    depth: number;
    taskId: string | null;
    postElapsedMs: number;
    attempts: SerpTaskProbeAttempt[];
    totalElapsedMs: number;
    outcome: SerpTaskProbeOutcome;
    /** Organic rows the completed task returned; null unless `outcome` is `ok`. */
    resultCount: number | null;
    /** Set when `outcome` is `error`. */
    errorClass: string | null;
    errorMessage: string | null;
}
/**
 * Post one SERP task and poll it to completion, timing every step.
 *
 * Never throws for a vendor-side failure — a thrown `ProviderError` IS the
 * measurement, so it is captured into the result. Anything else (a bug in this
 * code) propagates.
 */
export async function probeSerpTask(deps: SerpTaskProbeDeps, input: SerpTaskProbeInput): Promise<SerpTaskProbeResult> {
    const request = deps.request ?? dataForSeoRequest;
    const depth = input.depth ?? 100;
    const pollIntervalMs = input.pollIntervalMs ?? 3000;
    const maxPollAttempts = input.maxPollAttempts ?? 60;
    const startedAt = deps.now();
    const since = (): number => deps.now() - startedAt;
    const base: Omit<SerpTaskProbeResult, 'outcome'> = {
        keyword: input.keyword,
        depth,
        taskId: null,
        postElapsedMs: 0,
        attempts: [],
        totalElapsedMs: 0,
        resultCount: null,
        errorClass: null,
        errorMessage: null,
    };
    try {
        const posted = await request(deps.cfg, '/serp/google/organic/task_post', [
            {
                keyword: input.keyword,
                location_code: input.locationCode ?? 2840,
                language_code: input.languageCode ?? 'en',
                device: input.device ?? 'desktop',
                depth,
            },
        ], looseResultSchema, { operation: 'probe-serp-task-post' });
        base.postElapsedMs = since();
        base.taskId = posted[0]?.taskId ?? null;
    }
    catch (err) {
        return finalizeError(base, since(), err);
    }
    if (base.taskId === null) {
        // A post that reports no task id cannot be polled; say so rather than
        // looping against an undefined id.
        return {
            ...base,
            totalElapsedMs: since(),
            outcome: 'error',
            errorClass: 'NoTaskId',
            errorMessage: 'task_post returned no task id',
        };
    }
    for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
        try {
            const fetched = await request(deps.cfg, `/serp/google/organic/task_get/advanced/${encodeURIComponent(base.taskId)}`, [], looseResultSchema, { operation: 'probe-serp-task-get', method: 'GET' });
            const fetchedTask = fetched[0];
            base.attempts.push({
                attempt,
                elapsedMs: since(),
                taskStatus: fetchedTask?.status ?? null,
                errorClass: null,
                errorMessage: null,
            });
            if (fetchedTask?.status === 'ok') {
                return {
                    ...base,
                    totalElapsedMs: since(),
                    outcome: 'ok',
                    resultCount: fetchedTask.result?.length ?? 0,
                };
            }
        }
        catch (err) {
            base.attempts.push({
                attempt,
                elapsedMs: since(),
                taskStatus: null,
                errorClass: errorClassOf(err),
                errorMessage: messageOf(err),
            });
            // An auth or quota failure will not resolve by waiting; stop and report.
            if (err instanceof ProviderError && !err.retryable) {
                return finalizeError(base, since(), err);
            }
        }
        if (attempt < maxPollAttempts)
            await deps.wait(pollIntervalMs);
    }
    // The queue outlived the budget — the exact condition that surfaces to a
    // user as a failed check.
    return { ...base, totalElapsedMs: since(), outcome: 'exhausted' };
}
function errorClassOf(err: unknown): string {
    return err instanceof Error ? err.constructor.name : 'UnknownError';
}
function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
function finalizeError(base: Omit<SerpTaskProbeResult, 'outcome'>, totalElapsedMs: number, err: unknown): SerpTaskProbeResult {
    return {
        ...base,
        totalElapsedMs,
        outcome: 'error',
        errorClass: errorClassOf(err),
        errorMessage: messageOf(err),
    };
}
/**
 * One-line-per-step operator summary. Kept free of the keyword's SERP payload:
 * counts and timings only.
 */
export function formatSerpTaskProbe(result: SerpTaskProbeResult): string {
    const lines = [
        `keyword: ${result.keyword} (depth ${result.depth})`,
        `task_post: ${result.postElapsedMs}ms task_id=${result.taskId ?? 'none'}`,
        ...result.attempts.map((a) => `  poll ${a.attempt}: ${a.elapsedMs}ms status=${a.taskStatus ?? '-'}` +
            (a.errorClass === null ? '' : ` ${a.errorClass}: ${a.errorMessage ?? ''}`)),
        `outcome: ${result.outcome} after ${result.totalElapsedMs}ms` +
            (result.resultCount === null ? '' : ` (${result.resultCount} result blocks)`),
    ];
    if (result.errorClass !== null) {
        lines.push(`error: ${result.errorClass}: ${result.errorMessage ?? ''}`);
    }
    return lines.join('\n');
}
