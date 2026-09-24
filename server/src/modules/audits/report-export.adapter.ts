import { z } from 'zod';
import { REPORT_DOCUMENT_SCHEMA, REPORT_DOCUMENT_SCHEMA_VERSION, REPORT_GLOBAL_BOUNDS, REPORT_MAX_AFFECTED_URLS_PER_FINDING, renderReportDocument, reportCatalogCopy, reportCopy, reportIsoDateTime, reportSourceDate, reportSourceNote, reportSourceVersion, stableReportJson, reportTable, type ReportBlockV1, type ReportDocumentV1, type ReportTableRowInput, } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { ReportExportAdapter } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { getAuditRun, resolveOwnedAuditRunSiteId } from './audits.service.js';
import { getAuditReport, type AuditReport } from './report.service.js';
const AUDIT_SECTIONS = [
    'findings',
    'pagespeed',
    'gsc',
    'aiVisibility',
    'localSeo',
    'summary',
] as const;
const auditExportSelectionSchema = z
    .object({
    buckets: z
        .array(z.enum(['fixNow', 'watch', 'passed']))
        .min(1)
        .max(3)
        .default(['fixNow', 'watch', 'passed']),
    sections: z
        .array(z.enum(AUDIT_SECTIONS))
        .min(1)
        .max(AUDIT_SECTIONS.length)
        .default([...AUDIT_SECTIONS]),
})
    .strict();
type AuditExportSelection = z.infer<typeof auditExportSelectionSchema>;
function auditBucket(bucket: AuditReport['findings'][number]['bucket']) {
    return bucket === 'fix-now' ? 'fixNow' : bucket;
}
function canonicalBucket(bucket: AuditReport['findings'][number]['bucket']) {
    return bucket === 'fix-now' ? ('fix_now' as const) : bucket;
}
function canonicalSeverity(severity: AuditReport['findings'][number]['severity']) {
    if (severity === 'critical')
        return 'critical' as const;
    if (severity === 'warning')
        return 'high' as const;
    return 'info' as const;
}
async function auditSourceVersion(accountId: string, runId: string, locale: ReportDocumentV1['locale']): Promise<string> {
    const [{ run }, report] = await Promise.all([
        getAuditRun({ accountId, runId }),
        getAuditReport({ accountId, runId, locale }),
    ]);
    if (run.status !== 'succeeded' || !run.finishedAt) {
        throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    }
    return reportSourceVersion('audit', {
        runId,
        finishedAt: run.finishedAt,
        updatedAt: run.updatedAt,
        report,
    });
}
function sourceDates(locale: ReportDocumentV1['locale'], finishedAt: string, report: AuditReport): ReportDocumentV1['sourceDates'] {
    const dates: ReportDocumentV1['sourceDates'] = [
        reportSourceDate({
            id: 'audit-observation',
            label: reportCopy(locale, 'sources.auditObservation'),
            kind: 'provider_observation',
            observedAt: finishedAt,
            sourceNoteKey: 'audit.observation',
            freshness: 'unknown',
        }),
        reportSourceDate({
            id: 'audit-derived',
            label: reportCopy(locale, 'sources.auditDerived'),
            kind: 'derived',
            observedAt: finishedAt,
            sourceNoteKey: 'audit.derived',
        }),
        reportSourceDate({
            id: 'audit-pagespeed',
            label: reportCopy(locale, 'sources.pageSpeedEstimate'),
            kind: 'estimate',
            observedAt: finishedAt,
            sourceNoteKey: 'audit.pagespeed',
        }),
        reportSourceDate({
            id: 'audit-gsc',
            label: reportCopy(locale, 'sources.gscObservation'),
            kind: 'first_party_observation',
            observedAt: finishedAt,
            sourceNoteKey: 'audit.gsc',
        }),
        reportSourceDate({
            id: 'audit-local',
            label: reportCopy(locale, 'sources.localObservation'),
            kind: 'provider_observation',
            observedAt: finishedAt,
            sourceNoteKey: 'audit.local',
        }),
    ];
    if (report.aiSummary) {
        dates.push(reportSourceDate({
            id: 'audit-summary',
            label: reportCopy(locale, 'sources.generatedSummary'),
            kind: 'generated',
            observedAt: report.aiSummary.createdAt,
            sourceNoteKey: 'audit.summary',
        }));
    }
    return dates;
}
function auditBlocks(locale: ReportDocumentV1['locale'], report: AuditReport, selection: AuditExportSelection): {
    blocks: ReportBlockV1[];
    findingCount: number;
} {
    const enabled = new Set(selection.sections);
    const blocks: ReportBlockV1[] = [];
    const findings = report.findings.filter((finding) => selection.buckets.includes(auditBucket(finding.bucket)));
    blocks.push({
        type: 'kpi_group',
        id: 'audit-counts',
        items: [
            ['fix-now', 'fields.fixNow', report.counts.fixNow],
            ['watch', 'fields.watch', report.counts.watch],
            ['passed', 'fields.passed', report.counts.passed],
        ].map(([id, key, value]) => ({
            id: String(id),
            label: reportCopy(locale, String(key)),
            value: { type: 'number' as const, value: Number(value) },
            sourceDateId: 'audit-derived',
        })),
    });
    if (enabled.has('findings')) {
        blocks.push({
            type: 'heading',
            id: 'audit-findings-heading',
            level: 2,
            text: reportCopy(locale, 'sections.findings'),
        });
        blocks.push({
            type: 'findings',
            id: 'audit-findings',
            items: findings.map((finding, index) => ({
                id: `finding-${index + 1}`,
                ruleKey: finding.ruleId,
                bucket: canonicalBucket(finding.bucket),
                severity: canonicalSeverity(finding.severity),
                title: finding.copy.title,
                why: finding.copy.reason ?? finding.copy.why,
                ...(finding.bucket === 'passed'
                    ? { pass: finding.copy.passedLabel }
                    : { fix: finding.copy.fix }),
                affectedUrls: [...finding.affectedUrls].sort(),
                evidence: [],
                sourceDateId: 'audit-observation',
            })),
        });
        blocks.push(reportTable({
            id: 'audit-diff',
            columns: [
                { key: 'rule', label: reportCopy(locale, 'fields.rule'), valueType: 'string' },
                { key: 'url', label: reportCopy(locale, 'fields.url'), valueType: 'string' },
                { key: 'change', label: reportCopy(locale, 'fields.change'), valueType: 'string' },
            ],
            rows: report.diff.entries.map((entry, index) => ({
                id: `diff-${index + 1}`,
                values: [entry.ruleId, entry.url || reportCopy(locale, 'values.siteWide'), entry.kind],
                sourceDateId: 'audit-derived',
            })),
        }));
    }
    if (enabled.has('pagespeed')) {
        blocks.push({ type: 'heading', id: 'pagespeed-heading', level: 2, text: reportCopy(locale, 'sections.pageSpeed') });
        if (!report.pageSpeed || report.pageSpeed.status !== 'ok') {
            blocks.push({ type: 'state', id: 'pagespeed-unavailable', state: 'unavailable', reason: reportCopy(locale, 'states.pageSpeedUnavailable'), sourceDateId: 'audit-pagespeed' });
        }
        else {
            blocks.push(reportTable({
                id: 'pagespeed-samples',
                columns: [
                    { key: 'url', label: reportCopy(locale, 'fields.url'), valueType: 'url' },
                    { key: 'strategy', label: reportCopy(locale, 'fields.device'), valueType: 'string' },
                    { key: 'performance', label: reportCopy(locale, 'fields.performance'), valueType: 'number', unit: '%' },
                    { key: 'accessibility', label: reportCopy(locale, 'fields.accessibility'), valueType: 'number', unit: '%' },
                    { key: 'best-practices', label: reportCopy(locale, 'fields.bestPractices'), valueType: 'number', unit: '%' },
                    { key: 'seo', label: reportCopy(locale, 'fields.seo'), valueType: 'number', unit: '%' },
                    { key: 'lcp', label: reportCopy(locale, 'fields.lcp'), valueType: 'number', unit: 'ms' },
                    { key: 'inp', label: reportCopy(locale, 'fields.inp'), valueType: 'number', unit: 'ms' },
                    { key: 'cls', label: reportCopy(locale, 'fields.cls'), valueType: 'number' },
                    { key: 'field-level', label: reportCopy(locale, 'fields.fieldDataLevel'), valueType: 'string' },
                ],
                rows: report.pageSpeed.samples.map((sample, index) => ({
                    id: `pagespeed-${index + 1}`,
                    values: [
                        sample.url,
                        sample.strategy,
                        sample.labScores.performance,
                        sample.labScores.accessibility,
                        sample.labScores.bestPractices,
                        sample.labScores.seo,
                        sample.coreWebVitals?.lcpMs ?? null,
                        sample.coreWebVitals?.inp ?? null,
                        sample.coreWebVitals?.cls ?? null,
                        sample.fieldDataLevel,
                    ],
                    sourceDateId: 'audit-pagespeed',
                })),
            }));
        }
    }
    if (enabled.has('gsc')) {
        blocks.push({ type: 'heading', id: 'gsc-heading', level: 2, text: reportCopy(locale, 'sections.gsc') });
        if (!report.gscSearch || report.gscSearch.status !== 'ok') {
            blocks.push({ type: 'state', id: 'gsc-search-unavailable', state: 'unavailable', reason: reportCopy(locale, 'states.gscUnavailable'), sourceDateId: 'audit-gsc' });
        }
        else {
            blocks.push({
                type: 'kpi_group', id: 'gsc-totals', items: [
                    ['clicks', 'fields.clicks', report.gscSearch.totalClicks],
                    ['impressions', 'fields.impressions', report.gscSearch.totalImpressions],
                    ['ctr', 'fields.ctr', report.gscSearch.averageCtr * 100],
                    ['position', 'fields.position', report.gscSearch.averagePosition],
                ].map(([id, key, value]) => ({ id: String(id), label: reportCopy(locale, String(key)), value: { type: 'number' as const, value: Number(value) }, ...(id === 'ctr' ? { unit: '%' } : {}), sourceDateId: 'audit-gsc' })),
            });
            const analyticsColumns = [
                { key: 'item', label: reportCopy(locale, 'fields.item'), valueType: 'string' as const },
                { key: 'clicks', label: reportCopy(locale, 'fields.clicks'), valueType: 'number' as const },
                { key: 'impressions', label: reportCopy(locale, 'fields.impressions'), valueType: 'number' as const },
                { key: 'ctr', label: reportCopy(locale, 'fields.ctr'), valueType: 'number' as const, unit: '%' },
                { key: 'position', label: reportCopy(locale, 'fields.position'), valueType: 'number' as const },
            ];
            blocks.push(reportTable({ id: 'gsc-queries', columns: analyticsColumns, rows: report.gscSearch.topQueries.map((row, index) => ({ id: `query-${index + 1}`, values: [row.query, row.clicks, row.impressions, row.ctr * 100, row.position], sourceDateId: 'audit-gsc' })) }));
            blocks.push(reportTable({ id: 'gsc-pages', columns: analyticsColumns, rows: report.gscSearch.topPages.map((row, index) => ({ id: `page-${index + 1}`, values: [row.url, row.clicks, row.impressions, row.ctr * 100, row.position], sourceDateId: 'audit-gsc' })) }));
        }
        if (report.indexStatus?.status === 'ok') {
            blocks.push(reportTable({
                id: 'gsc-index-status',
                columns: [
                    { key: 'url', label: reportCopy(locale, 'fields.url'), valueType: 'url' },
                    { key: 'verdict', label: reportCopy(locale, 'fields.verdict'), valueType: 'string' },
                    { key: 'coverage', label: reportCopy(locale, 'fields.coverage'), valueType: 'string' },
                    { key: 'robots', label: reportCopy(locale, 'fields.robots'), valueType: 'string' },
                    { key: 'fetch', label: reportCopy(locale, 'fields.fetch'), valueType: 'string' },
                    { key: 'canonical', label: reportCopy(locale, 'fields.canonical'), valueType: 'string' },
                    { key: 'last-crawl', label: reportCopy(locale, 'fields.lastCrawl'), valueType: 'string' },
                    { key: 'rich-results', label: reportCopy(locale, 'fields.richResults'), valueType: 'string' },
                ],
                rows: report.indexStatus.samples.map((sample, index) => ({
                    id: `index-${index + 1}`,
                    values: [sample.url, sample.inspection.indexVerdict, sample.inspection.coverageState, sample.inspection.robotsTxtState, sample.inspection.pageFetchState, sample.inspection.googleCanonical, sample.inspection.lastCrawlTime ? reportIsoDateTime(sample.inspection.lastCrawlTime) : null, sample.inspection.richResults.items.map((item) => `${item.type}:${item.issues}`).join(', ') || sample.inspection.richResults.verdict],
                    sourceDateId: 'audit-gsc',
                })),
            }));
        }
        if (report.gscSitemaps?.status === 'ok') {
            blocks.push(reportTable({
                id: 'gsc-sitemaps',
                columns: [
                    { key: 'path', label: reportCopy(locale, 'fields.path'), valueType: 'string' },
                    { key: 'errors', label: reportCopy(locale, 'fields.errors'), valueType: 'number' },
                    { key: 'warnings', label: reportCopy(locale, 'fields.warnings'), valueType: 'number' },
                    { key: 'processed', label: reportCopy(locale, 'fields.processed'), valueType: 'number' },
                    { key: 'downloaded', label: reportCopy(locale, 'fields.lastDownloaded'), valueType: 'string' },
                ],
                rows: report.gscSitemaps.sitemaps.map((row, index) => ({ id: `sitemap-${index + 1}`, values: [row.path, row.errors, row.warnings, row.processed, row.lastDownloaded], sourceDateId: 'audit-gsc' })),
            }));
        }
    }
    if (enabled.has('aiVisibility')) {
        blocks.push({ type: 'heading', id: 'ai-visibility-heading', level: 2, text: reportCopy(locale, 'sections.aiVisibility') });
        if (!report.aiVisibility || report.aiVisibility.status !== 'ok') {
            blocks.push({ type: 'state', id: 'ai-visibility-unavailable', state: 'unavailable', reason: reportCopy(locale, 'states.aiVisibilityUnavailable'), sourceDateId: 'audit-derived' });
        }
        else {
            blocks.push({ type: 'key_value', id: 'ai-visibility-values', items: [
                    ['ai-overview-cited', 'fields.aiOverviewCited', report.aiVisibility.aiOverviewCitedCount],
                    ['ai-overview-checked', 'fields.aiOverviewChecked', report.aiVisibility.aiOverviewTotalChecked],
                    ['llm-mentioned', 'fields.llmMentioned', report.aiVisibility.llmMentionedCount],
                    ['llm-checked', 'fields.llmChecked', report.aiVisibility.llmTotalChecked],
                    ['share-of-voice', 'fields.shareOfVoice', report.aiVisibility.shareOfVoicePct],
                    ['sentiment-positive', 'fields.positive', report.aiVisibility.sentiment.positive],
                    ['sentiment-neutral', 'fields.neutral', report.aiVisibility.sentiment.neutral],
                    ['sentiment-negative', 'fields.negative', report.aiVisibility.sentiment.negative],
                ].map(([id, key, value]) => ({ id: String(id), label: reportCopy(locale, String(key)), value: value === null ? { type: 'null' as const, value: null } : { type: 'number' as const, value: Number(value) }, sourceDateId: 'audit-derived' })) });
            if (report.aiVisibility.notMentionedPrompts.length > 0) {
                blocks.push(reportTable({ id: 'ai-not-mentioned', columns: [{ key: 'prompt', label: reportCopy(locale, 'fields.prompt'), valueType: 'string' }], rows: report.aiVisibility.notMentionedPrompts.map((prompt, index) => ({ id: `prompt-${index + 1}`, values: [prompt], sourceDateId: 'audit-derived' })) }));
            }
        }
    }
    if (enabled.has('localSeo')) {
        blocks.push({ type: 'heading', id: 'local-heading', level: 2, text: reportCopy(locale, 'sections.localSeo') });
        if (!report.localSeo || report.localSeo.status !== 'ok') {
            blocks.push({ type: 'state', id: 'local-unavailable', state: 'unavailable', reason: reportCopy(locale, 'states.localUnavailable'), sourceDateId: 'audit-local' });
        }
        else {
            blocks.push(reportTable({ id: 'local-listings', columns: [
                    { key: 'source', label: reportCopy(locale, 'fields.source'), valueType: 'string' },
                    { key: 'consistent', label: reportCopy(locale, 'fields.consistent'), valueType: 'boolean' },
                ], rows: report.localSeo.listings.map((row, index) => ({ id: `listing-${index + 1}`, values: [row.source, row.consistent], sourceDateId: 'audit-local' })) }));
            blocks.push({ type: 'key_value', id: 'local-values', items: [
                    { id: 'rating', label: reportCopy(locale, 'fields.rating'), value: report.localSeo.reviews?.averageRating === null || report.localSeo.reviews === null ? { type: 'null', value: null } : { type: 'number', value: report.localSeo.reviews.averageRating }, sourceDateId: 'audit-local' },
                    { id: 'review-count', label: reportCopy(locale, 'fields.reviewCount'), value: report.localSeo.reviews ? { type: 'number', value: report.localSeo.reviews.reviewCount } : { type: 'null', value: null }, sourceDateId: 'audit-local' },
                    { id: 'unanswered', label: reportCopy(locale, 'fields.unanswered'), value: report.localSeo.qa ? { type: 'number', value: report.localSeo.qa.unansweredCount } : { type: 'null', value: null }, sourceDateId: 'audit-local' },
                    { id: 'local-position', label: reportCopy(locale, 'fields.position'), value: report.localSeo.localPack?.position === null || report.localSeo.localPack === null ? { type: 'null', value: null } : { type: 'number', value: report.localSeo.localPack.position }, sourceDateId: 'audit-local' },
                ] });
        }
    }
    if (enabled.has('summary')) {
        blocks.push({ type: 'heading', id: 'summary-heading', level: 2, text: reportCopy(locale, 'sections.summary') });
        blocks.push(report.aiSummary
            ? { type: 'prose', id: 'summary', tone: 'summary', text: report.aiSummary.text }
            : { type: 'state', id: 'summary-unavailable', state: 'unavailable', reason: reportCopy(locale, 'states.summaryUnavailable'), sourceDateId: 'audit-derived' });
    }
    blocks.push(reportSourceNote({ id: 'audit-observation-note', sourceDateId: 'audit-observation', methodology: reportCopy(locale, 'notes.auditObservation') }), reportSourceNote({ id: 'audit-derived-note', sourceDateId: 'audit-derived', methodology: reportCopy(locale, 'notes.auditDerived') }));
    return { blocks, findingCount: findings.length };
}
function auditCsvRows(document: ReportDocumentV1): ReportTableRowInput[] {
    const rows: ReportTableRowInput[] = [];
    const append = (section: string, rowId: string, data: unknown) => {
        rows.push({
            id: `audit-csv-${rows.length + 1}`,
            values: [section, rowId, stableReportJson(data)],
            sourceDateId: 'audit-derived',
        });
    };
    for (const block of document.blocks) {
        if (block.type === 'table') {
            block.rows.forEach((row, index) => append(block.id, auditCsvRowId(row.id, index), Object.fromEntries(row.cells.map((cell) => [cell.columnKey, cell.value.value]))));
            continue;
        }
        if (block.type === 'findings') {
            block.items.forEach((item) => append(block.id, item.id, item));
            continue;
        }
        if (block.type === 'kpi_group' || block.type === 'key_value') {
            block.items.forEach((item) => append(block.id, item.id, item));
            continue;
        }
        append(block.id, block.type, block);
    }
    return rows;
}
function auditCsvRowId(rowId: string | undefined, index: number): string {
    return rowId ?? `row-${index + 1}`;
}
function renderAuditDocument(context: Parameters<ReportExportAdapter['render']>[0]) {
    if (context.format !== 'csv')
        return renderReportDocument(context);
    const projection = reportTable({
        id: 'audit-csv-projection',
        columns: [
            { key: 'section', label: reportCopy(context.document.locale, 'fields.type'), valueType: 'string' },
            { key: 'row', label: reportCopy(context.document.locale, 'fields.item'), valueType: 'string' },
            { key: 'data', label: reportCopy(context.document.locale, 'fields.details'), valueType: 'string' },
        ],
        rows: auditCsvRows(context.document),
    });
    return renderReportDocument({
        ...context,
        document: {
            ...context.document,
            blocks: [
                projection,
                ...context.document.blocks.filter((block) => block.type !== 'table' && block.type !== 'time_series'),
            ],
        },
    });
}
export function createAuditReportExportAdapter(): ReportExportAdapter<AuditExportSelection> {
    return {
        kind: 'audit.run',
        kindVersion: 1,
        supportedFormats: ['pdf', 'csv', 'json'],
        selectionSchema: auditExportSelectionSchema,
        async assertAccess(context) {
            if (context.target.scope !== 'site_resource')
                throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
            const siteId = await resolveOwnedAuditRunSiteId(context.accountId, context.target.resourceId);
            if (siteId !== context.target.siteId)
                throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
            if (context.purpose === 'persist' && context.sourceVersion) {
                const current = await auditSourceVersion(context.accountId, context.target.resourceId, context.locale);
                if (current !== context.sourceVersion)
                    throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
            }
        },
        async compose(context) {
            if (context.target.scope !== 'site_resource')
                throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
            const [{ run }, report, site] = await Promise.all([
                getAuditRun({ accountId: context.accountId, runId: context.target.resourceId }),
                getAuditReport({ accountId: context.accountId, runId: context.target.resourceId, locale: context.locale }),
                getSite(context.accountId, context.target.siteId),
            ]);
            if (run.status !== 'succeeded' || !run.finishedAt)
                throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
            const selectedFindings = report.findings.filter((finding) => context.selection.buckets.includes(auditBucket(finding.bucket)));
            if (context.format === 'pdf' &&
                (selectedFindings.length > REPORT_GLOBAL_BOUNDS.pdfItems ||
                    selectedFindings.some((finding) => finding.affectedUrls.length >
                        REPORT_MAX_AFFECTED_URLS_PER_FINDING))) {
                throw new HttpError(422, { code: 'REPORT_EXPORTS_ERRORS_SCOPE_TOO_LARGE', messageKey: 'reportExports.errors.scopeTooLarge' }, { code: 'scope_too_large', narrowingFields: ['buckets', 'sections'] });
            }
            const built = auditBlocks(context.locale, report, context.selection);
            const document: ReportDocumentV1 = {
                schema: REPORT_DOCUMENT_SCHEMA,
                schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
                kind: 'audit.run',
                kindVersion: 1,
                locale: context.locale,
                title: reportCatalogCopy(context.locale, 'auditRun', 'title'),
                subject: [{ label: reportCopy(context.locale, 'fields.site'), value: site.displayName || site.domain }],
                selection: [
                    { label: reportCopy(context.locale, 'fields.buckets'), value: context.selection.buckets.join(', ') },
                    { label: reportCopy(context.locale, 'fields.sections'), value: context.selection.sections.join(', ') },
                ],
                sourceDates: sourceDates(context.locale, run.finishedAt, report),
                completeness: {
                    state: 'complete',
                    selectedItems: built.findingCount,
                    representedItems: built.findingCount,
                    bound: reportCatalogCopy(context.locale, 'auditRun', 'bound'),
                },
                branding: context.branding,
                blocks: built.blocks,
                artifacts: [],
            };
            return {
                sourceVersion: reportSourceVersion('audit', { runId: run.id, finishedAt: run.finishedAt, updatedAt: run.updatedAt, report }),
                document,
            };
        },
        async render(context) {
            return renderAuditDocument(context);
        },
    };
}
export const auditReportExportTestables = Object.freeze({
    auditExportSelectionSchema,
    auditBucket,
    canonicalBucket,
    canonicalSeverity,
    auditSourceVersion,
    sourceDates,
    auditBlocks,
    auditCsvRows,
    auditCsvRowId,
    renderAuditDocument,
});
