import { and, desc, eq, inArray, lte } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type * as schema from '../../db/schema/index.js';
import { keywordClusterDecisionEvents, keywordResearchHistory, vendorResponses, } from '../../db/schema/index.js';
import { REPORT_DOCUMENT_SCHEMA, REPORT_DOCUMENT_SCHEMA_VERSION, renderReportDocument, reportCatalogCopy, reportCopy, reportSourceDate, reportSourceNote, reportSourceVersion, reportTable, stableReportJson, stableSortText, type ReportBlockV1, type ReportBrandingSnapshot, type ReportDocumentV1, type ReportLocale, type ReportTableCellInput, type ReportTableRowInput, } from '../../shared/report-exports/index.js';
import { computeVendorCacheKey } from '../../shared/vendor-cache/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { ReportExportAdapter } from '../report-exports/index.js';
import { computeGapCacheKey, computeKeywordCacheKey, } from './keyword-research.cache.js';
import { findClusterRunForAccount, } from './keyword-research.clustering.js';
import { findTrendsRun, normalizeTrendsExploreInputs, serializeStoredRun, } from './keyword-research.service.js';
const researchOperations = [
    'metrics',
    'related',
    'intent',
    'ideas',
    'long_tail',
    'gap',
    'overview',
    'trends',
] as const;
const researchSelectionSchema = z
    .object({
    operation: z.enum(researchOperations).optional(),
    keyword: z.string().trim().min(1).max(80).optional(),
    competitor: z.string().trim().min(1).max(253).optional(),
})
    .strict();
const trendsSelectionSchema = z
    .object({
    phrases: z.array(z.string().trim().min(1).max(200)).min(1).max(5).optional(),
    relatedType: z.enum(['rising', 'top']).optional(),
})
    .strict();
const aiClusterSelectionSchema = z
    .object({
    decision: z.enum(['all', 'accepted', 'dismissed', 'undecided']).default('all'),
})
    .strict();
type ResearchSelection = z.infer<typeof researchSelectionSchema>;
type TrendsSelection = z.infer<typeof trendsSelectionSchema>;
type AiClusterSelection = z.infer<typeof aiClusterSelectionSchema>;
type Schema = typeof schema;
type ReportDb<TQueryResult extends PgQueryResultHKT> = PgDatabase<TQueryResult, Schema>;
interface StoredHistory {
    id: string;
    kind: (typeof researchOperations)[number];
    phrases: string[];
    locationCode: number;
    languageCode: string;
    resultCount: number;
    cached: boolean;
    createdAt: Date;
}
interface ArchivedPayload {
    cacheKey: string;
    payload: unknown;
    fetchedAt: Date;
}
interface RecordValue {
    [key: string]: unknown;
}
function record(value: unknown): RecordValue | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as RecordValue)
        : null;
}
function strings(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
}
function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}
function boundedListLabel(values: readonly string[]): string {
    const ordered = [...values].sort(stableSortText);
    const full = ordered.join(', ');
    return full.length <= 900 ? full : `${ordered.length}; ${reportSourceVersion('selection', ordered)}`;
}
async function loadHistory<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>, accountId: string, resourceId: string): Promise<StoredHistory> {
    const rows = await db
        .select()
        .from(keywordResearchHistory)
        .where(and(eq(keywordResearchHistory.id, resourceId), eq(keywordResearchHistory.accountId, accountId)))
        .limit(1);
    const row = rows[0];
    if (!row || row.kind === 'clusters') {
        throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
    }
    return row as StoredHistory;
}
function historyCacheKeys(history: StoredHistory): string[] {
    if (history.kind === 'gap')
        return [];
    return history.phrases.map((phrase) => computeKeywordCacheKey({
        phrase,
        locationCode: history.locationCode,
        languageCode: history.languageCode,
    }));
}
async function readHistoryArchive<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>, history: StoredHistory): Promise<ArchivedPayload[]> {
    const keys = historyCacheKeys(history);
    const filters = [
        eq(vendorResponses.capability, 'keyword' as const),
        eq(vendorResponses.operation, history.kind),
        lte(vendorResponses.fetchedAt, history.createdAt),
    ];
    if (keys.length > 0)
        filters.push(inArray(vendorResponses.cacheKey, keys));
    const rows = await db
        .select({
        cacheKey: vendorResponses.cacheKey,
        payload: vendorResponses.payload,
        params: vendorResponses.params,
        fetchedAt: vendorResponses.fetchedAt,
    })
        .from(vendorResponses)
        .where(and(...filters))
        .orderBy(desc(vendorResponses.fetchedAt), desc(vendorResponses.id));
    const wanted = new Set(keys);
    const seen = new Set<string>();
    const output: ArchivedPayload[] = [];
    for (const row of rows) {
        const payload = record(row.payload);
        const params = record(row.params);
        if (!payload || !params)
            continue;
        if (history.kind === 'gap') {
            const competitor = stringOrNull(payload.competitorDomain);
            const location = numberOrNull(params.locationCode);
            const language = stringOrNull(params.languageCode)?.toLowerCase();
            if (!competitor ||
                !history.phrases.includes(competitor) ||
                location !== history.locationCode ||
                language !== history.languageCode.toLowerCase())
                continue;
            const key = computeGapCacheKey({
                ownDomain: stringOrNull(payload.ownDomain) ?? '',
                competitorDomain: competitor,
                locationCode: history.locationCode,
                languageCode: history.languageCode,
            });
            if (seen.has(key))
                continue;
            seen.add(key);
            output.push({ cacheKey: key, payload: row.payload, fetchedAt: row.fetchedAt });
            continue;
        }
        if (!wanted.has(row.cacheKey) || seen.has(row.cacheKey))
            continue;
        seen.add(row.cacheKey);
        output.push({ cacheKey: row.cacheKey, payload: row.payload, fetchedAt: row.fetchedAt });
    }
    return output.sort((left, right) => stableSortText(left.cacheKey, right.cacheKey));
}
const researchColumns = [
    'operation',
    'keyword',
    'relatedKeyword',
    'ownDomain',
    'competitor',
    'url',
    'rowClass',
    'searchVolume',
    'difficulty',
    'cpc',
    'intent',
    'confidence',
    'position',
    'trend',
    'details',
    'cached',
] as const;
function researchRow(operation: StoredHistory['kind'], values: Partial<Record<(typeof researchColumns)[number], ReportTableCellInput>>, sourceDateIds: readonly (string | undefined)[]): ReportTableRowInput {
    return {
        values: researchColumns.map((key) => values[key] ?? null),
        sourceDateIds,
    };
}
function monthlyDetails(value: unknown): string {
    if (!Array.isArray(value))
        return '';
    return value
        .flatMap((item) => {
        const row = record(item);
        const year = numberOrNull(row?.year);
        const month = numberOrNull(row?.month);
        const volume = numberOrNull(row?.searchVolume ?? row?.value);
        return year && month && volume !== null
            ? [`${year}-${String(month).padStart(2, '0')}:${volume}`]
            : [];
    })
        .join(', ');
}
function researchRows(history: StoredHistory, archived: readonly ArchivedPayload[], selection: ResearchSelection): ReportTableRowInput[] {
    const rows: ReportTableRowInput[] = [];
    const obs = researchColumns.map(() => 'keyword-observation');
    const mixed = researchColumns.map((key) => ['searchVolume', 'difficulty', 'cpc', 'trend'].includes(key)
        ? 'keyword-estimate'
        : 'keyword-observation');
    for (const archive of archived) {
        const payload = record(archive.payload);
        if (!payload)
            continue;
        const phrase = stringOrNull(payload.phrase) ?? history.phrases[0] ?? '';
        if (selection.keyword && phrase !== selection.keyword)
            continue;
        const base = { operation: history.kind, keyword: phrase, cached: history.cached };
        if (history.kind === 'metrics' || history.kind === 'overview') {
            rows.push(researchRow(history.kind, {
                ...base,
                searchVolume: numberOrNull(payload.searchVolume),
                difficulty: numberOrNull(payload.difficulty),
                cpc: stringOrNull(payload.cpc) ?? (numberOrNull(payload.cpcMicros) === null ? null : String(numberOrNull(payload.cpcMicros)! / 1000000)),
                intent: stringOrNull(payload.intent),
                details: strings(payload.serpFeatures).join(', ') || monthlyDetails(payload.monthlySearches),
            }, mixed));
        }
        else if (history.kind === 'intent') {
            rows.push(researchRow(history.kind, {
                ...base,
                intent: stringOrNull(payload.intent),
                confidence: numberOrNull(payload.confidence),
            }, obs));
        }
        else if (history.kind === 'trends') {
            const points = Array.isArray(payload.monthlySearches) ? payload.monthlySearches : [];
            for (const pointValue of points) {
                const point = record(pointValue);
                const year = numberOrNull(point?.year);
                const month = numberOrNull(point?.month);
                rows.push(researchRow(history.kind, {
                    ...base,
                    trend: numberOrNull(point?.searchVolume),
                    details: year && month ? `${year}-${String(month).padStart(2, '0')}` : '',
                }, mixed));
            }
        }
        else if (history.kind === 'related' ||
            history.kind === 'ideas' ||
            history.kind === 'long_tail') {
            const values = Array.isArray(payload.related)
                ? payload.related
                : Array.isArray(payload.ideas)
                    ? payload.ideas
                    : Array.isArray(payload.suggestions)
                        ? payload.suggestions
                        : [];
            for (const value of values) {
                const item = record(value);
                if (!item)
                    continue;
                const relatedKeyword = stringOrNull(item.keyword) ?? '';
                if (selection.keyword && relatedKeyword !== selection.keyword)
                    continue;
                rows.push(researchRow(history.kind, {
                    ...base,
                    relatedKeyword,
                    searchVolume: numberOrNull(item.searchVolume),
                    difficulty: numberOrNull(item.difficulty),
                    cpc: stringOrNull(item.cpc) ?? (numberOrNull(item.cpcMicros) === null ? null : String(numberOrNull(item.cpcMicros)! / 1000000)),
                    details: monthlyDetails(item.monthlySearches),
                }, mixed));
            }
        }
        else {
            const ownDomain = stringOrNull(payload.ownDomain) ?? '';
            const competitor = stringOrNull(payload.competitorDomain) ?? '';
            if (selection.competitor && competitor !== selection.competitor)
                continue;
            const values = Array.isArray(payload.rows) ? payload.rows : [];
            for (const value of values) {
                const item = record(value);
                if (!item)
                    continue;
                rows.push(researchRow(history.kind, {
                    ...base,
                    keyword: stringOrNull(item.keyword) ?? '',
                    ownDomain,
                    competitor,
                    url: stringOrNull(item.target2Url),
                    rowClass: stringOrNull(item.class),
                    searchVolume: numberOrNull(item.searchVolume),
                    position: numberOrNull(item.target2Position),
                    details: stringOrNull(record(item.provenance)?.cache) ?? '',
                }, mixed));
            }
        }
    }
    return rows;
}
function baseDocument(input: {
    kind: 'keyword.research_result' | 'keyword.trends_run' | 'keyword.ai_cluster_run';
    stem: 'keywordResearchResult' | 'keywordTrendsRun' | 'keywordAiClusterRun';
    locale: ReportLocale;
    branding: ReportBrandingSnapshot;
    subject: ReportDocumentV1['subject'];
    selection: ReportDocumentV1['selection'];
    sourceDates: ReportDocumentV1['sourceDates'];
    rows: readonly ReportTableRowInput[];
    columns: Parameters<typeof reportTable>[0]['columns'];
    blocks?: ReportBlockV1[];
}): ReportDocumentV1 {
    return {
        schema: REPORT_DOCUMENT_SCHEMA,
        schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
        kind: input.kind,
        kindVersion: 1,
        locale: input.locale,
        title: reportCatalogCopy(input.locale, input.stem, 'title'),
        subject: input.subject,
        selection: input.selection,
        sourceDates: input.sourceDates,
        completeness: {
            state: 'complete',
            selectedItems: input.rows.length,
            representedItems: input.rows.length,
            bound: reportCatalogCopy(input.locale, input.stem, 'bound'),
        },
        branding: input.branding,
        blocks: [reportTable({ id: 'report-data', columns: input.columns, rows: input.rows }), ...(input.blocks ?? [])],
        artifacts: [],
    };
}
function standardRender(context: Parameters<ReportExportAdapter['render']>[0]) {
    return renderReportDocument({
        ...context,
        renderNative: async () => {
            throw new Error('native format unsupported');
        },
    });
}
function researchAdapter<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>): ReportExportAdapter<ResearchSelection> {
    async function version(accountId: string, resourceId: string) {
        const history = await loadHistory(db, accountId, resourceId);
        const archive = await readHistoryArchive(db, history);
        return reportSourceVersion('keyword-research', { history, archive });
    }
    return {
        kind: 'keyword.research_result',
        kindVersion: 1,
        supportedFormats: ['pdf', 'csv', 'json'],
        selectionSchema: researchSelectionSchema,
        async assertAccess(context) {
            if (context.target.scope !== 'account_resource' || context.target.siteId !== undefined)
                throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
            const current = await version(context.accountId, context.target.resourceId);
            if (context.purpose === 'persist' && context.sourceVersion && current !== context.sourceVersion) {
                throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
            }
        },
        async compose(context) {
            if (context.target.scope !== 'account_resource' || context.target.siteId !== undefined)
                throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
            const history = await loadHistory(db, context.accountId, context.target.resourceId);
            if (context.selection.operation && context.selection.operation !== history.kind) {
                throw HttpError.badRequest({ code: 'REPORT_EXPORTS_ERRORS_INVALID_SELECTION', messageKey: 'reportExports.errors.invalidSelection' });
            }
            const archive = await readHistoryArchive(db, history);
            const rows = researchRows(history, archive, context.selection).map((row) => ({
                ...row,
                values: [
                    row.values[0]!,
                    row.values[1]!,
                    row.values[2] ?? null,
                    row.values[5] ?? null,
                    stableReportJson({ searchVolume: row.values[7] ?? null, difficulty: row.values[8] ?? null, cpc: row.values[9] ?? null, position: row.values[12] ?? null, trend: row.values[13] ?? null }),
                    row.values[10] ?? null,
                    stableReportJson({ ownDomain: row.values[3] ?? null, competitor: row.values[4] ?? null, rowClass: row.values[6] ?? null, confidence: row.values[11] ?? null, details: row.values[14] ?? null }),
                    row.values[15]!,
                ],
                sourceDateIds: [row.sourceDateIds?.[0], row.sourceDateIds?.[1], row.sourceDateIds?.[2], row.sourceDateIds?.[5], row.sourceDateIds?.[7], row.sourceDateIds?.[10], row.sourceDateIds?.[11], row.sourceDateIds?.[15]],
            }));
            const observed = archive.map((item) => item.fetchedAt.toISOString()).sort(stableSortText);
            const from = observed[0] ?? history.createdAt.toISOString();
            const to = observed.at(-1) ?? history.createdAt.toISOString();
            const sourceDates = [
                reportSourceDate({ id: 'keyword-observation', label: reportCopy(context.locale, 'sources.keywordObservation'), kind: 'provider_observation', from, to, sourceNoteKey: 'keyword.observation', freshness: history.cached ? 'cached' : 'fresh' }),
                reportSourceDate({ id: 'keyword-estimate', label: reportCopy(context.locale, 'sources.keywordEstimate'), kind: 'estimate', from, to, sourceNoteKey: 'keyword.estimate', freshness: history.cached ? 'cached' : 'fresh' }),
            ];
            const document = baseDocument({
                kind: 'keyword.research_result', stem: 'keywordResearchResult', locale: context.locale, branding: context.branding,
                subject: [{ label: reportCopy(context.locale, 'fields.keywords'), value: boundedListLabel(history.phrases) }],
                selection: [
                    { label: reportCopy(context.locale, 'fields.type'), value: history.kind },
                    { label: reportCopy(context.locale, 'fields.location'), value: String(history.locationCode) },
                    { label: reportCopy(context.locale, 'fields.language'), value: history.languageCode },
                ],
                sourceDates,
                rows,
                columns: [
                    { key: 'operation', label: reportCopy(context.locale, 'fields.operation'), valueType: 'string' },
                    { key: 'keyword', label: reportCopy(context.locale, 'fields.keyword'), valueType: 'string' },
                    { key: 'item', label: reportCopy(context.locale, 'fields.item'), valueType: 'string' },
                    { key: 'url', label: reportCopy(context.locale, 'fields.url'), valueType: 'url' },
                    { key: 'metrics', label: reportCopy(context.locale, 'fields.metric'), valueType: 'string' },
                    { key: 'intent', label: reportCopy(context.locale, 'fields.intent'), valueType: 'string' },
                    { key: 'evidence', label: reportCopy(context.locale, 'fields.details'), valueType: 'string' },
                    { key: 'cached', label: reportCopy(context.locale, 'fields.cached'), valueType: 'boolean' },
                ],
                blocks: [reportSourceNote({ id: 'keyword-note', sourceDateId: 'keyword-estimate', methodology: reportCopy(context.locale, 'notes.keywordResearch') })],
            });
            return { sourceVersion: reportSourceVersion('keyword-research', { history, archive }), document };
        },
        render: standardRender,
    };
}
interface TrendsArchiveValue {
    payload: RecordValue | null;
    fetchedAt: Date | null;
}
async function loadTrendsArchive<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>, run: Awaited<ReturnType<typeof findTrendsRun>>): Promise<TrendsArchiveValue> {
    if (!run)
        return { payload: null, fetchedAt: null };
    const inputs = serializeStoredRun(run).inputs as {
        keywords: string[];
        geo: string | null;
        language: string | null;
    };
    const normalized = normalizeTrendsExploreInputs({ keywords: inputs.keywords, geo: inputs.geo ?? undefined, language: inputs.language ?? undefined });
    const params = { keywords: normalized.keywords, geo: normalized.geo, language: normalized.language };
    const cacheKey = computeVendorCacheKey({ capability: 'keyword', operation: 'trends_live', params });
    const cutoff = run.completedAt ?? (run.get('createdAt') as Date);
    const rows = await db.select({ payload: vendorResponses.payload, fetchedAt: vendorResponses.fetchedAt }).from(vendorResponses).where(and(eq(vendorResponses.capability, 'keyword'), eq(vendorResponses.operation, 'trends_live'), eq(vendorResponses.cacheKey, cacheKey), lte(vendorResponses.fetchedAt, cutoff))).orderBy(desc(vendorResponses.fetchedAt), desc(vendorResponses.id));
    for (const row of rows) {
        const payload = record(row.payload);
        if (payload && Array.isArray(payload.series) && Array.isArray(payload.relatedQueries))
            return { payload, fetchedAt: row.fetchedAt };
    }
    return { payload: null, fetchedAt: null };
}
function trendsAdapter<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>): ReportExportAdapter<TrendsSelection> {
    async function load(accountId: string, resourceId: string) {
        const run = await findTrendsRun({ accountId, runId: resourceId });
        if (!run)
            throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
        const archive = await loadTrendsArchive(db, run);
        return { run, archive };
    }
    return {
        kind: 'keyword.trends_run', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: trendsSelectionSchema,
        async assertAccess(context) {
            if (context.target.scope !== 'account_resource')
                throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
            const loaded = await load(context.accountId, context.target.resourceId);
            const runSiteId = serializeStoredRun(loaded.run).siteId;
            if (context.target.siteId !== undefined && context.target.siteId !== runSiteId)
                throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
            const current = reportSourceVersion('keyword-trends', { run: serializeStoredRun(loaded.run), archive: loaded.archive });
            if (context.purpose === 'persist' && context.sourceVersion && current !== context.sourceVersion)
                throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
        },
        async compose(context) {
            if (context.target.scope !== 'account_resource')
                throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
            const { run, archive } = await load(context.accountId, context.target.resourceId);
            const stored = serializeStoredRun(run);
            if (context.target.siteId !== undefined && context.target.siteId !== stored.siteId)
                throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
            const inputs = stored.inputs as {
                keywords: string[];
                geo: string | null;
                language: string | null;
            };
            const selected = new Set(context.selection.phrases ?? inputs.keywords);
            if ([...selected].some((phrase) => !inputs.keywords.includes(phrase)))
                throw HttpError.badRequest({ code: 'REPORT_EXPORTS_ERRORS_INVALID_SELECTION', messageKey: 'reportExports.errors.invalidSelection' });
            const payload = archive.payload;
            const rows: ReportTableRowInput[] = [];
            for (const seriesValue of Array.isArray(payload?.series) ? payload.series : []) {
                const series = record(seriesValue);
                const phrase = stringOrNull(series?.keyword) ?? '';
                if (!selected.has(phrase))
                    continue;
                for (const pointValue of Array.isArray(series?.points) ? series.points : []) {
                    const point = record(pointValue);
                    const year = numberOrNull(point?.year);
                    const month = numberOrNull(point?.month);
                    rows.push({ values: ['series', phrase, year && month ? `${year}-${String(month).padStart(2, '0')}` : '', numberOrNull(point?.value), null], sourceDateId: 'trend-estimate' });
                }
            }
            for (const queryValue of Array.isArray(payload?.relatedQueries) ? payload.relatedQueries : []) {
                const query = record(queryValue);
                const kind = stringOrNull(query?.kind);
                if (context.selection.relatedType && kind !== context.selection.relatedType)
                    continue;
                rows.push({ values: ['related', '', stringOrNull(query?.query) ?? '', numberOrNull(query?.value), kind], sourceDateId: 'trend-estimate' });
            }
            const observedAt = archive.fetchedAt ?? run.completedAt ?? (run.get('createdAt') as Date);
            const sourceDates = [reportSourceDate({ id: 'trend-estimate', label: reportCopy(context.locale, 'sources.keywordTrendEstimate'), kind: 'estimate', observedAt, sourceNoteKey: 'keyword.trends', freshness: archive.payload ? 'cached' : 'unknown' })];
            const document = baseDocument({
                kind: 'keyword.trends_run', stem: 'keywordTrendsRun', locale: context.locale, branding: context.branding,
                subject: [{ label: reportCopy(context.locale, 'fields.keywords'), value: boundedListLabel([...selected]) }],
                selection: [{ label: reportCopy(context.locale, 'fields.location'), value: inputs.geo ?? reportCopy(context.locale, 'values.all') }, { label: reportCopy(context.locale, 'fields.language'), value: inputs.language ?? reportCopy(context.locale, 'values.all') }],
                sourceDates, rows,
                columns: [
                    { key: 'type', label: reportCopy(context.locale, 'fields.type'), valueType: 'string' },
                    { key: 'keyword', label: reportCopy(context.locale, 'fields.keyword'), valueType: 'string' },
                    { key: 'item', label: reportCopy(context.locale, 'fields.item'), valueType: 'string' },
                    { key: 'trend', label: reportCopy(context.locale, 'fields.trend'), valueType: 'number' },
                    { key: 'classification', label: reportCopy(context.locale, 'fields.classification'), valueType: 'string' },
                ],
                blocks: [reportSourceNote({ id: 'trend-note', sourceDateId: 'trend-estimate', methodology: reportCopy(context.locale, 'notes.keywordTrends'), ...(archive.payload ? {} : { coverageWarning: reportCopy(context.locale, 'states.sourceUnavailable') }) })],
            });
            return { sourceVersion: reportSourceVersion('keyword-trends', { run: stored, archive }), document };
        },
        render: standardRender,
    };
}
async function clusterDecisions<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>, accountId: string, runId: string) {
    const rows = await db.select({ clusterId: keywordClusterDecisionEvents.clusterId, kind: keywordClusterDecisionEvents.kind, note: keywordClusterDecisionEvents.note, createdAt: keywordClusterDecisionEvents.createdAt }).from(keywordClusterDecisionEvents).where(and(eq(keywordClusterDecisionEvents.accountId, accountId), eq(keywordClusterDecisionEvents.runId, runId))).orderBy(desc(keywordClusterDecisionEvents.createdAt), desc(keywordClusterDecisionEvents.id));
    const byCluster = new Map<string, (typeof rows)[number]>();
    for (const row of rows)
        if (!byCluster.has(row.clusterId))
            byCluster.set(row.clusterId, row);
    return byCluster;
}
function aiClusterAdapter<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>): ReportExportAdapter<AiClusterSelection> {
    async function load(accountId: string, runId: string) {
        const run = await findClusterRunForAccount(accountId, runId);
        if (!run)
            throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
        return { run, decisions: await clusterDecisions(db, accountId, runId) };
    }
    return {
        kind: 'keyword.ai_cluster_run', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: aiClusterSelectionSchema,
        async assertAccess(context) {
            if (context.target.scope !== 'account_resource' || context.target.siteId !== undefined)
                throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
            const value = await load(context.accountId, context.target.resourceId);
            const current = reportSourceVersion('keyword-ai-cluster', value);
            if (context.purpose === 'persist' && context.sourceVersion && current !== context.sourceVersion)
                throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
        },
        async compose(context) {
            if (context.target.scope !== 'account_resource' || context.target.siteId !== undefined)
                throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
            const { run, decisions } = await load(context.accountId, context.target.resourceId);
            const rows: ReportTableRowInput[] = [];
            const orderedClusters = [...run.clusters].sort((a, b) => stableSortText(a.clusterId, b.clusterId));
            for (const cluster of orderedClusters) {
                const decision = decisions.get(cluster.clusterId);
                const decisionKind = decision?.kind ?? 'undecided';
                if (context.selection.decision !== 'all' && context.selection.decision !== decisionKind)
                    continue;
                for (const member of [...cluster.memberKeywords].sort(stableSortText)) {
                    rows.push({ values: [cluster.label, member, cluster.suggestedRoute, cluster.confidence, cluster.summedSearchVolume, decisionKind, decision?.note ?? null, decision?.createdAt ?? null], sourceDateIds: ['cluster-generated', 'cluster-observation', 'cluster-generated', 'cluster-generated', 'cluster-estimate', 'cluster-derived', 'cluster-derived', 'cluster-derived'] });
                }
            }
            const observed = run.memberRefs.map((item) => item.observedAt.toISOString()).sort(stableSortText);
            const sourceDates = [
                reportSourceDate({ id: 'cluster-observation', label: reportCopy(context.locale, 'sources.keywordObservation'), kind: 'provider_observation', from: observed[0] ?? run.createdAt, to: observed.at(-1) ?? run.createdAt, sourceNoteKey: 'keyword.cluster.members' }),
                reportSourceDate({ id: 'cluster-estimate', label: reportCopy(context.locale, 'sources.keywordEstimate'), kind: 'estimate', observedAt: run.createdAt, sourceNoteKey: 'keyword.cluster.volume' }),
                reportSourceDate({ id: 'cluster-generated', label: reportCopy(context.locale, 'sources.keywordClusterGenerated'), kind: 'generated', observedAt: run.createdAt, sourceNoteKey: 'keyword.cluster.generated' }),
                reportSourceDate({ id: 'cluster-derived', label: reportCopy(context.locale, 'sources.keywordClusterDerived'), kind: 'derived', observedAt: run.createdAt, sourceNoteKey: 'keyword.cluster.decision' }),
            ];
            const document = baseDocument({
                kind: 'keyword.ai_cluster_run', stem: 'keywordAiClusterRun', locale: context.locale, branding: context.branding,
                subject: [{ label: reportCopy(context.locale, 'fields.keywords'), value: String(run.memberRefs.length) }],
                selection: [{ label: reportCopy(context.locale, 'fields.location'), value: String(run.market.locationCode) }, { label: reportCopy(context.locale, 'fields.language'), value: run.market.languageCode }, { label: reportCopy(context.locale, 'fields.status'), value: context.selection.decision }],
                sourceDates, rows,
                columns: [
                    { key: 'cluster', label: reportCopy(context.locale, 'fields.cluster'), valueType: 'string' },
                    { key: 'keyword', label: reportCopy(context.locale, 'fields.keyword'), valueType: 'string' },
                    { key: 'route', label: reportCopy(context.locale, 'fields.route'), valueType: 'string' },
                    { key: 'confidence', label: reportCopy(context.locale, 'fields.confidence'), valueType: 'string' },
                    { key: 'volume', label: reportCopy(context.locale, 'fields.searchVolume'), valueType: 'number' },
                    { key: 'decision', label: reportCopy(context.locale, 'fields.decision'), valueType: 'string' },
                    { key: 'note', label: reportCopy(context.locale, 'fields.note'), valueType: 'string' },
                    { key: 'date', label: reportCopy(context.locale, 'fields.date'), valueType: 'date' },
                ],
                blocks: [reportSourceNote({ id: 'cluster-note', sourceDateId: 'cluster-generated', methodology: reportCopy(context.locale, 'notes.keywordAiClusters') })],
            });
            return { sourceVersion: reportSourceVersion('keyword-ai-cluster', { run, decisions: [...decisions.entries()] }), document };
        },
        render: standardRender,
    };
}
export function createKeywordResearchReportExportAdapters<TQueryResult extends PgQueryResultHKT>(db: ReportDb<TQueryResult>): ReportExportAdapter[] {
    return [researchAdapter(db), trendsAdapter(db), aiClusterAdapter(db)];
}
export const keywordResearchReportExportTestables = {
    record,
    strings,
    numberOrNull,
    stringOrNull,
    boundedListLabel,
    loadHistory,
    historyCacheKeys,
    readHistoryArchive,
    researchRow,
    monthlyDetails,
    researchRows,
    baseDocument,
    standardRender,
    loadTrendsArchive,
    clusterDecisions,
};
