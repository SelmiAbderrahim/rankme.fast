/**
 * Content inventory + cannibalization — HTTP-side service.
 *
 * Load-bearing invariants for `startInventoryRun` (start-order):
 *   1. zod parse (controller layer via `startInventoryBodySchema`)
 *   2. queue present — else 503 (a run record would never be consumed)
 *   3. Site.findOne({ _id, accountId }) — 404 not 403 (existence leak rule)
 *   4. `env.CONTENT_INVENTORY_ENABLED` false → 503 (kill switch)
 *   5. idempotent short-circuit — a duplicate run key returns the existing
 *      run BEFORE the active-run check
 *   6. single-active-run guard — a DIFFERENT non-terminal run → 409
 *   7. `assertPublicUrlSafe` on the verified origin AND every sitemap seed
 *      (SEC-URL) — runs before any record is written so an unsafe seed never
 *      reaches the crawler
 *   8. atomic idempotent `ContentInventoryRun.create` — unique index catches a
 *      duplicate start
 *   9. enqueue with the deterministic `content-inventory-<runId>` job id
 *  10. respond 202
 *
 * Compensation: enqueue failure marks the fresh run failed and surfaces a 503.
 * Read endpoints (get/list) never write, never enqueue, never crawl.
 */
import type { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { assertPublicUrlSafe, createPaginationCursorCodec, makeIdempotencyKey, type PaginationCursorCodec, } from '../../shared/security/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { env } from '../../config/env.js';
import { Site } from '../sites/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { enqueueContentInventoryJob } from '../../shared/queue/index.js';
import { ContentInventoryPage, ContentInventoryRun, CONTENT_INVENTORY_TERMINAL_STATUSES, type ContentInventoryRunDocument, type ContentInventoryStatus, } from './inventory.model.js';
import { isContentInventoryCancellable, assertContentInventoryTransition, } from './inventory.state.js';
import { recordContentInventoryEvent } from './inventory.events.js';
import { inventoryFindingsSchema, inventoryPageFactsSchema, THRESHOLDS_VERSION, type StartInventoryBody, } from './inventory.schemas.js';
import { toSupportedLocale, type SupportedLocale } from '../../shared/i18n/index.js';
import { localizeInventoryFindings, localizeInventoryWarning } from './inventory.copy.js';
/** Whole page BLOCKS (four owned pages each) covering `pages` requested pages. */
function blocksForPages(pages: number): number {
    return Math.ceil(pages / 4);
}
/**
 * Bind the run key to the full request shape so an identical resend is
 * idempotent and any change (page limit, paths, seeds, locale) is a new
 * run. `clientKey` forces a brand-new run when supplied.
 */
function makeInventoryRunKey(accountId: string, siteId: string, origin: string, body: StartInventoryBody): string {
    const composite = JSON.stringify({
        siteId,
        origin,
        pageLimit: body.pageLimit,
        allowedPaths: [...body.allowedPaths].sort(),
        excludedPaths: [...body.excludedPaths].sort(),
        sitemapSeeds: [...body.sitemapSeeds].sort(),
        locale: body.locale,
    });
    const scope = createHash('sha256').update(composite).digest('hex');
    const clientKeyResolved = body.clientKey
        ? createHash('sha256').update(body.clientKey).digest('hex')
        : scope;
    return makeIdempotencyKey(accountId, scope, clientKeyResolved);
}
function makeInputFingerprint(siteId: string, reservationKey: string): string {
    return createHash('sha256').update(`${siteId}|${reservationKey}`).digest('hex');
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
function isDuplicateKeyError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null)
        return false;
    const anyErr = err as {
        code?: number;
        name?: string;
    };
    return anyErr.code === 11000 || anyErr.name === 'MongoServerError';
}
export interface StartInventoryInput {
    accountId: string;
    ownerUserId: string;
    siteId: string;
    body: StartInventoryBody;
}
export interface StartInventoryDeps {
    db: ApplicationDb;
    queue: Queue | null;
}
export interface StartedInventory {
    runId: string;
    status: ContentInventoryStatus;
    reservedBlocks: number;
    duplicate: boolean;
}
/** START — the load-bearing ordering above. */
export async function startInventoryRun(input: StartInventoryInput, deps: StartInventoryDeps): Promise<StartedInventory> {
    const queue = deps.queue;
    if (!queue) {
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_INVENTORY_ERRORS_QUEUE_UNAVAILABLE', messageKey: 'contentIntelligence.inventory.errors.queueUnavailable' });
    }
    // (3) Ownership.
    const site = await loadOwnedSite(input.accountId, input.siteId);
    assertSiteNotPaused(site);
    const origin = site.url;
    // (4) Kill switch.
    if (!env.CONTENT_INVENTORY_ENABLED) {
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_INVENTORY_ERRORS_UNAVAILABLE', messageKey: 'contentIntelligence.inventory.errors.unavailable' });
    }
    const reservationKey = makeInventoryRunKey(input.accountId, input.siteId, origin, input.body);
    // (5) Idempotent short-circuit — same request returns the existing run.
    const existing = await ContentInventoryRun.findOne({
        accountId: input.accountId,
        siteId: input.siteId,
        idempotencyKey: reservationKey,
    });
    if (existing) {
        return {
            runId: String(existing._id),
            status: existing.status,
            reservedBlocks: blocksForPages(input.body.pageLimit),
            duplicate: true,
        };
    }
    // (6) Single-active-run guard — a DIFFERENT non-terminal run blocks a new one.
    const active = await ContentInventoryRun.findOne({
        accountId: input.accountId,
        siteId: input.siteId,
        status: { $nin: CONTENT_INVENTORY_TERMINAL_STATUSES as unknown as string[] },
    });
    if (active) {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_INVENTORY_ERRORS_RUN_IN_FLIGHT', messageKey: 'contentIntelligence.inventory.errors.runInFlight' });
    }
    // (7) SEC-URL — origin + every sitemap seed must resolve public + http(s).
    try {
        await assertPublicUrlSafe(origin);
    }
    catch {
        throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_INVENTORY_ERRORS_ORIGIN_UNSAFE', messageKey: 'contentIntelligence.inventory.errors.originUnsafe' });
    }
    for (const seed of input.body.sitemapSeeds) {
        try {
            await assertPublicUrlSafe(seed);
        }
        catch {
            throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_INVENTORY_ERRORS_SEED_UNSAFE', messageKey: 'contentIntelligence.inventory.errors.seedUnsafe' });
        }
    }
    const reservedBlocks = blocksForPages(input.body.pageLimit);
    // (8) Create the domain record.
    let doc;
    try {
        doc = await ContentInventoryRun.create({
            accountId: input.accountId,
            ownerUserId: input.ownerUserId,
            siteId: input.siteId,
            origin,
            locale: input.body.locale,
            status: 'queued',
            input: {
                pageLimit: input.body.pageLimit,
                allowedPaths: [...input.body.allowedPaths],
                excludedPaths: [...input.body.excludedPaths],
                sitemapSeeds: [...input.body.sitemapSeeds],
            },
            progress: {
                pagesRequested: input.body.pageLimit,
                pagesProcessed: 0,
                pagesFailed: 0,
                blocksReserved: reservedBlocks,
            },
            stages: [{ name: 'queued', startedAt: new Date(), completedAt: null, error: null }],
            warnings: [],
            error: null,
            inputFingerprint: makeInputFingerprint(input.siteId, reservationKey),
            idempotencyKey: reservationKey,
            thresholdsVersion: THRESHOLDS_VERSION,
            findings: null,
            costMicros: 0,
            aiCostMicros: 0,
            requestedAt: new Date(),
        });
    }
    catch (err) {
        if (isDuplicateKeyError(err)) {
            const race = await ContentInventoryRun.findOne({
                accountId: input.accountId,
                siteId: input.siteId,
                idempotencyKey: reservationKey,
            });
            if (race) {
                return {
                    runId: String(race._id),
                    status: race.status,
                    reservedBlocks: blocksForPages(input.body.pageLimit),
                    duplicate: true,
                };
            }
        }
        throw err;
    }
    // (9) Enqueue with the deterministic job id.
    try {
        await enqueueContentInventoryJob(queue, {
            accountId: input.accountId,
            siteId: input.siteId,
            runId: String(doc._id),
            reservationKey,
        });
    }
    catch (err) {
        doc.status = 'failed';
        doc.error = {
            category: 'unexpected',
            messageKey: 'contentIntelligence.inventory.errors.queueUnavailable',
            retryable: true,
            terminal: true,
        };
        doc.completedAt = new Date();
        await doc.save();
        await recordContentInventoryEvent(deps.db, {
            accountId: input.accountId,
            siteId: input.siteId,
            runId: String(doc._id),
            reservationKey,
            kind: 'failed',
            errorCategory: 'unexpected',
        });
        throw new HttpError(503, { code: 'CONTENT_INTELLIGENCE_INVENTORY_ERRORS_QUEUE_UNAVAILABLE', messageKey: 'contentIntelligence.inventory.errors.queueUnavailable' }, undefined, { cause: err });
    }
    return {
        runId: String(doc._id),
        status: doc.status,
        reservedBlocks,
        duplicate: false,
    };
}
// ---------------------------------------------------------------------------
// Serialization + reads
// ---------------------------------------------------------------------------
export function toPublicInventoryRun(doc: ContentInventoryRunDocument & {
    _id: unknown;
}, locale: SupportedLocale = toSupportedLocale(doc.locale)) {
    const findings = inventoryFindingsSchema.safeParse(doc.findings);
    return {
        runId: String(doc._id),
        siteId: String(doc.siteId),
        origin: doc.origin,
        locale: doc.locale,
        status: doc.status,
        input: {
            pageLimit: doc.input?.pageLimit ?? 0,
            allowedPaths: doc.input?.allowedPaths ?? [],
            excludedPaths: doc.input?.excludedPaths ?? [],
            sitemapSeeds: doc.input?.sitemapSeeds ?? [],
        },
        progress: {
            pagesRequested: doc.progress?.pagesRequested ?? 0,
            pagesProcessed: doc.progress?.pagesProcessed ?? 0,
            pagesFailed: doc.progress?.pagesFailed ?? 0,
            blocksReserved: doc.progress?.blocksReserved ?? 0,
        },
        warnings: (doc.warnings ?? []).map((warning) => localizeInventoryWarning(locale, warning)),
        error: doc.error ?? null,
        thresholdsVersion: doc.thresholdsVersion ?? null,
        findings: findings.success ? localizeInventoryFindings(locale, findings.data) : null,
        costMicros: Number(doc.costMicros ?? 0),
        aiCostMicros: Number(doc.aiCostMicros ?? 0),
        requestedAt: (doc.requestedAt as Date | null)?.toISOString?.() ?? null,
        startedAt: (doc.startedAt as Date | null)?.toISOString?.() ?? null,
        completedAt: (doc.completedAt as Date | null)?.toISOString?.() ?? null,
        cancelledAt: (doc.cancelledAt as Date | null)?.toISOString?.() ?? null,
    };
}
export interface ListInventoryInput {
    accountId: string;
    siteId: string;
    limit: number;
    cursor?: string;
    locale?: SupportedLocale;
}
export interface ListInventoryResult {
    items: ReturnType<typeof toPublicInventoryRun>[];
    nextCursor: string | null;
}
interface CursorPayload {
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
export async function listInventoryRuns(input: ListInventoryInput): Promise<ListInventoryResult> {
    const site = await loadOwnedSite(input.accountId, input.siteId);
    const query: Record<string, unknown> = {
        accountId: input.accountId,
        siteId: String(site._id),
    };
    if (input.cursor) {
        let decoded: CursorPayload;
        try {
            decoded = JSON.parse(getCursorCodec().decode(input.cursor)) as CursorPayload;
        }
        catch {
            throw HttpError.badRequest({ code: 'CONTENT_INTELLIGENCE_ERRORS_CURSOR_INVALID', messageKey: 'contentIntelligence.errors.cursorInvalid' });
        }
        query.requestedAt = { $lt: new Date(decoded.ts) };
    }
    const rows = await ContentInventoryRun.find(query)
        .sort({ requestedAt: -1, _id: -1 })
        .limit(input.limit + 1);
    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const items = page.map((r) => {
        const plain = r.toObject() as ContentInventoryRunDocument & {
            _id: unknown;
        };
        return toPublicInventoryRun(plain, input.locale ?? toSupportedLocale(plain.locale));
    });
    let nextCursor: string | null = null;
    if (hasMore) {
        const last = page[page.length - 1]!;
        const ts = (last.requestedAt as Date).getTime();
        nextCursor = getCursorCodec().encode(JSON.stringify({ ts, id: String(last._id) } satisfies CursorPayload));
    }
    return { items, nextCursor };
}
export async function getInventoryRun(input: {
    accountId: string;
    runId: string;
    locale?: SupportedLocale;
}) {
    if (!Types.ObjectId.isValid(input.runId)) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_INVENTORY_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.inventory.errors.notFound' });
    }
    const doc = await ContentInventoryRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
    });
    if (!doc)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_INVENTORY_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.inventory.errors.notFound' });
    const pageRows = await ContentInventoryPage.find({
        runId: doc._id,
        accountId: input.accountId,
    }).sort({ url: 1 });
    const pages = pageRows.flatMap((row) => {
        const parsed = inventoryPageFactsSchema.safeParse(row.facts);
        return parsed.success ? [{ url: row.url, facts: parsed.data }] : [];
    });
    return {
        ...toPublicInventoryRun(doc.toObject() as never, input.locale ?? toSupportedLocale(doc.locale)),
        pages,
    };
}
export interface CancelInventoryInput {
    accountId: string;
    runId: string;
}
/** Cancel a cancellable run. Terminal runs return 409. */
export async function cancelInventoryRun(input: CancelInventoryInput): Promise<void> {
    if (!Types.ObjectId.isValid(input.runId)) {
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_INVENTORY_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.inventory.errors.notFound' });
    }
    const doc = await ContentInventoryRun.findOne({
        _id: input.runId,
        accountId: input.accountId,
    });
    if (!doc)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_INVENTORY_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.inventory.errors.notFound' });
    if (!isContentInventoryCancellable(doc.status)) {
        throw HttpError.conflict({ code: 'CONTENT_INTELLIGENCE_INVENTORY_ERRORS_NOT_CANCELLABLE', messageKey: 'contentIntelligence.inventory.errors.notCancellable' });
    }
    assertContentInventoryTransition(doc.status, 'cancelled');
    doc.status = 'cancelled';
    doc.cancelledAt = new Date();
    doc.completedAt = new Date();
    doc.error = {
        category: 'cancelled',
        messageKey: 'contentIntelligence.inventory.errors.cancelledByUser',
        retryable: false,
        terminal: true,
    };
    await doc.save();
}
