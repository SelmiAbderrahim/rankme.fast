import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { ACTION_SOURCE_TYPES, ACTION_STATES } from '../../db/schema/action-events.js';
import { assertSiteTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { listActionsForSite } from './actions.service.js';
import type { SourceStatusEnvelope } from './actions.types.js';
const selectionSchema = z.object({
    source: z.array(z.enum(ACTION_SOURCE_TYPES)).max(ACTION_SOURCE_TYPES.length).optional(),
    state: z.array(z.enum(ACTION_STATES)).max(ACTION_STATES.length).optional(),
    severity: z.array(z.enum(['critical', 'warning', 'info'])).max(3).optional(),
    confidence: z.array(z.enum(['high', 'medium', 'low'])).max(3).optional(),
    effort: z.array(z.enum(['low', 'medium', 'high'])).max(3).optional(),
}).strict();
type Selection = z.infer<typeof selectionSchema>;
type ActionsExportContext = Pick<ReportExportAccessContext, 'accountId' | 'locale' | 'target'>;
async function loadAll(db: Db, context: ActionsExportContext) {
    assertSiteTarget(context.target);
    const items = [];
    let cursor: string | undefined;
    let sourceStatus: SourceStatusEnvelope = {};
    do {
        const page = await listActionsForSite({
            accountId: context.accountId,
            siteId: context.target.siteId,
            locale: context.locale,
            db,
            limit: 50,
            ...(cursor ? { cursor } : {}),
        });
        items.push(...page.items);
        sourceStatus = page.sourceStatus;
        cursor = page.nextCursor ?? undefined;
    } while (cursor && items.length <= 1000);
    return { items, sourceStatus };
}
export function createActionsReportExportAdapter(db: Db) {
    return createStoredReportAdapter<Selection>({
        kind: 'actions.plan', localizationStem: 'actionsPlan', formats: ['pdf', 'csv', 'json'], selectionSchema,
        access: (context) => loadAll(db, context),
        async load(context): Promise<LoadedStoredReport> {
            const all = await loadAll(db, context);
            assertSiteTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const selected = all.items.filter((item) => (!context.selection.source || context.selection.source.includes(item.sourceType)) &&
                (!context.selection.state || context.selection.state.includes(item.state)) &&
                (!context.selection.severity || context.selection.severity.includes(item.severity)) &&
                (!context.selection.confidence || context.selection.confidence.includes(item.confidence)) &&
                (!context.selection.effort || context.selection.effort.includes(item.effort)));
            const observedAt = selected.map((item) => item.observedAt).sort().at(-1) ?? new Date(0).toISOString();
            return {
                siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: all,
                records: selected.map((item) => storedRecord('action', item.id, {
                    sourceType: item.sourceType, sourceId: item.sourceId, sourceLink: item.sourceLink,
                    problem: item.problem, whyItMatters: item.whyItMatters, nextStep: item.nextStep,
                    copy: {
                        problem: { ...item.copy.problem },
                        whyItMatters: { ...item.copy.whyItMatters },
                        nextStep: { ...item.copy.nextStep },
                    },
                    affectedUrls: [...item.affectedUrls],
                    evidence: item.evidence.map((evidence) => ({
                        sourceRef: evidence.sourceRef,
                        url: evidence.url ?? null,
                        observation: {
                            ...evidence.observation,
                            market: evidence.observation.market
                                ? { ...evidence.observation.market }
                                : null,
                        },
                    })),
                    severity: item.severity,
                    firstPartyImpact: item.firstPartyImpact, confidence: item.confidence, effort: item.effort,
                    version: item.version, lastVerifiedAt: item.lastVerifiedAt, retest: item.retest,
                    sourceStatus: all.sourceStatus[item.sourceType]
                        ? {
                            status: all.sourceStatus[item.sourceType]!.status,
                            lastObservedAt: all.sourceStatus[item.sourceType]!.lastObservedAt ?? null,
                        }
                        : null,
                }, 'derived', { value: item.severity, state: item.state, observedAt: item.observedAt })),
            };
        },
    });
}
