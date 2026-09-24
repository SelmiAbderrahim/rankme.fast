/**
 * Public-page change monitoring — HTTP-side service.
 *
 * Load-bearing invariants for `createMonitor` (create-order — never create a
 * vendor monitor out of sequence):
 *   1. zod parse (controller layer)
 *   2. queue + provider present — else 503 (a monitor with no consumer/adapter
 *      would be a dead resource)
 *   3. Site.findOne({ _id, accountId }) — 404 not 403 (existence-leak rule)
 *   4. kill switches — `env.CONTENT_MONITORING_ENABLED` AND the
 *      `firecrawl_change_monitoring` operator kill switch — either off → 503
 *   5. SEC-URL — `assertPublicUrlSafe` on the target (normalizes + DNS/redirect
 *      pins) BEFORE any eligibility or vendor work
 *   6. target eligibility — owned target must be on the site origin; competitor
 *      target must match an ACTIVE confirmed competitor profile (read-only) —
 *      else 400/404. Only owned or confirmed-competitor public pages are eligible.
 *   7. idempotent short-circuit — a duplicate `(accountId, targetUrl)` returns
 *      the existing monitor BEFORE the active-count guard or any vendor call
 *   8. active-monitor limit — `< CONTENT_MONITOR_ACTIVE_LIMIT` (else 409)
 *   9. `provider.createMonitor` (weekly cadence, callback derived from SERVER_URL)
 *  10. envelope-encrypt the opaque vendor id + persist only the ciphertext +
 *      the non-secret `providerMonitorRef = sha256(id)` and credential-owner
 *      reference; the plaintext is never written to any store
 *
 * The five-active-monitor limit is a live-count product limit.
 *
 * SEC-REDACT: the plaintext vendor monitor id is never logged.
 */
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { and, desc, eq, lt } from 'drizzle-orm';
import { Types } from 'mongoose';
import { assertPublicUrlSafe, createPaginationCursorCodec, type PaginationCursorCodec, type PublicUrlResolver, } from '../../shared/security/index.js';
import { encryptSecret, decryptSecret } from '../../shared/crypto/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { env } from '../../config/env.js';
import { Site } from '../sites/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { competitorProfiles } from '../../db/schema/index.js';
import { contentMonitorEvents } from '../../db/schema/content-monitor-events.js';
import { isKillSwitchEnabled } from '../../shared/safety/feature-flags.js';
import type { ContentMonitorProvider } from '../../shared/providers/index.js';
import { ContentMonitor, MonitorEvidence, type ContentMonitorHydrated, type ContentMonitorStatus, type ContentMonitorTargetKind, } from './monitor.model.js';
import { assertContentMonitorTransition } from './monitoring.state.js';
import type { CreateMonitorBody } from './monitoring.schemas.js';
import { cancelAndScrubMonitorReceipts } from './monitoring.receipts.js';
import { CONTENT_MONITOR_ACTIVE_LIMIT } from '../../shared/safety/feature-limits.js';
/** Registrable-domain key — host lowercased, `www.` stripped (local helper). */
function registrableDomainKey(host: string): string {
    return host.toLowerCase().replace(/^www\./, '');
}
function sameRegistrableHost(a: string, b: string): boolean {
    return registrableDomainKey(a) === registrableDomainKey(b);
}
/** Non-secret webhook correlation key from the opaque vendor monitor id. */
export function providerMonitorRef(providerMonitorId: string): string {
    return createHash('sha256').update(providerMonitorId).digest('hex');
}
/** Public callback URL derived from SERVER_URL — never hardcoded. */
export function monitorCallbackUrl(): string {
    return new URL('/api/firecrawl/webhook', env.SERVER_URL).toString();
}
async function loadOwnedSite(accountId: string, siteId: string) {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    return site;
}
/** True for a Mongo duplicate-key error (unique-index race). Shared with the webhook. */
export function isDuplicateKeyError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null)
        return false;
    const anyErr = err as {
        code?: number;
        name?: string;
    };
    return anyErr.code === 11000 || anyErr.name === 'MongoServerError';
}
export interface MonitoringDeps {
    db: ApplicationDb;
    queue: Queue | null;
    provider: ContentMonitorProvider | null;
    resolver?: PublicUrlResolver;
}
export interface CreateMonitorInput {
    accountId: string;
    ownerUserId: string;
    siteId: string;
    body: CreateMonitorBody;
}
export interface CreatedMonitor {
    monitor: ReturnType<typeof toPublicMonitor>;
    duplicate: boolean;
}
/**
 * Resolve + validate the target per eligibility rules. Returns the normalized
 * URL string. Throws a localized 400/404 for an unsafe, off-origin, or
 * non-confirmed-competitor target.
 */
async function resolveEligibleTarget(deps: MonitoringDeps, args: {
    accountId: string;
    siteId: string;
    siteOrigin: string;
    targetUrl: string;
    targetKind: ContentMonitorTargetKind;
}): Promise<string> {
    let safe: URL;
    try {
        safe = await assertPublicUrlSafe(args.targetUrl, deps.resolver ? { resolver: deps.resolver } : {});
    }
    catch {
        throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_TARGET_URL_UNSAFE', messageKey: 'contentIntelligence.monitoring.errors.targetUrlUnsafe' });
    }
    if (args.targetKind === 'owned') {
        const originUrl = new URL(args.siteOrigin);
        if (!sameRegistrableHost(safe.hostname, originUrl.hostname)) {
            throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_TARGET_OFF_ORIGIN', messageKey: 'contentIntelligence.monitoring.errors.targetOffOrigin' });
        }
        return safe.toString();
    }
    // competitor — must be an ACTIVE confirmed competitor profile (read-only).
    const registrable = registrableDomainKey(safe.hostname);
    const rows = await deps.db
        .select({ id: competitorProfiles.id })
        .from(competitorProfiles)
        .where(and(eq(competitorProfiles.accountId, args.accountId), eq(competitorProfiles.siteId, args.siteId), eq(competitorProfiles.registrableDomain, registrable), eq(competitorProfiles.status, 'active')))
        .limit(1);
    if (rows.length === 0) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_COMPETITOR_NOT_CONFIRMED', messageKey: 'contentIntelligence.monitoring.errors.competitorNotConfirmed' });
    }
    return safe.toString();
}
/** CREATE — the load-bearing ordering above. */
export async function createMonitor(input: CreateMonitorInput, deps: MonitoringDeps): Promise<CreatedMonitor> {
    const queue = deps.queue;
    const provider = deps.provider;
    if (!queue || !provider) {
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_UNAVAILABLE_RUNTIME', messageKey: 'contentIntelligence.monitoring.errors.unavailableRuntime' });
    }
    // (3) Ownership.
    const site = await loadOwnedSite(input.accountId, input.siteId);
    assertSiteNotPaused(site);
    const siteId = String(site._id);
    // (4) Kill switches — env flag AND operator kill switch.
    if (!env.CONTENT_MONITORING_ENABLED) {
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_PRODUCT_UNAVAILABLE', messageKey: 'contentIntelligence.monitoring.errors.productUnavailable' });
    }
    if (!(await isKillSwitchEnabled(deps.db, 'firecrawl_change_monitoring'))) {
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_PRODUCT_UNAVAILABLE', messageKey: 'contentIntelligence.monitoring.errors.productUnavailable' });
    }
    // (5)+(6) SEC-URL + eligibility.
    const targetUrl = await resolveEligibleTarget(deps, {
        accountId: input.accountId,
        siteId,
        siteOrigin: site.url,
        targetUrl: input.body.targetUrl,
        targetKind: input.body.targetKind,
    });
    // (7) Idempotent short-circuit — a duplicate target returns the existing row.
    const existing = await ContentMonitor.findOne({ accountId: input.accountId, targetUrl });
    if (existing) {
        return { monitor: toPublicMonitor(existing.toObject() as never), duplicate: true };
    }
    // (8) Active-monitor product limit (5). Every existing monitor holds a vendor
    // slot regardless of status, so all statuses count toward the limit.
    const activeCount = await ContentMonitor.countDocuments({ accountId: input.accountId });
    if (activeCount >= CONTENT_MONITOR_ACTIVE_LIMIT) {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_ACTIVE_LIMIT_REACHED', messageKey: 'contentIntelligence.monitoring.errors.activeLimitReached' });
    }
    // (9) Vendor create — weekly cadence, callback derived from SERVER_URL.
    let created;
    try {
        created = await provider.createMonitor({
            targetUrl,
            cadence: 'weekly',
            callbackUrl: monitorCallbackUrl(),
            timeoutMs: env.FIRECRAWL_TIMEOUT_MS,
        });
    }
    catch {
        throw new HttpError(502, { code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_PROVIDER_FAILED', messageKey: 'contentIntelligence.monitoring.errors.providerFailed' });
    }
    // (10) Envelope-encrypt the opaque vendor id; persist ONLY the ciphertext +
    // the non-secret ref hash. The plaintext lives only in this local scope.
    const encrypted = encryptSecret(created.providerMonitorId);
    const ref = providerMonitorRef(created.providerMonitorId);
    let doc: ContentMonitorHydrated;
    try {
        doc = await ContentMonitor.create({
            accountId: input.accountId,
            ownerUserId: input.ownerUserId,
            siteId,
            targetUrl,
            targetKind: input.body.targetKind,
            cadence: 'weekly',
            locale: input.body.locale,
            status: 'active',
            providerMonitorIdEncrypted: encrypted,
            providerMonitorRef: ref,
            providerCredentialRef: created.providerCredentialRef,
            normalizedHash: null,
            createdBy: input.ownerUserId,
        });
    }
    catch (err) {
        if (isDuplicateKeyError(err)) {
            const race = await ContentMonitor.findOne({
                accountId: input.accountId,
                targetUrl,
            });
            if (race) {
                // A concurrent identical create won — best-effort delete the orphan
                // vendor monitor we just created so no dangling slot leaks.
                await provider
                    .deleteMonitor({
                    providerMonitorId: created.providerMonitorId,
                    providerCredentialRef: created.providerCredentialRef,
                    timeoutMs: env.FIRECRAWL_TIMEOUT_MS,
                })
                    .catch(() => undefined);
                return { monitor: toPublicMonitor(race.toObject() as never), duplicate: true };
            }
        }
        throw err;
    }
    return { monitor: toPublicMonitor(doc.toObject() as never), duplicate: false };
}
// ---------------------------------------------------------------------------
// Lifecycle mutations — pause / resume / delete.
// ---------------------------------------------------------------------------
async function loadOwnedMonitor(accountId: string, siteId: string, monitorId: string): Promise<ContentMonitorHydrated> {
    await loadOwnedSite(accountId, siteId);
    if (!Types.ObjectId.isValid(monitorId)) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.monitoring.errors.notFound' });
    }
    const doc = await ContentMonitor.findOne({
        _id: monitorId,
        accountId,
        siteId,
    });
    if (!doc)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.monitoring.errors.notFound' });
    return doc;
}
function decryptProviderMonitorId(doc: ContentMonitorHydrated): string {
    return decryptSecret(doc.providerMonitorIdEncrypted as never);
}
export interface MutateMonitorInput {
    accountId: string;
    siteId: string;
    monitorId: string;
}
export async function pauseMonitor(input: MutateMonitorInput, deps: MonitoringDeps): Promise<ReturnType<typeof toPublicMonitor>> {
    const provider = deps.provider;
    if (!provider) {
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_UNAVAILABLE_RUNTIME', messageKey: 'contentIntelligence.monitoring.errors.unavailableRuntime' });
    }
    const doc = await loadOwnedMonitor(input.accountId, input.siteId, input.monitorId);
    assertContentMonitorTransition(doc.status, 'paused');
    try {
        await provider.pauseMonitor({
            providerMonitorId: decryptProviderMonitorId(doc),
            ...(doc.providerCredentialRef
                ? { providerCredentialRef: doc.providerCredentialRef }
                : {}),
            timeoutMs: env.FIRECRAWL_TIMEOUT_MS,
        });
    }
    catch {
        throw new HttpError(502, { code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_PROVIDER_FAILED', messageKey: 'contentIntelligence.monitoring.errors.providerFailed' });
    }
    doc.status = 'paused';
    await doc.save();
    return toPublicMonitor(doc.toObject() as never);
}
export async function resumeMonitor(input: MutateMonitorInput, deps: MonitoringDeps): Promise<ReturnType<typeof toPublicMonitor>> {
    const provider = deps.provider;
    if (!provider) {
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_UNAVAILABLE_RUNTIME', messageKey: 'contentIntelligence.monitoring.errors.unavailableRuntime' });
    }
    const site = await loadOwnedSite(input.accountId, input.siteId);
    assertSiteNotPaused(site);
    const doc = await loadOwnedMonitor(input.accountId, input.siteId, input.monitorId);
    assertContentMonitorTransition(doc.status, 'active');
    try {
        await provider.resumeMonitor({
            providerMonitorId: decryptProviderMonitorId(doc),
            ...(doc.providerCredentialRef
                ? { providerCredentialRef: doc.providerCredentialRef }
                : {}),
            timeoutMs: env.FIRECRAWL_TIMEOUT_MS,
        });
    }
    catch {
        throw new HttpError(502, { code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_PROVIDER_FAILED', messageKey: 'contentIntelligence.monitoring.errors.providerFailed' });
    }
    doc.status = 'active';
    doc.error = null;
    await doc.save();
    return toPublicMonitor(doc.toObject() as never);
}
export async function deleteMonitor(input: MutateMonitorInput, deps: MonitoringDeps): Promise<void> {
    const provider = deps.provider;
    if (!provider) {
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_UNAVAILABLE_RUNTIME', messageKey: 'contentIntelligence.monitoring.errors.unavailableRuntime' });
    }
    const doc = await loadOwnedMonitor(input.accountId, input.siteId, input.monitorId);
    const deletionStartedAt = doc.deletionStartedAt ?? new Date();
    await ContentMonitor.updateOne({ _id: doc._id, deletionStartedAt: null }, { $set: { deletionStartedAt } }, { runValidators: true });
    try {
        await provider.deleteMonitor({
            providerMonitorId: decryptProviderMonitorId(doc),
            ...(doc.providerCredentialRef
                ? { providerCredentialRef: doc.providerCredentialRef }
                : {}),
            timeoutMs: env.FIRECRAWL_TIMEOUT_MS,
        });
    }
    catch {
        // A failed remote teardown is safe to retry and must not silently leave an
        // otherwise-live monitor unable to process accepted receipts.
        await ContentMonitor.updateOne({ _id: doc._id, deletionStartedAt }, { $set: { deletionStartedAt: null } }, { runValidators: true });
        throw new HttpError(502, { code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_PROVIDER_FAILED', messageKey: 'contentIntelligence.monitoring.errors.providerFailed' });
    }
    // Keep content-free receipt tombstones until their 30-day dedupe TTL. A
    // sending claim is recorded as unknown; all recipient/render/diff payload
    // is erased before the local capability disappears.
    await cancelAndScrubMonitorReceipts(String(doc._id), deletionStartedAt);
    await MonitorEvidence.deleteMany({ monitorId: doc._id });
    await ContentMonitor.deleteOne({ _id: doc._id, deletionStartedAt });
}
// ---------------------------------------------------------------------------
// Reads — list + get + change feed.
// ---------------------------------------------------------------------------
export function toPublicMonitor(doc: {
    _id: unknown;
    siteId: unknown;
    targetUrl: string;
    targetKind: ContentMonitorTargetKind;
    cadence: string;
    locale: string;
    status: ContentMonitorStatus;
    normalizedHash: string | null;
    lastCheckAt: Date | null;
    lastMaterialChangeAt: Date | null;
    lastReconcileAt: Date | null;
    error: {
        category: string;
        messageKey: string;
    } | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        monitorId: String(doc._id),
        siteId: String(doc.siteId),
        targetUrl: doc.targetUrl,
        targetKind: doc.targetKind,
        cadence: doc.cadence,
        locale: doc.locale,
        status: doc.status,
        // The last MATERIAL fingerprint is an internal hash — surfaced only as a
        // boolean "has a baseline" so no derived content leaks to the client.
        hasBaseline: doc.normalizedHash !== null,
        lastCheckAt: doc.lastCheckAt ? doc.lastCheckAt.toISOString() : null,
        lastMaterialChangeAt: doc.lastMaterialChangeAt
            ? doc.lastMaterialChangeAt.toISOString()
            : null,
        lastReconcileAt: doc.lastReconcileAt ? doc.lastReconcileAt.toISOString() : null,
        error: doc.error ? { category: doc.error.category, messageKey: doc.error.messageKey } : null,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
    };
}
export interface ListMonitorsInput {
    accountId: string;
    siteId: string;
    status: 'active' | 'paused' | 'error' | 'all';
}
export async function listMonitors(input: ListMonitorsInput): Promise<{
    monitors: ReturnType<typeof toPublicMonitor>[];
    activeLimit: number;
    usedSlots: number;
}> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const siteId = String(site._id);
    const query: Record<string, unknown> = { accountId: input.accountId, siteId };
    if (input.status !== 'all')
        query.status = input.status;
    const [rows, usedSlots] = await Promise.all([
        ContentMonitor.find(query).sort({ createdAt: -1 }),
        ContentMonitor.countDocuments({ accountId: input.accountId }),
    ]);
    return {
        monitors: rows.map((r) => toPublicMonitor(r.toObject() as never)),
        activeLimit: CONTENT_MONITOR_ACTIVE_LIMIT,
        usedSlots,
    };
}
interface ChangeFeedCursorPayload {
    ts: number;
    id: string;
}
let cursorCodec: PaginationCursorCodec | null = null;
function getCursorCodec(): PaginationCursorCodec {
    if (cursorCodec)
        return cursorCodec;
    cursorCodec = createPaginationCursorCodec(env.BETTER_AUTH_SECRET);
    return cursorCodec;
}
export interface GetMonitorInput {
    db: ApplicationDb;
    accountId: string;
    siteId: string;
    monitorId: string;
    limit: number;
    cursor?: string;
}
/**
 * One monitor + a page of its ordered change feed (from the Postgres event log
 * joined to the sanitized 7-day diff evidence). Feed entries are inert derived
 * facts + bounded diff text — never raw HTML.
 */
export async function getMonitor(input: GetMonitorInput): Promise<{
    monitor: ReturnType<typeof toPublicMonitor>;
    feed: {
        eventKey: string;
        kind: string;
        checkId: string | null;
        isoWeek: string | null;
        recordedAt: string;
        diffText: string | null;
    }[];
    nextCursor: string | null;
}> {
    const doc = await loadOwnedMonitor(input.accountId, input.siteId, input.monitorId);
    const monitorId = String(doc._id);
    const conditions = [eq(contentMonitorEvents.monitorId, monitorId)];
    if (input.cursor) {
        let decoded: ChangeFeedCursorPayload;
        try {
            decoded = JSON.parse(getCursorCodec().decode(input.cursor)) as ChangeFeedCursorPayload;
        }
        catch {
            throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_MONITORING_ERRORS_CURSOR_INVALID', messageKey: 'contentIntelligence.monitoring.errors.cursorInvalid' });
        }
        conditions.push(lt(contentMonitorEvents.recordedAt, new Date(decoded.ts)));
    }
    const rows = await input.db
        .select({
        id: contentMonitorEvents.id,
        eventKey: contentMonitorEvents.eventKey,
        kind: contentMonitorEvents.kind,
        checkId: contentMonitorEvents.checkId,
        isoWeek: contentMonitorEvents.isoWeek,
        recordedAt: contentMonitorEvents.recordedAt,
    })
        .from(contentMonitorEvents)
        .where(and(...conditions))
        .orderBy(desc(contentMonitorEvents.recordedAt), desc(contentMonitorEvents.id))
        .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    // Attach sanitized diff evidence (7-day TTL) by eventKey where present.
    const evidenceRows = await MonitorEvidence.find({
        monitorId: doc._id,
        eventKey: { $in: page.map((r) => r.eventKey) },
    });
    const diffByKey = new Map(evidenceRows.map((e) => [e.eventKey, e.diffText ?? null]));
    const feed = page.map((r) => ({
        eventKey: r.eventKey,
        kind: r.kind,
        checkId: r.checkId ?? null,
        isoWeek: r.isoWeek ?? null,
        recordedAt: r.recordedAt.toISOString(),
        diffText: diffByKey.get(r.eventKey) ?? null,
    }));
    let nextCursor: string | null = null;
    if (hasMore) {
        const last = page[page.length - 1]!;
        nextCursor = getCursorCodec().encode(JSON.stringify({
            ts: last.recordedAt.getTime(),
            id: last.id,
        } satisfies ChangeFeedCursorPayload));
    }
    return { monitor: toPublicMonitor(doc.toObject() as never), feed, nextCursor };
}
