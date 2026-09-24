import { z } from 'zod';
import { REPORT_DOCUMENT_SCHEMA, REPORT_DOCUMENT_SCHEMA_VERSION, renderReportDocument, reportCatalogCopy, reportCopy, reportSourceDate, reportSourceNote, reportSourceVersion, reportTable, stableReportJson, stableSortText, type ReportBrandingSnapshot, type ReportDocumentV1, type ReportLocale, } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { ReportExportAdapter } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { getKeywordClusterRun } from './keyword-clusters.service.js';
const selectionSchema = z
    .object({
    minSize: z.number().int().min(1).max(200).default(1),
    maxSize: z.number().int().min(1).max(200).default(200),
    decision: z.enum(['all', 'labeled', 'unlabeled', 'blocked']).default('all'),
})
    .strict()
    .superRefine((value, context) => {
    if (value.minSize > value.maxSize) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'reportExports.errors.invalidSelection' });
    }
});
type Selection = z.infer<typeof selectionSchema>;
async function loadOwned(accountId: string, target: Parameters<ReportExportAdapter['assertAccess']>[0]['target']) {
    if (target.scope !== 'site_resource')
        throw HttpError.notFound({ code: 'KEYWORD_CLUSTERS_ERRORS_NOT_FOUND', messageKey: 'keywordClusters.errors.notFound' });
    const run = await getKeywordClusterRun({ accountId, runId: target.resourceId });
    if (run.siteId !== target.siteId)
        throw HttpError.notFound({ code: 'KEYWORD_CLUSTERS_ERRORS_NOT_FOUND', messageKey: 'keywordClusters.errors.notFound' });
    return run;
}
function sourceVersion(run: Awaited<ReturnType<typeof getKeywordClusterRun>>): string {
    return reportSourceVersion('keyword.serp_cluster_run', run);
}
function selectionItems(locale: ReportLocale, value: Selection): ReportDocumentV1['selection'] {
    return Object.keys(value).sort(stableSortText).map((key) => ({
        label: reportCopy(locale, `fields.${key}`),
        value: String(value[key as keyof Selection]),
    }));
}
function sourceDates(locale: ReportLocale, run: Awaited<ReturnType<typeof getKeywordClusterRun>>): ReportDocumentV1['sourceDates'] {
    const observations = run.clusters.flatMap((cluster) => cluster.members.map((member) => member.observedAt));
    const blockedObservations = run.blocked.flatMap((row) => row.observedAt ?? []);
    const ordered = [...observations, ...blockedObservations].sort(stableSortText);
    const completed = run.completedAt ?? run.requestedAt;
    return [
        reportSourceDate({
            id: 'serp-observation',
            label: reportCopy(locale, 'sources.serpClusterObservation'),
            kind: 'provider_observation',
            ...(ordered.length > 0 ? { from: ordered[0]!, to: ordered.at(-1)! } : { observedAt: completed }),
            sourceNoteKey: 'keywordClusters.observation',
            freshness: 'unknown',
        }),
        reportSourceDate({
            id: 'cluster-derived',
            label: reportCopy(locale, 'sources.serpClusterDerived'),
            kind: 'derived',
            observedAt: completed,
            sourceNoteKey: 'keywordClusters.derived',
            freshness: 'unknown',
        }),
        reportSourceDate({
            id: 'cluster-generated',
            label: reportCopy(locale, 'sources.serpClusterGenerated'),
            kind: 'generated',
            observedAt: completed,
            sourceNoteKey: 'keywordClusters.generated',
            freshness: 'unknown',
        }),
    ];
}
function compareMembers(left: Awaited<ReturnType<typeof getKeywordClusterRun>>['clusters'][number]['members'][number], right: Awaited<ReturnType<typeof getKeywordClusterRun>>['clusters'][number]['members'][number]): number {
    return Number(right.isPivot) - Number(left.isPivot) ||
        stableSortText(left.phrase, right.phrase) ||
        stableSortText(left.keywordId, right.keywordId);
}
function compareBlocked(left: Awaited<ReturnType<typeof getKeywordClusterRun>>['blocked'][number], right: Awaited<ReturnType<typeof getKeywordClusterRun>>['blocked'][number]): number {
    return stableSortText(left.phrase, right.phrase) ||
        stableSortText(left.keywordId, right.keywordId);
}
function document(input: {
    locale: ReportLocale;
    branding: ReportBrandingSnapshot;
    selection: Selection;
    siteName: string;
    run: Awaited<ReturnType<typeof getKeywordClusterRun>>;
}): ReportDocumentV1 {
    const clusters = [...input.run.clusters]
        .filter((cluster) => cluster.size >= input.selection.minSize && cluster.size <= input.selection.maxSize)
        .filter((cluster) => input.selection.decision === 'all' || input.selection.decision === 'blocked' || (input.selection.decision === 'labeled' ? cluster.label !== null : cluster.label === null))
        .sort((left, right) => stableSortText(left.id, right.id));
    const includeClusters = input.selection.decision !== 'blocked';
    const includeBlocked = input.selection.decision === 'all' || input.selection.decision === 'blocked';
    const memberCount = includeClusters ? clusters.reduce((sum, cluster) => sum + cluster.members.length, 0) : 0;
    const blockedCount = includeBlocked ? input.run.blocked.length : 0;
    const representedItems = memberCount + blockedCount;
    const rows = [
        ...(includeClusters
            ? clusters.flatMap((cluster) => [...cluster.members]
                .sort(compareMembers)
                .flatMap((member) => [
                {
                    values: [
                        'cluster',
                        cluster.id,
                        member.phrase,
                        cluster.label,
                        'membership',
                        stableReportJson({
                            keywordId: member.keywordId,
                            size: cluster.size,
                            pivot: member.isPivot,
                            sharedUrlCount: member.sharedUrlCount,
                            labelSource: cluster.labelSource,
                        }),
                        member.observedAt,
                        stableReportJson({
                            aiStatus: input.run.aiStatus,
                            rulesVersion: input.run.rulesVersion,
                        }),
                    ],
                    sourceDateIds: [
                        'cluster-derived',
                        'cluster-derived',
                        'serp-observation',
                        cluster.label ? 'cluster-generated' : 'cluster-derived',
                        'cluster-derived',
                        'cluster-derived',
                        'serp-observation',
                        'cluster-derived',
                    ],
                },
                ...[...member.sharedUrls].sort(stableSortText).map((url) => ({
                    values: [
                        'evidence',
                        cluster.id,
                        member.phrase,
                        cluster.label,
                        'sharedUrl',
                        url,
                        member.observedAt,
                        stableReportJson({
                            pivot: member.isPivot,
                            sharedUrlCount: member.sharedUrlCount,
                        }),
                    ],
                    sourceDateIds: [
                        'serp-observation',
                        'cluster-derived',
                        'serp-observation',
                        cluster.label ? 'cluster-generated' : 'cluster-derived',
                        'serp-observation',
                        'serp-observation',
                        'serp-observation',
                        'cluster-derived',
                    ],
                })),
            ]))
            : []),
        ...(includeBlocked ? [...input.run.blocked]
            .sort(compareBlocked)
            .map((row) => ({
            values: ['blocked', null, row.phrase, null, 'blockedReason', row.reason, row.observedAt, stableReportJson({ keywordId: row.keywordId, aiStatus: input.run.aiStatus, rulesVersion: input.run.rulesVersion })],
            sourceDateIds: ['cluster-derived', undefined, 'serp-observation', undefined, 'cluster-derived', 'cluster-derived', 'serp-observation', 'cluster-derived'],
        })) : []),
    ].map((row, index) => ({ ...row, id: `cluster-record-${index + 1}` }));
    return {
        schema: REPORT_DOCUMENT_SCHEMA,
        schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
        kind: 'keyword.serp_cluster_run',
        kindVersion: 1,
        locale: input.locale,
        title: reportCatalogCopy(input.locale, 'keywordSerpClusterRun', 'title'),
        subject: [{ label: reportCopy(input.locale, 'fields.site'), value: input.siteName }],
        selection: selectionItems(input.locale, input.selection),
        sourceDates: sourceDates(input.locale, input.run),
        completeness: { state: 'complete', selectedItems: representedItems, representedItems, bound: reportCatalogCopy(input.locale, 'keywordSerpClusterRun', 'bound') },
        branding: input.branding,
        blocks: [
            reportTable({
                id: 'serp-clusters',
                columns: [
                    { key: 'recordType', label: reportCopy(input.locale, 'fields.recordType'), valueType: 'string' },
                    { key: 'cluster', label: reportCopy(input.locale, 'fields.cluster'), valueType: 'string' },
                    { key: 'keyword', label: reportCopy(input.locale, 'fields.keyword'), valueType: 'string' },
                    { key: 'label', label: reportCopy(input.locale, 'fields.label'), valueType: 'string' },
                    { key: 'detailType', label: reportCopy(input.locale, 'fields.type'), valueType: 'string' },
                    { key: 'detailValue', label: reportCopy(input.locale, 'fields.value'), valueType: 'string' },
                    { key: 'observedAt', label: reportCopy(input.locale, 'fields.observedAt'), valueType: 'date' },
                    { key: 'status', label: reportCopy(input.locale, 'fields.status'), valueType: 'string' },
                ],
                rows,
            }),
            reportSourceNote({ id: 'serp-cluster-observation-note', sourceDateId: 'serp-observation', methodology: reportCopy(input.locale, 'notes.serpClusterObservation') }),
            reportSourceNote({ id: 'serp-cluster-derived-note', sourceDateId: 'cluster-derived', methodology: reportCopy(input.locale, 'notes.serpClusterDerived') }),
            reportSourceNote({ id: 'serp-cluster-generated-note', sourceDateId: 'cluster-generated', methodology: reportCopy(input.locale, 'notes.serpClusterGenerated') }),
        ],
        artifacts: [],
    };
}
export function createKeywordClusterReportExportAdapter(): ReportExportAdapter<Selection> {
    return {
        kind: 'keyword.serp_cluster_run',
        kindVersion: 1,
        supportedFormats: ['pdf', 'csv', 'json'],
        selectionSchema,
        async assertAccess(context) {
            const run = await loadOwned(context.accountId, context.target);
            if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== sourceVersion(run))
                throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
        },
        async compose(context) {
            const run = await loadOwned(context.accountId, context.target);
            const site = await getSite(context.accountId, run.siteId);
            return { document: document({ locale: context.locale, branding: context.branding, selection: context.selection, siteName: site.displayName || site.domain, run }), sourceVersion: sourceVersion(run) };
        },
        render: ({ document: value, format, snapshotCreatedAt }) => renderReportDocument({ document: value, format, snapshotCreatedAt }),
    };
}
export const keywordClusterReportExportTestables = Object.freeze({
    selectionSchema,
    sourceDates,
    compareMembers,
    compareBlocked,
    document,
});
