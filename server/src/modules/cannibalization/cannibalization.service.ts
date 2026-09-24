import type { SpendPreview } from '../../shared/safety/operation-preview.js';
/**
 * Cannibalization report generation.
 *
 * FIRST-PARTY ONLY. A report is computed from the Search Console `query,page`
 * rows the daily sync already persisted — this module never constructs a GSC
 * provider, never calls Google, and therefore keeps working after the user
 * disconnects their property. A site whose sync has not yet written any
 * `query,page` rows gets the localized "waiting for the next sync" refusal:
 * there is nothing to compute.
 *
 * Order on the generate path:
 *   parse → own (404) → awaiting-sync precondition (409)
 *   → compute from stored rows → persist.
 */
import { and, desc, eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { GSC_DIMENSION_KEY_SEPARATOR, gscSearchAnalytics } from '../../db/schema/gsc.js';
import { buildCannibalizationCandidates, recommendPrimaryPage, type CannibalizationConfidence, type CannibalizationGroup, type CannibalizationPageMetrics, type PrimaryPageReason, } from '../../shared/cannibalization/index.js';
import { buildObservationMeta } from '../../shared/observations/observations.js';
import type { ObservationMeta } from '../../shared/observations/types.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/sites.model.js';
import { CannibalizationReport } from './cannibalization.model.js';
import { MAX_CANDIDATES, MAX_PAGES_PER_QUERY, type CannibalizationWindow, } from './cannibalization.schema.js';
export const CANNIBALIZATION_DIMENSION_SET = 'query,page';
const NOT_FOUND_KEY = 'cannibalization.errors.notFound';
const UNAVAILABLE_KEY = 'cannibalization.errors.productUnavailable';
const AWAITING_SYNC_KEY = 'cannibalization.errors.awaitingSync';
// ---------------------------------------------------------------------------
// Wire DTOs
// ---------------------------------------------------------------------------
export interface CandidatePageDto {
    url: string;
    clicks: number;
    impressions: number;
    position: number;
    clickShare: number;
    impressionShare: number;
    isPrimary: boolean;
}
export interface CandidateDto {
    id: string;
    query: string;
    confidence: CannibalizationConfidence;
    /** Honesty invariant — every candidate carries its own provenance. */
    sourceKind: 'first_party';
    windowDays: number;
    snapshotDate: string;
    observation: ObservationMeta;
    totalClicks: number;
    totalImpressions: number;
    primaryUrl: string;
    primaryReason: PrimaryPageReason;
    pages: CandidatePageDto[];
}
export interface ReportSummaryDto {
    id: string;
    siteId: string;
    windowDays: number;
    snapshotDate: string;
    generatedAt: string;
    queriesAnalyzed: number;
    candidateCount: number;
    pagesInvolved: number;
}
export interface ReportDetailDto extends ReportSummaryDto {
    candidates: CandidateDto[];
}
export interface CannibalizationServiceDeps {
    db: ApplicationDb;
    now?: () => Date;
}
// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------
/**
 * Kill switch. Only the NEW-REPORT entry points (preview + generate) close;
 * stored reports stay readable so a user never loses access to work already
 * paid for. Read from `env` at request time so an operator flip takes effect
 * without a restart.
 */
function requireEnabled(): void {
    if (!env.CANNIBALIZATION_ENABLED)
        throw new HttpError(503, { code: 'UNAVAILABLE', messageKey: UNAVAILABLE_KEY });
}
/** Owner-scoped site load. A stranger's site id is a 404, never a 403. */
async function requireOwnedSite(accountId: string, siteId: string): Promise<string | null> {
    const site = await Site.findOne({
        _id: siteId,
        accountId,
        deletionStartedAt: null,
    }).select({ gscPropertyUrl: 1, gscBindingGenerationId: 1 });
    if (!site)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return site.gscPropertyUrl ? site.gscBindingGenerationId ?? 'legacy' : null;
}
// ---------------------------------------------------------------------------
// Stored-row reads
// ---------------------------------------------------------------------------
interface StoredRow {
    query: string;
    page: string;
    clicks: number;
    impressions: number;
    position: number;
}
/** Newest persisted snapshot date for the site's `query,page` rows. */
async function readLatestSnapshotDate(db: ApplicationDb, siteId: string, windowDays: number, bindingGenerationId: string): Promise<string | null> {
    const rows = await db
        .select({ snapshotDate: gscSearchAnalytics.snapshotDate })
        .from(gscSearchAnalytics)
        .where(and(eq(gscSearchAnalytics.siteId, siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId), eq(gscSearchAnalytics.dimensionSet, CANNIBALIZATION_DIMENSION_SET), eq(gscSearchAnalytics.windowDays, windowDays)))
        .orderBy(desc(gscSearchAnalytics.snapshotDate))
        .limit(1);
    return rows[0]?.snapshotDate ?? null;
}
/** Every `query,page` row of one snapshot, split back into its two keys. */
async function readSnapshotRows(db: ApplicationDb, siteId: string, windowDays: number, snapshotDate: string, bindingGenerationId: string): Promise<StoredRow[]> {
    const rows = await db
        .select({
        dimensionKey: gscSearchAnalytics.dimensionKey,
        clicks: gscSearchAnalytics.clicks,
        impressions: gscSearchAnalytics.impressions,
        position: gscSearchAnalytics.position,
    })
        .from(gscSearchAnalytics)
        .where(and(eq(gscSearchAnalytics.siteId, siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId), eq(gscSearchAnalytics.dimensionSet, CANNIBALIZATION_DIMENSION_SET), eq(gscSearchAnalytics.windowDays, windowDays), eq(gscSearchAnalytics.snapshotDate, snapshotDate)));
    const out: StoredRow[] = [];
    for (const row of rows) {
        const sep = row.dimensionKey.indexOf(GSC_DIMENSION_KEY_SEPARATOR);
        // A `query,page` key always carries both keys joined by the separator; a
        // row missing it is malformed and is skipped rather than trusted.
        if (sep === -1)
            continue;
        const query = row.dimensionKey.slice(0, sep);
        const page = row.dimensionKey.slice(sep + GSC_DIMENSION_KEY_SEPARATOR.length);
        if (query.length === 0 || page.length === 0)
            continue;
        out.push({
            query,
            page,
            clicks: row.clicks,
            impressions: row.impressions,
            position: row.position,
        });
    }
    return out;
}
// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
interface ComputedReport {
    queriesAnalyzed: number;
    pagesInvolved: number;
    candidates: Array<{
        candidateId: string;
        query: string;
        confidence: CannibalizationConfidence;
        totalClicks: number;
        totalImpressions: number;
        primaryUrl: string;
        primaryReason: PrimaryPageReason;
        pages: CandidatePageDto[];
    }>;
}
/**
 * Compute the report from stored rows. Deterministic: the shared scoring
 * authority orders candidates and grades confidence; this function only adds
 * the per-page split metrics and the primary-page recommendation.
 */
export function computeReport(rows: readonly StoredRow[]): ComputedReport {
    const metricsByQuery = new Map<string, Map<string, CannibalizationPageMetrics>>();
    const groups = new Map<string, CannibalizationGroup>();
    for (const row of rows) {
        let pages = metricsByQuery.get(row.query);
        if (!pages) {
            pages = new Map();
            metricsByQuery.set(row.query, pages);
        }
        const existing = pages.get(row.page);
        if (existing) {
            // Two rows for one (query, page) can only come from a malformed
            // snapshot; fold them so the shares still sum to one.
            existing.clicks += row.clicks;
            existing.impressions += row.impressions;
        }
        else {
            pages.set(row.page, {
                url: row.page,
                clicks: row.clicks,
                impressions: row.impressions,
                position: row.position,
            });
        }
        let group = groups.get(row.query);
        if (!group) {
            group = { urls: new Set(), gscUrls: new Set(), rankUrls: new Set() };
            groups.set(row.query, group);
        }
        group.urls.add(row.page);
        if (row.impressions > 0)
            group.gscUrls.add(row.page);
    }
    const scored = buildCannibalizationCandidates(groups).slice(0, MAX_CANDIDATES);
    const involved = new Set<string>();
    const candidates: ComputedReport['candidates'] = [];
    for (const candidate of scored) {
        // Every scored query came from `rows`, so its metrics map always exists —
        // the two maps are populated in the same loop from the same keys.
        const pageMap = metricsByQuery.get(candidate.query)!;
        const pages = [...pageMap.values()]
            .sort((a, b) => b.clicks - a.clicks ||
            a.position - b.position ||
            a.url.localeCompare(b.url))
            .slice(0, MAX_PAGES_PER_QUERY);
        const totalClicks = pages.reduce((sum, p) => sum + p.clicks, 0);
        const totalImpressions = pages.reduce((sum, p) => sum + p.impressions, 0);
        const primary = recommendPrimaryPage(pages);
        for (const page of pages)
            involved.add(page.url);
        candidates.push({
            candidateId: candidate.id,
            query: candidate.query,
            confidence: candidate.confidence,
            totalClicks,
            totalImpressions,
            primaryUrl: primary.url,
            primaryReason: primary.reason,
            pages: pages.map((page) => ({
                url: page.url,
                clicks: page.clicks,
                impressions: page.impressions,
                position: page.position,
                clickShare: totalClicks === 0 ? 0 : page.clicks / totalClicks,
                impressionShare: totalImpressions === 0 ? 0 : page.impressions / totalImpressions,
                isPrimary: page.url === primary.url,
            })),
        });
    }
    return {
        queriesAnalyzed: metricsByQuery.size,
        pagesInvolved: involved.size,
        candidates,
    };
}
// ---------------------------------------------------------------------------
// DTO mapping
// ---------------------------------------------------------------------------
interface StoredReportShape {
    _id: unknown;
    siteId: unknown;
    windowDays: number;
    snapshotDate: string;
    queriesAnalyzed: number;
    pagesInvolved: number;
    candidates: ComputedReport['candidates'];
    createdAt: Date;
}
function toSummary(doc: StoredReportShape): ReportSummaryDto {
    return {
        id: String(doc._id),
        siteId: String(doc.siteId),
        windowDays: doc.windowDays,
        snapshotDate: doc.snapshotDate,
        generatedAt: doc.createdAt.toISOString(),
        queriesAnalyzed: doc.queriesAnalyzed,
        candidateCount: doc.candidates.length,
        pagesInvolved: doc.pagesInvolved,
    };
}
function toDetail(doc: StoredReportShape): ReportDetailDto {
    return {
        ...toSummary(doc),
        candidates: doc.candidates.map((candidate) => ({
            id: candidate.candidateId,
            query: candidate.query,
            confidence: candidate.confidence,
            sourceKind: 'first_party',
            windowDays: doc.windowDays,
            snapshotDate: doc.snapshotDate,
            observation: buildObservationMeta({
                sourceKind: 'first_party',
                sourceLabel: 'google_search_console',
                observedAt: `${doc.snapshotDate}T00:00:00.000Z`,
                sampleCount: candidate.pages.length,
            }),
            totalClicks: candidate.totalClicks,
            totalImpressions: candidate.totalImpressions,
            primaryUrl: candidate.primaryUrl,
            primaryReason: candidate.primaryReason,
            pages: candidate.pages,
        })),
    };
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export interface GenerateReportInput {
    accountId: string;
    siteId: string;
    windowDays: CannibalizationWindow;
}
/** Read-only spend preview — never reserves, never reads a provider. */
export async function previewReport(input: GenerateReportInput): Promise<SpendPreview> {
    await requireOwnedSite(input.accountId, input.siteId);
    requireEnabled();
    return { deploymentMode: 'community', capacityEnforced: false };
}
export async function generateReport(input: GenerateReportInput, deps: CannibalizationServiceDeps): Promise<ReportDetailDto> {
    const bindingGenerationId = await requireOwnedSite(input.accountId, input.siteId);
    requireEnabled();
    // With no stored `query,page` rows there is no report to generate.
    const snapshotDate = bindingGenerationId
        ? await readLatestSnapshotDate(deps.db, input.siteId, input.windowDays, bindingGenerationId)
        : null;
    if (snapshotDate === null)
        throw new HttpError(409, { code: 'AWAITING_SYNC', messageKey: AWAITING_SYNC_KEY });
    const rows = await readSnapshotRows(deps.db, input.siteId, input.windowDays, snapshotDate, bindingGenerationId!);
    const computed = computeReport(rows);
    const created = await CannibalizationReport.create({
        accountId: new Types.ObjectId(input.accountId),
        siteId: new Types.ObjectId(input.siteId),
        windowDays: input.windowDays,
        snapshotDate,
        queriesAnalyzed: computed.queriesAnalyzed,
        pagesInvolved: computed.pagesInvolved,
        candidates: computed.candidates,
    });
    return toDetail(created.toObject() as unknown as StoredReportShape);
}
export interface ListReportsInput {
    accountId: string;
    siteId: string;
    limit: number;
    windowDays?: CannibalizationWindow;
}
export async function listReports(input: ListReportsInput): Promise<{
    items: ReportSummaryDto[];
}> {
    await requireOwnedSite(input.accountId, input.siteId);
    const filter: Record<string, unknown> = {
        accountId: input.accountId,
        siteId: input.siteId,
    };
    if (input.windowDays !== undefined)
        filter.windowDays = input.windowDays;
    const docs = await CannibalizationReport.find(filter)
        .sort({ createdAt: -1 })
        .limit(input.limit)
        .lean();
    return {
        items: (docs as unknown as StoredReportShape[]).map(toSummary),
    };
}
export async function getReport(input: {
    accountId: string;
    reportId: string;
}): Promise<ReportDetailDto> {
    const doc = await CannibalizationReport.findOne({
        _id: input.reportId,
        accountId: input.accountId,
    }).lean();
    if (!doc)
        throw HttpError.notFound({ code: 'NOT_FOUND', messageKey: NOT_FOUND_KEY });
    return toDetail(doc as unknown as StoredReportShape);
}
/** Resolve a report's owning Site without exposing cross-account existence. */
export async function resolveOwnedCannibalizationReportSiteId(accountId: string, reportId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(reportId))
        return null;
    const report = await CannibalizationReport.findOne({ _id: reportId, accountId }, { siteId: 1 }).lean();
    return report ? String(report.siteId) : null;
}
