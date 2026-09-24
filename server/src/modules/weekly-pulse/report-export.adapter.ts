import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { stableReportJson } from '../../shared/report-exports/index.js';
import { assertSiteResourceTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { getPulseHistoryDetail } from './weekly-pulse.service.js';
const SECTIONS = ['header', 'coverage', 'citations', 'rankDrops', 'actions', 'gsc', 'brandDeltas', 'deepLinks'] as const;
const selectionSchema = z.object({ sections: z.array(z.enum(SECTIONS)).max(SECTIONS.length).optional() }).strict();
type Selection = z.infer<typeof selectionSchema>;
type WeeklyPulseExportContext = Pick<ReportExportAccessContext, 'accountId' | 'actorUserId' | 'target' | 'locale'>;
async function base(db: Db, context: WeeklyPulseExportContext) {
    assertSiteResourceTarget(context.target);
    return getPulseHistoryDetail({
        accountId: context.accountId, siteId: context.target.siteId,
        userId: context.actorUserId, pulseId: context.target.resourceId,
        locale: context.locale,
    }, { db, queue: null });
}
export function createWeeklyPulseReportExportAdapter(db: Db) {
    return createStoredReportAdapter<Selection>({
        kind: 'weekly_pulse.run', localizationStem: 'weeklyPulseRun', formats: ['pdf', 'json'], selectionSchema,
        access: (context) => base(db, context),
        async load(context): Promise<LoadedStoredReport> {
            const detail = await base(db, context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const selected = new Set(context.selection.sections ?? SECTIONS);
            const projection = detail.projection;
            const observedAt = projection?.header.renderedAt ?? new Date(0).toISOString();
            const records = [storedRecord('pulse', detail.runId, stableReportJson({
                    isoWeek: detail.isoWeek, status: detail.status, projectionAvailable: projection !== null,
                }), 'derived', { state: detail.status, observedAt })];
            if (projection) {
                const sections = {
                    header: projection.header,
                    coverage: projection.coverage,
                    citations: { new: projection.citations_new, lost: projection.citations_lost, unknownPartial: projection.citations_unknown_partial },
                    rankDrops: projection.confirmed_rank_drops,
                    actions: { completed: projection.actions_completed, regressed: projection.actions_regressed, next: projection.next_actions_top3 },
                    gsc: projection.gsc_appearance,
                    brandDeltas: projection.brand_deltas ?? [],
                    deepLinks: projection.deep_links,
                };
                for (const key of SECTIONS)
                    if (selected.has(key))
                        records.push(storedRecord('pulse-section', key, stableReportJson(sections[key]), key === 'header' || key === 'deepLinks' ? 'derived' : 'observation', { observedAt }));
            }
            if (selected.has('citations'))
                detail.citationChanges.forEach((change, index) => records.push(storedRecord('citation-change', String(index + 1), stableReportJson(change), 'derived', { state: change.change, observedAt })));
            return { siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: detail, records };
        },
    });
}
