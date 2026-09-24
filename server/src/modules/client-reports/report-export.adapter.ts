import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { env } from '../../config/env.js';
import { REPORT_DOCUMENT_SCHEMA, REPORT_DOCUMENT_SCHEMA_VERSION, renderReportDocument, reportCatalogCopy, reportCopy, reportSourceDate, reportSourceNote, reportSourceVersion, reportTable, type ReportBlockV1, type ReportDocumentV1, } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { ReportExportAdapter } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { clientReportSectionsSchema } from './client-reports.schema.js';
import { composeClientReport, inspectClientReportCompleteness, } from './report-composer.service.js';
const clientExportSelectionSchema = z.object({
    sections: clientReportSectionsSchema.default({ audit: true, ranks: true, gsc: true }),
}).strict();
type ClientExportSelection = z.infer<typeof clientExportSelectionSchema>;
const ALL_CLIENT_REPORT_SECTIONS = Object.freeze({
    audit: true,
    ranks: true,
    gsc: true,
});
function clientSnapshotVersion(snapshot: unknown): string {
    return reportSourceVersion('client', snapshot);
}
function ensureClientStateSource(sourceDates: ReportDocumentV1['sourceDates'], locale: ReportDocumentV1['locale'], generatedAt: string): string {
    const sourceId = 'client-state';
    if (!sourceDates.some((date) => date.id === sourceId)) {
        sourceDates.push(reportSourceDate({
            id: sourceId,
            label: reportCopy(locale, 'sources.snapshotState'),
            kind: 'derived',
            observedAt: generatedAt,
            sourceNoteKey: 'client.state',
            freshness: 'unknown',
        }));
    }
    return sourceId;
}
export function createClientReportExportAdapter(db: Db): ReportExportAdapter<ClientExportSelection> {
    return {
        kind: 'client.composite',
        kindVersion: 1,
        supportedFormats: ['pdf', 'json'],
        selectionSchema: clientExportSelectionSchema,
        async assertAccess(context) {
            if (context.target.scope !== 'site')
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            await getSite(context.accountId, context.target.siteId);
            if (!env.CLIENT_REPORTS_ENABLED)
                throw HttpError.notFound({ code: 'CLIENT_REPORTS_ERRORS_UNAVAILABLE', messageKey: 'clientReports.errors.unavailable' });
            if (context.purpose === 'persist' && context.sourceVersion) {
                const current = await composeClientReport({
                    accountId: context.accountId,
                    siteId: context.target.siteId,
                    locale: context.locale,
                    sections: ALL_CLIENT_REPORT_SECTIONS,
                }, db);
                if (clientSnapshotVersion(current) !== context.sourceVersion) {
                    throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
                }
            }
        },
        async compose(context) {
            if (context.target.scope !== 'site')
                throw HttpError.notFound({ code: 'SITES_ERRORS_NOT_FOUND', messageKey: 'sites.errors.notFound' });
            const selectedInput = {
                accountId: context.accountId,
                siteId: context.target.siteId,
                locale: context.locale,
                sections: context.selection.sections,
            } as const;
            const snapshot = await composeClientReport({
                ...selectedInput,
                sections: ALL_CLIENT_REPORT_SECTIONS,
            }, db);
            const completeness = await inspectClientReportCompleteness(selectedInput, snapshot, db);
            if (completeness.auditFindings > 200 ||
                completeness.maxAffectedUrls > 10 ||
                completeness.rankRows > 25 ||
                completeness.gscQueries > 5) {
                throw new HttpError(422, { code: 'REPORT_EXPORTS_ERRORS_SCOPE_TOO_LARGE', messageKey: 'reportExports.errors.scopeTooLarge' }, {
                    code: 'scope_too_large',
                    narrowingFields: ['sections'],
                });
            }
            const sourceDates: ReportDocumentV1['sourceDates'] = [];
            const blocks: ReportBlockV1[] = [];
            let representedItems = 0;
            if (context.selection.sections.audit) {
                const audit = snapshot.sections.audit;
                if (!audit) {
                    const sourceId = ensureClientStateSource(sourceDates, context.locale, snapshot.generatedAt);
                    blocks.push({ type: 'state', id: 'client-audit-unavailable', state: 'unavailable', reason: reportCopy(context.locale, 'states.noAuditSnapshot'), sourceDateId: sourceId });
                }
                else {
                    sourceDates.push(reportSourceDate({ id: 'client-audit', label: reportCopy(context.locale, 'sources.auditObservation'), kind: 'provider_observation', observedAt: audit.snapshotDate, sourceNoteKey: 'client.audit', freshness: 'unknown' }));
                    blocks.push({ type: 'heading', id: 'client-audit-heading', level: 2, text: reportCopy(context.locale, 'sections.findings') });
                    blocks.push({ type: 'kpi_group', id: 'client-audit-counts', items: [
                            ['fix-now', 'fields.fixNow', audit.report.counts.fixNow],
                            ['watch', 'fields.watch', audit.report.counts.watch],
                            ['passed', 'fields.passed', audit.report.counts.passed],
                        ].map(([id, key, value]) => ({ id: String(id), label: reportCopy(context.locale, String(key)), value: { type: 'number' as const, value: Number(value) }, sourceDateId: 'client-audit' })) });
                    blocks.push({ type: 'findings', id: 'client-audit-findings', items: audit.report.findings.map((finding, index) => ({
                            id: `finding-${index + 1}`,
                            ruleKey: finding.ruleId,
                            bucket: finding.bucket === 'fix-now' ? 'fix_now' : finding.bucket,
                            severity: finding.severity === 'critical' ? 'critical' : finding.severity === 'warning' ? 'high' : 'info',
                            title: finding.copy.title,
                            why: finding.copy.reason ?? finding.copy.why,
                            ...(finding.bucket === 'passed' ? { pass: finding.copy.passedLabel } : { fix: finding.copy.fix }),
                            affectedUrls: [...finding.affectedUrls].sort(),
                            evidence: [],
                            sourceDateId: 'client-audit',
                        })) });
                    if (audit.report.aiSummary) {
                        sourceDates.push(reportSourceDate({ id: 'client-summary', label: reportCopy(context.locale, 'sources.generatedSummary'), kind: 'generated', observedAt: audit.report.aiSummary.createdAt, sourceNoteKey: 'client.summary' }));
                        blocks.push({ type: 'prose', id: 'client-audit-summary', tone: 'summary', text: audit.report.aiSummary.text });
                    }
                    representedItems += audit.report.findings.length;
                }
            }
            if (context.selection.sections.ranks) {
                const ranks = snapshot.sections.ranks;
                if (!ranks) {
                    const sourceId = ensureClientStateSource(sourceDates, context.locale, snapshot.generatedAt);
                    blocks.push({ type: 'state', id: 'client-ranks-unavailable', state: 'unavailable', reason: reportCopy(context.locale, 'states.noRankSnapshot'), sourceDateId: sourceId });
                }
                else {
                    const oldest = ranks.rows.map((row) => row.checkedAt).sort()[0] ?? ranks.snapshotDate;
                    sourceDates.push(reportSourceDate({ id: 'client-ranks', label: reportCopy(context.locale, 'sources.rankObservation'), kind: 'provider_observation', from: oldest, to: ranks.snapshotDate, sourceNoteKey: 'client.ranks', freshness: 'unknown' }));
                    blocks.push({ type: 'heading', id: 'client-ranks-heading', level: 2, text: reportCopy(context.locale, 'sections.ranks') });
                    blocks.push(reportTable({ id: 'client-ranks', columns: [
                            { key: 'keyword', label: reportCopy(context.locale, 'fields.keyword'), valueType: 'string' },
                            { key: 'engine', label: reportCopy(context.locale, 'fields.engine'), valueType: 'string' },
                            { key: 'position', label: reportCopy(context.locale, 'fields.position'), valueType: 'number' },
                            { key: 'status', label: reportCopy(context.locale, 'fields.status'), valueType: 'string' },
                            { key: 'checked', label: reportCopy(context.locale, 'fields.checkedAt'), valueType: 'date' },
                        ], rows: ranks.rows.map((row, index) => ({ id: `rank-${index + 1}`, values: [row.keyword, row.engine, row.position, row.position === null ? reportCopy(context.locale, 'values.notRanked') : reportCopy(context.locale, 'values.observed'), row.checkedAt], sourceDateId: 'client-ranks' })) }));
                    representedItems += ranks.rows.length;
                }
            }
            if (context.selection.sections.gsc) {
                const gsc = snapshot.sections.gsc;
                if (!gsc) {
                    const sourceId = ensureClientStateSource(sourceDates, context.locale, snapshot.generatedAt);
                    blocks.push({ type: 'state', id: 'client-gsc-unavailable', state: 'unavailable', reason: reportCopy(context.locale, 'states.gscUnavailable'), sourceDateId: sourceId });
                }
                else {
                    const from = new Date(new Date(`${gsc.snapshotDate}T00:00:00.000Z`).getTime() - 27 * 24 * 60 * 60 * 1000).toISOString();
                    sourceDates.push(reportSourceDate({ id: 'client-gsc', label: reportCopy(context.locale, 'sources.gscObservation'), kind: 'first_party_observation', from, to: gsc.snapshotDate, sourceNoteKey: 'client.gsc', lagDays: 3, freshness: 'unknown' }));
                    blocks.push({ type: 'heading', id: 'client-gsc-heading', level: 2, text: reportCopy(context.locale, 'sections.gsc') });
                    blocks.push({ type: 'kpi_group', id: 'client-gsc-totals', items: [
                            ['clicks', 'fields.clicks', gsc.totalClicks],
                            ['impressions', 'fields.impressions', gsc.totalImpressions],
                            ['ctr', 'fields.ctr', gsc.averageCtr * 100],
                            ['position', 'fields.position', gsc.averagePosition],
                        ].map(([id, key, value]) => ({ id: String(id), label: reportCopy(context.locale, String(key)), value: { type: 'number' as const, value: Number(value) }, ...(id === 'ctr' ? { unit: '%' } : {}), sourceDateId: 'client-gsc' })) });
                    blocks.push(reportTable({ id: 'client-gsc-queries', columns: [
                            { key: 'query', label: reportCopy(context.locale, 'fields.query'), valueType: 'string' },
                            { key: 'clicks', label: reportCopy(context.locale, 'fields.clicks'), valueType: 'number' },
                            { key: 'impressions', label: reportCopy(context.locale, 'fields.impressions'), valueType: 'number' },
                            { key: 'ctr', label: reportCopy(context.locale, 'fields.ctr'), valueType: 'number', unit: '%' },
                            { key: 'position', label: reportCopy(context.locale, 'fields.position'), valueType: 'number' },
                            { key: 'snapshot', label: reportCopy(context.locale, 'fields.snapshotDate'), valueType: 'string' },
                        ], rows: gsc.topQueries.map((row, index) => ({ id: `query-${index + 1}`, values: [row.query, row.clicks, row.impressions, row.ctr * 100, row.position, row.snapshotDate], sourceDateId: 'client-gsc' })) }));
                    representedItems += gsc.topQueries.length;
                }
            }
            if (sourceDates.length === 0) {
                throw HttpError.conflict({ code: 'CLIENT_REPORTS_ERRORS_NO_SNAPSHOT', messageKey: 'clientReports.errors.noSnapshot' });
            }
            for (const source of sourceDates) {
                blocks.push(reportSourceNote({ id: `${source.id}-note`, sourceDateId: source.id, methodology: reportCopy(context.locale, source.kind === 'generated' ? 'notes.generatedSummary' : source.kind === 'first_party_observation' ? 'notes.gscObservation' : source.kind === 'provider_observation' ? 'notes.rankObservation' : 'notes.snapshotState') }));
            }
            const document: ReportDocumentV1 = {
                schema: REPORT_DOCUMENT_SCHEMA,
                schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
                kind: 'client.composite',
                kindVersion: 1,
                locale: context.locale,
                title: reportCatalogCopy(context.locale, 'clientComposite', 'title'),
                subject: [{ label: reportCopy(context.locale, 'fields.site'), value: snapshot.siteLabel }],
                selection: [{ label: reportCopy(context.locale, 'fields.sections'), value: Object.entries(context.selection.sections).filter(([, selected]) => selected).map(([section]) => section).join(', ') }],
                sourceDates,
                completeness: { state: 'complete', selectedItems: representedItems, representedItems, bound: reportCatalogCopy(context.locale, 'clientComposite', 'bound') },
                branding: context.branding,
                blocks,
                artifacts: [],
            };
            return { sourceVersion: clientSnapshotVersion(snapshot), document };
        },
        render: (context) => renderReportDocument({ ...context, renderNative: async () => { throw new Error('native format unsupported'); } }),
    };
}
export const clientReportExportAdapterTestables = Object.freeze({
    clientExportSelectionSchema,
    allSections: ALL_CLIENT_REPORT_SECTIONS,
    clientSnapshotVersion,
    ensureClientStateSource,
});
