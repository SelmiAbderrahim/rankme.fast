import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { assertSiteTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { listTrackedPrompts, readRecentCompetitorMentions, readRecentMentions } from './ai-visibility.repository.js';
import { computeShareOfVoicePct } from './ai-visibility.service.js';
const selectionSchema = z.object({
    from: z.string().date().optional(), to: z.string().date().optional(),
    prompt: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
    model: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    sentiment: z.array(z.enum(['positive', 'neutral', 'negative'])).max(3).optional(),
}).strict().superRefine((value, context) => {
    if (Boolean(value.from) !== Boolean(value.to)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'reportExports.errors.invalidWindow' });
        return;
    }
    if (!value.from || !value.to)
        return;
    const days = (new Date(`${value.to}T00:00:00.000Z`).getTime() - new Date(`${value.from}T00:00:00.000Z`).getTime()) / 86400000 + 1;
    if (days < 7 || days > 365)
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'reportExports.errors.invalidWindow' });
});
type Selection = z.infer<typeof selectionSchema>;
type AiVisibilityExportContext = Pick<ReportExportAccessContext, 'accountId' | 'target'>;
async function loadBase(db: Db, context: AiVisibilityExportContext) {
    assertSiteTarget(context.target);
    await getSite(context.accountId, context.target.siteId);
    const since = new Date(Date.now() - 365 * 86400000);
    const [prompts, mentions, competitors] = await Promise.all([
        listTrackedPrompts(db, { accountId: context.accountId, siteId: context.target.siteId }),
        readRecentMentions(db, { accountId: context.accountId, siteId: context.target.siteId, since }),
        readRecentCompetitorMentions(db, { accountId: context.accountId, siteId: context.target.siteId, since }),
    ]);
    return { prompts, mentions, competitors };
}
export function createAiVisibilityReportExportAdapter(db: Db) {
    return createStoredReportAdapter<Selection>({
        kind: 'ai.visibility', localizationStem: 'aiVisibility', formats: ['pdf', 'csv', 'json'], selectionSchema,
        access: (context) => loadBase(db, context),
        async load(context): Promise<LoadedStoredReport> {
            const base = await loadBase(db, context);
            assertSiteTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const from = context.selection.from ? new Date(`${context.selection.from}T00:00:00.000Z`) : new Date(Date.now() - 30 * 86400000);
            const to = context.selection.to ? new Date(`${context.selection.to}T23:59:59.999Z`) : new Date();
            const mentions = base.mentions.filter((row) => row.checkedAt >= from && row.checkedAt <= to)
                .filter((row) => !context.selection.prompt || context.selection.prompt.includes(row.prompt))
                .filter((row) => !context.selection.model || context.selection.model.includes(row.model))
                .filter((row) => !context.selection.sentiment || (row.sentiment !== null && context.selection.sentiment.includes(row.sentiment)));
            const competitors = base.competitors.filter((row) => row.checkedAt >= from && row.checkedAt <= to)
                .filter((row) => !context.selection.prompt || context.selection.prompt.includes(row.prompt))
                .filter((row) => !context.selection.model || context.selection.model.includes(row.model));
            const shareOfVoicePct = computeShareOfVoicePct({
                brandMentionedCount: mentions.filter((row) => row.mentioned).length,
                competitorMentionedCount: competitors.filter((row) => row.mentioned).length,
            });
            const observedAt = [...mentions, ...competitors].map((row) => row.checkedAt.toISOString()).sort().at(-1) ?? to.toISOString();
            return {
                siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: base,
                selectedItems: base.prompts.filter((row) => !context.selection.prompt || context.selection.prompt.includes(row.prompt)).length + mentions.length + competitors.length,
                records: [
                    storedRecord('share-of-voice', 'selected-window', {
                        from: from.toISOString(), to: to.toISOString(), shareOfVoicePct,
                        brandMentionedCount: mentions.filter((row) => row.mentioned).length,
                        competitorMentionedCount: competitors.filter((row) => row.mentioned).length,
                    }, 'derived', { value: shareOfVoicePct, observedAt }),
                    ...base.prompts.filter((row) => !context.selection.prompt || context.selection.prompt.includes(row.prompt)).map((row) => storedRecord('tracked-prompt', row.id, { prompt: row.prompt, createdAt: row.createdAt }, 'observation', { label: row.prompt, observedAt: row.createdAt })),
                    ...mentions.map((row) => storedRecord('brand-mention', row.id, {
                        prompt: row.prompt, platform: row.model, mentioned: row.mentioned,
                        citedUrl: row.citedUrl, sentiment: row.sentiment,
                    }, 'observation', { label: row.prompt, value: row.mentioned, state: row.sentiment, observedAt: row.checkedAt.toISOString() })),
                    ...competitors.map((row) => storedRecord('competitor-mention', row.id, {
                        prompt: row.prompt, platform: row.model, competitorDomain: row.competitorDomain,
                        mentioned: row.mentioned, cited: row.cited,
                    }, 'observation', { label: row.competitorDomain, value: row.mentioned, observedAt: row.checkedAt.toISOString() })),
                ],
            };
        },
    });
}
