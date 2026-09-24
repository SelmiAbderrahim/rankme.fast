import { z } from 'zod';
import { stableReportJson } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { assertSiteResourceTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { INTERNAL_LINK_CONFIDENCES, INTERNAL_LINK_RANKING_SOURCES, INTERNAL_LINK_TARGET_FLAGS, } from './internal-links.schemas.js';
import { getInternalLinkRun } from './internal-links.service.js';
const selectionSchema = z.object({
    targetFlag: z.array(z.enum(INTERNAL_LINK_TARGET_FLAGS)).max(2).optional(),
    confidence: z.array(z.enum(INTERNAL_LINK_CONFIDENCES)).max(3).optional(),
    rankingSource: z.array(z.enum(INTERNAL_LINK_RANKING_SOURCES)).max(2).optional(),
}).strict();
type Selection = z.infer<typeof selectionSchema>;
type InternalLinksExportContext = Pick<ReportExportAccessContext, 'accountId' | 'target'>;
async function base(context: InternalLinksExportContext) {
    assertSiteResourceTarget(context.target);
    const run = await getInternalLinkRun({ accountId: context.accountId, runId: context.target.resourceId });
    if (run.siteId !== context.target.siteId)
        throw HttpError.notFound({ code: 'INTERNAL_LINKS_ERRORS_NOT_FOUND', messageKey: 'internalLinks.errors.notFound' });
    return run;
}
export function createInternalLinksReportExportAdapter() {
    return createStoredReportAdapter<Selection>({
        kind: 'internal_links.run', localizationStem: 'internalLinksRun', formats: ['pdf', 'csv', 'json'], selectionSchema,
        access: base,
        async load(context): Promise<LoadedStoredReport> {
            const run = await base(context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const suggestions = run.suggestions.filter((item) => !context.selection.targetFlag || context.selection.targetFlag.includes(item.targetFlag))
                .filter((item) => !context.selection.confidence || context.selection.confidence.includes(item.confidence))
                .filter((item) => !context.selection.rankingSource || context.selection.rankingSource.includes(item.rankingSource));
            const observedAt = run.completedAt ?? run.requestedAt;
            return {
                siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: run,
                records: [
                    storedRecord('run', run.id, stableReportJson({
                        status: run.status, aiStatus: run.aiStatus, inventoryDate: run.inventoryDate,
                        gscSnapshotDate: run.gscSnapshotDate, candidateRulesVersion: run.candidateRulesVersion,
                        suggestionCount: run.suggestionCount, requestedAt: run.requestedAt,
                        startedAt: run.startedAt, completedAt: run.completedAt, error: run.error,
                    }), 'derived', { state: run.status, observedAt }),
                    ...suggestions.map((item) => storedRecord('suggestion', item.id, stableReportJson(item), item.rankingSource === 'ai' ? 'generated' : 'derived', {
                        label: item.anchorText, value: item.rank, state: item.confidence, observedAt: item.inventoryDate,
                    })),
                ],
            };
        },
    });
}
