/**
 * Deterministic fake content-monitor provider.
 *
 * The fully-tested CI path: no network, no vendor key. Every lifecycle call
 * returns a deterministic opaque id, and `normalizeWebhookDelivery` parses a
 * compact fake webhook shape into provider-neutral `PageChangeEvent`s. Failure
 * modes are injectable so the module + webhook tests can drive timeout / quota /
 * malformed / unavailable branches without a live vendor.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CONTENT_MONITOR_MAX_EVENTS_PER_DELIVERY, PAGE_CHANGE_STATUSES, contentMonitorDeliveryKey, contentMonitorEventKey, createMonitorInputSchema, monitorRefInputSchema, sanitizeDiffText, type ContentMonitorProvider, type CreateMonitorInput, type CreateMonitorResult, type MonitorRefInput, type MonitorStatusResult, type NormalizedWebhookDelivery, type PageChangeEvent, } from './content-monitor.js';
import { ProviderError, VendorAuthError, VendorMalformedError, VendorQuotaError, VendorTimeoutError, VendorUnavailableError, } from './errors.js';
export type FakeContentMonitorMode = 'timeout' | 'malformed' | 'quota' | 'unavailable';
export interface FakeContentMonitorOptions {
    /** Injected failure applied to EVERY lifecycle call. */
    mode?: FakeContentMonitorMode;
    clock?: () => Date;
    /** Deterministic id seed override (tests). */
    idPrefix?: string;
}
const ctx = { provider: 'fake', operation: 'content-monitor' };
const FAKE_CREDENTIAL_REF = 'fake-content-monitor-primary';
const fakeClock = (): Date => new Date('2026-01-01T00:00:00.000Z');
/** Compact fake webhook shape — a deliberately small stand-in for the vendor body. */
const fakePageSchema = z.object({
    url: z.string().min(1).max(2048),
    status: z.enum(PAGE_CHANGE_STATUSES),
    changed: z.boolean(),
    contentHash: z.string().max(128).nullable().optional(),
    diff: z.string().max(50000).nullable().optional(),
});
const fakeWebhookSchema = z.object({
    type: z.enum(['monitor.check.completed', 'monitor.page']),
    monitorId: z.string().min(1).max(512),
    providerCredentialRef: z.string().min(1).max(128).nullable().optional(),
    checkId: z.string().min(1).max(512),
    pages: z.array(fakePageSchema).max(CONTENT_MONITOR_MAX_EVENTS_PER_DELIVERY),
});
function throwInjected(mode: FakeContentMonitorMode | undefined): void {
    if (mode === 'timeout')
        throw new VendorTimeoutError('injected timeout', ctx);
    if (mode === 'malformed')
        throw new VendorMalformedError('injected malformed response', ctx);
    if (mode === 'quota')
        throw new VendorQuotaError('injected quota', { ...ctx, retryAfterSeconds: 60 });
    if (mode === 'unavailable')
        throw new VendorUnavailableError('injected unavailable', ctx);
}
function opaqueId(prefix: string, seed: string): string {
    return `${prefix}_${createHash('sha256').update(seed).digest('hex').slice(0, 24)}`;
}
export function createFakeContentMonitorProvider(opts: FakeContentMonitorOptions = {}): ContentMonitorProvider {
    const clock = opts.clock ?? fakeClock;
    const prefix = opts.idPrefix ?? 'fakemon';
    return {
        async createMonitor(input: CreateMonitorInput): Promise<CreateMonitorResult> {
            const parsed = createMonitorInputSchema.safeParse(input);
            if (!parsed.success) {
                throw new VendorMalformedError(`invalid create-monitor input: ${parsed.error.message}`, {
                    ...ctx,
                    cause: parsed.error,
                });
            }
            throwInjected(opts.mode);
            return {
                providerMonitorId: opaqueId(prefix, `${parsed.data.targetUrl}|${parsed.data.callbackUrl}`),
                providerCredentialRef: FAKE_CREDENTIAL_REF,
                status: 'active',
                cadence: parsed.data.cadence,
            };
        },
        async pauseMonitor(input: MonitorRefInput): Promise<MonitorStatusResult> {
            const ref = parseOwnedRef(input);
            throwInjected(opts.mode);
            return { providerMonitorId: ref.providerMonitorId, status: 'paused' };
        },
        async resumeMonitor(input: MonitorRefInput): Promise<MonitorStatusResult> {
            const ref = parseOwnedRef(input);
            throwInjected(opts.mode);
            return { providerMonitorId: ref.providerMonitorId, status: 'active' };
        },
        async deleteMonitor(input: MonitorRefInput): Promise<void> {
            parseOwnedRef(input);
            throwInjected(opts.mode);
        },
        async getMonitorStatus(input: MonitorRefInput): Promise<MonitorStatusResult> {
            const ref = parseOwnedRef(input);
            throwInjected(opts.mode);
            return { providerMonitorId: ref.providerMonitorId, status: 'active' };
        },
        normalizeWebhookDelivery(body: unknown): NormalizedWebhookDelivery {
            const parsed = fakeWebhookSchema.safeParse(body);
            if (!parsed.success) {
                throw new VendorMalformedError(`invalid monitor webhook body: ${parsed.error.message}`, {
                    ...ctx,
                    cause: parsed.error,
                });
            }
            const data = parsed.data;
            // Omitted metadata represents a newly-created fake monitor. Explicit
            // null remains available to exercise the legacy-primary webhook path.
            const providerCredentialRef = data.providerCredentialRef === undefined
                ? FAKE_CREDENTIAL_REF
                : (data.providerCredentialRef ?? undefined);
            const events: PageChangeEvent[] = data.pages.map((page) => ({
                eventKey: contentMonitorEventKey(data.monitorId, data.checkId, page.url),
                providerMonitorId: data.monitorId,
                checkId: data.checkId,
                targetUrl: page.url,
                status: page.status,
                changed: page.changed,
                contentHash: page.contentHash ?? null,
                diffText: sanitizeDiffText(page.diff ?? null),
                occurredAt: clock(),
            }));
            return {
                eventType: data.type,
                deliveryKey: contentMonitorDeliveryKey(data.type, data.checkId, providerCredentialRef),
                providerMonitorId: data.monitorId,
                ...(providerCredentialRef ? { providerCredentialRef } : {}),
                checkId: data.checkId,
                events,
            };
        },
    };
}
function parseRef(input: MonitorRefInput): MonitorRefInput {
    const parsed = monitorRefInputSchema.safeParse(input);
    if (!parsed.success) {
        throw new ProviderError(`invalid monitor ref: ${parsed.error.message}`, false, {
            ...ctx,
            cause: parsed.error,
        });
    }
    return parsed.data;
}
function parseOwnedRef(input: MonitorRefInput): MonitorRefInput {
    const ref = parseRef(input);
    if (ref.providerCredentialRef !== undefined &&
        ref.providerCredentialRef !== FAKE_CREDENTIAL_REF) {
        throw new VendorAuthError('Fake monitor credential is not configured.', ctx);
    }
    return ref;
}
