/**
 * Firecrawl monitor webhook — raw-body HTTP handler.
 *
 * The ONLY unauthenticated inbound surface in the batch. Mounted BEFORE
 * `express.json()` with a raw-body parser (wildcard content-type, 1mb limit) and
 * fronted by the per-IP `firecrawl_webhook` rate-limit bucket, so a flood or
 * oversized body is rejected BEFORE any HMAC work. Order inside the handler:
 *
 *   1. explicit byte cap (defense-in-depth alongside express.raw's limit)
 *   2. enforce env kill switch — 503 while monitoring is disabled
 *   3. verify HMAC over the EXACT raw bytes and bind it to one credential
 *   4. resolve provider/queue/db + operator kill switch — 503 if unavailable/off
 *   4. JSON-parse AFTER verification — 400 on parse failure
 *   5. normalize via the adapter (provider-neutral events, bounded ≤20) — 400
 *   6. correlate to a monitor by `(providerCredentialRef,
 *      providerMonitorRef = sha256(providerMonitorId))`. Metadata-free legacy
 *      deliveries may match only legacy rows — unknown monitor ⇒ 200 ack
 *   7. atomic `(provider, eventId)` receipt insert — duplicate ⇒ 200 no-op
 *   8. enqueue ONCE (deterministic job id); an enqueue failure keeps the receipt
 *      and reconciliation re-enqueues it (still 200 — the delivery is stored)
 *   9. fast 200 ack
 *
 * SEC-REDACT: the raw body, the signature header, the secret, and any diff/prose
 * NEVER reach the logger — only ids, statuses, and counts.
 */
import type { Request, Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { asyncHandler } from '../../shared/utils/async-handler.js';
import { logger as baseLogger } from '../../config/logger.js';
import { env } from '../../config/env.js';
import { enqueueContentMonitorJob } from '../../shared/queue/index.js';
import { MonitorWebhookVerifyError, type MonitorWebhookSecretBinding, verifyMonitorWebhookSignature, } from './webhook.verify.js';
import { getContentMonitorDb, getContentMonitorProvider, getContentMonitorQueue, } from './monitoring.holders.js';
import { ContentMonitor, MonitorWebhookReceipt, MONITOR_WEBHOOK_RECEIPT_TTL_DAYS, } from './monitor.model.js';
import { isDuplicateKeyError, providerMonitorRef } from './monitoring.service.js';
import { filterPausedSiteIds } from '../sites/sites.guard.js';
import { acquireSiteWorkLease, releaseSiteWorkLease, runWithSiteWorkLeaseContext, } from '../sites/site-lifecycle.js';
import { firecrawlCredentialRef } from '../../shared/providers/index.js';
import { isKillSwitchEnabled } from '../../shared/safety/feature-flags.js';
const WEBHOOK_PROVIDER = 'firecrawl';
/** Explicit raw-body ceiling (matches the express.raw `1mb` limit). */
export const MONITOR_WEBHOOK_MAX_BODY_BYTES = 1048576;
/** Resolve explicit operator bindings to one-way credential-affinity refs. */
function activeBindings(): MonitorWebhookSecretBinding[] {
    const apiKeys = [env.FIRECRAWL_API_KEY, ...env.FIRECRAWL_FALLBACK_API_KEYS];
    if (!apiKeys[0])
        return [];
    const expectedCredentials = new Set([
        'primary',
        ...env.FIRECRAWL_FALLBACK_API_KEYS.map((_, index) => `fallback:${index}`),
    ]);
    if (env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS.length !== expectedCredentials.size)
        return [];
    const seenCredentials = new Set<string>();
    const seenSecrets = new Set<string>();
    const resolved: MonitorWebhookSecretBinding[] = [];
    for (const binding of env.FIRECRAWL_WEBHOOK_SECRET_BINDINGS) {
        if (!expectedCredentials.has(binding.credential) ||
            seenCredentials.has(binding.credential)) {
            return [];
        }
        seenCredentials.add(binding.credential);
        const keyIndex = binding.credential === 'primary'
            ? 0
            : Number(binding.credential.slice('fallback:'.length)) + 1;
        const apiKey = apiKeys[keyIndex];
        if (!apiKey)
            return [];
        const credentialRef = firecrawlCredentialRef(apiKey);
        for (const secret of binding.secrets) {
            if (secret.trim() === '' || seenSecrets.has(secret))
                return [];
            seenSecrets.add(secret);
            resolved.push({ secret, credentialRef });
        }
    }
    // Cardinality, membership, and duplicate checks above prove every expected
    // credential was seen exactly once.
    return resolved;
}
export const monitorWebhookHandler = asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    // (1) Byte cap BEFORE any HMAC math.
    if (rawBody.length > MONITOR_WEBHOOK_MAX_BODY_BYTES) {
        res.status(413).json({ received: false });
        return;
    }
    // (2) Verify the signature and retain the one authorized credential owner.
    // The root rollout flag stops new monitors and reconciliation-produced
    // checks, but accepted provider work may still deliver a terminal webhook.
    // Keep this authenticated completion boundary open so a normal rollback
    // cannot strand an in-flight run. The persisted provider kill switch below
    // remains the explicit emergency-abort control.
    let verifiedCredentialRef: string;
    try {
        verifiedCredentialRef = verifyMonitorWebhookSignature({
            rawBody,
            headers: req.headers,
            bindings: activeBindings(),
        });
    }
    catch (err) {
        const status = err instanceof MonitorWebhookVerifyError ? err.status : 401;
        // No detail leakage — the status alone tells the caller nothing about why.
        res.status(status).json({ received: false });
        return;
    }
    // (3) Runtime + persisted emergency kill switch must be ready before acceptance.
    const provider = getContentMonitorProvider();
    const queue = getContentMonitorQueue();
    const db = getContentMonitorDb();
    if (!provider || !queue || !db) {
        // 503 so the vendor retries once the runtime is back — no orphan receipt.
        res.status(503).json({ received: false });
        return;
    }
    try {
        if (!(await isKillSwitchEnabled(db, 'firecrawl_change_monitoring'))) {
            res.status(503).json({ received: false });
            return;
        }
    }
    catch {
        res.status(503).json({ received: false });
        return;
    }
    // (4) JSON-parse AFTER verification.
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawBody.toString('utf8'));
    }
    catch {
        res.status(400).json({ received: false });
        return;
    }
    // (5) Normalize via the adapter — provider-neutral, bounded batch.
    let delivery;
    try {
        delivery = provider.normalizeWebhookDelivery(parsed);
    }
    catch {
        res.status(400).json({ received: false });
        return;
    }
    // Metadata is signed as part of the raw payload, but it is still
    // caller-supplied. It must agree with the credential authorized by the
    // matching HMAC secret; metadata-free legacy deliveries fail closed.
    if (delivery.providerCredentialRef !== verifiedCredentialRef) {
        res.status(401).json({ received: false });
        return;
    }
    // (6) Correlate by the credential owner + non-secret monitor ref hash.
    // `{ providerCredentialRef: null }` intentionally matches both null and
    // absent fields, but never a newly bound resource.
    const ref = providerMonitorRef(delivery.providerMonitorId);
    const monitor = await ContentMonitor.findOne({
        providerMonitorRef: ref,
        providerCredentialRef: verifiedCredentialRef,
        deletionStartedAt: null,
    });
    if (!monitor) {
        // Ack — a delivery for a monitor we no longer track (deleted). Nothing to
        // process; do not leak existence.
        res.status(200).json({ received: true });
        return;
    }
    // A verified delivery is still an out-of-band writer. Join the same
    // atomic Site lease protocol as API requests/workers before creating the
    // receipt. If deletion already claimed the site, acknowledge without
    // persistence; if this lease wins, deletion waits until receipt+enqueue
    // (or terminal skip) finishes and its later cascade observes the result.
    const siteLease = await acquireSiteWorkLease({ accountId: String(monitor.accountId), siteId: String(monitor.siteId) }, `firecrawl-webhook:${delivery.deliveryKey}:${randomUUID()}`);
    if (!siteLease) {
        res.status(200).json({ received: true });
        return;
    }
    try {
        await runWithSiteWorkLeaseContext(siteLease, async () => {
            const now = new Date();
            const payloadHash = createHash('sha256').update(rawBody).digest('hex');
            // (7) Atomic dedupe insert on (provider, eventId).
            let receiptId: string;
            try {
                const receipt = await MonitorWebhookReceipt.create({
                    provider: WEBHOOK_PROVIDER,
                    eventId: delivery.deliveryKey,
                    monitorId: monitor._id,
                    accountId: monitor.accountId,
                    siteId: monitor.siteId,
                    providerMonitorRef: ref,
                    checkId: delivery.checkId,
                    eventType: delivery.eventType,
                    payloadHash,
                    events: delivery.events.map((event) => ({
                        eventKey: event.eventKey,
                        checkId: event.checkId,
                        targetUrl: event.targetUrl,
                        status: event.status,
                        changed: event.changed,
                        contentHash: event.contentHash,
                        diffText: event.diffText,
                        occurredAt: event.occurredAt,
                    })),
                    status: 'received',
                    receivedAt: now,
                    expiryAt: new Date(now.getTime() + MONITOR_WEBHOOK_RECEIPT_TTL_DAYS * 24 * 60 * 60 * 1000),
                });
                receiptId = String(receipt._id);
            }
            catch (err) {
                if (isDuplicateKeyError(err)) {
                    // A duplicate delivery (replay / concurrent double-send) — no second
                    // receipt, no second enqueue. Ack silently.
                    baseLogger.info({ provider: WEBHOOK_PROVIDER, monitorId: String(monitor._id) }, 'content-monitor webhook: duplicate delivery deduped');
                    res.status(200).json({ received: true });
                    return;
                }
                throw err;
            }
            // (7b) Paused-site guard: persist the receipt in a TERMINAL state and ack
            // without enqueueing — leaving it `received` would make the stuck-receipt
            // sweep re-enqueue it forever for a site that must not run anything.
            const pausedSites = await filterPausedSiteIds([String(monitor.siteId)]);
            if (pausedSites.size > 0) {
                await MonitorWebhookReceipt.updateOne({ _id: receiptId }, { $set: { status: 'skipped', processedAt: now } });
                baseLogger.info({ provider: WEBHOOK_PROVIDER, monitorId: String(monitor._id), receiptId }, 'content-monitor webhook: site paused; receipt terminal-skipped without enqueue');
                res.status(200).json({ received: true });
                return;
            }
            // (8) Enqueue ONCE. A failure keeps the receipt; reconciliation re-enqueues.
            try {
                await enqueueContentMonitorJob(queue, {
                    accountId: String(monitor.accountId),
                    siteId: String(monitor.siteId),
                    monitorId: String(monitor._id),
                    receiptId,
                });
            }
            catch {
                baseLogger.warn({ provider: WEBHOOK_PROVIDER, monitorId: String(monitor._id), receiptId }, 'content-monitor webhook: enqueue failed; receipt persisted for reconciliation');
                res.status(200).json({ received: true });
                return;
            }
            // (9) Fast ack.
            res.status(200).json({ received: true });
        });
    }
    finally {
        await releaseSiteWorkLease(siteLease);
    }
});
/**
 * Operator helper: is a monitor webhook secret configured? Reports
 * configured/not-configured ONLY — never the secret value.
 */
export function isMonitorWebhookConfigured(): boolean {
    return activeBindings().length > 0;
}
