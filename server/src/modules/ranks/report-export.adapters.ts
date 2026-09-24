import { and, asc, count, eq, gte, inArray, lte, max } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type * as schema from '../../db/schema/index.js';
import { domainStates, keywords, rankings, RANK_ENGINES, SERP_DEVICES, serpObservations, type RankCheckFailureReason, } from '../../db/schema/index.js';
import { REPORT_DOCUMENT_SCHEMA, REPORT_DOCUMENT_SCHEMA_VERSION, renderReportDocument, reportCatalogCopy, reportCopy, reportSourceDate, reportSourceNote, reportSourceVersion, reportTable, stableReportJson, stableSortText, type ReportBlockV1, type ReportBrandingSnapshot, type ReportDocumentV1, type ReportLocale, } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { ReportExportAdapter } from '../report-exports/index.js';
import { getSite, type PublicSite } from '../sites/index.js';
/**
 * Localized one-line explanation for a stored failure reason. A null reason
 * yields a null cell — the export never invents a cause for a row stamped
 * before the reason was recorded.
 */
function failureReasonCopy(locale: ReportLocale, reason: RankCheckFailureReason | null): string | null {
    if (reason === null)
        return null;
    const key = {
        vendor_auth: 'values.failedAuth',
        vendor_quota: 'values.failedQuota',
        vendor_timeout: 'values.failedTimeout',
        vendor_unavailable: 'values.failedUnavailable',
        vendor_malformed: 'values.failedMalformed',
        vendor_error: 'values.failedOther',
    }[reason];
    return reportCopy(locale, key);
}
const currentSelectionSchema = z
    .object({
    active: z.boolean().default(true),
    engine: z.enum(RANK_ENGINES).optional(),
    device: z.enum(SERP_DEVICES).optional(),
    locationCode: z.number().int().positive().optional(),
    languageCode: z.string().min(2).max(20).optional(),
})
    .strict();
const historySelectionSchema = z
    .object({
    keywordIds: z.array(z.string().uuid()).min(1).max(25),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    engine: z.enum(RANK_ENGINES).optional(),
})
    .strict()
    .superRefine((value, context) => {
    if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'reportExports.errors.invalidSelection' });
    }
});
const serpSelectionSchema = z
    .object({
    keywordIds: z.array(z.string().uuid()).min(1).max(2000).optional(),
    latest: z.boolean().default(true),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    engine: z.enum(RANK_ENGINES).optional(),
    device: z.enum(SERP_DEVICES).optional(),
})
    .strict()
    .superRefine((value, context) => {
    if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'reportExports.errors.invalidSelection' });
    }
});
type CurrentSelection = z.infer<typeof currentSelectionSchema>;
type HistorySelection = z.infer<typeof historySelectionSchema>;
type SerpSelection = z.infer<typeof serpSelectionSchema>;
type Schema = typeof schema;
type ReportDb<TQueryResult extends PgQueryResultHKT> = PgDatabase<TQueryResult, Schema>;
async function rankSiteVersion<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>, accountId: string, siteId: string): Promise<string> {
    await getSite(accountId, siteId);
    const [keywordStamp, rankingStamp, serpStamp] = await Promise.all([
        db.select({ value: max(keywords.updatedAt), rows: count() }).from(keywords).where(and(eq(keywords.accountId, accountId), eq(keywords.siteId, siteId))),
        db.select({ value: max(rankings.checkedAt), rows: count() }).from(rankings).innerJoin(keywords, eq(rankings.keywordId, keywords.id)).where(and(eq(keywords.accountId, accountId), eq(keywords.siteId, siteId))),
        db.select({ value: max(serpObservations.checkedAt), rows: count() }).from(serpObservations).where(and(eq(serpObservations.accountId, accountId), eq(serpObservations.siteId, siteId))),
    ]);
    return reportSourceVersion('ranks', {
        siteId,
        keyword: keywordStamp[0]?.value?.toISOString() ?? null,
        keywordRows: keywordStamp[0]!.rows,
        ranking: rankingStamp[0]?.value?.toISOString() ?? null,
        rankingRows: rankingStamp[0]!.rows,
        serp: serpStamp[0]?.value?.toISOString() ?? null,
        serpRows: serpStamp[0]!.rows,
    });
}
async function assertRankAccess<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>, context: Parameters<ReportExportAdapter['assertAccess']>[0]): Promise<void> {
    if (context.target.scope !== 'site')
        throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
    const version = await rankSiteVersion(db, context.accountId, context.target.siteId);
    if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== version) {
        throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
    }
}
function rankSourceDates(locale: ReportLocale, timestamps: readonly string[], fallback: string): ReportDocumentV1['sourceDates'] {
    if (timestamps.length === 0) {
        return [reportSourceDate({
                id: 'rank-state',
                label: reportCopy(locale, 'sources.rankState'),
                kind: 'derived',
                observedAt: fallback,
                sourceNoteKey: 'ranks.state',
                freshness: 'unknown',
            })];
    }
    const ordered = [...timestamps].sort(stableSortText);
    return [reportSourceDate({
            id: 'rank-observation',
            label: reportCopy(locale, 'sources.rankObservation'),
            kind: 'provider_observation',
            from: ordered[0]!,
            to: ordered[ordered.length - 1]!,
            sourceNoteKey: 'ranks.observation',
            freshness: 'unknown',
        })];
}
function baseRankDocument(input: {
    kind: 'ranks.current' | 'ranks.history' | 'ranks.serp_features';
    catalogStem: 'ranksCurrent' | 'ranksHistory' | 'ranksSerpFeatures';
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
function standardRankRender(context: Parameters<ReportExportAdapter['render']>[0]) {
    return renderReportDocument({
        ...context,
        renderNative: async () => {
            throw new Error('native format unsupported');
        },
    });
}
function renderWideRankTable(context: Parameters<ReportExportAdapter['render']>[0], splitAt: number, coreId: string, evidenceId: string) {
    if (context.format !== 'pdf')
        return standardRankRender(context);
    const table = context.document.blocks.find((block) => block.type === 'table');
    if (!table)
        return standardRankRender(context);
    const remainingBlocks = context.document.blocks.filter((block) => block !== table);
    const coreTable = {
        ...table,
        id: coreId,
        columns: table.columns.slice(0, splitAt),
        rows: table.rows.map((row) => ({ ...row, cells: row.cells.slice(0, splitAt) })),
    };
    const evidenceTable = {
        ...table,
        id: evidenceId,
        columns: [table.columns[0]!, ...table.columns.slice(splitAt)],
        rows: table.rows.map((row) => ({ ...row, cells: [row.cells[0]!, ...row.cells.slice(splitAt)] })),
    };
    return standardRankRender({
        ...context,
        document: {
            ...context.document,
            blocks: [coreTable, evidenceTable, ...remainingBlocks],
        },
    });
}
function renderCurrentRankDocument(context: Parameters<ReportExportAdapter['render']>[0]) {
    return renderWideRankTable(context, 11, 'current-rankings-core', 'current-rank-evidence');
}
function renderHistoryRankDocument(context: Parameters<ReportExportAdapter['render']>[0]) {
    return renderWideRankTable(context, 9, 'rank-history-core', 'rank-history-evidence');
}
function renderSerpRankDocument(context: Parameters<ReportExportAdapter['render']>[0]) {
    if (context.format !== 'csv')
        return standardRankRender(context);
    const tables = context.document.blocks.filter((block) => block.type === 'table');
    const rows = tables.flatMap((table) => table.rows.map((row, rowIndex) => {
        const rowId = row.id ?? `${table.id}-row-${rowIndex + 1}`;
        return {
            id: `${table.id}-${rowId}`,
            values: [
                table.id,
                rowId,
                stableReportJson(Object.fromEntries(row.cells.map((cell) => [cell.columnKey, cell.value.value]))),
            ],
            sourceDateId: row.cells[0]!.sourceDateId!,
        };
    }));
    const projection = reportTable({
        id: 'serp-csv-projection',
        columns: [
            { key: 'section', label: reportCopy(context.document.locale, 'fields.type'), valueType: 'string' },
            { key: 'row', label: reportCopy(context.document.locale, 'fields.item'), valueType: 'string' },
            { key: 'data', label: reportCopy(context.document.locale, 'fields.details'), valueType: 'string' },
        ],
        rows,
    });
    return standardRankRender({
        ...context,
        document: {
            ...context.document,
            blocks: [projection, ...context.document.blocks.filter((block) => block.type !== 'table')],
        },
    });
}
interface CurrentRankRow {
    id: string;
    phrase: string;
    engine: string;
    engineTarget: string | null;
    device: string;
    locationCode: number;
    languageCode: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
    lastFailedCheckAt: Date | null;
    lastFailedReason: RankCheckFailureReason | null;
    cadence: string | null;
    observations: Array<{
        position: number | null;
        foundUrl: string | null;
        checkedAt: Date;
        source: string;
        aiOverviewPresent: boolean | null;
        aiCited: boolean | null;
        aiCitedUrl: string | null;
        observationMeta: unknown;
    }>;
}
async function readCurrentRows<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>, accountId: string, siteId: string, selection: CurrentSelection): Promise<CurrentRankRow[]> {
    const filters = [eq(keywords.accountId, accountId), eq(keywords.siteId, siteId), eq(keywords.active, selection.active)];
    if (selection.engine)
        filters.push(eq(keywords.engine, selection.engine));
    if (selection.device)
        filters.push(eq(keywords.device, selection.device));
    if (selection.locationCode)
        filters.push(eq(keywords.locationCode, selection.locationCode));
    if (selection.languageCode)
        filters.push(eq(keywords.languageCode, selection.languageCode));
    const keywordRows = await db.select({
        id: keywords.id,
        phrase: keywords.phrase,
        engine: keywords.engine,
        engineTarget: keywords.engineTarget,
        device: keywords.device,
        locationCode: keywords.locationCode,
        languageCode: keywords.languageCode,
        active: keywords.active,
        createdAt: keywords.createdAt,
        updatedAt: keywords.updatedAt,
        lastFailedCheckAt: keywords.lastFailedCheckAt,
        lastFailedReason: keywords.lastFailedReason,
        cadence: domainStates.cadence,
    }).from(keywords).leftJoin(domainStates, eq(domainStates.siteId, keywords.siteId)).where(and(...filters)).orderBy(asc(keywords.phrase), asc(keywords.createdAt), asc(keywords.id));
    if (keywordRows.length === 0)
        return [];
    const rankRows = await db.select({
        keywordId: rankings.keywordId,
        position: rankings.position,
        foundUrl: rankings.foundUrl,
        checkedAt: rankings.checkedAt,
        source: rankings.source,
        aiOverviewPresent: rankings.aiOverviewPresent,
        aiCited: rankings.aiCited,
        aiCitedUrl: rankings.aiCitedUrl,
        observationMeta: rankings.observationMeta,
    }).from(rankings).where(inArray(rankings.keywordId, keywordRows.map((row) => row.id))).orderBy(asc(rankings.keywordId), rankings.checkedAt);
    const byKeyword = new Map<string, CurrentRankRow['observations']>();
    for (const row of rankRows) {
        const bucket = byKeyword.get(row.keywordId) ?? [];
        bucket.push(row);
        if (bucket.length > 2)
            bucket.shift();
        byKeyword.set(row.keywordId, bucket);
    }
    return keywordRows.map((row) => ({ ...row, observations: byKeyword.get(row.id) ?? [] }));
}
function currentAdapter<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>): ReportExportAdapter<CurrentSelection> {
    return {
        kind: 'ranks.current', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: currentSelectionSchema,
        assertAccess: (context) => assertRankAccess(db, context),
        async compose(context) {
            if (context.target.scope !== 'site')
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            const sourceVersion = await rankSiteVersion(db, context.accountId, context.target.siteId);
            const [site, rows] = await Promise.all([
                getSite(context.accountId, context.target.siteId),
                readCurrentRows(db, context.accountId, context.target.siteId, context.selection),
            ]);
            const finalVersion = await rankSiteVersion(db, context.accountId, context.target.siteId);
            if (sourceVersion !== finalVersion)
                throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
            const timestamps = rows.flatMap((row) => row.observations.at(-1)?.checkedAt.toISOString() ?? []);
            const fallback = rows.map((row) => row.updatedAt.toISOString()).sort(stableSortText).at(-1) ?? site.updatedAt;
            const sourceDates = rankSourceDates(context.locale, timestamps, fallback);
            const sourceId = timestamps.length > 0 ? 'rank-observation' : 'rank-state';
            const currentRows = rows.map((row, index) => {
                const latest = row.observations.at(-1);
                const previous = row.observations.at(-2);
                const delta = latest?.position !== null && latest?.position !== undefined && previous?.position !== null && previous?.position !== undefined ? previous.position - latest.position : null;
                const status = !latest ? reportCopy(context.locale, 'values.unavailable') : latest.position === null ? reportCopy(context.locale, 'values.notRanked') : reportCopy(context.locale, 'values.observed');
                return { id: `rank-${index + 1}`, values: [row.phrase, row.engine, row.engineTarget, row.device, row.locationCode, row.languageCode, row.cadence ?? 'weekly', latest?.position ?? null, previous?.position ?? null, delta, status, latest?.foundUrl ?? null, latest?.checkedAt.toISOString() ?? null, latest?.source ?? null, latest?.aiOverviewPresent ?? null, latest?.aiCited ?? null, latest?.aiCitedUrl ?? null, row.lastFailedCheckAt?.toISOString() ?? null, failureReasonCopy(context.locale, row.lastFailedReason)], sourceDateId: sourceId };
            });
            const blocks: ReportBlockV1[] = [
                reportTable({
                    id: 'current-rankings',
                    columns: [
                        { key: 'keyword', label: reportCopy(context.locale, 'fields.keyword'), valueType: 'string' },
                        { key: 'engine', label: reportCopy(context.locale, 'fields.engine'), valueType: 'string' },
                        { key: 'target', label: reportCopy(context.locale, 'fields.engineTarget'), valueType: 'string' },
                        { key: 'device', label: reportCopy(context.locale, 'fields.device'), valueType: 'string' },
                        { key: 'location', label: reportCopy(context.locale, 'fields.location'), valueType: 'number' },
                        { key: 'language', label: reportCopy(context.locale, 'fields.language'), valueType: 'string' },
                        { key: 'cadence', label: reportCopy(context.locale, 'fields.cadence'), valueType: 'string' },
                        { key: 'position', label: reportCopy(context.locale, 'fields.position'), valueType: 'number' },
                        { key: 'previous', label: reportCopy(context.locale, 'fields.previousPosition'), valueType: 'number' },
                        { key: 'delta', label: reportCopy(context.locale, 'fields.delta'), valueType: 'number' },
                        { key: 'status', label: reportCopy(context.locale, 'fields.status'), valueType: 'string' },
                        { key: 'url', label: reportCopy(context.locale, 'fields.foundUrl'), valueType: 'string' },
                        { key: 'checked', label: reportCopy(context.locale, 'fields.checkedAt'), valueType: 'string' },
                        { key: 'source', label: reportCopy(context.locale, 'fields.source'), valueType: 'string' },
                        { key: 'ai-overview', label: reportCopy(context.locale, 'fields.aiOverview'), valueType: 'boolean' },
                        { key: 'ai-cited', label: reportCopy(context.locale, 'fields.aiCited'), valueType: 'boolean' },
                        { key: 'ai-url', label: reportCopy(context.locale, 'fields.aiCitedUrl'), valueType: 'string' },
                        { key: 'failed', label: reportCopy(context.locale, 'fields.lastFailedAt'), valueType: 'string' },
                        { key: 'failed-reason', label: reportCopy(context.locale, 'fields.lastFailedReason'), valueType: 'string' },
                    ],
                    rows: currentRows,
                }),
                reportSourceNote({ id: 'rank-source-note', sourceDateId: sourceId, methodology: reportCopy(context.locale, 'notes.rankObservation') }),
            ];
            return {
                sourceVersion: finalVersion,
                document: baseRankDocument({ kind: 'ranks.current', catalogStem: 'ranksCurrent', locale: context.locale, site, branding: context.branding, selection: [
                        { label: reportCopy(context.locale, 'fields.active'), value: String(context.selection.active) },
                        { label: reportCopy(context.locale, 'fields.engine'), value: context.selection.engine ?? reportCopy(context.locale, 'values.all') },
                        { label: reportCopy(context.locale, 'fields.device'), value: context.selection.device ?? reportCopy(context.locale, 'values.all') },
                    ], sourceDates, representedItems: rows.length, blocks }),
            };
        },
        render: renderCurrentRankDocument,
    };
}
async function readHistoryRows<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>, accountId: string, siteId: string, selection: HistorySelection) {
    const keywordFilters = [eq(keywords.accountId, accountId), eq(keywords.siteId, siteId), inArray(keywords.id, selection.keywordIds)];
    if (selection.engine)
        keywordFilters.push(eq(keywords.engine, selection.engine));
    const owned = await db.select({ id: keywords.id, phrase: keywords.phrase, engine: keywords.engine, device: keywords.device, locationCode: keywords.locationCode, languageCode: keywords.languageCode }).from(keywords).where(and(...keywordFilters));
    const allOwned = await db.select({ id: keywords.id }).from(keywords).where(and(eq(keywords.accountId, accountId), eq(keywords.siteId, siteId), inArray(keywords.id, selection.keywordIds)));
    if (allOwned.length !== selection.keywordIds.length)
        throw HttpError.notFound({ code: 'RANKS_ERRORS_KEYWORD_NOT_FOUND', messageKey: 'ranks.errors.keywordNotFound' });
    if (owned.length === 0)
        return { keywords: owned, rows: [] };
    const filters = [inArray(rankings.keywordId, owned.map((row) => row.id))];
    if (selection.from)
        filters.push(gte(rankings.checkedAt, new Date(selection.from)));
    if (selection.to)
        filters.push(lte(rankings.checkedAt, new Date(selection.to)));
    const rows = await db.select({ keywordId: rankings.keywordId, checkedAt: rankings.checkedAt, position: rankings.position, rankAbsolute: rankings.rankAbsolute, source: rankings.source, foundUrl: rankings.foundUrl, aiOverviewPresent: rankings.aiOverviewPresent, aiCited: rankings.aiCited, aiCitedUrl: rankings.aiCitedUrl, observationMeta: rankings.observationMeta }).from(rankings).where(and(...filters)).orderBy(asc(rankings.checkedAt), asc(rankings.id));
    const byId = new Map(owned.map((row) => [row.id, row]));
    return { keywords: owned, rows: rows.map((row) => ({ ...row, keyword: byId.get(row.keywordId)! })).sort((left, right) => stableSortText(left.keyword.phrase, right.keyword.phrase) || left.checkedAt.getTime() - right.checkedAt.getTime()) };
}
function historyAdapter<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>): ReportExportAdapter<HistorySelection> {
    return {
        kind: 'ranks.history', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: historySelectionSchema,
        assertAccess: (context) => assertRankAccess(db, context),
        async compose(context) {
            if (context.target.scope !== 'site')
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            const sourceVersion = await rankSiteVersion(db, context.accountId, context.target.siteId);
            const [site, result] = await Promise.all([getSite(context.accountId, context.target.siteId), readHistoryRows(db, context.accountId, context.target.siteId, context.selection)]);
            const finalVersion = await rankSiteVersion(db, context.accountId, context.target.siteId);
            if (sourceVersion !== finalVersion)
                throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
            const timestamps = result.rows.map((row) => row.checkedAt.toISOString());
            const fallback = context.selection.to ?? context.selection.from ?? site.updatedAt;
            const sourceDates = rankSourceDates(context.locale, timestamps, fallback);
            const sourceId = timestamps.length ? 'rank-observation' : 'rank-state';
            const blocks: ReportBlockV1[] = [];
            if (result.rows.length === 0)
                blocks.push({ type: 'state', id: 'history-empty', state: 'empty', reason: reportCopy(context.locale, 'states.noRankHistory'), sourceDateId: sourceId });
            blocks.push(reportTable({ id: 'rank-history', columns: [
                    { key: 'keyword', label: reportCopy(context.locale, 'fields.keyword'), valueType: 'string' },
                    { key: 'engine', label: reportCopy(context.locale, 'fields.engine'), valueType: 'string' },
                    { key: 'device', label: reportCopy(context.locale, 'fields.device'), valueType: 'string' },
                    { key: 'location', label: reportCopy(context.locale, 'fields.location'), valueType: 'number' },
                    { key: 'language', label: reportCopy(context.locale, 'fields.language'), valueType: 'string' },
                    { key: 'checked', label: reportCopy(context.locale, 'fields.checkedAt'), valueType: 'date' },
                    { key: 'position', label: reportCopy(context.locale, 'fields.position'), valueType: 'number' },
                    { key: 'absolute', label: reportCopy(context.locale, 'fields.absoluteRank'), valueType: 'number' },
                    { key: 'status', label: reportCopy(context.locale, 'fields.status'), valueType: 'string' },
                    { key: 'source', label: reportCopy(context.locale, 'fields.source'), valueType: 'string' },
                    { key: 'url', label: reportCopy(context.locale, 'fields.foundUrl'), valueType: 'string' },
                    { key: 'ai-overview', label: reportCopy(context.locale, 'fields.aiOverview'), valueType: 'boolean' },
                    { key: 'ai-cited', label: reportCopy(context.locale, 'fields.aiCited'), valueType: 'boolean' },
                    { key: 'ai-url', label: reportCopy(context.locale, 'fields.aiCitedUrl'), valueType: 'string' },
                ], rows: result.rows.map((row, index) => ({ id: `history-${index + 1}`, values: [row.keyword.phrase, row.keyword.engine, row.keyword.device, row.keyword.locationCode, row.keyword.languageCode, row.checkedAt, row.position, row.rankAbsolute, row.position === null ? reportCopy(context.locale, 'values.notRanked') : reportCopy(context.locale, 'values.observed'), row.source, row.foundUrl, row.aiOverviewPresent, row.aiCited, row.aiCitedUrl], sourceDateId: sourceId })) }));
            blocks.push(reportSourceNote({ id: 'history-source-note', sourceDateId: sourceId, methodology: reportCopy(context.locale, 'notes.rankObservation') }));
            return { sourceVersion: finalVersion, document: baseRankDocument({ kind: 'ranks.history', catalogStem: 'ranksHistory', locale: context.locale, site, branding: context.branding, selection: [
                        { label: reportCopy(context.locale, 'fields.keywords'), value: String(context.selection.keywordIds.length) },
                        { label: reportCopy(context.locale, 'fields.from'), value: context.selection.from ?? reportCopy(context.locale, 'values.retainedWindow') },
                        { label: reportCopy(context.locale, 'fields.to'), value: context.selection.to ?? reportCopy(context.locale, 'values.latest') },
                        { label: reportCopy(context.locale, 'fields.engine'), value: context.selection.engine ?? reportCopy(context.locale, 'values.all') },
                    ], sourceDates, representedItems: result.rows.length, blocks }) };
        },
        render: renderHistoryRankDocument,
    };
}
async function readSerpRows<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>, accountId: string, siteId: string, selection: SerpSelection) {
    const keywordFilters = [eq(keywords.accountId, accountId), eq(keywords.siteId, siteId), eq(keywords.active, true)];
    if (selection.keywordIds)
        keywordFilters.push(inArray(keywords.id, selection.keywordIds));
    if (selection.engine)
        keywordFilters.push(eq(keywords.engine, selection.engine));
    if (selection.device)
        keywordFilters.push(eq(keywords.device, selection.device));
    const keywordRows = await db.select({ id: keywords.id, phrase: keywords.phrase, engine: keywords.engine, device: keywords.device }).from(keywords).where(and(...keywordFilters)).orderBy(asc(keywords.phrase), asc(keywords.id));
    if (selection.keywordIds) {
        const owned = await db.select({ id: keywords.id }).from(keywords).where(and(eq(keywords.accountId, accountId), eq(keywords.siteId, siteId), inArray(keywords.id, selection.keywordIds)));
        if (owned.length !== selection.keywordIds.length)
            throw HttpError.notFound({ code: 'RANKS_ERRORS_KEYWORD_NOT_FOUND', messageKey: 'ranks.errors.keywordNotFound' });
    }
    if (keywordRows.length === 0)
        return { keywords: keywordRows, observations: [] };
    const filters = [eq(serpObservations.accountId, accountId), eq(serpObservations.siteId, siteId), inArray(serpObservations.keywordId, keywordRows.map((row) => row.id))];
    if (selection.engine)
        filters.push(eq(serpObservations.engine, selection.engine));
    if (selection.from)
        filters.push(gte(serpObservations.checkedAt, new Date(selection.from)));
    if (selection.to)
        filters.push(lte(serpObservations.checkedAt, new Date(selection.to)));
    const observations = await db.select().from(serpObservations).where(and(...filters)).orderBy(asc(serpObservations.checkedAt), asc(serpObservations.id));
    if (!selection.latest)
        return { keywords: keywordRows, observations };
    const latest = new Map<string, (typeof observations)[number]>();
    for (const row of observations)
        latest.set(row.keywordId, row);
    return { keywords: keywordRows, observations: [...latest.values()] };
}
function compareSerpObservationRows(left: {
    keyword: {
        phrase: string;
    };
    observation: {
        checkedAt: Date;
    } | null;
}, right: {
    keyword: {
        phrase: string;
    };
    observation: {
        checkedAt: Date;
    } | null;
}): number {
    return stableSortText(left.keyword.phrase, right.keyword.phrase)
        || (left.observation?.checkedAt.getTime() ?? 0) - (right.observation?.checkedAt.getTime() ?? 0);
}
function serpAdapter<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>): ReportExportAdapter<SerpSelection> {
    return {
        kind: 'ranks.serp_features', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: serpSelectionSchema,
        assertAccess: (context) => assertRankAccess(db, context),
        async compose(context) {
            if (context.target.scope !== 'site')
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            const sourceVersion = await rankSiteVersion(db, context.accountId, context.target.siteId);
            const [site, result] = await Promise.all([getSite(context.accountId, context.target.siteId), readSerpRows(db, context.accountId, context.target.siteId, context.selection)]);
            const finalVersion = await rankSiteVersion(db, context.accountId, context.target.siteId);
            if (sourceVersion !== finalVersion)
                throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
            const keywordById = new Map(result.keywords.map((row) => [row.id, row]));
            const observationByKeyword = new Map(result.observations.map((row) => [row.keywordId, row]));
            const timestamps = result.observations.map((row) => row.checkedAt.toISOString());
            const sourceDates = rankSourceDates(context.locale, timestamps, context.selection.to ?? context.selection.from ?? site.updatedAt);
            const sourceId = timestamps.length ? 'rank-observation' : 'rank-state';
            const observationRows = context.selection.latest
                ? result.keywords.map((keyword) => ({ keyword, observation: observationByKeyword.get(keyword.id) ?? null }))
                : result.observations.map((observation) => ({ keyword: keywordById.get(observation.keywordId)!, observation }));
            observationRows.sort(compareSerpObservationRows);
            const blocks: ReportBlockV1[] = [reportTable({ id: 'serp-observations', columns: [
                        { key: 'keyword', label: reportCopy(context.locale, 'fields.keyword'), valueType: 'string' },
                        { key: 'engine', label: reportCopy(context.locale, 'fields.engine'), valueType: 'string' },
                        { key: 'device', label: reportCopy(context.locale, 'fields.device'), valueType: 'string' },
                        { key: 'observed', label: reportCopy(context.locale, 'fields.checkedAt'), valueType: 'string' },
                        { key: 'status', label: reportCopy(context.locale, 'fields.status'), valueType: 'string' },
                        { key: 'source', label: reportCopy(context.locale, 'fields.source'), valueType: 'string' },
                        { key: 'features', label: reportCopy(context.locale, 'fields.features'), valueType: 'string' },
                        { key: 'snippet-domain', label: reportCopy(context.locale, 'fields.snippetDomain'), valueType: 'string' },
                        { key: 'snippet-url', label: reportCopy(context.locale, 'fields.snippetUrl'), valueType: 'string' },
                        { key: 'paa-count', label: reportCopy(context.locale, 'fields.paaCount'), valueType: 'number' },
                        { key: 'top-count', label: reportCopy(context.locale, 'fields.topResultCount'), valueType: 'number' },
                    ], rows: observationRows.map(({ keyword, observation }, index) => ({ id: `serp-${index + 1}`, values: [keyword.phrase, observation?.engine ?? keyword.engine, keyword.device, observation?.checkedAt.toISOString() ?? null, observation ? reportCopy(context.locale, 'values.observed') : reportCopy(context.locale, 'values.notObserved'), observation?.source ?? null, observation?.features.features.map((feature) => feature.type).join(', ') ?? '', observation?.features.featuredSnippet?.domain ?? null, observation?.features.featuredSnippet?.url ?? null, observation?.features.paa.length ?? 0, observation?.topResults.length ?? 0], sourceDateId: sourceId })) })];
            const paaRows = result.observations.flatMap((observation) => observation.features.paa.map((row) => ({ observation, row }))).sort((left, right) => left.observation.checkedAt.getTime() - right.observation.checkedAt.getTime() || stableSortText(left.row.question, right.row.question));
            if (paaRows.length)
                blocks.push(reportTable({ id: 'serp-paa', columns: [
                        { key: 'keyword', label: reportCopy(context.locale, 'fields.keyword'), valueType: 'string' },
                        { key: 'observed', label: reportCopy(context.locale, 'fields.checkedAt'), valueType: 'date' },
                        { key: 'question', label: reportCopy(context.locale, 'fields.question'), valueType: 'string' },
                        { key: 'domain', label: reportCopy(context.locale, 'fields.answerDomain'), valueType: 'string' },
                        { key: 'url', label: reportCopy(context.locale, 'fields.answerUrl'), valueType: 'string' },
                    ], rows: paaRows.map(({ observation, row }, index) => ({ id: `paa-${index + 1}`, values: [keywordById.get(observation.keywordId)!.phrase, observation.checkedAt, row.question, row.answerDomain, row.answerUrl], sourceDateId: sourceId })) }));
            const topRows = result.observations.flatMap((observation) => observation.topResults.map((row) => ({ observation, row }))).sort((left, right) => left.observation.checkedAt.getTime() - right.observation.checkedAt.getTime() || left.row.rankAbsolute - right.row.rankAbsolute || stableSortText(left.row.url, right.row.url));
            if (topRows.length)
                blocks.push(reportTable({ id: 'serp-top-results', columns: [
                        { key: 'keyword', label: reportCopy(context.locale, 'fields.keyword'), valueType: 'string' },
                        { key: 'observed', label: reportCopy(context.locale, 'fields.checkedAt'), valueType: 'date' },
                        { key: 'rank', label: reportCopy(context.locale, 'fields.absoluteRank'), valueType: 'number' },
                        { key: 'domain', label: reportCopy(context.locale, 'fields.domain'), valueType: 'string' },
                        { key: 'url', label: reportCopy(context.locale, 'fields.url'), valueType: 'url' },
                    ], rows: topRows.map(({ observation, row }, index) => ({ id: `top-${index + 1}`, values: [keywordById.get(observation.keywordId)!.phrase, observation.checkedAt, row.rankAbsolute, row.domain, row.url], sourceDateId: sourceId })) }));
            blocks.push(reportSourceNote({ id: 'serp-source-note', sourceDateId: sourceId, methodology: reportCopy(context.locale, 'notes.serpObservation'), coverageWarning: reportCopy(context.locale, 'notes.serpCoverage') }));
            const representedItems = observationRows.length + paaRows.length + topRows.length;
            return { sourceVersion: finalVersion, document: baseRankDocument({ kind: 'ranks.serp_features', catalogStem: 'ranksSerpFeatures', locale: context.locale, site, branding: context.branding, selection: [
                        { label: reportCopy(context.locale, 'fields.keywords'), value: String(context.selection.keywordIds?.length ?? result.keywords.length) },
                        { label: reportCopy(context.locale, 'fields.window'), value: context.selection.latest ? reportCopy(context.locale, 'values.latest') : `${context.selection.from ?? reportCopy(context.locale, 'values.retainedWindow')} – ${context.selection.to ?? reportCopy(context.locale, 'values.latest')}` },
                        { label: reportCopy(context.locale, 'fields.engine'), value: context.selection.engine ?? reportCopy(context.locale, 'values.all') },
                        { label: reportCopy(context.locale, 'fields.device'), value: context.selection.device ?? reportCopy(context.locale, 'values.all') },
                    ], sourceDates, representedItems, blocks }) };
        },
        render: renderSerpRankDocument,
    };
}
export function createRankReportExportAdapters<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>): readonly ReportExportAdapter[] {
    return [currentAdapter(db), historyAdapter(db), serpAdapter(db)];
}
export const rankReportExportTestables = {
    failureReasonCopy,
    rankSiteVersion,
    assertRankAccess,
    rankSourceDates,
    baseRankDocument,
    readCurrentRows,
    readHistoryRows,
    readSerpRows,
    compareSerpObservationRows,
    standardRankRender,
    renderWideRankTable,
    renderCurrentRankDocument,
    renderHistoryRankDocument,
    renderSerpRankDocument,
};
