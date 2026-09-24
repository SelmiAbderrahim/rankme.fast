/**
 * Firecrawl content-monitor adapter.
 *
 * ============================ PHASE-0 CONTRACT ============================
 * Verified against primary docs (docs.firecrawl.dev), captured 2026-07-20:
 *
 *   Monitor resource — Firecrawl DOES ship a first-class recurring `/monitor`
 *   resource (NOT an emulated scheduled-scrape loop):
 *     POST   /v2/monitor                 create   → { success, data:{ id, status, schedule:{cron,timezone}, nextRunAt, estimatedCreditsPerMonth, ... } }
 *     GET    /v2/monitor/{id}            get      → status
 *     PATCH  /v2/monitor/{id}            update   → pause/resume via { status }
 *     DELETE /v2/monitor/{id}            delete
 *   Weekly cadence is expressed as schedule `{ text: "weekly", timezone }`;
 *   the API normalizes text → cron on the returned record. `judgeEnabled` is
 *   set FALSE — we run our own deterministic change detection, so we never pay
 *   for the vendor AI judge. `retentionDays` is bounded to our own replay
 *   window. `webhook.metadata` is echoed verbatim on every delivery.
 *
 *   Webhook signature (docs.firecrawl.dev/webhooks/security):
 *     header : `X-Firecrawl-Signature`  value `sha256=<hex>`
 *     algo   : HMAC-SHA256 over the EXACT raw request body (pre-JSON-parse)
 *     time   : NO timestamp is part of the signed payload → replay defence is
 *              UNCONDITIONAL event-id dedupe with a bounded TTL (implemented in
 *              modules/content-monitoring, 30-day documented replay window).
 *     ack    : return 2xx within 10s; failed deliveries retry at +1m/+5m/+15m
 *              then abandon after 3 attempts.
 *
 *   Webhook body (docs.firecrawl.dev/webhooks/events):
 *     { success, type, id, webhookId?, metadata?, data:[ … ] }
 *     type ∈ { "monitor.page", "monitor.check.completed" }
 *     data[] (monitor.page): { monitorId, checkId, url, status(same|new|changed|
 *       removed|error), isMeaningful, judgment?, diff?:{text,json}, snapshot? }
 *     data[] (monitor.check.completed): { monitorId, checkId, status, summary }
 *     Deliveries carry a `data` ARRAY → bounded to
 *     CONTENT_MONITOR_MAX_EVENTS_PER_DELIVERY (amplification guard).
 *
 * The signature contract lives with the webhook handler (app-level secret); this
 * adapter owns the monitor lifecycle calls + provider-neutral normalization only.
 * No vendor shape escapes: callers receive `content-monitor.ts` types + opaque
 * ids. Signature-bearing webhook fixtures under
 * `shared/testing/fixtures/firecrawl-monitor/*` are recorded + redacted.
 * =========================================================================
 */
import type { Logger } from 'pino';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CONTENT_MONITOR_MAX_EVENTS_PER_DELIVERY, PAGE_CHANGE_STATUSES, contentMonitorDeliveryKey, contentMonitorEventKey, createMonitorInputSchema, monitorRefInputSchema, sanitizeDiffText, type ContentMonitorProvider, type ContentMonitorProviderStatus, type CreateMonitorInput, type CreateMonitorResult, type MonitorRefInput, type MonitorStatusResult, type NormalizedWebhookDelivery, type PageChangeEvent, } from '../content-monitor.js';
import { ProviderError, VendorMalformedError } from '../errors.js';
import { FIRECRAWL_CREDENTIAL_REF_PATTERN, createFirecrawlCredentialPool, } from './credential-pool.js';
const ctx = { provider: 'firecrawl', operation: 'content-monitor' };
export const FIRECRAWL_CREDENTIAL_REF_METADATA_KEY = 'rankmeProviderCredentialRef';
// ---------------------------------------------------------------------------
// Vendor response schemas (only the fields we read).
// ---------------------------------------------------------------------------
const monitorRecordSchema = z.object({
    id: z.string().min(1).max(512),
    status: z.enum(['active', 'paused']),
});
const createMonitorResponseSchema = z.object({
    success: z.literal(true),
    data: monitorRecordSchema,
});
const monitorStatusResponseSchema = z.object({
    success: z.literal(true).optional(),
    data: z.object({
        id: z.string().min(1).max(512),
        // Any non-active/paused vendor status maps to our neutral `error`.
        status: z.string().min(1).max(64),
    }),
});
const deleteResponseSchema = z.object({ success: z.literal(true) });
// ---------------------------------------------------------------------------
// Webhook body schema — the two monitor event shapes.
// ---------------------------------------------------------------------------
const webhookPageSchema = z.object({
    monitorId: z.string().min(1).max(512),
    checkId: z.string().min(1).max(512),
    url: z.string().min(1).max(2048),
    status: z.enum(PAGE_CHANGE_STATUSES).catch('error'),
    isMeaningful: z.boolean().optional(),
    contentHash: z.string().max(128).nullable().optional(),
    diff: z
        .object({ text: z.string().max(100000).nullable().optional() })
        .nullable()
        .optional(),
});
const webhookCheckSchema = z.object({
    monitorId: z.string().min(1).max(512),
    checkId: z.string().min(1).max(512),
    status: z.string().max(64).optional(),
});
const webhookEnvelopeSchema = z.object({
    type: z.enum(['monitor.page', 'monitor.check.completed']),
    metadata: z
        .object({
        [FIRECRAWL_CREDENTIAL_REF_METADATA_KEY]: z
            .string()
            .regex(FIRECRAWL_CREDENTIAL_REF_PATTERN)
            .optional(),
    })
        .passthrough()
        .optional(),
    data: z.array(z.record(z.string(), z.unknown())).max(CONTENT_MONITOR_MAX_EVENTS_PER_DELIVERY),
});
export interface FirecrawlContentMonitorConfig {
    apiKey: string;
    fallbackApiKeys?: readonly string[];
    baseUrl: string;
    timeoutMs: number;
    zdrEnabled: boolean;
    logger?: Logger;
    fetchImpl?: typeof fetch;
    clock?: () => Date;
    maxRetries?: number;
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
function toProviderStatus(raw: string): ContentMonitorProviderStatus {
    if (raw === 'active')
        return 'active';
    if (raw === 'paused')
        return 'paused';
    return 'error';
}
function parseCreate(input: CreateMonitorInput): CreateMonitorInput {
    const parsed = createMonitorInputSchema.safeParse(input);
    if (!parsed.success) {
        throw new VendorMalformedError(`invalid create-monitor input: ${parsed.error.message}`, {
            ...ctx,
            cause: parsed.error,
        });
    }
    return parsed.data;
}
function parseRef(input: MonitorRefInput): MonitorRefInput {
    const parsed = monitorRefInputSchema.safeParse(input);
    if (!parsed.success) {
        throw new VendorMalformedError(`invalid monitor ref: ${parsed.error.message}`, {
            ...ctx,
            cause: parsed.error,
        });
    }
    return parsed.data;
}
export function createFirecrawlContentMonitorProvider(cfg: FirecrawlContentMonitorConfig): ContentMonitorProvider {
    if (!cfg.apiKey)
        throw new Error('PROVIDER_CONTENT_SOURCE=firecrawl requires FIRECRAWL_API_KEY.');
    if (cfg.zdrEnabled !== true) {
        throw new Error('PROVIDER_CONTENT_SOURCE=firecrawl requires FIRECRAWL_ZDR_ENABLED=true (operator attestation that Firecrawl Cloud Zero Data Retention is enabled on every configured account).');
    }
    if (!Number.isInteger(cfg.timeoutMs) || cfg.timeoutMs <= 0) {
        throw new Error('FIRECRAWL_TIMEOUT_MS must be a positive integer.');
    }
    const baseUrl = validateBaseUrl(cfg.baseUrl);
    const credentialPool = createFirecrawlCredentialPool({
        apiKey: cfg.apiKey,
        ...(cfg.fallbackApiKeys ? { fallbackApiKeys: cfg.fallbackApiKeys } : {}),
        baseUrl,
        timeoutMs: cfg.timeoutMs,
        ...(cfg.logger ? { logger: cfg.logger } : {}),
        ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}),
        ...(cfg.maxRetries !== undefined ? { maxRetries: cfg.maxRetries } : {}),
    });
    const clock = cfg.clock ?? (() => new Date());
    return {
        async createMonitor(input: CreateMonitorInput): Promise<CreateMonitorResult> {
            const parsed = parseCreate(input);
            const { value: response, credential } = await credentialPool.executeWithFailover('monitor-create', async (attempt) => attempt.failoverClient.request({
                operation: 'monitor-create',
                path: '/v2/monitor',
                method: 'POST',
                body: {
                    name: `rankmefast-${parsed.cadence}`,
                    schedule: { text: parsed.cadence, timezone: 'UTC' },
                    judgeEnabled: false,
                    retentionDays: 30,
                    targets: [
                        {
                            type: 'scrape',
                            urls: [parsed.targetUrl],
                            scrapeOptions: {
                                formats: ['markdown', { type: 'changeTracking', modes: ['git-diff'] }],
                                onlyMainContent: true,
                                blockAds: true,
                                storeInCache: false,
                            },
                        },
                    ],
                    webhook: {
                        url: parsed.callbackUrl,
                        events: ['monitor.page', 'monitor.check.completed'],
                        metadata: {
                            ...(parsed.metadata ?? {}),
                            // Reserved metadata always wins over caller-supplied tags.
                            [FIRECRAWL_CREDENTIAL_REF_METADATA_KEY]: attempt.credentialRef,
                        },
                    },
                    zeroDataRetention: true,
                },
                schema: createMonitorResponseSchema,
                timeoutMs: Math.min(parsed.timeoutMs, cfg.timeoutMs),
            }));
            return {
                providerMonitorId: response.data.id,
                providerCredentialRef: credential.credentialRef,
                status: response.data.status,
                cadence: parsed.cadence,
            };
        },
        async pauseMonitor(input: MonitorRefInput): Promise<MonitorStatusResult> {
            return patchStatus(input, 'paused');
        },
        async resumeMonitor(input: MonitorRefInput): Promise<MonitorStatusResult> {
            return patchStatus(input, 'active');
        },
        async deleteMonitor(input: MonitorRefInput): Promise<void> {
            const ref = parseRef(input);
            const credential = credentialPool.resolvePinned(ref.providerCredentialRef, 'monitor-delete');
            try {
                await credential.pinnedClient.request({
                    operation: 'monitor-delete',
                    path: `/v2/monitor/${encodeURIComponent(ref.providerMonitorId)}`,
                    method: 'DELETE',
                    schema: deleteResponseSchema,
                    timeoutMs: Math.min(ref.timeoutMs, cfg.timeoutMs),
                });
            }
            catch (error) {
                // Remote DELETE is retry-idempotent: a previous attempt may have
                // succeeded before local finalization failed. "Already absent" is the
                // desired terminal state, not a provider failure.
                if (error instanceof ProviderError && error.httpStatus === 404)
                    return;
                throw error;
            }
        },
        async getMonitorStatus(input: MonitorRefInput): Promise<MonitorStatusResult> {
            const ref = parseRef(input);
            const credential = credentialPool.resolvePinned(ref.providerCredentialRef, 'monitor-get');
            const response = await credential.pinnedClient.request({
                operation: 'monitor-get',
                path: `/v2/monitor/${encodeURIComponent(ref.providerMonitorId)}`,
                method: 'GET',
                schema: monitorStatusResponseSchema,
                timeoutMs: Math.min(ref.timeoutMs, cfg.timeoutMs),
            });
            return {
                providerMonitorId: response.data.id,
                status: toProviderStatus(response.data.status),
            };
        },
        normalizeWebhookDelivery(body: unknown): NormalizedWebhookDelivery {
            const envelope = webhookEnvelopeSchema.safeParse(body);
            if (!envelope.success) {
                throw new VendorMalformedError(`invalid monitor webhook body: ${envelope.error.message}`, {
                    ...ctx,
                    cause: envelope.error,
                });
            }
            const type = envelope.data.type;
            const providerCredentialRef = envelope.data.metadata?.[FIRECRAWL_CREDENTIAL_REF_METADATA_KEY];
            if (type === 'monitor.check.completed') {
                const first = webhookCheckSchema.safeParse(envelope.data.data[0]);
                if (!first.success) {
                    throw new VendorMalformedError(`invalid monitor.check.completed body: ${first.error.message}`, { ...ctx, cause: first.error });
                }
                return {
                    eventType: type,
                    deliveryKey: contentMonitorDeliveryKey(type, first.data.checkId, providerCredentialRef),
                    providerMonitorId: first.data.monitorId,
                    ...(providerCredentialRef ? { providerCredentialRef } : {}),
                    checkId: first.data.checkId,
                    events: [],
                };
            }
            const pages = envelope.data.data.map((entry, index) => {
                const parsed = webhookPageSchema.safeParse(entry);
                if (!parsed.success) {
                    throw new VendorMalformedError(`invalid monitor.page entry ${index}: ${parsed.error.message}`, { ...ctx, cause: parsed.error });
                }
                return parsed.data;
            });
            if (pages.length === 0) {
                throw new VendorMalformedError('monitor.page delivery carried no pages', ctx);
            }
            const events: PageChangeEvent[] = pages.map((page) => ({
                eventKey: contentMonitorEventKey(page.monitorId, page.checkId, page.url),
                providerMonitorId: page.monitorId,
                checkId: page.checkId,
                targetUrl: page.url,
                status: page.status,
                changed: page.status === 'changed' || page.status === 'new' || page.status === 'removed',
                contentHash: page.contentHash ?? null,
                diffText: sanitizeDiffText(page.diff?.text ?? null),
                occurredAt: clock(),
            }));
            const first = pages[0]!;
            const deliveryDiscriminator = createHash('sha256')
                .update(events.map((event) => event.eventKey).join('|'))
                .digest('hex')
                .slice(0, 32);
            return {
                eventType: type,
                deliveryKey: contentMonitorDeliveryKey(type, deliveryDiscriminator, providerCredentialRef),
                providerMonitorId: first.monitorId,
                ...(providerCredentialRef ? { providerCredentialRef } : {}),
                checkId: first.checkId,
                events,
            };
        },
    };
    async function patchStatus(input: MonitorRefInput, status: 'active' | 'paused'): Promise<MonitorStatusResult> {
        const ref = parseRef(input);
        const credential = credentialPool.resolvePinned(ref.providerCredentialRef, 'monitor-update');
        const response = await credential.pinnedClient.request({
            operation: 'monitor-update',
            path: `/v2/monitor/${encodeURIComponent(ref.providerMonitorId)}`,
            method: 'PATCH',
            body: { status },
            schema: monitorStatusResponseSchema,
            timeoutMs: Math.min(ref.timeoutMs, cfg.timeoutMs),
        });
        return {
            providerMonitorId: response.data.id,
            status: toProviderStatus(response.data.status),
        };
    }
}
