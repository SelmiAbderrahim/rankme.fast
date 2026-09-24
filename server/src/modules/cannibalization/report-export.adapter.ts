import { z } from 'zod';
import { REPORT_DOCUMENT_SCHEMA, REPORT_DOCUMENT_SCHEMA_VERSION, renderReportDocument, reportCatalogCopy, reportCopy, reportSourceDate, reportSourceNote, reportSourceVersion, reportTable, stableReportJson, stableSortText, type ReportDocumentV1, } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { ReportExportAdapter } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { getReport } from './cannibalization.service.js';
const selectionSchema = z.object({
    confidence: z.enum(['low', 'medium', 'high']).optional(),
    candidateId: z.string().trim().min(1).max(200).optional(),
}).strict();
type Selection = z.infer<typeof selectionSchema>;
async function loadOwned(accountId: string, target: Parameters<ReportExportAdapter['assertAccess']>[0]['target']) {
    if (target.scope !== 'site_resource')
        throw HttpError.notFound({ code: 'CANNIBALIZATION_ERRORS_NOT_FOUND', messageKey: 'cannibalization.errors.notFound' });
    const report = await getReport({ accountId, reportId: target.resourceId });
    if (report.siteId !== target.siteId)
        throw HttpError.notFound({ code: 'CANNIBALIZATION_ERRORS_NOT_FOUND', messageKey: 'cannibalization.errors.notFound' });
    return report;
}
function compareCandidates(left: Awaited<ReturnType<typeof getReport>>['candidates'][number], right: Awaited<ReturnType<typeof getReport>>['candidates'][number]): number {
    return stableSortText(left.query, right.query) || stableSortText(left.id, right.id);
}
function comparePages(left: Awaited<ReturnType<typeof getReport>>['candidates'][number]['pages'][number], right: Awaited<ReturnType<typeof getReport>>['candidates'][number]['pages'][number]): number {
    return Number(right.isPrimary) - Number(left.isPrimary) || stableSortText(left.url, right.url);
}
export function createCannibalizationReportExportAdapter(): ReportExportAdapter<Selection> {
    return {
        kind: 'keyword.cannibalization', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema,
        async assertAccess(context) {
            const report = await loadOwned(context.accountId, context.target);
            const version = reportSourceVersion('keyword.cannibalization', report);
            if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== version)
                throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
        },
        async compose(context) {
            const report = await loadOwned(context.accountId, context.target);
            const site = await getSite(context.accountId, report.siteId);
            const candidates = [...report.candidates]
                .filter((candidate) => !context.selection.confidence || candidate.confidence === context.selection.confidence)
                .filter((candidate) => !context.selection.candidateId || candidate.id === context.selection.candidateId)
                .sort(compareCandidates);
            const rows = candidates.flatMap((candidate) => [...candidate.pages]
                .sort(comparePages)
                .map((page) => ({
                values: [candidate.id, candidate.query, page.url, stableReportJson({ clicks: page.clicks, impressions: page.impressions, ctr: page.impressions > 0 ? page.clicks / page.impressions : null, position: page.position }), stableReportJson({ clickShare: page.clickShare, impressionShare: page.impressionShare, totalClicks: candidate.totalClicks, totalImpressions: candidate.totalImpressions }), stableReportJson({ confidence: candidate.confidence, isPrimary: page.isPrimary, primaryUrl: candidate.primaryUrl, primaryReason: candidate.primaryReason }), candidate.snapshotDate, candidate.sourceKind],
                sourceDateIds: ['cannibal-derived', 'cannibal-observation', 'cannibal-observation', 'cannibal-observation', 'cannibal-derived', 'cannibal-derived', 'cannibal-observation', 'cannibal-observation'],
            }))).map((row, index) => ({ ...row, id: `candidate-page-${index + 1}` }));
            const sourceDates: ReportDocumentV1['sourceDates'] = [
                reportSourceDate({ id: 'cannibal-observation', label: reportCopy(context.locale, 'sources.cannibalizationObservation'), kind: 'first_party_observation', observedAt: report.snapshotDate, sourceNoteKey: 'cannibalization.observation', freshness: 'unknown' }),
                reportSourceDate({ id: 'cannibal-derived', label: reportCopy(context.locale, 'sources.cannibalizationDerived'), kind: 'derived', observedAt: report.generatedAt, sourceNoteKey: 'cannibalization.derived', freshness: 'unknown' }),
            ];
            const document: ReportDocumentV1 = {
                schema: REPORT_DOCUMENT_SCHEMA, schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
                kind: 'keyword.cannibalization', kindVersion: 1, locale: context.locale,
                title: reportCatalogCopy(context.locale, 'keywordCannibalization', 'title'),
                subject: [{ label: reportCopy(context.locale, 'fields.site'), value: site.displayName || site.domain }],
                selection: Object.keys(context.selection).sort(stableSortText).map((key) => ({ label: reportCopy(context.locale, `fields.${key}`), value: String(context.selection[key as keyof Selection] ?? '') })), sourceDates,
                completeness: { state: 'complete', selectedItems: rows.length, representedItems: rows.length, bound: reportCatalogCopy(context.locale, 'keywordCannibalization', 'bound') },
                branding: context.branding,
                blocks: [
                    reportTable({ id: 'cannibalization', columns: [
                            { key: 'candidateId', label: reportCopy(context.locale, 'fields.candidateId'), valueType: 'string' },
                            { key: 'query', label: reportCopy(context.locale, 'fields.query'), valueType: 'string' },
                            { key: 'url', label: reportCopy(context.locale, 'fields.url'), valueType: 'url' },
                            { key: 'metrics', label: reportCopy(context.locale, 'fields.metric'), valueType: 'string' },
                            { key: 'shares', label: reportCopy(context.locale, 'fields.coverage'), valueType: 'string' },
                            { key: 'primary', label: reportCopy(context.locale, 'fields.primary'), valueType: 'string' },
                            { key: 'snapshotDate', label: reportCopy(context.locale, 'fields.snapshotDate'), valueType: 'date' },
                            { key: 'source', label: reportCopy(context.locale, 'fields.source'), valueType: 'string' },
                        ], rows }),
                    reportSourceNote({ id: 'cannibalization-observation-note', sourceDateId: 'cannibal-observation', methodology: reportCopy(context.locale, 'notes.cannibalizationObservation') }),
                    reportSourceNote({ id: 'cannibalization-derived-note', sourceDateId: 'cannibal-derived', methodology: reportCopy(context.locale, 'notes.cannibalizationDerived') }),
                ], artifacts: [],
            };
            return { document, sourceVersion: reportSourceVersion('keyword.cannibalization', report) };
        },
        render: ({ document, format, snapshotCreatedAt }) => renderReportDocument({ document, format, snapshotCreatedAt }),
    };
}
export const cannibalizationReportExportTestables = Object.freeze({
    selectionSchema,
    compareCandidates,
    comparePages,
});
