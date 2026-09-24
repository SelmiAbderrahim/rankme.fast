import { z } from 'zod';
import { REPORT_DOCUMENT_SCHEMA, REPORT_DOCUMENT_SCHEMA_VERSION, renderReportDocument, reportCatalogCopy, reportCopy, reportSourceDate, reportSourceNote, reportSourceVersion, reportTable, stableReportJson, stableSortText, type ReportDocumentV1, type ReportTableRowInput, } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import type { ReportExportAdapter } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { COMPETITOR_OPPORTUNITY_KINDS } from './competitor-content.schemas.js';
import { getCompetitorRun } from './competitor-content.runs.service.js';
const selectionSchema = z.object({
    domains: z.array(z.string().trim().min(1).max(253)).max(10).optional(),
    pages: z.array(z.string().url().max(2048)).max(15).optional(),
    opportunities: z.array(z.enum(COMPETITOR_OPPORTUNITY_KINDS)).max(COMPETITOR_OPPORTUNITY_KINDS.length).optional(),
}).strict();
type Selection = z.infer<typeof selectionSchema>;
function visibleKeywordEvidence(value: {
    keyword: string;
    class: string | null;
    ownedPosition: number | null;
    competitorPosition: number | null;
    ownedUrl: string | null;
    competitorUrl: string | null;
    searchVolume: number | null;
    intent: string | null;
}) {
    return {
        keyword: value.keyword,
        class: value.class,
        ownedPosition: value.ownedPosition,
        competitorPosition: value.competitorPosition,
        ownedUrl: value.ownedUrl,
        competitorUrl: value.competitorUrl,
        searchVolume: value.searchVolume,
        intent: value.intent,
    };
}
function boundedSelectionValue(values: readonly string[]): string {
    const ordered = [...values].sort(stableSortText);
    const full = ordered.join(', ');
    return full.length <= 900 ? full : `${ordered.length}; ${reportSourceVersion('selection', ordered)}`;
}
function comparePageMatches(left: {
    competitorDomain: string;
    selectedUrl: string;
    ownedUrl: string | null;
}, right: {
    competitorDomain: string;
    selectedUrl: string;
    ownedUrl: string | null;
}): number {
    return stableSortText(left.competitorDomain, right.competitorDomain) ||
        stableSortText(left.selectedUrl, right.selectedUrl) ||
        stableSortText(left.ownedUrl ?? '', right.ownedUrl ?? '');
}
function compareDeltas(left: {
    competitorDomain: string;
    competitorUrl: string;
}, right: {
    competitorDomain: string;
    competitorUrl: string;
}): number {
    return stableSortText(left.competitorDomain, right.competitorDomain) ||
        stableSortText(left.competitorUrl, right.competitorUrl);
}
function compareOpportunities(left: {
    kind: string;
    id: string;
}, right: {
    kind: string;
    id: string;
}): number {
    return stableSortText(left.kind, right.kind) || stableSortText(left.id, right.id);
}
function findingOwnedUrl(findings: {
    ownedUrl: string;
} | null | undefined, ownedUrl: string): string {
    return findings?.ownedUrl ?? ownedUrl;
}
async function loadOwned(accountId: string, target: Parameters<ReportExportAdapter['assertAccess']>[0]['target'], locale?: Parameters<ReportExportAdapter['compose']>[0]['locale']) {
    if (target.scope !== 'site_resource')
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.competitorContent.errors.notFound' });
    const run = await getCompetitorRun({ accountId, runId: target.resourceId, locale });
    if (run.siteId !== target.siteId)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_COMPETITOR_CONTENT_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.competitorContent.errors.notFound' });
    return run;
}
export function createCompetitorContentReportExportAdapter(): ReportExportAdapter<Selection> {
    return {
        kind: 'competitors.content_run', kindVersion: 1, supportedFormats: ['pdf', 'csv', 'json'], selectionSchema,
        async assertAccess(context) { const run = await loadOwned(context.accountId, context.target); const version = reportSourceVersion('competitors.content_run', run); if (context.purpose === 'persist' && context.sourceVersion && context.sourceVersion !== version)
            throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' }); },
        async compose(context) {
            const run = await loadOwned(context.accountId, context.target, context.locale);
            const site = await getSite(context.accountId, run.siteId);
            const findings = run.findings;
            const domains = new Set(context.selection.domains ?? run.input.competitorDomains);
            const pages = new Set(context.selection.pages ?? []);
            const usePages = pages.size > 0;
            const rows: ReportTableRowInput[] = [];
            let representedItems = 0;
            const addRow = (values: ReportTableRowInput['values'], sourceDateId: string) => rows.push({ id: `content-record-${rows.length + 1}`, values, sourceDateId });
            for (const match of [...run.input.pageMatches].sort(comparePageMatches)) {
                if (domains.size > 0 && !domains.has(match.competitorDomain))
                    continue;
                if (usePages &&
                    !pages.has(match.selectedUrl) &&
                    (!match.ownedUrl || !pages.has(match.ownedUrl)))
                    continue;
                representedItems += 1;
                addRow([
                    'reviewed-page-match',
                    match.competitorDomain,
                    match.selectedUrl,
                    match.source,
                    'reviewedSelection',
                    match.source === 'landscape_review' ? 'approved' : 'legacy_explicit',
                    stableReportJson({
                        suggestedRankingUrl: match.suggestedRankingUrl,
                        ownedUrl: match.ownedUrl,
                        linkedLandscape: match.source === 'landscape_review',
                        keywordEvidence: match.keywordEvidence.map(visibleKeywordEvidence),
                    }),
                    'observation',
                ], 'content-observation');
            }
            for (const page of [...run.pages].sort((a, b) => stableSortText(a.url, b.url))) {
                const domain = page.facts.competitorDomain ?? new URL(page.url).hostname;
                if (page.role === 'competitor' && domains.size > 0 && !domains.has(domain))
                    continue;
                if (usePages && !pages.has(page.url))
                    continue;
                representedItems += 1;
                addRow(['page', domain, page.url, page.role, 'wordCount', String(page.facts.wordCount), stableReportJson({ statusCode: page.facts.statusCode, hasSchemaOrgArticle: page.facts.hasSchemaOrgArticle, internalLinks: page.facts.internalLinkCount, externalLinks: page.facts.externalLinkCount }), 'observation'], 'content-observation');
                if (page.facts.title !== null)
                    addRow(['page-field', domain, page.url, page.role, 'title', page.facts.title, '', 'observation'], 'content-observation');
                if (page.facts.description !== null)
                    addRow(['page-field', domain, page.url, page.role, 'description', page.facts.description, '', 'observation'], 'content-observation');
                for (const heading of page.facts.headings)
                    addRow(['page-field', domain, page.url, page.role, 'heading', heading, '', 'observation'], 'content-observation');
                for (const schemaType of page.facts.schemaTypes)
                    addRow(['page-field', domain, page.url, page.role, 'schemaType', schemaType, '', 'observation'], 'content-observation');
                for (const topic of page.facts.primaryTopics)
                    addRow(['page-field', domain, page.url, page.role, 'primaryTopic', topic, '', 'observation'], 'content-observation');
                for (const topic of page.facts.secondaryTopics)
                    addRow(['page-field', domain, page.url, page.role, 'secondaryTopic', topic, '', 'observation'], 'content-observation');
                if (page.facts.snippet)
                    addRow(['page-field', domain, page.url, page.role, 'snippet', page.facts.snippet, '', 'observation'], 'content-observation');
            }
            for (const delta of [...(findings?.deltas ?? [])].sort(compareDeltas)) {
                if (domains.size > 0 && !domains.has(delta.competitorDomain))
                    continue;
                if (usePages && !pages.has(delta.competitorUrl) && !pages.has(delta.ownedUrl))
                    continue;
                representedItems += 1;
                addRow(['delta', delta.competitorDomain, delta.competitorUrl, delta.ownedUrl, 'wordCountDelta', String(delta.wordCountDelta), stableReportJson({ headingCountDelta: delta.headingCountDelta, internalLinkDelta: delta.internalLinkDelta, externalLinkDelta: delta.externalLinkDelta, linkedLandscape: delta.landscapeReportId !== null }), 'derived'], 'content-derived');
                for (const value of delta.missingSchemaTypes)
                    addRow(['delta-evidence', delta.competitorDomain, delta.competitorUrl, delta.ownedUrl, 'missingSchemaType', value, '', 'derived'], 'content-derived');
                for (const value of delta.missingTopics)
                    addRow(['delta-evidence', delta.competitorDomain, delta.competitorUrl, delta.ownedUrl, 'missingTopic', value, '', 'derived'], 'content-derived');
                for (const value of delta.ownedOnlyTopics)
                    addRow(['delta-evidence', delta.competitorDomain, delta.competitorUrl, delta.ownedUrl, 'ownedOnlyTopic', value, '', 'derived'], 'content-derived');
                for (const value of delta.sharedQueries)
                    addRow(['delta-evidence', delta.competitorDomain, delta.competitorUrl, delta.ownedUrl, 'sharedQuery', value, '', 'derived'], 'content-derived');
                for (const value of delta.keywordEvidence)
                    addRow(['delta-evidence', delta.competitorDomain, delta.competitorUrl, delta.ownedUrl, 'keywordEvidence', stableReportJson(visibleKeywordEvidence(value)), '', 'derived'], 'content-derived');
            }
            const allowedOpportunities = new Set(context.selection.opportunities ?? COMPETITOR_OPPORTUNITY_KINDS);
            const selectedOpportunities = [...(findings?.opportunities ?? [])]
                .filter((item) => allowedOpportunities.has(item.kind))
                .sort(compareOpportunities);
            for (const opportunity of selectedOpportunities) {
                representedItems += 1;
                const ownedUrl = findingOwnedUrl(findings, run.ownedUrl);
                addRow(['opportunity', '', ownedUrl, opportunity.kind, opportunity.confidence, opportunity.label, '', 'derived'], 'content-derived');
                for (const sourceId of opportunity.evidenceSourceIds)
                    addRow(['opportunity-evidence', '', ownedUrl, opportunity.kind, 'evidenceSource', sourceId, '', 'derived'], 'content-derived');
                for (const value of opportunity.keywordEvidence)
                    addRow(['opportunity-evidence', '', ownedUrl, opportunity.kind, 'keywordEvidence', stableReportJson(visibleKeywordEvidence(value)), '', 'derived'], 'content-derived');
            }
            if (findings?.aiExplanation) {
                representedItems += 1;
                addRow(['explanation', '', findings.ownedUrl, 'generated', 'ai', findings.aiExplanation, '', 'generated'], 'content-generated');
            }
            for (const domain of [...(findings?.partialDomains ?? [])].sort(stableSortText)) {
                representedItems += 1;
                addRow(['missing', domain, '', 'partial', 'unavailable', '', 'source page unavailable', 'observation'], 'content-observation');
            }
            const observedAt = run.completedAt ?? run.startedAt ?? run.requestedAt ?? new Date(0).toISOString();
            const dates = [
                reportSourceDate({ id: 'content-observation', label: reportCopy(context.locale, 'sources.competitorContentObservation'), kind: 'provider_observation', observedAt, sourceNoteKey: 'competitors.content.observation', freshness: 'unknown' }),
                reportSourceDate({ id: 'content-derived', label: reportCopy(context.locale, 'sources.competitorContentDerived'), kind: 'derived', observedAt, sourceNoteKey: 'competitors.content.derived', freshness: 'unknown' }),
                reportSourceDate({ id: 'content-generated', label: reportCopy(context.locale, 'sources.competitorContentGenerated'), kind: 'generated', observedAt, sourceNoteKey: 'competitors.content.generated', freshness: 'unknown' }),
            ];
            const document: ReportDocumentV1 = { schema: REPORT_DOCUMENT_SCHEMA, schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION, kind: 'competitors.content_run', kindVersion: 1, locale: context.locale, title: reportCatalogCopy(context.locale, 'competitorsContentRun', 'title'), subject: [{ label: reportCopy(context.locale, 'fields.site'), value: site.displayName || site.domain }, { label: reportCopy(context.locale, 'fields.comparedDomains'), value: boundedSelectionValue([...domains]) }], selection: [{ label: reportCopy(context.locale, 'fields.domains'), value: boundedSelectionValue([...domains]) }, { label: reportCopy(context.locale, 'fields.pages'), value: boundedSelectionValue([...pages]) }, { label: reportCopy(context.locale, 'fields.opportunities'), value: boundedSelectionValue([...allowedOpportunities]) }], sourceDates: dates, completeness: { state: 'complete', selectedItems: representedItems, representedItems, bound: reportCatalogCopy(context.locale, 'competitorsContentRun', 'bound') }, branding: context.branding, blocks: [reportTable({ id: 'content-comparison', columns: [
                            { key: 'recordType', label: reportCopy(context.locale, 'fields.recordType'), valueType: 'string' },
                            { key: 'domain', label: reportCopy(context.locale, 'fields.domain'), valueType: 'string' },
                            { key: 'url', label: reportCopy(context.locale, 'fields.url'), valueType: 'string' },
                            { key: 'context', label: reportCopy(context.locale, 'fields.context'), valueType: 'string' },
                            { key: 'metric', label: reportCopy(context.locale, 'fields.metric'), valueType: 'string' },
                            { key: 'value', label: reportCopy(context.locale, 'fields.value'), valueType: 'string' },
                            { key: 'details', label: reportCopy(context.locale, 'fields.details'), valueType: 'string' },
                            { key: 'provenance', label: reportCopy(context.locale, 'fields.provenance'), valueType: 'string' },
                        ], rows }), reportSourceNote({ id: 'content-observation-note', sourceDateId: 'content-observation', methodology: reportCopy(context.locale, 'notes.competitorContentObservation') }), reportSourceNote({ id: 'content-derived-note', sourceDateId: 'content-derived', methodology: reportCopy(context.locale, 'notes.competitorContentDerived') }), reportSourceNote({ id: 'content-generated-note', sourceDateId: 'content-generated', methodology: reportCopy(context.locale, 'notes.competitorContentGenerated') })], artifacts: [] };
            return { document, sourceVersion: reportSourceVersion('competitors.content_run', run) };
        },
        render: ({ document, format, snapshotCreatedAt }) => renderReportDocument({ document, format, snapshotCreatedAt }),
    };
}
export const competitorContentReportExportTestables = Object.freeze({
    selectionSchema,
    visibleKeywordEvidence,
    boundedSelectionValue,
    comparePageMatches,
    compareDeltas,
    compareOpportunities,
    findingOwnedUrl,
    loadOwned,
});
