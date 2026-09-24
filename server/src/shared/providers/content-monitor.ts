/**
 * Content-monitor capability interface.
 *
 * A NARROW capability, separate from `ContentSourceProvider`: Agency public-page
 * change monitoring is a distinct lifecycle (create → weekly check → webhook) so
 * it gets its own interface (interface-segregation). Feature code never
 * sees a vendor shape — the adapter returns only these provider-neutral types and
 * OPAQUE monitor IDs.
 *
 * Provider selection is keyed off `PROVIDER_CONTENT_SOURCE` (the same vendor that
 * backs the content-source capability also backs monitoring); the fake is the
 * fully-tested CI path and the Firecrawl adapter sits behind recorded fixtures.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
/** Only weekly cadence ships in this release (spec "Locked product limits"). */
export const CONTENT_MONITOR_CADENCES = ['weekly'] as const;
export type ContentMonitorCadence = (typeof CONTENT_MONITOR_CADENCES)[number];
/** Provider-neutral monitor lifecycle status. */
export const CONTENT_MONITOR_PROVIDER_STATUSES = ['active', 'paused', 'error'] as const;
export type ContentMonitorProviderStatus = (typeof CONTENT_MONITOR_PROVIDER_STATUSES)[number];
/** Per-page change status carried on a normalized event. */
export const PAGE_CHANGE_STATUSES = ['new', 'same', 'changed', 'removed', 'error'] as const;
export type PageChangeStatus = (typeof PAGE_CHANGE_STATUSES)[number];
/** Hard ceiling on events per single webhook delivery (amplification guard). */
export const CONTENT_MONITOR_MAX_EVENTS_PER_DELIVERY = 20;
/** Max characters of any bounded, sanitized diff-evidence fragment (SEC-OUT). */
export const CONTENT_MONITOR_DIFF_MAX_CHARS = 500;
export const createMonitorInputSchema = z.object({
    /** Normalized, already-SSRF-checked public URL. */
    targetUrl: z.string().min(1).max(2048),
    cadence: z.enum(CONTENT_MONITOR_CADENCES),
    /** Public callback URL derived from SERVER_URL (never hardcoded). */
    callbackUrl: z.string().min(1).max(2048),
    /** Request deadline for the vendor create call. */
    timeoutMs: z.number().int().positive().max(120000),
    /** Opaque tags echoed back on webhook deliveries (e.g. our monitor ref). */
    metadata: z.record(z.string().max(64), z.string().max(256)).optional(),
});
export type CreateMonitorInput = z.infer<typeof createMonitorInputSchema>;
export const monitorRefInputSchema = z.object({
    providerMonitorId: z.string().min(1).max(512),
    /** Stable, non-secret reference to the credential that owns this resource. */
    providerCredentialRef: z.string().min(1).max(128).optional(),
    timeoutMs: z.number().int().positive().max(120000),
});
export type MonitorRefInput = z.infer<typeof monitorRefInputSchema>;
export interface CreateMonitorResult {
    /** OPAQUE vendor id — never parsed by feature code, envelope-encrypted at rest. */
    providerMonitorId: string;
    /** Stable, non-secret owner credential reference for pinned lifecycle calls. */
    providerCredentialRef: string;
    status: Exclude<ContentMonitorProviderStatus, 'error'>;
    cadence: ContentMonitorCadence;
}
export interface MonitorStatusResult {
    providerMonitorId: string;
    status: ContentMonitorProviderStatus;
}
/**
 * A single provider-neutral page-change event, normalized from a verified
 * webhook delivery. Carries derived facts + bounded sanitized diff evidence
 * ONLY — never raw HTML, never page prose.
 */
export interface PageChangeEvent {
    /** Stable per-event id used for downstream idempotency `(monitorId, eventKey)`. */
    eventKey: string;
    providerMonitorId: string;
    /** Vendor check id — the reserved-check correlation key. */
    checkId: string;
    /** The monitored URL as reported by the vendor (re-validated at the processor). */
    targetUrl: string;
    status: PageChangeStatus;
    /** True when the vendor flagged a content change on this page. */
    changed: boolean;
    /** Vendor content fingerprint for this snapshot (may be null). */
    contentHash: string | null;
    /** Bounded, sanitized diff text (≤ CONTENT_MONITOR_DIFF_MAX_CHARS). */
    diffText: string | null;
    occurredAt: Date;
}
/**
 * The result of normalizing ONE webhook delivery. `deliveryKey` is the
 * receipt/dedupe key (provider event id); `events` is the bounded batch.
 */
export interface NormalizedWebhookDelivery {
    eventType: string;
    /** Stable id for the WHOLE delivery — the `(provider, eventId)` dedupe key. */
    deliveryKey: string;
    /** OPAQUE vendor monitor id this delivery is about. */
    providerMonitorId: string;
    /** Signed owner credential reference. Absent only on legacy deliveries. */
    providerCredentialRef?: string;
    /** Vendor check id this delivery reports on (reserved-check correlation). */
    checkId: string;
    events: PageChangeEvent[];
}
export interface ContentMonitorProvider {
    createMonitor(input: CreateMonitorInput): Promise<CreateMonitorResult>;
    pauseMonitor(input: MonitorRefInput): Promise<MonitorStatusResult>;
    resumeMonitor(input: MonitorRefInput): Promise<MonitorStatusResult>;
    deleteMonitor(input: MonitorRefInput): Promise<void>;
    /** Safe status read for reconciliation drift detection. */
    getMonitorStatus(input: MonitorRefInput): Promise<MonitorStatusResult>;
    /**
     * Normalize an ALREADY-VERIFIED webhook body (HMAC checked by the app layer)
     * into provider-neutral events. Throws the shared vendor error taxonomy on a
     * malformed shape.
     */
    normalizeWebhookDelivery(body: unknown): NormalizedWebhookDelivery;
}
/**
 * Deterministic per-event idempotency key from provider-neutral fields. Shared
 * by the fake and the Firecrawl adapter so a replayed delivery collapses onto
 * the same `(monitorId, eventKey)` Postgres row.
 */
export function contentMonitorEventKey(providerMonitorId: string, checkId: string, targetUrl: string): string {
    return createHash('sha256')
        .update(JSON.stringify([providerMonitorId, checkId, targetUrl]))
        .digest('hex');
}
/**
 * Receipt dedupe key scoped to the owning credential without embedding the
 * derived credential reference in the persisted event id. Legacy deliveries
 * retain their historical `<type>:<discriminator>` shape.
 */
export function contentMonitorDeliveryKey(eventType: string, discriminator: string, providerCredentialRef?: string): string {
    if (providerCredentialRef === undefined)
        return `${eventType}:${discriminator}`;
    const scoped = createHash('sha256')
        .update(JSON.stringify([providerCredentialRef, discriminator]))
        .digest('hex');
    return `${eventType}:${scoped}`;
}
/**
 * Bound + sanitize a vendor-supplied diff fragment to inert, length-capped text.
 * Strips HTML markers and control characters so no raw markup or prose survives.
 */
export function sanitizeDiffText(value: string | null | undefined): string | null {
    if (value === null || value === undefined)
        return null;
    const stripped = value
        .replace(/<[^>]{0,512}>/g, ' ')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, CONTENT_MONITOR_DIFF_MAX_CHARS);
    return stripped.length > 0 ? stripped : null;
}
