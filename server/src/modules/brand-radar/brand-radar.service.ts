/**
 * Brand Radar service.
 *
 * Order of operations on the scan path is load-bearing:
 *
 *   parse (controller) → own site → kill switch → create scan doc → enqueue
 *
 * Site ownership runs FIRST and is mandatory: a caller who does not own the
 * site must not learn whether the feature flag is on.
 */
import { createHash } from 'node:crypto';
import type { Queue } from 'bullmq';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { SpendPreview } from '../../shared/safety/operation-preview.js';
import { enqueueBrandRadarScanJob } from '../../shared/queue/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { isSupportedLocale, type SupportedLocale, } from '../../shared/i18n/locales.js';
import { DATAFORSEO_LOCATION_ISO } from '../../shared/observations/observations.js';
import { Site } from '../sites/index.js';
import { assertSiteNotPaused } from '../sites/sites.guard.js';
import { BrandRadarScan, BRAND_RADAR_SETTLED_STATUSES, type BrandRadarScanHydrated, } from './brand-radar.model.js';
import { readMentionRowsPage, type BrandRadarPolarity, type StoredMentionRow, } from './brand-radar.rows.model.js';
import type { CreateScanInput, ListMentionsQuery, ListScansQuery, } from './brand-radar.schemas.js';
export const BRAND_RADAR_NOT_FOUND_KEY = 'brandRadar.errors.notFound';
export const BRAND_RADAR_UNAVAILABLE_KEY = 'brandRadar.errors.productUnavailable';
export interface BrandRadarServiceDeps {
    queue: Queue | null;
    now?: () => Date;
}
/**
 * Trend series key. NFKC → collapse internal whitespace → trim → lowercase,
 * then sha256. Two spellings that differ only by casing, Unicode
 * normalization form, or run-length of whitespace share one series.
 */
export function normalizeBrandQuery(raw: string): string {
    return raw.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}
export function brandQueryHash(raw: string, language: string | null = null, countryCode: string | null = null): string {
    const series = JSON.stringify([
        normalizeBrandQuery(raw),
        language?.trim().toLowerCase() ?? '',
        countryCode?.trim().toUpperCase() ?? '',
    ]);
    return createHash('sha256').update(series, 'utf8').digest('hex');
}
/** Kill switch. Stored-result reads never call this — only mutation paths do. */
export function assertBrandRadarEnabled(): void {
    if (!env.BRAND_RADAR_ENABLED) {
        throw new HttpError(503, { code: 'BRAND_RADAR_UNAVAILABLE', messageKey: BRAND_RADAR_UNAVAILABLE_KEY });
    }
}
/**
 * `assertNotPaused` is explicit rather than optional: the two paid paths pass
 * `true`, the list read passes `false`, and there is no third caller to hide a
 * default from.
 */
async function loadOwnedSite(accountId: string, siteId: string, assertNotPaused: boolean): Promise<string> {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'BRAND_RADAR_NOT_FOUND', messageKey: BRAND_RADAR_NOT_FOUND_KEY });
    }
    const site = await Site.findOne({
        _id: siteId,
        accountId,
        deletionStartedAt: null,
    }).select({ _id: 1, paused: 1 });
    if (!site)
        throw HttpError.notFound({ code: 'BRAND_RADAR_NOT_FOUND', messageKey: BRAND_RADAR_NOT_FOUND_KEY });
    if (assertNotPaused) {
        // The paid scan path only — a paused site must not be linked to new
        // vendor spend. Reads of a paused site's stored scans stay available.
        assertSiteNotPaused(site);
    }
    return String(site._id);
}
export function serializeScan(scan: BrandRadarScanHydrated) {
    return {
        id: String(scan._id),
        siteId: String(scan.siteId),
        brandQuery: scan.brandQuery,
        language: scan.language ?? null,
        outputLocale: resolveBrandRadarOutputLocale(scan),
        countryCode: scan.countryCode ?? null,
        locationCode: scan.locationCode ?? null,
        status: scan.status,
        digestState: scan.digestState,
        queryHash: scan.queryHash,
        priorScanId: scan.priorScanId ? String(scan.priorScanId) : null,
        retainedRowCount: scan.retainedRowCount,
        createdAt: scan.createdAt.toISOString(),
        updatedAt: scan.updatedAt.toISOString(),
        terminalAt: scan.terminalAt ? scan.terminalAt.toISOString() : null,
    };
}
/** Pre-change completed digest generation was hardcoded to English. */
export function resolveBrandRadarOutputLocale(scan: {
    outputLocale?: unknown;
    status: string;
    digestState: string;
}): SupportedLocale | null {
    if (isSupportedLocale(scan.outputLocale))
        return scan.outputLocale;
    if ((BRAND_RADAR_SETTLED_STATUSES as readonly string[]).includes(scan.status) &&
        scan.digestState === 'digest_present') {
        return 'en';
    }
    return null;
}
/**
 * Detail DTO for `GET /api/brand-radar/scans/:id`.
 *
 * The list DTO stays deliberately narrow; only the detail read carries the
 * deterministic aggregates and the digest. Every field here is a bounded,
 * normalized value already persisted at settlement — no vendor envelope, no
 * raw mention URL, no re-derived number.
 */
export function serializeScanDetail(scan: BrandRadarScanHydrated) {
    return {
        ...serializeScan(scan),
        mentionCount: scan.mentionCount,
        sentimentDistribution: {
            positive: scan.sentimentDistribution.positive,
            neutral: scan.sentimentDistribution.neutral,
            negative: scan.sentimentDistribution.negative,
            unknown: scan.sentimentDistribution.unknown,
        },
        topDomains: scan.topDomains.map((entry) => ({
            domain: entry.domain,
            count: entry.count,
        })),
        // `null` iff there is no prior scan for this query — never a fabricated 0.
        trend: scan.trendVsPrevious === null || scan.trendVsPrevious === undefined
            ? null
            : {
                delta: scan.trendVsPrevious,
                direction: scan.trendVsPrevious > 0
                    ? ('up' as const)
                    : scan.trendVsPrevious < 0
                        ? ('down' as const)
                        : ('flat' as const),
            },
        digestSentences: scan.digestSentences.map((sentence) => ({
            // SEC-OUT: generated text — the client renders it as a text node.
            text: sentence.text,
            citedRowIds: [...sentence.citedRowIds],
        })),
        // Which stage halted and why (the halt contract).
        // Bounded taxonomy, never raw vendor error text. Null on clean terminals
        // and on legacy scans that predate the field.
        halt: scan.halt
            ? { stage: scan.halt.stage, reason: scan.halt.reason }
            : null,
    };
}
/**
 * Most recent settled scan for the same account + SAME SITE + same normalized
 * query. The site is part of the key: two sites of
 * one account tracking the same brand are separate series and must not share
 * a baseline. Absent on the first scan of a series —
 * `computeTrendVsPrevious` surfaces `null` rather than fabricating a
 * zero delta.
 */
export async function findPriorScanId(accountId: string, siteId: string, queryHash: string): Promise<Types.ObjectId | null> {
    const prior = await BrandRadarScan.findOne({
        accountId,
        siteId,
        queryHash,
        status: { $in: [...BRAND_RADAR_SETTLED_STATUSES] },
    })
        .sort({ createdAt: -1, _id: -1 })
        .select({ _id: 1 });
    return prior ? (prior._id as Types.ObjectId) : null;
}
export async function createScan(accountId: string, siteIdInput: string, input: CreateScanInput & {
    outputLocale: SupportedLocale;
}, deps: BrandRadarServiceDeps) {
    const siteId = await loadOwnedSite(accountId, siteIdInput, true);
    assertBrandRadarEnabled();
    if (!deps.queue)
        throw new HttpError(503, { code: 'BRAND_RADAR_UNAVAILABLE', messageKey: BRAND_RADAR_UNAVAILABLE_KEY });
    const now = (deps.now ?? (() => new Date()))();
    const legacyCountry = input.locationCode === undefined
        ? null
        : DATAFORSEO_LOCATION_ISO[input.locationCode] ?? null;
    const countryCode = input.countryCode ?? legacyCountry;
    const queryHash = brandQueryHash(input.brandQuery, input.language ?? null, countryCode);
    const scan = await BrandRadarScan.create({
        accountId,
        siteId,
        brandQuery: input.brandQuery,
        language: input.language ?? null,
        outputLocale: input.outputLocale,
        countryCode,
        locationCode: input.locationCode ?? null,
        status: 'queued',
        digestState: 'pending',
        queryHash,
        priorScanId: await findPriorScanId(accountId, siteId, queryHash),
        retainedRowCount: 0,
        retainedRowIds: [],
        mentionSummaryId: null,
        terminalAt: null,
    });
    try {
        await enqueueBrandRadarScanJob(deps.queue, {
            accountId,
            siteId,
            scanId: String(scan._id),
            outputLocale: input.outputLocale,
        });
    }
    catch (error) {
        await BrandRadarScan.updateOne({ _id: scan._id, accountId }, { $set: { status: 'failed', terminalAt: now } });
        throw new HttpError(503, { code: 'BRAND_RADAR_UNAVAILABLE', messageKey: BRAND_RADAR_UNAVAILABLE_KEY }, undefined, {
            cause: error,
        });
    }
    return {
        scanId: String(scan._id),
        status: 'queued' as const,
        queryHash,
        priorScanId: scan.priorScanId ? String(scan.priorScanId) : null,
        outputLocale: input.outputLocale,
    };
}
interface ScanCursor {
    createdAt: string;
    id: string;
}
export function encodeBrandRadarCursor(cursor: ScanCursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
export function decodeBrandRadarCursor(cursor: string): ScanCursor {
    let parsed: unknown;
    try {
        parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    }
    catch {
        throw HttpError.badRequest({ code: 'BRAND_RADAR_ERRORS_INVALID_CURSOR', messageKey: 'brandRadar.errors.invalidCursor' });
    }
    const candidate = parsed as Partial<ScanCursor> | null;
    if (!candidate ||
        typeof candidate.createdAt !== 'string' ||
        typeof candidate.id !== 'string' ||
        !Types.ObjectId.isValid(candidate.id) ||
        Number.isNaN(Date.parse(candidate.createdAt))) {
        throw HttpError.badRequest({ code: 'BRAND_RADAR_ERRORS_INVALID_CURSOR', messageKey: 'brandRadar.errors.invalidCursor' });
    }
    return { createdAt: candidate.createdAt, id: candidate.id };
}
export async function listScans(accountId: string, siteIdInput: string, query: ListScansQuery): Promise<{
    items: ReturnType<typeof serializeScan>[];
    nextCursor: string | null;
}> {
    // Ownership (and the Site deletion boundary) is settled here, so the list
    // filter is a plain `{ accountId, siteId }` — no live-site fan-out and no
    // `null` member, both of which existed only to carry legacy account-scoped
    // scans that the rankme-site-scoping backfill retired.
    const siteId = await loadOwnedSite(accountId, siteIdInput, false);
    const filter: Record<string, unknown> = { accountId, siteId };
    if (query.cursor) {
        const cursor = decodeBrandRadarCursor(query.cursor);
        const createdAt = new Date(cursor.createdAt);
        filter.$or = [
            { createdAt: { $lt: createdAt } },
            { createdAt, _id: { $lt: new Types.ObjectId(cursor.id) } },
        ];
    }
    const docs = await BrandRadarScan.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(query.limit + 1);
    const hasMore = docs.length > query.limit;
    const page = hasMore ? docs.slice(0, query.limit) : docs;
    const last = page.at(-1);
    return {
        items: page.map(serializeScan),
        nextCursor: hasMore && last
            ? encodeBrandRadarCursor({
                createdAt: last.createdAt.toISOString(),
                id: String(last._id),
            })
            : null,
    };
}
export async function getScan(accountId: string, scanId: string) {
    const scan = await BrandRadarScan.findOne({ _id: scanId, accountId });
    if (!scan)
        throw HttpError.notFound({ code: 'BRAND_RADAR_NOT_FOUND', messageKey: BRAND_RADAR_NOT_FOUND_KEY });
    return serializeScanDetail(scan);
}
/**
 * Every scan carries a site, so the stored-read lease now enforces a real Site
 * boundary for all of them. `null` means "no such scan on this account" — the
 * lease treats that as nothing to lease, and the service read below still
 * answers 404.
 */
export async function resolveOwnedBrandRadarScanSiteId(accountId: string, scanId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(scanId))
        return null;
    const scan = await BrandRadarScan.findOne({ _id: scanId, accountId }, { siteId: 1 }).lean();
    return scan ? String(scan.siteId) : null;
}
export interface BrandRadarMentionDto {
    id: string;
    /** `null` when the stored value is not an http(s) URL — see below. */
    url: string | null;
    domain: string;
    title: string;
    snippet: string;
    polarity: BrandRadarPolarity;
    confidence: number | null;
    language: string | null;
    observedAt: string | null;
}
/**
 * Serialization-time scheme guard (SEC-OUT). The stored value is vendor text
 * that was output-encoded, not scheme-checked, so a `javascript:` or `data:`
 * string can be sitting in the collection. Anything that is not http(s) is
 * served as `null` rather than as a link the client could render.
 *
 * This is NOT SSRF validation — nothing is fetched here, so
 * `assertPublicUrlSafe` (which resolves DNS and pins an address) is
 * deliberately not used.
 */
function safeMentionUrl(stored: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(stored);
    }
    catch {
        return null;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
        ? stored
        : null;
}
export function serializeMentionRow(row: StoredMentionRow): BrandRadarMentionDto {
    return {
        id: row.id,
        url: safeMentionUrl(row.url),
        domain: row.domain,
        title: row.title,
        snippet: row.snippet,
        polarity: row.polarity,
        confidence: row.confidence,
        language: row.language,
        observedAt: row.observedAt ? row.observedAt.toISOString() : null,
    };
}
/**
 * Mention inventory for one owned scan.
 *
 * A STORED-DATA read: no `assertCapacity`, no enqueue, no `captureVendorCost`,
 * no provider call, and no kill-switch check — stored results stay readable
 * when `BRAND_RADAR_ENABLED` is false, exactly like `GET /scans/:id`.
 */
export async function listScanMentions(accountId: string, scanId: string, query: ListMentionsQuery): Promise<{
    items: BrandRadarMentionDto[];
    nextCursor: string | null;
}> {
    const scan = await BrandRadarScan.findOne({ _id: scanId, accountId }).select({
        _id: 1,
    });
    if (!scan)
        throw HttpError.notFound({ code: 'BRAND_RADAR_NOT_FOUND', messageKey: BRAND_RADAR_NOT_FOUND_KEY });
    const page = await readMentionRowsPage({
        accountId,
        scanId,
        limit: query.limit,
        cursor: query.cursor ? decodeBrandRadarCursor(query.cursor) : null,
    });
    return {
        items: page.items.map(serializeMentionRow),
        nextCursor: page.nextCursor
            ? encodeBrandRadarCursor(page.nextCursor)
            : null,
    };
}
/**
 * Read-only spend preview for exactly one scan. Never mutates, never
 * enqueues, never calls a provider. A successful preview is not an
 * authorization token — `createScan` repeats every check independently.
 */
export async function previewSpend(accountId: string, siteIdInput: string): Promise<SpendPreview> {
    // Ownership first — a preview must not answer for a site the caller does
    // not own.
    await loadOwnedSite(accountId, siteIdInput, true);
    assertBrandRadarEnabled();
    return { deploymentMode: 'community', capacityEnforced: false };
}
