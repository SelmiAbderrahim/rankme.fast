import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { assertSiteResourceTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import type { ReportJsonValue } from '../../shared/report-exports/index.js';
import { getSite } from '../sites/index.js';
import { listTerminalSignalDecisions } from './audience-research.decisions.js';
import { AUDIENCE_RESEARCH_CONFIDENCE, AUDIENCE_RESEARCH_SIGNAL_TYPES, AUDIENCE_RESEARCH_SOURCE_TYPES, } from './audience-research.model.js';
import { getAudienceResearchRunResult } from './audience-research.service.js';
const selectionSchema = z.object({
    confidence: z.array(z.enum(AUDIENCE_RESEARCH_CONFIDENCE)).max(3).optional(),
    signal: z.array(z.enum(AUDIENCE_RESEARCH_SIGNAL_TYPES)).max(AUDIENCE_RESEARCH_SIGNAL_TYPES.length).optional(),
    source: z.array(z.enum(AUDIENCE_RESEARCH_SOURCE_TYPES)).max(AUDIENCE_RESEARCH_SOURCE_TYPES.length).optional(),
    decision: z.array(z.enum(['accepted', 'dismissed', 'undecided'])).max(3).optional(),
}).strict();
type Selection = z.infer<typeof selectionSchema>;
type AudienceResearchExportContext = Pick<ReportExportAccessContext, 'accountId' | 'target'>;
function reportJsonValue(value: unknown): ReportJsonValue {
    const serialized = JSON.stringify(value);
    return serialized === undefined
        ? null
        : JSON.parse(serialized) as ReportJsonValue;
}
async function base(db: Db, context: AudienceResearchExportContext) {
    assertSiteResourceTarget(context.target);
    const result = await getAudienceResearchRunResult({ accountId: context.accountId, siteId: context.target.siteId, runId: context.target.resourceId });
    const decisions = await listTerminalSignalDecisions(db, { accountId: context.accountId, runId: context.target.resourceId });
    return { result, decisions };
}
export function createAudienceResearchReportExportAdapter(db: Db) {
    return createStoredReportAdapter<Selection>({
        kind: 'audience.research_run', localizationStem: 'audienceResearchRun', formats: ['pdf', 'csv', 'json'], selectionSchema,
        access: (context) => base(db, context),
        async load(context): Promise<LoadedStoredReport> {
            const loaded = await base(db, context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const decisionBySignal = new Map(loaded.decisions.map((decision) => [decision.signalId, decision]));
            const signals = loaded.result.signals.filter((signal) => (!context.selection.confidence || context.selection.confidence.includes(signal.confidence as never)) &&
                (!context.selection.signal || context.selection.signal.includes(signal.type as never)) &&
                (!context.selection.decision || context.selection.decision.includes(decisionBySignal.get(signal.signalId)?.terminalDecision ?? 'undecided')));
            const cited = new Set(signals.flatMap((signal) => [...signal.citedSourceIds]));
            const sources = loaded.result.sources.filter((source) => cited.has(source.sourceId) || !context.selection.source || context.selection.source.includes(source.sourceType as never));
            const observedAt = loaded.result.completedAt ?? loaded.result.updatedAt;
            return {
                siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: loaded,
                selectedItems: sources.length + signals.length,
                records: [
                    storedRecord('run', loaded.result.runId, {
                        input: reportJsonValue(loaded.result.input), state: loaded.result.state,
                        outputLocale: loaded.result.outputLocale,
                        terminal: reportJsonValue(loaded.result.terminal),
                        coverageNoteKey: loaded.result.coverageNoteKey, requestedAt: loaded.result.requestedAt,
                        startedAt: loaded.result.startedAt, completedAt: loaded.result.completedAt,
                    }, 'derived', { state: loaded.result.state, observedAt }),
                    ...sources.map((source) => storedRecord('source', source.sourceId, {
                        canonicalUrl: source.canonicalUrl, title: source.title, sourceType: source.sourceType,
                        registrableDomain: source.registrableDomain, contentHash: source.contentHash,
                        excerpt: source.excerpt,
                        observationMeta: reportJsonValue(source.observationMeta),
                    }, 'observation', { label: source.title, state: source.sourceType, observedAt: source.observedAt })),
                    ...signals.map((signal) => {
                        const decision = decisionBySignal.get(signal.signalId);
                        return storedRecord('signal', signal.signalId, {
                            type: signal.type, title: signal.title, summary: signal.summary,
                            outputLocale: loaded.result.outputLocale,
                            suggestedRoute: signal.suggestedRoute, citedSourceIds: [...signal.citedSourceIds],
                            independentDomainCount: signal.independentDomainCount, sourceTypeCount: signal.sourceTypeCount,
                            mostRecentSourceObservedAt: signal.mostRecentSourceObservedAt, confidence: signal.confidence,
                            decision: decision ? {
                                terminalDecision: decision.terminalDecision, destination: decision.destination,
                                downstreamId: decision.downstreamId, deepLinkPath: decision.deepLinkPath, decidedAt: decision.decidedAt,
                            } : null,
                        }, signal.summary ? 'generated' : 'derived', {
                            label: signal.title, value: signal.confidence,
                            state: decision?.terminalDecision ?? 'undecided', observedAt: signal.mostRecentSourceObservedAt,
                        });
                    }),
                ],
            };
        },
    });
}
