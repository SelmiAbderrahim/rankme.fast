import { z } from 'zod';
import { and, count, eq, max } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { ga4Metrics, gscSearchAnalytics, gscSearchAppearance, gscSitemaps, } from '../../db/schema/index.js';
import { REPORT_DOCUMENT_SCHEMA, REPORT_DOCUMENT_SCHEMA_VERSION, renderReportDocument, reportCatalogCopy, reportCopy, reportIsoDateTime, reportSourceDate, reportSourceNote, reportSourceVersion, stableReportJson, reportTable, reportWindow, type ReportBlockV1, type ReportBrandingSnapshot, type ReportDocumentV1, type ReportLocale, type ReportTableRowInput, } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { buildGenerativeAppearanceRead, readLatestSnapshotDate, readPreviousSnapshotTotals, readSearchAnalytics, readSearchAppearance, readSitemaps, } from '../gsc-snapshots/index.js';
import { readGa4Metrics, readLatestGa4SnapshotDate, readPreviousGa4Totals, } from '../ga4-snapshots/index.js';
import type { ReportExportAdapter } from '../report-exports/index.js';
import { getSite, Site, type PublicSite } from '../sites/index.js';
import { GA4_DEFAULT_LAG_DAYS, assertGa4StoredReadAccess, getAnalyticsDetailFor, getAnalyticsSummaryFor, } from './google-analytics.service.js';
import { GSC_SEARCH_LAG_DAYS, assertGscStoredReadAccess, getSearchAnalyticsDetailFor, getSearchSummaryFor, getSitemapsFor, } from './google-connections.service.js';
import { RANGE_VALUES } from './google-connections.schema.js';
const GSC_DIMENSIONS = ['summary', 'query', 'page', 'country', 'device', 'date'] as const;
const GA4_DIMENSIONS = ['summary', 'channel', 'page', 'country', 'device', 'date'] as const;
const gscSearchSelectionSchema = z.object({
    window: z.enum(RANGE_VALUES).default('28d'),
    dimensions: z.array(z.enum(GSC_DIMENSIONS)).min(1).max(GSC_DIMENSIONS.length).default([...GSC_DIMENSIONS]),
}).strict();
const sitemapSelectionSchema = z.object({
    status: z.enum(['submitted', 'processed', 'error']).optional(),
}).strict();
const generativeSelectionSchema = z.object({
    window: z.enum(RANGE_VALUES).default('28d'),
    classification: z.array(z.string().min(1).max(80)).max(50).optional(),
}).strict();
const ga4SelectionSchema = z.object({
    window: z.enum(RANGE_VALUES).default('28d'),
    dimensions: z.array(z.enum(GA4_DIMENSIONS)).min(1).max(GA4_DIMENSIONS.length).default([...GA4_DIMENSIONS]),
}).strict();
type GscSearchSelection = z.infer<typeof gscSearchSelectionSchema>;
type SitemapSelection = z.infer<typeof sitemapSelectionSchema>;
type GenerativeSelection = z.infer<typeof generativeSelectionSchema>;
type Ga4Selection = z.infer<typeof ga4SelectionSchema>;
type GoogleReportKind = 'google.gsc_search' | 'google.gsc_sitemaps' | 'google.gsc_generative_appearance' | 'google.ga4';
type GoogleReportDb = Pick<Db, 'select'>;
async function googleStoredVersion(db: GoogleReportDb, kind: GoogleReportKind, accountId: string, siteId: string, bindingGenerationId = 'legacy'): Promise<string> {
    const stamp = kind === 'google.gsc_search'
        ? await db.select({ rows: count(), latest: max(gscSearchAnalytics.fetchedAt) }).from(gscSearchAnalytics).where(and(eq(gscSearchAnalytics.accountId, accountId), eq(gscSearchAnalytics.siteId, siteId), eq(gscSearchAnalytics.bindingGenerationId, bindingGenerationId)))
        : kind === 'google.gsc_sitemaps'
            ? await db.select({ rows: count(), latest: max(gscSitemaps.fetchedAt) }).from(gscSitemaps).where(and(eq(gscSitemaps.accountId, accountId), eq(gscSitemaps.siteId, siteId), eq(gscSitemaps.bindingGenerationId, bindingGenerationId)))
            : kind === 'google.gsc_generative_appearance'
                ? await db.select({ rows: count(), latest: max(gscSearchAppearance.fetchedAt) }).from(gscSearchAppearance).where(and(eq(gscSearchAppearance.accountId, accountId), eq(gscSearchAppearance.siteId, siteId), eq(gscSearchAppearance.bindingGenerationId, bindingGenerationId)))
                : await db.select({ rows: count(), latest: max(ga4Metrics.fetchedAt) }).from(ga4Metrics).where(and(eq(ga4Metrics.accountId, accountId), eq(ga4Metrics.siteId, siteId), eq(ga4Metrics.bindingGenerationId, bindingGenerationId)));
    // Aggregate SELECTs always return exactly one row, including an empty-table
    // row with count 0 and a null maximum.
    const aggregate = stamp[0]!;
    return reportSourceVersion(kind, {
        rows: aggregate.rows,
        latest: aggregate.latest?.toISOString() ?? null,
    });
}
async function reportBinding(accountId: string, siteId: string, kind: GoogleReportKind): Promise<{
    generation: string;
    property: string | null;
}> {
    const site = await Site.findOne({
        _id: siteId,
        accountId,
        deletionStartedAt: null,
    })
        .select('gscPropertyUrl gscBindingGenerationId ga4PropertyId ga4BindingGenerationId')
        .lean();
    const owned = assertStoredGoogleSite(site);
    if (kind === 'google.ga4') {
        return {
            generation: owned.ga4BindingGenerationId ?? 'legacy',
            property: owned.ga4PropertyId ?? null,
        };
    }
    return {
        generation: owned.gscBindingGenerationId ?? 'legacy',
        property: owned.gscPropertyUrl ?? null,
    };
}
async function assertGoogleVersion(db: GoogleReportDb, kind: GoogleReportKind, context: Parameters<ReportExportAdapter['assertAccess']>[0]): Promise<void> {
    if (context.purpose !== 'persist' || !context.sourceVersion || context.target.scope !== 'site')
        return;
    const binding = await reportBinding(context.accountId, context.target.siteId, kind);
    const current = await googleStoredVersion(db, kind, context.accountId, context.target.siteId, binding.generation);
    if (current !== context.sourceVersion)
        throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
}
function windowDays(value: (typeof RANGE_VALUES)[number]): number {
    return value === '7d' ? 7 : value === '90d' ? 90 : 28;
}
function assertStableGoogleVersion(initialVersion: string, finalVersion: string): void {
    if (initialVersion !== finalVersion) {
        throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
    }
}
function assertStoredGoogleSite<T>(site: T | null): T {
    if (site === null)
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    return site;
}
function googleDocument(input: {
    kind: 'google.gsc_search' | 'google.gsc_sitemaps' | 'google.gsc_generative_appearance' | 'google.ga4';
    catalogStem: 'googleGscSearch' | 'googleGscSitemaps' | 'googleGscGenerativeAppearance' | 'googleGa4';
    locale: ReportLocale;
    site: PublicSite;
    branding: ReportBrandingSnapshot;
    selection: ReportDocumentV1['selection'];
    sourceDates: ReportDocumentV1['sourceDates'];
    representedItems: number;
    blocks: ReportBlockV1[];
}): ReportDocumentV1 {
    return {
        schema: REPORT_DOCUMENT_SCHEMA,
        schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
        kind: input.kind,
        kindVersion: 1,
        locale: input.locale,
        title: reportCatalogCopy(input.locale, input.catalogStem, 'title'),
        subject: [{ label: reportCopy(input.locale, 'fields.site'), value: input.site.displayName || input.site.domain }],
        selection: input.selection,
        sourceDates: input.sourceDates,
        completeness: {
            state: 'complete',
            selectedItems: input.representedItems,
            representedItems: input.representedItems,
            bound: reportCatalogCopy(input.locale, input.catalogStem, 'bound'),
        },
        branding: input.branding,
        blocks: input.blocks,
        artifacts: [],
    };
}
function gscDeps(db: GoogleReportDb, bindingGenerationId = 'legacy') {
    return {
        readLatestSnapshotDate: (siteId: string, dimension: string, days: number) => readLatestSnapshotDate(db, siteId, dimension, days, bindingGenerationId),
        readSearchAnalytics: (siteId: string, dimension: string, range: {
            since?: string;
            until?: string;
        }, days: number) => readSearchAnalytics(db, siteId, dimension, range, days, bindingGenerationId),
        readPreviousTotals: (siteId: string, before: string, days: number) => readPreviousSnapshotTotals(db, siteId, 'query', before, days, bindingGenerationId),
    };
}
function ga4Deps(db: GoogleReportDb, bindingGenerationId = 'legacy') {
    return {
        readLatest: (siteId: string, dimension: string, days: number) => readLatestGa4SnapshotDate(db, siteId, dimension, days, bindingGenerationId),
        readRows: (siteId: string, dimension: string, days: number, range: {
            since?: string;
            until?: string;
        }) => readGa4Metrics(db, siteId, dimension, days, range, bindingGenerationId),
        readPreviousTotals: (siteId: string, dimension: string, days: number, before: string) => readPreviousGa4Totals(db, siteId, dimension, days, before, bindingGenerationId),
    };
}
function metricsColumns(locale: ReportLocale, firstKey: string) {
    return [
        { key: 'item', label: reportCopy(locale, firstKey), valueType: 'string' as const },
        { key: 'clicks', label: reportCopy(locale, 'fields.clicks'), valueType: 'number' as const },
        { key: 'impressions', label: reportCopy(locale, 'fields.impressions'), valueType: 'number' as const },
        { key: 'ctr', label: reportCopy(locale, 'fields.ctr'), valueType: 'number' as const, unit: '%' },
        { key: 'position', label: reportCopy(locale, 'fields.position'), valueType: 'number' as const },
    ];
}
function gscSource(locale: ReportLocale, asOf: string, days: number) {
    const range = reportWindow(asOf, days);
    return reportSourceDate({
        id: 'gsc-observation',
        label: reportCopy(locale, 'sources.gscObservation'),
        kind: 'first_party_observation',
        from: range.from,
        to: range.to,
        sourceNoteKey: 'google.gsc',
        lagDays: GSC_SEARCH_LAG_DAYS,
        freshness: 'unknown',
    });
}
function googleCsvRows(document: ReportDocumentV1): ReportTableRowInput[] {
    const rows: ReportTableRowInput[] = [];
    const append = (section: string, rowId: string, data: unknown, sourceDateId: string) => {
        rows.push({
            id: `google-csv-${rows.length + 1}`,
            values: [section, rowId, stableReportJson(data)],
            sourceDateId,
        });
    };
    for (const block of document.blocks) {
        if (block.type === 'kpi_group') {
            for (const item of block.items) {
                append(block.id, item.id, { label: item.label, value: item.value.value, unit: item.unit ?? null }, item.sourceDateId!);
            }
            continue;
        }
        if (block.type === 'table') {
            block.rows.forEach((row, index) => {
                append(block.id, row.id ?? `row-${index + 1}`, Object.fromEntries(row.cells.map((cell) => [cell.columnKey, cell.value.value])), row.cells[0]!.sourceDateId!);
            });
            continue;
        }
        if (block.type === 'time_series') {
            block.tableFallback.rows.forEach((row, index) => {
                append(block.id, row.id ?? `row-${index + 1}`, Object.fromEntries(row.cells.map((cell) => [cell.columnKey, cell.value.value])), row.cells[0]!.sourceDateId!);
            });
        }
    }
    return rows;
}
function renderGoogleMetrics(context: Parameters<ReportExportAdapter['render']>[0]) {
    if (context.format !== 'csv')
        return renderReportDocument(context);
    const projection = reportTable({
        id: 'google-csv-projection',
        columns: [
            { key: 'section', label: reportCopy(context.document.locale, 'fields.type'), valueType: 'string' },
            { key: 'row', label: reportCopy(context.document.locale, 'fields.item'), valueType: 'string' },
            { key: 'data', label: reportCopy(context.document.locale, 'fields.details'), valueType: 'string' },
        ],
        rows: googleCsvRows(context.document),
    });
    return renderReportDocument({
        ...context,
        document: {
            ...context.document,
            blocks: [
                projection,
                ...context.document.blocks.filter((block) => !['kpi_group', 'table', 'time_series'].includes(block.type)),
            ],
        },
    });
}
function gscSearchAdapter(db: GoogleReportDb): ReportExportAdapter<GscSearchSelection> {
    return {
        kind: 'google.gsc_search', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: gscSearchSelectionSchema,
        async assertAccess(context) {
            if (context.target.scope !== 'site')
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            await assertGscStoredReadAccess(context.accountId, context.target.siteId);
            await assertGoogleVersion(db, 'google.gsc_search', context);
        },
        async compose(context) {
            if (context.target.scope !== 'site')
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            const siteId = context.target.siteId;
            const binding = await reportBinding(context.accountId, siteId, 'google.gsc_search');
            const sourceVersion = await googleStoredVersion(db, 'google.gsc_search', context.accountId, siteId, binding.generation);
            const days = windowDays(context.selection.window);
            const deps = gscDeps(db, binding.generation);
            const [site, summary] = await Promise.all([
                getSite(context.accountId, siteId),
                getSearchSummaryFor(context.accountId, siteId, deps, context.selection.window),
            ]);
            const dimensions = new Set(context.selection.dimensions);
            const detailNames = ['query', 'page', 'country', 'device'] as const;
            const details = new Map<string, Awaited<ReturnType<typeof getSearchAnalyticsDetailFor>>>();
            await Promise.all(detailNames.filter((dimension) => dimensions.has(dimension)).map(async (dimension) => {
                details.set(dimension, await getSearchAnalyticsDetailFor(context.accountId, siteId, dimension, deps, context.selection.window));
            }));
            const blocks: ReportBlockV1[] = [];
            if (dimensions.has('summary')) {
                blocks.push({ type: 'kpi_group', id: 'gsc-summary', items: [
                        ['clicks', 'fields.clicks', summary.totalClicks, null],
                        ['impressions', 'fields.impressions', summary.totalImpressions, null],
                        ['ctr', 'fields.ctr', summary.averageCtr * 100, '%'],
                        ['position', 'fields.position', summary.averagePosition, null],
                        ['click-delta', 'fields.clickDelta', summary.previousPeriod ? summary.totalClicks - summary.previousPeriod.totalClicks : null, null],
                        ['impression-delta', 'fields.impressionDelta', summary.previousPeriod ? summary.totalImpressions - summary.previousPeriod.totalImpressions : null, null],
                    ].map(([id, key, value, unit]) => ({ id: String(id), label: reportCopy(context.locale, String(key)), value: value === null ? { type: 'null' as const, value: null } : { type: 'number' as const, value: Number(value) }, ...(unit ? { unit: String(unit) } : {}), sourceDateId: 'gsc-observation' })) });
            }
            for (const dimension of detailNames) {
                const detail = details.get(dimension);
                if (!detail)
                    continue;
                blocks.push(reportTable({ id: `gsc-${dimension}`, columns: metricsColumns(context.locale, `fields.${dimension}`), rows: detail.rows.map((row, index) => ({ id: `${dimension}-${index + 1}`, values: [row.key, row.clicks, row.impressions, row.ctr * 100, row.position], sourceDateId: 'gsc-observation' })) }));
            }
            if (dimensions.has('date')) {
                const fallback = reportTable({ id: 'gsc-date-fallback', columns: metricsColumns(context.locale, 'fields.date'), rows: summary.timeseries.map((row, index) => ({ id: `date-${index + 1}`, values: [row.date, row.clicks, row.impressions, row.ctr * 100, row.position], sourceDateId: 'gsc-observation' })) });
                blocks.push({ type: 'time_series', id: 'gsc-timeseries', series: [
                        { id: 'clicks', label: reportCopy(context.locale, 'fields.clicks'), sourceDateId: 'gsc-observation', points: summary.timeseries.map((row) => ({ timestamp: reportIsoDateTime(row.date), value: row.clicks })) },
                        { id: 'impressions', label: reportCopy(context.locale, 'fields.impressions'), sourceDateId: 'gsc-observation', points: summary.timeseries.map((row) => ({ timestamp: reportIsoDateTime(row.date), value: row.impressions })) },
                        { id: 'ctr', label: reportCopy(context.locale, 'fields.ctr'), unit: '%', sourceDateId: 'gsc-observation', points: summary.timeseries.map((row) => ({ timestamp: reportIsoDateTime(row.date), value: row.ctr * 100 })) },
                        { id: 'position', label: reportCopy(context.locale, 'fields.position'), sourceDateId: 'gsc-observation', points: summary.timeseries.map((row) => ({ timestamp: reportIsoDateTime(row.date), value: row.position })) },
                    ], tableFallback: { columns: fallback.columns, rows: fallback.rows } });
            }
            blocks.push(reportSourceNote({ id: 'gsc-source-note', sourceDateId: 'gsc-observation', methodology: reportCopy(context.locale, 'notes.gscObservation') }));
            const representedItems = [...details.values()].reduce((sum, detail) => sum + detail.rows.length, 0) + (dimensions.has('date') ? summary.timeseries.length : 0);
            const document = googleDocument({ kind: 'google.gsc_search', catalogStem: 'googleGscSearch', locale: context.locale, site, branding: context.branding, selection: [
                    { label: reportCopy(context.locale, 'fields.window'), value: context.selection.window },
                    { label: reportCopy(context.locale, 'fields.dimensions'), value: context.selection.dimensions.join(', ') },
                ], sourceDates: [gscSource(context.locale, summary.asOf, days)], representedItems, blocks });
            const finalVersion = await googleStoredVersion(db, 'google.gsc_search', context.accountId, siteId, binding.generation);
            assertStableGoogleVersion(sourceVersion, finalVersion);
            return { sourceVersion: finalVersion, document };
        },
        render: renderGoogleMetrics,
    };
}
function sitemapStatus(row: {
    isPending: boolean;
    processed: number;
    errors: number;
    warnings: number;
}): 'submitted' | 'processed' | 'error' {
    if (row.errors > 0 || row.warnings > 0)
        return 'error';
    if (!row.isPending && row.processed > 0)
        return 'processed';
    return 'submitted';
}
function sitemapAdapter(db: GoogleReportDb): ReportExportAdapter<SitemapSelection> {
    return {
        kind: 'google.gsc_sitemaps', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: sitemapSelectionSchema,
        async assertAccess(context) {
            if (context.target.scope !== 'site')
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            await assertGscStoredReadAccess(context.accountId, context.target.siteId);
            await assertGoogleVersion(db, 'google.gsc_sitemaps', context);
        },
        async compose(context) {
            if (context.target.scope !== 'site')
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            const binding = await reportBinding(context.accountId, context.target.siteId, 'google.gsc_sitemaps');
            const sourceVersion = await googleStoredVersion(db, 'google.gsc_sitemaps', context.accountId, context.target.siteId, binding.generation);
            const [site, result] = await Promise.all([
                getSite(context.accountId, context.target.siteId),
                getSitemapsFor(context.accountId, context.target.siteId, {
                    readSitemaps: (siteId) => readSitemaps(db, siteId, undefined, binding.generation),
                }),
            ]);
            const rows = result.sitemaps.filter((row) => !context.selection.status || sitemapStatus(row) === context.selection.status);
            const source = result.asOf
                ? reportSourceDate({ id: 'gsc-sitemaps', label: reportCopy(context.locale, 'sources.gscObservation'), kind: 'first_party_observation', observedAt: result.asOf, sourceNoteKey: 'google.sitemaps', lagDays: GSC_SEARCH_LAG_DAYS, freshness: 'unknown' })
                : reportSourceDate({ id: 'gsc-sitemaps', label: reportCopy(context.locale, 'sources.snapshotState'), kind: 'derived', observedAt: site.updatedAt, sourceNoteKey: 'google.sitemaps.empty', freshness: 'unknown' });
            const blocks: ReportBlockV1[] = [];
            if (!result.asOf)
                blocks.push({ type: 'state', id: 'sitemaps-unavailable', state: 'unavailable', reason: reportCopy(context.locale, 'states.noSitemapSnapshot'), sourceDateId: 'gsc-sitemaps' });
            else if (rows.length === 0)
                blocks.push({ type: 'state', id: 'sitemaps-empty', state: 'empty', reason: reportCopy(context.locale, 'states.noSitemaps'), sourceDateId: 'gsc-sitemaps' });
            blocks.push(reportTable({ id: 'sitemaps', columns: [
                    { key: 'path', label: reportCopy(context.locale, 'fields.path'), valueType: 'string' },
                    { key: 'type', label: reportCopy(context.locale, 'fields.type'), valueType: 'string' },
                    { key: 'status', label: reportCopy(context.locale, 'fields.status'), valueType: 'string' },
                    { key: 'submitted', label: reportCopy(context.locale, 'fields.lastSubmitted'), valueType: 'string' },
                    { key: 'downloaded', label: reportCopy(context.locale, 'fields.lastDownloaded'), valueType: 'string' },
                    { key: 'pending', label: reportCopy(context.locale, 'fields.pending'), valueType: 'boolean' },
                    { key: 'index', label: reportCopy(context.locale, 'fields.sitemapIndex'), valueType: 'boolean' },
                    { key: 'errors', label: reportCopy(context.locale, 'fields.errors'), valueType: 'number' },
                    { key: 'warnings', label: reportCopy(context.locale, 'fields.warnings'), valueType: 'number' },
                    { key: 'processed', label: reportCopy(context.locale, 'fields.processed'), valueType: 'number' },
                ], rows: rows.map((row, index) => ({ id: `sitemap-${index + 1}`, values: [row.path, row.type, sitemapStatus(row), row.lastSubmitted?.toISOString() ?? null, row.lastDownloaded?.toISOString() ?? null, row.isPending, row.isSitemapsIndex, row.errors, row.warnings, row.processed], sourceDateId: 'gsc-sitemaps' })) }));
            blocks.push(reportSourceNote({ id: 'sitemap-source-note', sourceDateId: 'gsc-sitemaps', methodology: reportCopy(context.locale, 'notes.gscSitemaps') }));
            const finalVersion = await googleStoredVersion(db, 'google.gsc_sitemaps', context.accountId, context.target.siteId, binding.generation);
            assertStableGoogleVersion(sourceVersion, finalVersion);
            return { sourceVersion: finalVersion, document: googleDocument({ kind: 'google.gsc_sitemaps', catalogStem: 'googleGscSitemaps', locale: context.locale, site, branding: context.branding, selection: [{ label: reportCopy(context.locale, 'fields.status'), value: context.selection.status ?? reportCopy(context.locale, 'values.all') }], sourceDates: [source], representedItems: rows.length, blocks }) };
        },
        render: (context) => renderReportDocument(context),
    };
}
function generativeAdapter(db: GoogleReportDb): ReportExportAdapter<GenerativeSelection> {
    return {
        kind: 'google.gsc_generative_appearance', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: generativeSelectionSchema,
        async assertAccess(context) {
            if (context.target.scope !== 'site')
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            await assertGscStoredReadAccess(context.accountId, context.target.siteId);
            await assertGoogleVersion(db, 'google.gsc_generative_appearance', context);
        },
        async compose(context) {
            if (context.target.scope !== 'site')
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            const binding = await reportBinding(context.accountId, context.target.siteId, 'google.gsc_generative_appearance');
            const sourceVersion = await googleStoredVersion(db, 'google.gsc_generative_appearance', context.accountId, context.target.siteId, binding.generation);
            const site = await getSite(context.accountId, context.target.siteId);
            const read = buildGenerativeAppearanceRead(await readSearchAppearance(db, context.target.siteId, binding.property!, { windowDays: windowDays(context.selection.window), bindingGenerationId: binding.generation }));
            const rows = read.rows.filter((row) => !context.selection.classification || context.selection.classification.includes(row.classificationSlug));
            const source = read.window
                ? reportSourceDate({ id: 'gsc-generative', label: reportCopy(context.locale, 'sources.gscDerived'), kind: 'derived', from: read.window.start, to: read.window.end, sourceNoteKey: 'google.generative', lagDays: GSC_SEARCH_LAG_DAYS, freshness: read.observationMeta!.freshness === 'stale' ? 'stale' : 'unknown' })
                : reportSourceDate({ id: 'gsc-generative', label: reportCopy(context.locale, 'sources.snapshotState'), kind: 'derived', observedAt: site.updatedAt, sourceNoteKey: 'google.generative.empty', freshness: 'unknown' });
            const blocks: ReportBlockV1[] = [];
            if (!read.window)
                blocks.push({ type: 'state', id: 'generative-unavailable', state: 'unavailable', reason: reportCopy(context.locale, 'states.noGenerativeSnapshot'), sourceDateId: 'gsc-generative' });
            blocks.push(reportTable({ id: 'generative-appearance', columns: [
                    { key: 'appearance', label: reportCopy(context.locale, 'fields.appearance'), valueType: 'string' },
                    { key: 'classification', label: reportCopy(context.locale, 'fields.classification'), valueType: 'string' },
                    { key: 'generative', label: reportCopy(context.locale, 'fields.generative'), valueType: 'boolean' },
                    { key: 'clicks', label: reportCopy(context.locale, 'fields.clicks'), valueType: 'number' },
                    { key: 'impressions', label: reportCopy(context.locale, 'fields.impressions'), valueType: 'number' },
                    { key: 'ctr', label: reportCopy(context.locale, 'fields.ctr'), valueType: 'number', unit: '%' },
                    { key: 'position', label: reportCopy(context.locale, 'fields.position'), valueType: 'number' },
                ], rows: rows.map((row, index) => ({ id: `appearance-${index + 1}`, values: [row.rawAppearance, row.classificationSlug, row.isGenerative, row.clicks, row.impressions, row.ctr * 100, row.position], sourceDateId: 'gsc-generative' })) }));
            blocks.push(reportSourceNote({ id: 'generative-source-note', sourceDateId: 'gsc-generative', methodology: reportCopy(context.locale, 'notes.gscGenerative') }));
            const finalVersion = await googleStoredVersion(db, 'google.gsc_generative_appearance', context.accountId, context.target.siteId, binding.generation);
            assertStableGoogleVersion(sourceVersion, finalVersion);
            return { sourceVersion: finalVersion, document: googleDocument({ kind: 'google.gsc_generative_appearance', catalogStem: 'googleGscGenerativeAppearance', locale: context.locale, site, branding: context.branding, selection: [
                        { label: reportCopy(context.locale, 'fields.window'), value: context.selection.window },
                        { label: reportCopy(context.locale, 'fields.classification'), value: context.selection.classification?.join(', ') ?? reportCopy(context.locale, 'values.all') },
                    ], sourceDates: [source], representedItems: rows.length, blocks }) };
        },
        render: (context) => renderReportDocument(context),
    };
}
function ga4MetricColumns(locale: ReportLocale, firstKey: string) {
    return [
        { key: 'item', label: reportCopy(locale, firstKey), valueType: 'string' as const },
        { key: 'sessions', label: reportCopy(locale, 'fields.sessions'), valueType: 'number' as const },
        { key: 'users', label: reportCopy(locale, 'fields.activeUsers'), valueType: 'number' as const },
        { key: 'engaged', label: reportCopy(locale, 'fields.engagedSessions'), valueType: 'number' as const },
        { key: 'events', label: reportCopy(locale, 'fields.keyEvents'), valueType: 'number' as const },
    ];
}
function ga4Adapter(db: GoogleReportDb): ReportExportAdapter<Ga4Selection> {
    return {
        kind: 'google.ga4', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: ga4SelectionSchema,
        async assertAccess(context) {
            if (context.target.scope !== 'site')
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            await getSite(context.accountId, context.target.siteId);
            await assertGa4StoredReadAccess(context.accountId, context.target.siteId);
            await assertGoogleVersion(db, 'google.ga4', context);
        },
        async compose(context) {
            if (context.target.scope !== 'site')
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            const siteId = context.target.siteId;
            const binding = await reportBinding(context.accountId, siteId, 'google.ga4');
            const sourceVersion = await googleStoredVersion(db, 'google.ga4', context.accountId, siteId, binding.generation);
            const deps = ga4Deps(db, binding.generation);
            const [site, summary] = await Promise.all([
                getSite(context.accountId, siteId),
                getAnalyticsSummaryFor(context.accountId, siteId, context.selection.window, deps),
            ]);
            const dimensions = new Set(context.selection.dimensions);
            const detailNames = ['channel', 'page', 'country', 'device'] as const;
            const details = new Map<string, Awaited<ReturnType<typeof getAnalyticsDetailFor>>>();
            await Promise.all(detailNames.filter((dimension) => dimensions.has(dimension)).map(async (dimension) => {
                details.set(dimension, await getAnalyticsDetailFor(context.accountId, siteId, dimension, context.selection.window, deps));
            }));
            const blocks: ReportBlockV1[] = [];
            if (dimensions.has('summary')) {
                blocks.push({ type: 'kpi_group', id: 'ga4-summary', items: [
                        ['sessions', 'fields.sessions', summary.totalSessions, null],
                        ['users', 'fields.activeUsers', summary.totalActiveUsers, null],
                        ['engaged', 'fields.engagedSessions', summary.totalEngagedSessions, null],
                        ['events', 'fields.keyEvents', summary.totalKeyEvents, null],
                        ['rate', 'fields.engagementRate', summary.engagementRate * 100, '%'],
                    ].map(([id, key, value, unit]) => ({ id: String(id), label: reportCopy(context.locale, String(key)), value: { type: 'number' as const, value: Number(value) }, ...(unit ? { unit: String(unit) } : {}), sourceDateId: 'ga4-observation' })) });
            }
            for (const dimension of detailNames) {
                const detail = details.get(dimension);
                if (!detail)
                    continue;
                blocks.push(reportTable({ id: `ga4-${dimension}`, columns: ga4MetricColumns(context.locale, `fields.${dimension}`), rows: detail.rows.map((row, index) => ({ id: `${dimension}-${index + 1}`, values: [row.key, row.sessions, row.activeUsers, row.engagedSessions, row.keyEvents], sourceDateId: 'ga4-observation' })) }));
            }
            if (dimensions.has('date')) {
                const fallback = reportTable({ id: 'ga4-date-fallback', columns: ga4MetricColumns(context.locale, 'fields.date'), rows: summary.timeseries.map((row, index) => ({ id: `date-${index + 1}`, values: [row.date, row.sessions, row.activeUsers, row.engagedSessions, row.keyEvents], sourceDateId: 'ga4-observation' })) });
                blocks.push({ type: 'time_series', id: 'ga4-timeseries', series: [
                        { id: 'sessions', label: reportCopy(context.locale, 'fields.sessions'), sourceDateId: 'ga4-observation', points: summary.timeseries.map((row) => ({ timestamp: reportIsoDateTime(row.date), value: row.sessions })) },
                        { id: 'users', label: reportCopy(context.locale, 'fields.activeUsers'), sourceDateId: 'ga4-observation', points: summary.timeseries.map((row) => ({ timestamp: reportIsoDateTime(row.date), value: row.activeUsers })) },
                        { id: 'engaged', label: reportCopy(context.locale, 'fields.engagedSessions'), sourceDateId: 'ga4-observation', points: summary.timeseries.map((row) => ({ timestamp: reportIsoDateTime(row.date), value: row.engagedSessions })) },
                        { id: 'events', label: reportCopy(context.locale, 'fields.keyEvents'), sourceDateId: 'ga4-observation', points: summary.timeseries.map((row) => ({ timestamp: reportIsoDateTime(row.date), value: row.keyEvents })) },
                    ], tableFallback: { columns: fallback.columns, rows: fallback.rows } });
            }
            const days = windowDays(context.selection.window);
            const range = reportWindow(summary.asOf, days);
            const source = reportSourceDate({ id: 'ga4-observation', label: reportCopy(context.locale, 'sources.ga4Observation'), kind: 'first_party_observation', from: range.from, to: range.to, sourceNoteKey: 'google.ga4', lagDays: GA4_DEFAULT_LAG_DAYS, freshness: 'unknown' });
            blocks.push(reportSourceNote({ id: 'ga4-source-note', sourceDateId: 'ga4-observation', methodology: reportCopy(context.locale, 'notes.ga4Observation') }));
            const representedItems = [...details.values()].reduce((sum, detail) => sum + detail.rows.length, 0) + (dimensions.has('date') ? summary.timeseries.length : 0);
            const finalVersion = await googleStoredVersion(db, 'google.ga4', context.accountId, siteId, binding.generation);
            assertStableGoogleVersion(sourceVersion, finalVersion);
            return { sourceVersion: finalVersion, document: googleDocument({ kind: 'google.ga4', catalogStem: 'googleGa4', locale: context.locale, site, branding: context.branding, selection: [
                        { label: reportCopy(context.locale, 'fields.window'), value: context.selection.window },
                        { label: reportCopy(context.locale, 'fields.dimensions'), value: context.selection.dimensions.join(', ') },
                    ], sourceDates: [source], representedItems, blocks }) };
        },
        render: renderGoogleMetrics,
    };
}
export function createGoogleReportExportAdapters(db: GoogleReportDb): readonly ReportExportAdapter[] {
    return [gscSearchAdapter(db), sitemapAdapter(db), generativeAdapter(db), ga4Adapter(db)];
}
export const googleReportExportTestables = {
    gscSearchSelectionSchema,
    sitemapSelectionSchema,
    generativeSelectionSchema,
    ga4SelectionSchema,
    reportBinding,
    googleStoredVersion,
    assertGoogleVersion,
    windowDays,
    assertStableGoogleVersion,
    assertStoredGoogleSite,
    googleDocument,
    gscDeps,
    ga4Deps,
    metricsColumns,
    gscSource,
    sitemapStatus,
    ga4MetricColumns,
    googleCsvRows,
    renderGoogleMetrics,
};
