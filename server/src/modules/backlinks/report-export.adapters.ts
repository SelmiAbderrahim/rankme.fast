import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { backlinkSnapshots, TOXICITY_BANDS, vendorResponses } from '../../db/schema/index.js';
import { REPORT_DOCUMENT_SCHEMA, REPORT_DOCUMENT_SCHEMA_VERSION, REPORT_NATIVE_MEDIA_TYPES, renderReportDocument, reportCatalogCopy, reportCopy, reportSourceDate, reportSourceNote, reportSourceVersion, reportTable, stableReportJson, stableSortText, type ReportBlockV1, type ReportBrandingSnapshot, type ReportDocumentV1, type ReportLocale, type ReportRenderedResult, type ReportSourceTarget, type ReportTableRowInput, } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { ReportExportAdapter } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { BACKLINK_PULL_TYPES, LINK_GAP_LEG_STATUSES } from './backlink-runs.model.js';
import { getBacklinkDeepRun } from './backlink-deep.service.js';
import { buildToxicityDisavow, getToxicityReview } from './toxicity-review.service.js';
import { disavowBuildBodySchema } from './toxicity-review.schema.js';
import { TOXICITY_SIGNALS } from './toxicity-rubric.js';
import { getLinkGapRun } from './link-gap.service.js';
const emptySelectionSchema = z.object({}).strict();
const inventorySelectionSchema = z.object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    domain: z.string().trim().min(1).max(253).optional(),
    dofollow: z.boolean().optional(),
    broken: z.boolean().optional(),
}).strict().superRefine((value, context) => {
    if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to))
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'reportExports.errors.invalidSelection' });
});
const deepSelectionSchema = z.object({ operation: z.enum(BACKLINK_PULL_TYPES).optional() }).strict();
const gapSelectionSchema = z.object({
    competitor: z.string().trim().min(1).max(253).optional(),
    legStatus: z.enum(LINK_GAP_LEG_STATUSES).optional(),
}).strict();
const toxicitySelectionSchema = z.object({
    band: z.enum(TOXICITY_BANDS).optional(),
    signal: z.enum(TOXICITY_SIGNALS).optional(),
    dofollow: z.boolean().optional(),
    broken: z.boolean().optional(),
}).strict();
type EmptySelection = z.infer<typeof emptySelectionSchema>;
type InventorySelection = z.infer<typeof inventorySelectionSchema>;
type DeepSelection = z.infer<typeof deepSelectionSchema>;
type GapSelection = z.infer<typeof gapSelectionSchema>;
type ToxicitySelection = z.infer<typeof toxicitySelectionSchema>;
type DisavowSelection = z.infer<typeof disavowBuildBodySchema>;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
const textValue = (value: unknown): string | null => typeof value === 'string' ? value : null;
const boolValue = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
function assertSiteTarget(target: ReportSourceTarget): asserts target is Extract<ReportSourceTarget, {
    scope: 'site';
}> {
    if (target.scope !== 'site')
        throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' });
}
function assertRunTarget(target: ReportSourceTarget): asserts target is Extract<ReportSourceTarget, {
    scope: 'site_resource';
}> {
    if (target.scope !== 'site_resource')
        throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' });
}
function tableColumns(locale: ReportLocale) {
    return [
        { key: 'recordType', label: reportCopy(locale, 'fields.recordType'), valueType: 'string' as const },
        { key: 'domain', label: reportCopy(locale, 'fields.domain'), valueType: 'string' as const },
        { key: 'url', label: reportCopy(locale, 'fields.url'), valueType: 'string' as const },
        { key: 'value', label: reportCopy(locale, 'fields.value'), valueType: 'string' as const },
        { key: 'details', label: reportCopy(locale, 'fields.details'), valueType: 'string' as const },
        { key: 'firstSeen', label: reportCopy(locale, 'fields.firstSeen'), valueType: 'string' as const },
        { key: 'lastSeen', label: reportCopy(locale, 'fields.lastSeen'), valueType: 'string' as const },
        { key: 'provenance', label: reportCopy(locale, 'fields.provenance'), valueType: 'string' as const },
    ];
}
function selectionItems(locale: ReportLocale, value: Record<string, unknown>): ReportDocumentV1['selection'] {
    return Object.keys(value).sort(stableSortText).map((key) => ({
        label: reportCopy(locale, `fields.${key}`),
        value: (() => {
            const full = Array.isArray(value[key]) ? stableReportJson(value[key]) : String(value[key] ?? '');
            return full.length <= 900 ? full : `${Array.isArray(value[key]) ? value[key].length : 1}; ${reportSourceVersion('selection', value[key])}`;
        })(),
    }));
}
function baseDocument(input: {
    kind: ReportDocumentV1['kind'];
    stem: string;
    locale: ReportLocale;
    branding: ReportBrandingSnapshot;
    subject: string;
    selection: Record<string, unknown>;
    sourceDates: ReportDocumentV1['sourceDates'];
    rows: ReportTableRowInput[];
    notes: ReportBlockV1[];
    artifacts?: ReportDocumentV1['artifacts'];
    blocks?: ReportBlockV1[];
}): ReportDocumentV1 {
    return {
        schema: REPORT_DOCUMENT_SCHEMA, schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION, kind: input.kind, kindVersion: 1,
        locale: input.locale, title: reportCatalogCopy(input.locale, input.stem, 'title'),
        subject: [{ label: reportCopy(input.locale, 'fields.site'), value: input.subject }], selection: selectionItems(input.locale, input.selection),
        sourceDates: input.sourceDates,
        completeness: { state: 'complete', selectedItems: input.rows.length, representedItems: input.rows.length, bound: reportCatalogCopy(input.locale, input.stem, 'bound') },
        branding: input.branding,
        blocks: input.blocks ?? [reportTable({ id: 'records', columns: tableColumns(input.locale), rows: input.rows }), ...input.notes],
        artifacts: input.artifacts ?? [],
    };
}
async function latestSummary(db: Db, accountId: string, siteId: string) {
    await getSite(accountId, siteId);
    const rows = await db.select().from(backlinkSnapshots).where(and(eq(backlinkSnapshots.accountId, accountId), eq(backlinkSnapshots.siteId, siteId))).orderBy(desc(backlinkSnapshots.fetchedAt), desc(backlinkSnapshots.id)).limit(1);
    const row = rows[0];
    if (!row)
        throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
    return row;
}
function summaryAdapter(db: Db): ReportExportAdapter<EmptySelection> {
    return {
        kind: 'backlinks.summary', kindVersion: 1, supportedFormats: ['pdf', 'json'], selectionSchema: emptySelectionSchema,
        async assertAccess(context) {
            assertSiteTarget(context.target);
            const row = await latestSummary(db, context.accountId, context.target.siteId);
            const version = reportSourceVersion('backlinks.summary', row);
            if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== version)
                throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
        },
        async compose(context) {
            assertSiteTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const row = await latestSummary(db, context.accountId, context.target.siteId);
            const date = reportSourceDate({ id: 'backlink-observation', label: reportCopy(context.locale, 'sources.backlinkObservation'), kind: 'provider_observation', observedAt: row.fetchedAt, sourceNoteKey: 'backlinks.observation', freshness: 'unknown' });
            const rows: ReportTableRowInput[] = [
                ['domainRating', row.domainRating], ['backlinks', row.backlinks], ['referringDomains', row.referringDomains], ['brokenBacklinks', row.brokenBacklinks],
            ].map(([name, value]) => ({ id: String(name), values: ['summary', site.domain, null, String(value ?? ''), String(name), null, row.fetchedAt.toISOString(), 'observation'], sourceDateId: 'backlink-observation' }));
            return { document: baseDocument({ kind: 'backlinks.summary', stem: 'backlinksSummary', locale: context.locale, branding: context.branding, subject: site.displayName || site.domain, selection: context.selection, sourceDates: [date], rows, notes: [reportSourceNote({ id: 'backlink-note', sourceDateId: date.id, methodology: reportCopy(context.locale, 'notes.backlinkObservation') })] }), sourceVersion: reportSourceVersion('backlinks.summary', row) };
        },
        render: ({ document, format, snapshotCreatedAt }) => renderReportDocument({ document, format, snapshotCreatedAt }),
    };
}
async function inventoryArchive(db: Db, domain: string, selection: InventorySelection) {
    const archives = await db.select({ id: vendorResponses.id, payload: vendorResponses.payload, params: vendorResponses.params, fetchedAt: vendorResponses.fetchedAt }).from(vendorResponses)
        .where(and(eq(vendorResponses.capability, 'backlink'), inArray(vendorResponses.operation, ['list-first-page', 'list-page'])))
        .orderBy(vendorResponses.fetchedAt, vendorResponses.id);
    return archives.flatMap((archive) => {
        if (textValue(record(archive.params)?.domain)?.toLowerCase() !== domain.toLowerCase())
            return [];
        if (selection.from && archive.fetchedAt.getTime() < Date.parse(selection.from))
            return [];
        if (selection.to && archive.fetchedAt.getTime() > Date.parse(selection.to))
            return [];
        const rows = record(archive.payload)?.rows;
        if (!Array.isArray(rows))
            return [];
        return rows.flatMap((raw, index) => {
            const row = record(raw);
            if (!row)
                return [];
            const domainFrom = textValue(row.domainFrom) ?? '';
            if (selection.domain && domainFrom.toLowerCase() !== selection.domain.toLowerCase())
                return [];
            if (selection.dofollow !== undefined && boolValue(row.dofollow) !== selection.dofollow)
                return [];
            if (selection.broken !== undefined && boolValue(row.isBroken) !== selection.broken)
                return [];
            return [{
                    domainFrom: row.domainFrom,
                    urlFrom: row.urlFrom,
                    urlTo: row.urlTo,
                    anchor: row.anchor,
                    dofollow: row.dofollow,
                    isBroken: row.isBroken,
                    backlinkSpamScore: row.backlinkSpamScore,
                    urlToSpamScore: row.urlToSpamScore,
                    firstSeen: row.firstSeen,
                    lastSeen: row.lastSeen,
                    archiveId: archive.id,
                    archiveIndex: index,
                    capturedAt: archive.fetchedAt.toISOString(),
                }];
        });
    }).sort(compareInventoryRows);
}
function compareInventoryRows(left: {
    capturedAt: unknown;
    urlFrom: unknown;
    urlTo: unknown;
    archiveIndex: unknown;
}, right: {
    capturedAt: unknown;
    urlFrom: unknown;
    urlTo: unknown;
    archiveIndex: unknown;
}): number {
    return stableSortText(String(left.capturedAt), String(right.capturedAt))
        || stableSortText(String(left.urlFrom), String(right.urlFrom))
        || stableSortText(String(left.urlTo), String(right.urlTo))
        || Number(left.archiveIndex) - Number(right.archiveIndex);
}
function inventoryAdapter(db: Db): ReportExportAdapter<InventorySelection> {
    return {
        kind: 'backlinks.inventory', kindVersion: 1, supportedFormats: ['csv', 'json'], selectionSchema: inventorySelectionSchema,
        async assertAccess(context) {
            assertSiteTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const version = reportSourceVersion('backlinks.inventory', await inventoryArchive(db, site.domain, {}));
            if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== version)
                throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
        },
        async compose(context) {
            assertSiteTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const archived = await inventoryArchive(db, site.domain, context.selection);
            const stamps = archived.map((row) => String(row.capturedAt));
            const observedAt = stamps.at(-1) ?? site.updatedAt;
            const date = reportSourceDate({ id: 'backlink-observation', label: reportCopy(context.locale, 'sources.backlinkObservation'), kind: 'provider_observation', ...(stamps.length ? { from: stamps[0]!, to: stamps.at(-1)! } : { observedAt }), sourceNoteKey: 'backlinks.observation', freshness: 'unknown' });
            const rows = archived.map((row, index): ReportTableRowInput => ({ id: `backlink-${index + 1}`, values: ['backlink', String(row.domainFrom ?? ''), String(row.urlFrom ?? ''), String(row.urlTo ?? ''), stableReportJson({ anchor: row.anchor ?? null, dofollow: row.dofollow ?? null, broken: row.isBroken ?? null, spamScore: row.backlinkSpamScore ?? null, targetSpamScore: row.urlToSpamScore ?? null }), textValue(row.firstSeen), textValue(row.lastSeen), 'observation'], sourceDateId: 'backlink-observation' }));
            return { document: baseDocument({ kind: 'backlinks.inventory', stem: 'backlinksInventory', locale: context.locale, branding: context.branding, subject: site.displayName || site.domain, selection: context.selection, sourceDates: [date], rows, notes: [reportSourceNote({ id: 'backlink-note', sourceDateId: date.id, methodology: reportCopy(context.locale, 'notes.backlinkObservation') })] }), sourceVersion: reportSourceVersion('backlinks.inventory', await inventoryArchive(db, site.domain, {})) };
        },
        render: ({ document, format, snapshotCreatedAt }) => renderReportDocument({ document, format, snapshotCreatedAt }),
    };
}
function deepRows(run: Awaited<ReturnType<typeof getBacklinkDeepRun>>): ReportTableRowInput[] {
    if (!run.result)
        return [];
    return run.result.rows.map((item, index) => {
        const row = record(item)!;
        const domain = textValue(row.domain) ?? run.domain;
        const first = textValue(row.firstSeen) ?? (typeof row.year === 'number' && typeof row.month === 'number' ? `${row.year}-${String(row.month).padStart(2, '0')}` : null);
        return { id: `deep-${index + 1}`, values: [run.type, domain, null, textValue(row.anchor) ?? String(row.rank ?? row.backlinks ?? ''), stableReportJson(row), first, textValue(row.lastSeen), 'observation'], sourceDateId: 'backlink-observation' };
    });
}
function deepAdapter(db: Db): ReportExportAdapter<DeepSelection> {
    return {
        kind: 'backlinks.deep_run', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: deepSelectionSchema,
        async assertAccess(context) { assertRunTarget(context.target); const run = await getBacklinkDeepRun(context.accountId, context.target.resourceId, db); if (run.siteId !== context.target.siteId)
            throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' }); const version = reportSourceVersion('backlinks.deep_run', run); if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== version)
            throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' }); },
        async compose(context) {
            assertRunTarget(context.target);
            const run = await getBacklinkDeepRun(context.accountId, context.target.resourceId, db);
            if (run.siteId !== context.target.siteId)
                throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' });
            if (context.selection.operation && context.selection.operation !== run.type)
                throw HttpError.notFound({ code: 'REPORT_EXPORTS_ERRORS_NOT_FOUND', messageKey: 'reportExports.errors.notFound' });
            const site = await getSite(context.accountId, run.siteId);
            const at = run.result?.observation.capturedAt ?? run.completedAt ?? run.createdAt;
            const date = reportSourceDate({ id: 'backlink-observation', label: reportCopy(context.locale, 'sources.backlinkObservation'), kind: 'provider_observation', observedAt: at, sourceNoteKey: 'backlinks.observation', freshness: 'unknown' });
            return { document: baseDocument({ kind: 'backlinks.deep_run', stem: 'backlinksDeepRun', locale: context.locale, branding: context.branding, subject: site.displayName || site.domain, selection: context.selection, sourceDates: [date], rows: deepRows(run), notes: [reportSourceNote({ id: 'backlink-note', sourceDateId: date.id, methodology: reportCopy(context.locale, 'notes.backlinkObservation') })] }), sourceVersion: reportSourceVersion('backlinks.deep_run', run) };
        }, render: ({ document, format, snapshotCreatedAt }) => renderReportDocument({ document, format, snapshotCreatedAt }),
    };
}
function gapAdapter(db: Db): ReportExportAdapter<GapSelection> {
    return {
        kind: 'backlinks.gap_run', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: gapSelectionSchema,
        async assertAccess(context) { assertRunTarget(context.target); const run = await getLinkGapRun(context.accountId, context.target.resourceId, db); if (run.siteId !== context.target.siteId)
            throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' }); const version = reportSourceVersion('backlinks.gap_run', run); if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== version)
            throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' }); },
        async compose(context) {
            assertRunTarget(context.target);
            const run = await getLinkGapRun(context.accountId, context.target.resourceId, db);
            if (run.siteId !== context.target.siteId)
                throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' });
            const site = await getSite(context.accountId, run.siteId);
            const legs = [...run.legs].filter((leg) => !context.selection.competitor || leg.competitor === context.selection.competitor).filter((leg) => !context.selection.legStatus || leg.status === context.selection.legStatus).sort((a, b) => stableSortText(a.competitor, b.competitor));
            const rows = legs.flatMap((leg) => leg.result ? leg.result.rows.map((item): ReportTableRowInput => ({ values: ['gap', item.domain, null, String(item.intersections), stableReportJson({ ownDomain: run.ownDomain, competitor: leg.competitor, rank: item.rank, overlap: leg.result.overlap, legStatus: leg.status }), item.firstSeen, leg.result.observation.capturedAt, 'observation'], sourceDateId: 'backlink-observation' })) : [{ values: ['gap-unavailable', leg.competitor, null, '', stableReportJson({ ownDomain: run.ownDomain, legStatus: leg.status, retainedCount: leg.retainedCount }), null, run.completedAt, 'unavailable'], sourceDateId: 'backlink-derived' }]).map((row, index) => ({ ...row, id: `gap-${index + 1}` }));
            const at = legs.flatMap((leg) => leg.result?.observation.capturedAt ?? []).sort(stableSortText).at(-1) ?? run.completedAt ?? run.createdAt;
            const dates = [reportSourceDate({ id: 'backlink-observation', label: reportCopy(context.locale, 'sources.backlinkObservation'), kind: 'provider_observation', observedAt: at, sourceNoteKey: 'backlinks.observation', freshness: 'unknown' }), reportSourceDate({ id: 'backlink-derived', label: reportCopy(context.locale, 'sources.backlinkDerived'), kind: 'derived', observedAt: run.completedAt ?? run.createdAt, sourceNoteKey: 'backlinks.derived', freshness: 'unknown' })];
            return { document: baseDocument({ kind: 'backlinks.gap_run', stem: 'backlinksGapRun', locale: context.locale, branding: context.branding, subject: site.displayName || site.domain, selection: context.selection, sourceDates: dates, rows, notes: [reportSourceNote({ id: 'backlink-note', sourceDateId: 'backlink-observation', methodology: reportCopy(context.locale, 'notes.backlinkObservation') }), reportSourceNote({ id: 'gap-note', sourceDateId: 'backlink-derived', methodology: reportCopy(context.locale, 'notes.backlinkGapDerived') })] }), sourceVersion: reportSourceVersion('backlinks.gap_run', run) };
        }, render: ({ document, format, snapshotCreatedAt }) => renderReportDocument({ document, format, snapshotCreatedAt }),
    };
}
async function toxicityOwned(db: Db, accountId: string, target: ReportSourceTarget, band?: (typeof TOXICITY_BANDS)[number]) {
    assertRunTarget(target);
    const run = await getToxicityReview(accountId, target.resourceId, { ...(band ? { band } : {}) }, db);
    if (run.siteId !== target.siteId)
        throw HttpError.notFound({ code: 'BACKLINKS_ERRORS_SITE_NOT_FOUND', messageKey: 'backlinks.errors.siteNotFound' });
    return run;
}
function toxicityAdapter(db: Db): ReportExportAdapter<ToxicitySelection> {
    return {
        kind: 'backlinks.toxicity_run', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema: toxicitySelectionSchema,
        async assertAccess(context) { const run = await toxicityOwned(db, context.accountId, context.target); const version = reportSourceVersion('backlinks.toxicity_run', run); if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== version)
            throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' }); },
        async compose(context) {
            const run = await toxicityOwned(db, context.accountId, context.target, context.selection.band);
            const site = await getSite(context.accountId, run.siteId);
            const filtered = run.rows.filter((row) => !context.selection.signal || row.signals.includes(context.selection.signal)).filter((row) => context.selection.dofollow === undefined || row.dofollow === context.selection.dofollow).filter((row) => context.selection.broken === undefined || row.isBroken === context.selection.broken).sort((a, b) => b.spamScore - a.spamScore || stableSortText(a.domain, b.domain) || stableSortText(a.url, b.url));
            const rows = filtered.map((row, index): ReportTableRowInput => ({ id: `toxicity-${index + 1}`, values: ['toxicity', row.domain, row.url, `${row.band}:${row.spamScore}`, stableReportJson({ signals: row.signals, dofollow: row.dofollow, broken: row.isBroken, rubricVersion: row.rubricVersion, rationale: row.rationale }), row.firstSeen, row.lastSeen ?? row.capturedAt, row.sourceKind], sourceDateIds: ['toxicity-derived', 'toxicity-observation', 'toxicity-observation', 'toxicity-derived', row.rationale.text ? 'toxicity-generated' : 'toxicity-derived', 'toxicity-observation', 'toxicity-observation', 'toxicity-observation'] }));
            const at = filtered.map((row) => row.capturedAt).sort(stableSortText).at(-1) ?? run.completedAt ?? run.createdAt;
            const dates = [reportSourceDate({ id: 'toxicity-observation', label: reportCopy(context.locale, 'sources.backlinkObservation'), kind: 'provider_observation', observedAt: at, sourceNoteKey: 'backlinks.observation', freshness: 'unknown' }), reportSourceDate({ id: 'toxicity-derived', label: reportCopy(context.locale, 'sources.toxicityDerived'), kind: 'derived', observedAt: run.completedAt ?? run.createdAt, sourceNoteKey: 'backlinks.toxicity', freshness: 'unknown' }), reportSourceDate({ id: 'toxicity-generated', label: reportCopy(context.locale, 'sources.toxicityGenerated'), kind: 'generated', observedAt: run.completedAt ?? run.createdAt, sourceNoteKey: 'backlinks.toxicityGenerated', freshness: 'unknown' })];
            const versionRun = context.selection.band ? await toxicityOwned(db, context.accountId, context.target) : run;
            return { document: baseDocument({ kind: 'backlinks.toxicity_run', stem: 'backlinksToxicityRun', locale: context.locale, branding: context.branding, subject: site.displayName || site.domain, selection: context.selection, sourceDates: dates, rows, notes: [reportSourceNote({ id: 'toxicity-observation-note', sourceDateId: 'toxicity-observation', methodology: reportCopy(context.locale, 'notes.backlinkObservation') }), reportSourceNote({ id: 'toxicity-derived-note', sourceDateId: 'toxicity-derived', methodology: reportCopy(context.locale, 'notes.toxicityDerived') }), reportSourceNote({ id: 'toxicity-generated-note', sourceDateId: 'toxicity-generated', methodology: reportCopy(context.locale, 'notes.toxicityGenerated') })] }), sourceVersion: reportSourceVersion('backlinks.toxicity_run', versionRun) };
        }, render: ({ document, format, snapshotCreatedAt }) => renderReportDocument({ document, format, snapshotCreatedAt }),
    };
}
function disavowAdapter(db: Db): ReportExportAdapter<DisavowSelection> {
    return {
        kind: 'backlinks.disavow', kindVersion: 1, supportedFormats: ['txt'], selectionSchema: disavowBuildBodySchema,
        async assertAccess(context) { const run = await toxicityOwned(db, context.accountId, context.target); const version = reportSourceVersion('backlinks.disavow', run); if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== version)
            throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' }); },
        async compose(context) {
            const run = await toxicityOwned(db, context.accountId, context.target);
            const site = await getSite(context.accountId, run.siteId);
            const generatedOn = new Date(run.completedAt ?? run.createdAt);
            const output = await buildToxicityDisavow(context.accountId, run.runId, context.selection, db, generatedOn);
            const bytes = Buffer.from(output.text, 'utf8');
            const sha256 = createHash('sha256').update(bytes).digest('hex');
            const date = reportSourceDate({ id: 'disavow-derived', label: reportCopy(context.locale, 'sources.disavowDerived'), kind: 'derived', observedAt: generatedOn, sourceNoteKey: 'backlinks.disavow', freshness: 'unknown' });
            const artifact = { id: 'disavow-text', label: output.filename, format: 'txt' as const, mediaType: REPORT_NATIVE_MEDIA_TYPES.txt, extension: 'txt' as const, byteLength: bytes.byteLength, sha256, validation: 'valid' as const };
            const directiveRows = output.text.split('\n').map((line, index): ReportTableRowInput => ({ id: `disavow-line-${index + 1}`, values: [line], sourceDateId: 'disavow-derived' }));
            const document = baseDocument({ kind: 'backlinks.disavow', stem: 'backlinksDisavow', locale: context.locale, branding: context.branding, subject: site.displayName || site.domain, selection: context.selection, sourceDates: [date], rows: context.selection.entries.map((entry) => ({ values: [entry.rowId] })), notes: [], artifacts: [artifact], blocks: [reportTable({ id: 'disavow-text-source', columns: [{ key: 'directive', label: reportCopy(context.locale, 'fields.value'), valueType: 'string' }], rows: directiveRows }), { type: 'native_artifact', id: 'disavow-artifact', artifactId: artifact.id }, reportSourceNote({ id: 'disavow-note', sourceDateId: date.id, methodology: reportCopy(context.locale, 'notes.disavowDerived') })] });
            return { document, sourceVersion: reportSourceVersion('backlinks.disavow', run) };
        },
        render: ({ document, format, snapshotCreatedAt }) => renderReportDocument({ document, format, snapshotCreatedAt, renderNative: async (): Promise<ReportRenderedResult> => { const block = document.blocks.find((item) => item.type === 'table' && item.id === 'disavow-text-source'); if (!block || block.type !== 'table')
                throw new Error('canonical disavow text is missing'); const lines = block.rows.map((row) => { const value = row.cells[0]?.value; if (!value || value.type !== 'string')
                throw new Error('canonical disavow line is invalid'); return value.value; }); return { format: 'txt', mediaType: REPORT_NATIVE_MEDIA_TYPES.txt, extension: 'txt', bytes: Buffer.from(lines.join('\n'), 'utf8') }; } }),
    };
}
export function createBacklinkReportExportAdapters(db: Db): ReportExportAdapter[] {
    return [summaryAdapter(db), inventoryAdapter(db), deepAdapter(db), gapAdapter(db), toxicityAdapter(db), disavowAdapter(db)];
}
export const backlinkReportExportTestables = {
    record,
    textValue,
    boolValue,
    assertSiteTarget,
    assertRunTarget,
    tableColumns,
    selectionItems,
    baseDocument,
    latestSummary,
    inventoryArchive,
    compareInventoryRows,
    deepRows,
    toxicityOwned,
};
