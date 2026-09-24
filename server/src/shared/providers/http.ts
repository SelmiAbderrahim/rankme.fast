/**
 * Shared vendor HTTP client.
 *
 * TWO-LAYER RETRY POLICY — read before touching retry code:
 *   1. This client retries TRANSIENT faults (timeout, 429, 5xx, network
 *      drop) at most `maxRetries` times (default 2) with exponential
 *      backoff + jitter, so a single blip never surfaces to a job.
 *   2. BullMQ owns JOB-LEVEL retries: a processor that receives a
 *      `retryable` ProviderError re-queues with queue backoff; a
 *      non-retryable one fails fast to the dead-letter queue.
 * Keep in-client retries small (≤2) — anything longer belongs to the queue.
 *
 * Secrets are never logged: log lines carry structured fields only
 * (provider / operation / status / cost), never request headers or bodies,
 * so `Authorization` is redacted by construction.
 */
import type { Logger } from 'pino';
import type { z } from 'zod';
import { recordVendorCostUsd } from './cost-capture.js';
import { zodDataForSeoEnvelope } from './dataforseo-envelope.js';
import { ProviderError, VendorAuthError, VendorMalformedError, VendorQuotaError, VendorTimeoutError, VendorUnavailableError, } from './errors.js';
export interface VendorHttpClientConfig {
    /** Registry key carried on every error + log line, e.g. `dataforseo`. */
    provider: string;
    /** Origin + path prefix, no trailing slash, e.g. `https://api.dataforseo.com/v3`. */
    baseUrl: string;
    /** Static headers (auth). Never logged. */
    headers?: Record<string, string>;
    /** Per-request deadline. Default 30s; PSI callers override to ≥60s per call. */
    timeoutMs?: number;
    /** In-client retries for retryable faults. Default 2 — see policy above. */
    maxRetries?: number;
    /** Maximum decoded response-body bytes. Default 12 MiB. */
    maxResponseBytes?: number;
    /** First backoff step. Default 500ms. */
    backoffBaseMs?: number;
    logger?: Logger;
    fetchImpl?: typeof fetch;
    /** Jitter source — injectable for deterministic tests. Default Math.random. */
    random?: () => number;
    /** Vendor-specific HTTP quota statuses. Defaults to 429. */
    quotaStatuses?: readonly number[];
    /**
     * Optional per-client retry policy. Defaults to the error taxonomy's
     * `retryable` flag so existing providers retain their current behavior.
     */
    shouldRetryError?: (error: ProviderError) => boolean;
}
export interface VendorRequestOptions<T> {
    operation: string;
    path: string;
    method?: 'DELETE' | 'GET' | 'PATCH' | 'POST';
    body?: unknown;
    /** Every response body is validated; a mismatch is a VendorMalformedError. */
    schema: z.ZodType<T>;
    /** Per-call deadline override (PSI needs ≥60s). */
    timeoutMs?: number;
    /** Caller cancellation, distinct from the request deadline. */
    signal?: AbortSignal;
    /** Per-call response ceiling override. */
    maxResponseBytes?: number;
}
export interface VendorHttpClient {
    request<T>(opts: VendorRequestOptions<T>): Promise<T>;
}
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_BASE_MS = 500;
const DEFAULT_MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Vendor-reported spend, when the payload carries a numeric `cost` (DataForSEO does). */
export function extractVendorCost(payload: unknown): number | undefined {
    if (typeof payload === 'object' && payload !== null && 'cost' in payload) {
        const cost = (payload as {
            cost: unknown;
        }).cost;
        if (typeof cost === 'number')
            return cost;
    }
    return undefined;
}
function parseRetryAfterSeconds(res: Response): number | undefined {
    const header = res.headers.get('retry-after');
    if (header === null)
        return undefined;
    const seconds = Number(header);
    return Number.isFinite(seconds) ? seconds : undefined;
}
async function readBoundedJson(res: Response, maxResponseBytes: number, ctx: {
    provider: string;
    operation: string;
    httpStatus?: number;
}): Promise<unknown> {
    const reader = res.body?.getReader();
    if (!reader) {
        throw new VendorMalformedError('response body is empty', ctx);
    }
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    for (;;) {
        const chunk = await reader.read();
        if (chunk.done)
            break;
        bytes += chunk.value.byteLength;
        if (bytes > maxResponseBytes) {
            void reader.cancel();
            throw new VendorMalformedError(`response exceeded ${maxResponseBytes} byte ceiling`, ctx);
        }
        text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    try {
        return JSON.parse(text) as unknown;
    }
    catch (cause) {
        throw new VendorMalformedError('response body is not JSON', { ...ctx, cause });
    }
}
export function createVendorHttpClient(cfg: VendorHttpClientConfig): VendorHttpClient {
    const timeoutMsDefault = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = cfg.maxRetries ?? DEFAULT_MAX_RETRIES;
    const backoffBaseMs = cfg.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    const random = cfg.random ?? Math.random;
    const fetchImpl = cfg.fetchImpl;
    const quotaStatuses = cfg.quotaStatuses ?? [429];
    const maxResponseBytesDefault = cfg.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isInteger(maxResponseBytesDefault) || maxResponseBytesDefault <= 0) {
        throw new Error('maxResponseBytes must be a positive integer');
    }
    async function attemptOnce<T>(opts: VendorRequestOptions<T>, attempt: number): Promise<T> {
        const ctx = { provider: cfg.provider, operation: opts.operation };
        const timeoutMs = opts.timeoutMs ?? timeoutMsDefault;
        const maxResponseBytes = opts.maxResponseBytes ?? maxResponseBytesDefault;
        if (!Number.isInteger(maxResponseBytes) || maxResponseBytes <= 0) {
            throw new Error('maxResponseBytes must be a positive integer');
        }
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
        const cancel = (): void => controller.abort(opts.signal?.reason);
        if (opts.signal?.aborted)
            cancel();
        else
            opts.signal?.addEventListener('abort', cancel, { once: true });
        try {
            let res: Response;
            try {
                res = await (fetchImpl ?? fetch)(`${cfg.baseUrl}${opts.path}`, {
                    method: opts.method ?? 'POST',
                    headers: { 'content-type': 'application/json', ...cfg.headers },
                    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
                    signal: controller.signal,
                });
            }
            catch (cause) {
                if (controller.signal.aborted) {
                    if (!timedOut && opts.signal?.aborted) {
                        throw new ProviderError('request cancelled', false, { ...ctx, cause });
                    }
                    throw new VendorTimeoutError(`no response within ${timeoutMs}ms`, { ...ctx, cause });
                }
                throw new VendorUnavailableError('network failure before a response', { ...ctx, cause });
            }
            const responseCtx = { ...ctx, httpStatus: res.status };
            if (res.status === 401 || res.status === 403) {
                throw new VendorAuthError(`credentials rejected (HTTP ${res.status})`, responseCtx);
            }
            if (quotaStatuses.includes(res.status)) {
                throw new VendorQuotaError(`vendor quota hit (HTTP ${res.status})`, {
                    ...responseCtx,
                    retryAfterSeconds: parseRetryAfterSeconds(res),
                });
            }
            if (res.status === 408 || res.status === 504) {
                throw new VendorTimeoutError(`vendor timed out (HTTP ${res.status})`, responseCtx);
            }
            if (res.status >= 500) {
                throw new VendorUnavailableError(`vendor unavailable (HTTP ${res.status})`, responseCtx);
            }
            if (!res.ok) {
                throw new VendorMalformedError(`unexpected HTTP ${res.status}`, responseCtx);
            }
            // Body read stays INSIDE the deadline — a vendor that streams headers
            // then stalls the body is a timeout, not a hang. undici rejects the
            // body read on abort, which we catch here.
            let payload: unknown;
            try {
                payload = await readBoundedJson(res, maxResponseBytes, responseCtx);
            }
            catch (cause) {
                if (cause instanceof ProviderError)
                    throw cause;
                if (controller.signal.aborted) {
                    if (!timedOut && opts.signal?.aborted) {
                        throw new ProviderError('request cancelled', false, { ...ctx, cause });
                    }
                    throw new VendorTimeoutError(`no complete body within ${timeoutMs}ms`, {
                        ...responseCtx,
                        cause,
                    });
                }
                throw new VendorMalformedError('response body could not be read', {
                    ...responseCtx,
                    cause,
                });
            }
            const parsed = opts.schema.safeParse(payload);
            if (!parsed.success) {
                throw new VendorMalformedError(`response failed schema validation: ${parsed.error.message}`, { ...responseCtx, cause: parsed.error });
            }
            // Structured cost logging — fields only, never headers or bodies.
            cfg.logger?.info({
                provider: cfg.provider,
                operation: opts.operation,
                status: res.status,
                attempt,
                costUsd: extractVendorCost(payload),
            }, 'vendor request ok');
            return parsed.data;
        }
        finally {
            clearTimeout(timer);
            opts.signal?.removeEventListener('abort', cancel);
        }
    }
    async function requestWithRetry<T>(opts: VendorRequestOptions<T>, attempt: number): Promise<T> {
        try {
            return await attemptOnce(opts, attempt);
        }
        catch (err) {
            const retryable = err instanceof ProviderError &&
                (cfg.shouldRetryError === undefined ? err.retryable : cfg.shouldRetryError(err));
            if (!retryable || attempt >= maxRetries)
                throw err;
            const delayMs = backoffBaseMs * 2 ** attempt + random() * backoffBaseMs;
            cfg.logger?.warn({
                provider: cfg.provider,
                operation: opts.operation,
                attempt,
                delayMs,
                error: (err as ProviderError).message,
            }, 'vendor request retrying');
            await sleep(delayMs);
            return requestWithRetry(opts, attempt + 1);
        }
    }
    return { request: (opts) => requestWithRetry(opts, 0) };
}
// ---------------------------------------------------------------------------
// DataForSEO specifics — shared by the four DataForSEO adapters.
// ---------------------------------------------------------------------------
export interface DataForSeoConfig {
    login: string;
    password: string;
    /** Prod `https://api.dataforseo.com/v3`; sandbox `https://sandbox.dataforseo.com/v3`
     * is a drop-in swap serving free dummy data. From `DATAFORSEO_BASE_URL`. */
    baseUrl: string;
    timeoutMs?: number;
    maxRetries?: number;
    backoffBaseMs?: number;
    logger?: Logger;
    fetchImpl?: typeof fetch;
    random?: () => number;
}
/**
 * Per-task outcome. `in_queue` (vendor 40601/40602) means keep polling — it is
 * a normal state, not an error. `created` (20100) acknowledges a task_post.
 */
export type DataForSeoTaskOutcome<T> = {
    status: 'ok';
    taskId: string | null;
    costUsd: number | null;
    result: T;
} | {
    status: 'created';
    taskId: string | null;
    costUsd: number | null;
} | {
    status: 'in_queue';
    taskId: string | null;
};
type DataForSeoStatusClass = 'ok' | 'created' | 'in_queue';
/**
 * DataForSEO status codes appear at BOTH the envelope and the task level;
 * both go through this classifier: 20000 ok, 20100 task created, 40601/40602
 * pending, 402xx quota/balance, 401xx credentials, 5xxxx vendor
 * fault. Anything else is contract drift → malformed (fail fast).
 */
function classifyDataForSeoStatus(code: number, message: string | undefined, ctx: {
    provider: string;
    operation: string;
}): DataForSeoStatusClass {
    if (code === 20000)
        return 'ok';
    if (code === 20100)
        return 'created';
    if (code === 40601 || code === 40602)
        return 'in_queue';
    const detail = `vendor status ${code}${message === undefined ? '' : `: ${message}`}`;
    if (code >= 40200 && code < 40300)
        throw new VendorQuotaError(detail, ctx);
    if (code >= 40100 && code < 40200)
        throw new VendorAuthError(detail, ctx);
    if (code >= 50000)
        throw new VendorUnavailableError(detail, ctx);
    throw new VendorMalformedError(`unrecognized ${detail}`, ctx);
}
// Module-level VendorHttpClient memo keyed by the identity-relevant DataForSEO
// config fields (audit polls a run repeatedly and each iteration was
// rebuilding the client). Test seams (`fetchImpl`, `logger`,
// `random`) bypass the memo so contract tests never share state.
const dataForSeoClientCache = new Map<string, VendorHttpClient>();
function dataForSeoClientCacheKey(cfg: DataForSeoConfig): string {
    return [
        cfg.baseUrl,
        cfg.login,
        cfg.password,
        cfg.timeoutMs ?? '',
        cfg.maxRetries ?? '',
        cfg.backoffBaseMs ?? '',
    ].join('|');
}
/** Test seam so the memo can be cleared between contract-test runs. */
export function clearDataForSeoClientCache(): void {
    dataForSeoClientCache.clear();
}
/** Test seam — cache size for memoization assertions. */
export function dataForSeoClientCacheSize(): number {
    return dataForSeoClientCache.size;
}
function getDataForSeoClient(cfg: DataForSeoConfig): VendorHttpClient {
    // Bypass the memo when a `fetchImpl` or `random` test seam is present so
    // contract tests never share state through this module-level cache. The
    // production `logger` from the registry stays cache-friendly — every prod
    // call ships the same shared pino instance, so the FIRST built client's
    // logger reference is fine to reuse for later hits.
    const bypass = Boolean(cfg.fetchImpl) || Boolean(cfg.random);
    const build = (): VendorHttpClient => createVendorHttpClient({
        provider: 'dataforseo',
        baseUrl: cfg.baseUrl,
        headers: {
            authorization: `Basic ${Buffer.from(`${cfg.login}:${cfg.password}`).toString('base64')}`,
        },
        ...(cfg.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
        ...(cfg.maxRetries !== undefined ? { maxRetries: cfg.maxRetries } : {}),
        ...(cfg.backoffBaseMs !== undefined ? { backoffBaseMs: cfg.backoffBaseMs } : {}),
        ...(cfg.logger ? { logger: cfg.logger } : {}),
        ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}),
        ...(cfg.random ? { random: cfg.random } : {}),
    });
    if (bypass)
        return build();
    const key = dataForSeoClientCacheKey(cfg);
    const existing = dataForSeoClientCache.get(key);
    if (existing)
        return existing;
    const created = build();
    dataForSeoClientCache.set(key, created);
    return created;
}
/**
 * Typed DataForSEO call: POSTs the task array, validates the two-level
 * envelope, branches on both status levels, and parses each task's `result`
 * with the caller's schema. Basic auth from DATAFORSEO_LOGIN/PASSWORD —
 * passed in via config, never read from env here.
 */
export async function dataForSeoRequest<T>(cfg: DataForSeoConfig, path: string, tasks: unknown[], resultSchema: z.ZodType<T>, opts?: {
    operation?: string;
    timeoutMs?: number;
    method?: 'GET' | 'POST';
    maxResponseBytes?: number;
}): Promise<DataForSeoTaskOutcome<T>[]> {
    const operation = opts?.operation ?? path;
    const method = opts?.method ?? 'POST';
    const ctx = { provider: 'dataforseo', operation };
    const client = getDataForSeoClient(cfg);
    const envelope = await client.request({
        operation,
        path,
        method,
        ...(method === 'POST' ? { body: tasks } : {}),
        schema: zodDataForSeoEnvelope,
        timeoutMs: opts?.timeoutMs,
        maxResponseBytes: opts?.maxResponseBytes,
    });
    classifyDataForSeoStatus(envelope.status_code, envelope.status_message, ctx);
    // Envelope `cost` is the vendor-reported total for this HTTP request —
    // recorded into the ambient capture scope (if any) so archive writers
    // can persist actual spend per provider-method invocation.
    recordVendorCostUsd(envelope.cost ?? null);
    return (envelope.tasks ?? []).map((task): DataForSeoTaskOutcome<T> => {
        const taskId = task.id ?? null;
        const status = classifyDataForSeoStatus(task.status_code, task.status_message, ctx);
        if (status === 'in_queue')
            return { status, taskId };
        const costUsd = task.cost ?? null;
        if (status === 'created')
            return { status, taskId, costUsd };
        const parsed = resultSchema.safeParse(task.result);
        if (!parsed.success) {
            throw new VendorMalformedError(`task result failed schema validation: ${parsed.error.message}`, { ...ctx, cause: parsed.error });
        }
        return { status, taskId, costUsd, result: parsed.data };
    });
}
