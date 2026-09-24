import { z } from 'zod';
import { stableReportJson } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { assertSiteResourceTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { getContentBrief } from './content-brief.service.js';
const selectionSchema = z.object({
    draftVersion: z.number().int().min(1).max(100).optional(),
    sections: z.array(z.enum(['serp', 'documents', 'corpus', 'outline', 'questions', 'terms', 'draft', 'scores'])).max(8).optional(),
}).strict();
type Selection = z.infer<typeof selectionSchema>;
type ContentBriefExportContext = Pick<ReportExportAccessContext, 'accountId' | 'target'>;
async function base(context: ContentBriefExportContext) {
    assertSiteResourceTarget(context.target);
    return getContentBrief(context.accountId, context.target.siteId, context.target.resourceId);
}
export function createContentBriefReportExportAdapter() {
    return createStoredReportAdapter<Selection>({
        kind: 'content.brief', localizationStem: 'contentBrief', formats: ['pdf', 'json', 'md'], selectionSchema,
        access: base,
        async load(context): Promise<LoadedStoredReport> {
            const brief = await base(context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const sections = new Set(context.selection.sections ?? ['serp', 'documents', 'corpus', 'outline', 'questions', 'terms', 'draft', 'scores']);
            const records = [storedRecord('brief', brief.id, stableReportJson({
                    keyword: brief.keyword, status: brief.status, locale: brief.locale, serpSource: brief.serpSource,
                    retainedDocumentCount: brief.retainedDocumentCount, halt: brief.halt,
                    requestedAt: brief.requestedAt, terminalAt: brief.terminalAt, latestDraftVersion: brief.latestDraftVersion,
                    abstentions: brief.abstentions,
                }), 'derived', { state: brief.status, observedAt: brief.terminalAt ?? brief.requestedAt })];
            if (sections.has('serp')) {
                records.push(storedRecord('serp', 'snapshot', stableReportJson(brief.serp), 'observation', { observedAt: brief.serp.checkedAt }));
                brief.serp.paaRows.forEach((row) => records.push(storedRecord('paa', row.id, stableReportJson(row), 'observation', { label: row.question, observedAt: brief.serp.checkedAt })));
            }
            if (sections.has('documents'))
                brief.documents.forEach((document) => records.push(storedRecord('document', document.id, stableReportJson(document), 'observation', { label: document.title, observedAt: document.capturedAt })));
            if (sections.has('corpus'))
                records.push(storedRecord('corpus', 'statistics', stableReportJson(brief.corpusStats), 'derived', { observedAt: brief.terminalAt }));
            if (sections.has('outline'))
                brief.outline.forEach((node) => records.push(storedRecord('outline', node.id, stableReportJson(node), 'generated', { label: node.heading, observedAt: brief.terminalAt })));
            if (sections.has('questions'))
                brief.questions.forEach((question, index) => records.push(storedRecord('question', String(index + 1), stableReportJson(question), 'generated', { label: question.question, observedAt: brief.terminalAt })));
            if (sections.has('terms'))
                brief.secondaryTerms.forEach((term) => records.push(storedRecord('secondary-term', term.id, stableReportJson(term), 'derived', { value: term.term, observedAt: brief.terminalAt })));
            const selected = context.selection.draftVersion
                ? brief.scoreHistory.find((version) => version.version === context.selection.draftVersion)
                : brief.scoreHistory.at(-1);
            if (context.selection.draftVersion && !selected)
                throw HttpError.notFound({ code: 'CONTENT_BRIEFS_ERRORS_NOT_FOUND', messageKey: 'contentBriefs.errors.notFound' });
            if (sections.has('scores'))
                brief.scoreHistory.forEach((version) => records.push(storedRecord('score-history', String(version.version), stableReportJson({
                    version: version.version, comparison: version.comparison, aiScore: version.aiScore,
                    aiRationale: version.aiRationale, aiCitations: version.aiCitations,
                    aiDisclosure: version.aiDisclosure, createdAt: version.createdAt,
                }), 'generated', { value: version.aiScore, observedAt: version.createdAt })));
            if (sections.has('draft') && selected)
                records.push(storedRecord('draft', String(selected.version), stableReportJson({ draft: selected.draft, createdAt: selected.createdAt }), 'generated', { observedAt: selected.createdAt }));
            return {
                siteLabel: site.displayName || site.domain, observedAt: brief.terminalAt ?? brief.requestedAt,
                sourceVersionValue: brief, selectedItems: Math.max(0, records.length - 1), records,
                ...(sections.has('draft') && selected ? { artifact: { format: 'md' as const, label: `${brief.id}-v${selected.version}.md`, value: selected.draft } } : {}),
            };
        },
    });
}
