import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { competitorIntersections, competitors, trafficSnapshots, vendorResponses } from '../../db/schema/index.js';
import { REPORT_DOCUMENT_SCHEMA, REPORT_DOCUMENT_SCHEMA_VERSION, renderReportDocument, reportCatalogCopy, reportCopy, reportSourceDate, reportSourceNote, reportSourceVersion, reportTable, stableReportJson, stableSortText, type ReportBrandingSnapshot, type ReportDocumentV1, type ReportLocale, type ReportSourceTarget, type ReportTableRowInput, } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { ReportExportAdapter } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { compareTrafficSnapshots } from './traffic-snapshots.compare.js';
import { getSnapshot } from './traffic-snapshots.service.js';
const organicSelectionSchema = z.object({ mode: z.enum(['list', 'intersection']).default('list'), domain: z.string().trim().min(1).max(253).optional(), rowClass: z.enum(['missing']).optional() }).strict().superRefine((value, context) => { if (value.mode === 'intersection' && !value.domain)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'reportExports.errors.invalidSelection' }); });
const techSelectionSchema = z.object({ domain: z.string().trim().min(1).max(253), category: z.enum(['cms', 'analytics', 'hosting', 'ecommerce', 'other']).optional() }).strict();
const snapshotSelectionSchema = z.object({ country: z.string().regex(/^[A-Z]{2}$/u).optional() }).strict();
const comparisonSelectionSchema = z.object({ snapshotIds: z.array(z.string().regex(/^[0-9a-f]{24}$/iu)).min(2).max(5), country: z.string().regex(/^[A-Z]{2}$/u).optional(), metric: z.enum(['visits', 'rank', 'keywords']).optional() }).strict().superRefine((value, context) => { if (new Set(value.snapshotIds).size !== value.snapshotIds.length)
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'reportExports.errors.invalidSelection' }); }).transform((value) => ({ ...value, snapshotIds: [...value.snapshotIds].sort(stableSortText) }));
const techStackArchiveSchema = z.array(z.object({ category: z.enum(['cms', 'analytics', 'hosting', 'ecommerce', 'other']), name: z.string().min(1).max(500) }).strip()).max(1000);
type OrganicSelection = z.infer<typeof organicSelectionSchema>;
type TechSelection = z.infer<typeof techSelectionSchema>;
type SnapshotSelection = z.infer<typeof snapshotSelectionSchema>;
type ComparisonSelection = z.infer<typeof comparisonSelectionSchema>;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const textValue = (value: unknown): string | null => typeof value === 'string' ? value : null;
function assertSiteTarget(target: ReportSourceTarget): asserts target is Extract<ReportSourceTarget, {
    scope: 'site';
}> { if (target.scope !== 'site')
    throw HttpError.notFound({ code: 'COMPETITORS_ERRORS_SITE_NOT_FOUND', messageKey: 'competitors.errors.siteNotFound' }); }
function assertResourceTarget(target: ReportSourceTarget): asserts target is Extract<ReportSourceTarget, {
    scope: 'account_resource';
}> { if (target.scope !== 'account_resource')
    throw HttpError.notFound({ code: 'TRAFFIC_INSIGHTS_ERRORS_NOT_FOUND', messageKey: 'trafficInsights.errors.notFound' }); }
function assertResourceSite(target: Extract<ReportSourceTarget, {
    scope: 'account_resource';
}>, actualSiteId: string | null): void { if (target.siteId !== undefined && target.siteId !== actualSiteId)
    throw HttpError.notFound({ code: 'TRAFFIC_INSIGHTS_ERRORS_NOT_FOUND', messageKey: 'trafficInsights.errors.notFound' }); }
function comparisonAllowedSiteIds(target: Extract<ReportSourceTarget, {
    scope: 'account_resource';
}>): string[] | null { return target.siteId === undefined ? null : [target.siteId]; }
function selectionItems(locale: ReportLocale, value: Record<string, unknown>): ReportDocumentV1['selection'] {
    return Object.keys(value).sort(stableSortText).map((key) => {
        const full = Array.isArray(value[key]) ? value[key].join(', ') : String(value[key] ?? '');
        return { label: reportCopy(locale, `fields.${key}`), value: full.length <= 900 ? full : `${Array.isArray(value[key]) ? value[key].length : 1}; ${reportSourceVersion('selection', value[key])}` };
    });
}
function boundedListLabel(values: readonly string[]): string { const ordered = [...values].sort(stableSortText); const full = ordered.join(', '); return full.length <= 900 ? full : `${ordered.length}; ${reportSourceVersion('selection', ordered)}`; }
function columns(locale: ReportLocale) {
    return [
        { key: 'recordType', label: reportCopy(locale, 'fields.recordType'), valueType: 'string' as const },
        { key: 'domain', label: reportCopy(locale, 'fields.domain'), valueType: 'string' as const },
        { key: 'market', label: reportCopy(locale, 'fields.market'), valueType: 'string' as const },
        { key: 'date', label: reportCopy(locale, 'fields.date'), valueType: 'string' as const },
        { key: 'metric', label: reportCopy(locale, 'fields.metric'), valueType: 'string' as const },
        { key: 'value', label: reportCopy(locale, 'fields.value'), valueType: 'string' as const },
        { key: 'details', label: reportCopy(locale, 'fields.details'), valueType: 'string' as const },
        { key: 'provenance', label: reportCopy(locale, 'fields.provenance'), valueType: 'string' as const },
    ];
}
function document(input: {
    kind: ReportDocumentV1['kind'];
    stem: string;
    locale: ReportLocale;
    branding: ReportBrandingSnapshot;
    subject: string;
    selection: Record<string, unknown>;
    dates: ReportDocumentV1['sourceDates'];
    rows: ReportTableRowInput[];
    noteKey: string;
    sourceDateId: string;
}): ReportDocumentV1 {
    return { schema: REPORT_DOCUMENT_SCHEMA, schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION, kind: input.kind, kindVersion: 1, locale: input.locale, title: reportCatalogCopy(input.locale, input.stem, 'title'), subject: [{ label: reportCopy(input.locale, 'fields.site'), value: input.subject }], selection: selectionItems(input.locale, input.selection), sourceDates: input.dates, completeness: { state: 'complete', selectedItems: input.rows.length, representedItems: input.rows.length, bound: reportCatalogCopy(input.locale, input.stem, 'bound') }, branding: input.branding, blocks: [reportTable({ id: 'records', columns: columns(input.locale), rows: input.rows }), reportSourceNote({ id: 'source-note', sourceDateId: input.sourceDateId, methodology: reportCopy(input.locale, input.noteKey) })], artifacts: [] };
}
async function competitorSiteVersion(db: Db, accountId: string, siteId: string) {
    const [listRows, intersectionRows] = await Promise.all([
        db.select().from(competitors).where(and(eq(competitors.accountId, accountId), eq(competitors.siteId, siteId))).orderBy(competitors.fetchedAt, competitors.id),
        db.select().from(competitorIntersections).where(and(eq(competitorIntersections.accountId, accountId), eq(competitorIntersections.siteId, siteId))).orderBy(competitorIntersections.fetchedAt, competitorIntersections.id),
    ]);
    return reportSourceVersion('competitors.site', { listRows, intersectionRows });
}
async function techSiteVersion(db: Db, accountId: string, siteId: string) {
    const known = await db.select({ domain: competitors.competitorDomain }).from(competitors).where(and(eq(competitors.accountId, accountId), eq(competitors.siteId, siteId))).orderBy(competitors.competitorDomain);
    const domains = new Set(known.map((row) => row.domain.toLowerCase()));
    const archives = await db.select({ id: vendorResponses.id, params: vendorResponses.params, payload: vendorResponses.payload, fetchedAt: vendorResponses.fetchedAt }).from(vendorResponses).where(and(eq(vendorResponses.capability, 'competitor'), eq(vendorResponses.operation, 'tech-stack'))).orderBy(vendorResponses.fetchedAt, vendorResponses.id);
    return reportSourceVersion('competitors.tech_stack', archives.filter((row) => domains.has(textValue(record(row.params)?.domain)?.toLowerCase() ?? '')));
}
async function trafficAccountVersion(db: Db, accountId: string, siteId?: string) {
    const rows = await db.select().from(trafficSnapshots).where(and(eq(trafficSnapshots.accountId, accountId), ...(siteId ? [eq(trafficSnapshots.siteId, siteId)] : []))).orderBy(trafficSnapshots.capturedAt, trafficSnapshots.id);
    return reportSourceVersion('competitors.traffic', rows);
}
async function organicData(db: Db, accountId: string, siteId: string, selection: OrganicSelection) {
    await getSite(accountId, siteId);
    if (selection.mode === 'intersection') {
        const rows = await db.select().from(competitorIntersections).where(and(eq(competitorIntersections.accountId, accountId), eq(competitorIntersections.siteId, siteId), eq(competitorIntersections.competitorDomain, selection.domain!))).orderBy(desc(competitorIntersections.fetchedAt), desc(competitorIntersections.id)).limit(1);
        if (!rows[0])
            throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
        return { mode: 'intersection' as const, rows: rows[0] };
    }
    const rows = await db.select().from(competitors).where(and(eq(competitors.accountId, accountId), eq(competitors.siteId, siteId))).orderBy(desc(competitors.fetchedAt), desc(competitors.id));
    const latestDay = rows[0]?.snapshotDay;
    return { mode: 'list' as const, rows: latestDay ? rows.filter((row) => row.snapshotDay === latestDay).sort((a, b) => b.intersections - a.intersections || stableSortText(a.competitorDomain, b.competitorDomain)) : [] };
}
function organicAdapter(db: Db): ReportExportAdapter<OrganicSelection> {
    return { kind: 'competitors.organic', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: organicSelectionSchema,
        async assertAccess(context) { assertSiteTarget(context.target); await getSite(context.accountId, context.target.siteId); const version = await competitorSiteVersion(db, context.accountId, context.target.siteId); if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== version)
            throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' }); },
        async compose(context) {
            assertSiteTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const data = await organicData(db, context.accountId, context.target.siteId, context.selection);
            const observedAt = data.mode === 'list' ? data.rows[0]?.fetchedAt ?? site.updatedAt : data.rows.fetchedAt;
            const rows: ReportTableRowInput[] = data.mode === 'list' ? data.rows.map((row, index) => ({ id: `competitor-${index + 1}`, values: ['competitor', row.competitorDomain, 'organic', row.snapshotDay, 'intersections', String(row.intersections), stableReportJson({ averagePosition: row.avgPosition, estimatedTraffic: row.estimatedTraffic, source: row.source }), 'observation'], sourceDateId: 'competitor-observation' })) : (Array.isArray(data.rows.keywords) ? data.rows.keywords : []).flatMap((raw, index) => { const row = record(raw); if (!row || (context.selection.rowClass && row.class !== context.selection.rowClass))
                return []; return [{ id: `intersection-${index + 1}`, values: ['intersection', data.rows.competitorDomain, 'organic', data.rows.fetchedAt.toISOString(), textValue(row.keyword) ?? '', String(row.searchVolume ?? ''), stableReportJson({ targetPosition: row.target1Position ?? null, competitorPosition: row.target2Position ?? null, targetUrl: row.target1Url ?? null, competitorUrl: row.target2Url ?? null, rowClass: row.class ?? null }), 'observation'], sourceDateId: 'competitor-observation' }]; });
            const date = reportSourceDate({ id: 'competitor-observation', label: reportCopy(context.locale, 'sources.competitorObservation'), kind: 'provider_observation', observedAt, sourceNoteKey: 'competitors.organic', freshness: 'unknown' });
            return { document: document({ kind: 'competitors.organic', stem: 'competitorsOrganic', locale: context.locale, branding: context.branding, subject: site.displayName || site.domain, selection: context.selection, dates: [date], rows, noteKey: 'notes.competitorObservation', sourceDateId: date.id }), sourceVersion: await competitorSiteVersion(db, context.accountId, context.target.siteId) };
        },
        render: ({ document: value, format, snapshotCreatedAt }) => renderReportDocument({ document: value, format, snapshotCreatedAt }) };
}
async function techArchive(db: Db, domain: string) {
    const rows = await db.select({ payload: vendorResponses.payload, params: vendorResponses.params, fetchedAt: vendorResponses.fetchedAt, id: vendorResponses.id }).from(vendorResponses).where(and(eq(vendorResponses.capability, 'competitor'), eq(vendorResponses.operation, 'tech-stack'))).orderBy(desc(vendorResponses.fetchedAt), desc(vendorResponses.id));
    return rows.find((row) => textValue(record(row.params)?.domain)?.toLowerCase() === domain.toLowerCase()) ?? null;
}
function techAdapter(db: Db): ReportExportAdapter<TechSelection> {
    return { kind: 'competitors.tech_stack', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: techSelectionSchema,
        async assertAccess(context) { assertSiteTarget(context.target); await getSite(context.accountId, context.target.siteId); const version = await techSiteVersion(db, context.accountId, context.target.siteId); if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== version)
            throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' }); },
        async compose(context) {
            assertSiteTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const known = await db.select({ domain: competitors.competitorDomain }).from(competitors).where(and(eq(competitors.accountId, context.accountId), eq(competitors.siteId, context.target.siteId), eq(competitors.competitorDomain, context.selection.domain))).limit(1);
            if (!known[0])
                throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
            const archive = await techArchive(db, context.selection.domain);
            if (!archive)
                throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
            const payload = record(archive.payload);
            const parsed = techStackArchiveSchema.safeParse(Array.isArray(payload?.techStack) ? payload.techStack : archive.payload);
            if (!parsed.success)
                throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
            const rows = parsed.data.flatMap((row, index) => { if (context.selection.category && context.selection.category !== row.category)
                return []; return [{ id: `technology-${index + 1}`, values: ['technology', context.selection.domain, row.category, archive.fetchedAt.toISOString(), row.name, '', '', 'observation'], sourceDateId: 'competitor-observation' }]; });
            const date = reportSourceDate({ id: 'competitor-observation', label: reportCopy(context.locale, 'sources.competitorObservation'), kind: 'provider_observation', observedAt: archive.fetchedAt, sourceNoteKey: 'competitors.tech', freshness: 'cached', cachedAt: archive.fetchedAt });
            return { document: document({ kind: 'competitors.tech_stack', stem: 'competitorsTechStack', locale: context.locale, branding: context.branding, subject: site.displayName || site.domain, selection: context.selection, dates: [date], rows, noteKey: 'notes.competitorObservation', sourceDateId: date.id }), sourceVersion: await techSiteVersion(db, context.accountId, context.target.siteId) };
        }, render: ({ document: value, format, snapshotCreatedAt }) => renderReportDocument({ document: value, format, snapshotCreatedAt }) };
}
function snapshotRows(run: Awaited<ReturnType<typeof getSnapshot>>, selection: SnapshotSelection): ReportTableRowInput[] {
    if (!run.snapshot)
        return [{ id: 'snapshot-unavailable', values: ['unavailable', run.targetDomain, `${run.inputs.locationCode}/${run.inputs.languageCode}`, run.completedAt ?? run.createdAt, 'status', run.status, stableReportJson({ retainedOps: run.retainedOps }), 'estimate'], sourceDateId: 'traffic-estimate' }];
    const payload = run.snapshot.payload;
    const rows: ReportTableRowInput[] = [];
    for (const operation of ['traffic', 'rankOverview', 'history'] as const)
        rows.push({ id: `availability-${operation}`, values: ['availability', run.targetDomain, `${run.inputs.locationCode}/${run.inputs.languageCode}`, run.snapshot.capturedAt, operation, payload.retained[operation] ? 'available' : 'unavailable', stableReportJson({ retained: payload.retained[operation], runStatus: run.status }), 'estimate'], sourceDateId: 'traffic-estimate' });
    rows.push({ id: 'summary-visits', values: ['summary', run.targetDomain, `${run.inputs.locationCode}/${run.inputs.languageCode}`, run.snapshot.capturedAt, 'monthlyOrganicVisits', String(payload.monthlyOrganicVisits.value), stableReportJson({ retained: payload.retained }), 'estimate'], sourceDateId: 'traffic-estimate' });
    rows.push({ id: 'summary-rank', values: ['summary', run.targetDomain, `${run.inputs.locationCode}/${run.inputs.languageCode}`, run.snapshot.capturedAt, 'domainRank', payload.domainRank.value === null ? 'unavailable' : String(payload.domainRank.value), stableReportJson({ retained: payload.retained.rankOverview }), 'estimate'], sourceDateId: 'traffic-estimate' });
    rows.push({ id: 'summary-keywords', values: ['summary', run.targetDomain, `${run.inputs.locationCode}/${run.inputs.languageCode}`, run.snapshot.capturedAt, 'keywordCount', payload.keywordCount.value === null ? 'unavailable' : String(payload.keywordCount.value), stableReportJson({ retained: payload.retained.rankOverview }), 'estimate'], sourceDateId: 'traffic-estimate' });
    for (const country of payload.topCountries.filter((row) => !selection.country || row.countryCode === selection.country).sort((a, b) => stableSortText(a.countryCode, b.countryCode)))
        rows.push({ id: `country-${country.countryCode}`, values: ['country', run.targetDomain, country.countryCode, run.snapshot.capturedAt, 'visits', String(country.visits.value), '', 'estimate'], sourceDateId: 'traffic-estimate' });
    for (const point of [...payload.history].sort((a, b) => stableSortText(a.capturedAt, b.capturedAt)))
        rows.push({ id: `history-${rows.length + 1}`, values: ['history', run.targetDomain, `${run.inputs.locationCode}/${run.inputs.languageCode}`, point.capturedAt, 'traffic', String(point.traffic.value), stableReportJson({ rank: point.rank.value, keywordCount: point.keywordCount.value }), 'estimate'], sourceDateId: 'traffic-estimate' });
    return rows;
}
type TrafficComparison = Awaited<ReturnType<typeof compareTrafficSnapshots>>;
function trafficComparisonRows(comparison: TrafficComparison, selection: ComparisonSelection): ReportTableRowInput[] {
    const rows: ReportTableRowInput[] = [];
    const snapshots = [...comparison.snapshots].sort((left, right) => stableSortText(left.capturedAt, right.capturedAt) ||
        stableSortText(left.targetDomain, right.targetDomain) ||
        stableSortText(left.id, right.id));
    const countryCodes = selection.country
        ? [selection.country]
        : [...comparison.axes.countryCodes].sort(stableSortText);
    for (const snapshot of snapshots) {
        const sourceDateId = `traffic-estimate-${snapshot.id}`;
        const derivedDateId = `traffic-derived-${snapshot.id}`;
        const market = 'all';
        const wanted = selection.metric;
        for (const operation of ['traffic', 'rankOverview', 'history'] as const) {
            rows.push({
                id: `${snapshot.id}-availability-${operation}`,
                values: ['availability', snapshot.targetDomain, market, snapshot.capturedAt, operation, snapshot.payload.retained[operation] ? 'available' : 'unavailable', stableReportJson({ retained: snapshot.payload.retained[operation] }), 'estimate'],
                sourceDateId,
            });
        }
        if (!wanted || wanted === 'visits')
            rows.push({ id: `${snapshot.id}-visits`, values: ['comparison', snapshot.targetDomain, market, snapshot.capturedAt, 'visits', String(snapshot.payload.monthlyOrganicVisits.value), stableReportJson({ retained: snapshot.payload.retained.traffic }), 'estimate'], sourceDateId });
        if (!wanted || wanted === 'rank')
            rows.push({ id: `${snapshot.id}-rank`, values: ['comparison', snapshot.targetDomain, market, snapshot.capturedAt, 'rank', snapshot.payload.domainRank.value === null ? 'unavailable' : String(snapshot.payload.domainRank.value), stableReportJson({ retained: snapshot.payload.retained.rankOverview }), 'estimate'], sourceDateId });
        if (!wanted || wanted === 'keywords')
            rows.push({ id: `${snapshot.id}-keywords`, values: ['comparison', snapshot.targetDomain, market, snapshot.capturedAt, 'keywords', snapshot.payload.keywordCount.value === null ? 'unavailable' : String(snapshot.payload.keywordCount.value), stableReportJson({ retained: snapshot.payload.retained.rankOverview }), 'estimate'], sourceDateId });
        if (!wanted || wanted === 'visits') {
            for (const countryCode of countryCodes) {
                const country = snapshot.payload.topCountries.find((item) => item.countryCode === countryCode);
                rows.push({
                    id: `${snapshot.id}-country-${countryCode}`,
                    values: ['country-comparison', snapshot.targetDomain, countryCode, snapshot.capturedAt, 'visits', country ? String(country.visits.value) : 'unavailable', stableReportJson({ available: Boolean(country), retained: snapshot.payload.retained.traffic }), 'estimate'],
                    sourceDateId,
                });
            }
        }
        const history = [...snapshot.payload.history].sort((left, right) => stableSortText(left.capturedAt, right.capturedAt));
        for (const point of history) {
            if (!wanted || wanted === 'visits')
                rows.push({ id: `${snapshot.id}-history-${point.capturedAt}-visits`, values: ['history', snapshot.targetDomain, market, point.capturedAt, 'visits', String(point.traffic.value), '', 'estimate'], sourceDateId });
            if (!wanted || wanted === 'rank')
                rows.push({ id: `${snapshot.id}-history-${point.capturedAt}-rank`, values: ['history', snapshot.targetDomain, market, point.capturedAt, 'rank', point.rank.value === null ? 'unavailable' : String(point.rank.value), '', 'estimate'], sourceDateId });
            if (!wanted || wanted === 'keywords')
                rows.push({ id: `${snapshot.id}-history-${point.capturedAt}-keywords`, values: ['history', snapshot.targetDomain, market, point.capturedAt, 'keywords', String(point.keywordCount.value), '', 'estimate'], sourceDateId });
        }
        const first = history[0];
        const last = history.at(-1);
        const deltas = [
            { metric: 'visits' as const, from: first?.traffic.value, to: last?.traffic.value },
            { metric: 'rank' as const, from: first?.rank.value, to: last?.rank.value },
            { metric: 'keywords' as const, from: first?.keywordCount.value, to: last?.keywordCount.value },
        ].filter((delta) => !wanted || wanted === delta.metric);
        for (const delta of deltas) {
            const complete = history.length >= 2 && delta.from !== null && delta.from !== undefined && delta.to !== null && delta.to !== undefined;
            rows.push({
                id: `${snapshot.id}-delta-${delta.metric}`,
                values: ['delta', snapshot.targetDomain, market, last?.capturedAt ?? snapshot.capturedAt, delta.metric, complete ? String(delta.to! - delta.from!) : 'unavailable', stableReportJson({ from: delta.from ?? null, to: delta.to ?? null, fromDate: first?.capturedAt ?? null, toDate: last?.capturedAt ?? null, reason: complete ? null : 'insufficient_history' }), 'derived'],
                sourceDateIds: [derivedDateId, sourceDateId, sourceDateId, derivedDateId, derivedDateId, derivedDateId, derivedDateId, derivedDateId],
            });
        }
    }
    return rows;
}
function snapshotAdapter(db: Db): ReportExportAdapter<SnapshotSelection> {
    return { kind: 'competitors.traffic_snapshot', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: snapshotSelectionSchema,
        async assertAccess(context) { assertResourceTarget(context.target); const run = await getSnapshot(context.accountId, context.target.resourceId, db); assertResourceSite(context.target, run.siteId); const version = reportSourceVersion('competitors.traffic_snapshot', run); if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== version)
            throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' }); },
        async compose(context) { assertResourceTarget(context.target); const run = await getSnapshot(context.accountId, context.target.resourceId, db); assertResourceSite(context.target, run.siteId); const at = run.snapshot?.capturedAt ?? run.completedAt ?? run.createdAt; const date = reportSourceDate({ id: 'traffic-estimate', label: reportCopy(context.locale, 'sources.trafficEstimate'), kind: 'estimate', observedAt: at, sourceNoteKey: 'competitors.traffic', freshness: 'unknown' }); return { document: document({ kind: 'competitors.traffic_snapshot', stem: 'competitorsTrafficSnapshot', locale: context.locale, branding: context.branding, subject: run.targetDomain, selection: context.selection, dates: [date], rows: snapshotRows(run, context.selection), noteKey: 'notes.trafficEstimate', sourceDateId: date.id }), sourceVersion: reportSourceVersion('competitors.traffic_snapshot', run) }; }, render: ({ document: value, format, snapshotCreatedAt }) => renderReportDocument({ document: value, format, snapshotCreatedAt }) };
}
function comparisonAdapter(db: Db): ReportExportAdapter<ComparisonSelection> {
    return { kind: 'competitors.traffic_comparison', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: comparisonSelectionSchema,
        async assertAccess(context) { assertResourceTarget(context.target); const run = await getSnapshot(context.accountId, context.target.resourceId, db); assertResourceSite(context.target, run.siteId); const version = await trafficAccountVersion(db, context.accountId, context.target.siteId); if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== version)
            throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' }); },
        async compose(context) {
            assertResourceTarget(context.target);
            if (!context.selection.snapshotIds.includes(context.target.resourceId))
                throw HttpError.notFound({ code: 'TRAFFIC_INSIGHTS_ERRORS_NOT_FOUND', messageKey: 'trafficInsights.errors.notFound' });
            const runs = await Promise.all(context.selection.snapshotIds.map((id) => getSnapshot(context.accountId, id, db)));
            for (const run of runs)
                assertResourceSite(context.target, run.siteId);
            const comparison = await compareTrafficSnapshots(context.accountId, { ids: context.selection.snapshotIds, clamped: false }, db, comparisonAllowedSiteIds(context.target));
            const dates = comparison.snapshots.map((snapshot) => reportSourceDate({ id: `traffic-estimate-${snapshot.id}`, label: `${reportCopy(context.locale, 'sources.trafficEstimate')}: ${snapshot.targetDomain}`, kind: 'estimate', observedAt: snapshot.capturedAt, sourceNoteKey: 'competitors.traffic', freshness: 'unknown' }));
            for (const snapshot of comparison.snapshots) {
                const historyDates = snapshot.payload.history.map((point) => point.capturedAt).sort(stableSortText);
                dates.push(reportSourceDate({ id: `traffic-derived-${snapshot.id}`, label: `${reportCopy(context.locale, 'sources.trafficDerived')}: ${snapshot.targetDomain}`, kind: 'derived', from: historyDates[0] ?? snapshot.capturedAt, to: historyDates.at(-1) ?? snapshot.capturedAt, sourceNoteKey: 'competitors.traffic.delta', freshness: 'unknown' }));
            }
            const rows = trafficComparisonRows(comparison, context.selection);
            return { document: document({ kind: 'competitors.traffic_comparison', stem: 'competitorsTrafficComparison', locale: context.locale, branding: context.branding, subject: boundedListLabel(comparison.snapshots.map((item) => item.targetDomain)), selection: context.selection, dates, rows, noteKey: 'notes.trafficEstimate', sourceDateId: dates[0]!.id }), sourceVersion: await trafficAccountVersion(db, context.accountId, context.target.siteId) };
        }, render: ({ document: value, format, snapshotCreatedAt }) => renderReportDocument({ document: value, format, snapshotCreatedAt }) };
}
export function createCompetitorReportExportAdapters(db: Db): ReportExportAdapter[] { return [organicAdapter(db), techAdapter(db), snapshotAdapter(db), comparisonAdapter(db)]; }
export const competitorReportExportTestables = {
    record,
    textValue,
    assertSiteTarget,
    assertResourceTarget,
    assertResourceSite,
    comparisonAllowedSiteIds,
    selectionItems,
    boundedListLabel,
    columns,
    document,
    competitorSiteVersion,
    techSiteVersion,
    trafficAccountVersion,
    organicData,
    techArchive,
    snapshotRows,
    trafficComparisonRows,
};
