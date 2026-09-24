import { z } from 'zod';
import { stableReportJson } from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { assertSiteResourceTarget, createStoredReportAdapter, storedRecord, type LoadedStoredReport, type ReportExportAccessContext, } from '../report-exports/index.js';
import { getSite } from '../sites/index.js';
import { getAnalysis } from './content-intelligence.service.js';
import { getStoredRecommendationOutcome } from './content-recommendation-outcomes.service.js';
import { getRecommendationApplicationCheck, listRecommendationHistory } from './content-recommendation.service.js';
import { getInventoryRun } from './inventory.service.js';
const analysisSelectionSchema = z.object({
    sections: z.array(z.enum(['scorecard', 'recommendations', 'brief', 'draft', 'citations'])).max(5).optional(),
    draftVersion: z.string().trim().min(1).max(128).optional(),
}).strict();
type AnalysisSelection = z.infer<typeof analysisSelectionSchema>;
type ContentIntelligenceExportContext = Pick<ReportExportAccessContext, 'accountId' | 'target' | 'locale'>;
async function analysisBase(context: ContentIntelligenceExportContext) {
    assertSiteResourceTarget(context.target);
    const analysis = await getAnalysis({ accountId: context.accountId, siteId: context.target.siteId, analysisId: context.target.resourceId, locale: context.locale });
    return analysis;
}
function createAnalysisAdapter() {
    return createStoredReportAdapter<AnalysisSelection>({
        kind: 'content.analysis', localizationStem: 'contentAnalysis', formats: ['pdf', 'json', 'md'], selectionSchema: analysisSelectionSchema,
        access: analysisBase,
        async load(context): Promise<LoadedStoredReport> {
            const analysis = await analysisBase(context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const sections = new Set(context.selection.sections ?? ['scorecard', 'recommendations', 'brief', 'draft', 'citations']);
            const records = [storedRecord('analysis', analysis.analysisId, stableReportJson({
                    ownedUrl: analysis.ownedUrl, keyword: analysis.keyword, locale: analysis.locale, status: analysis.status,
                    stages: analysis.stages, warnings: analysis.warnings, schemaVersion: analysis.schemaVersion,
                    owned: analysis.owned, error: analysis.error, requestedAt: analysis.requestedAt,
                    startedAt: analysis.startedAt, completedAt: analysis.completedAt, cancelledAt: analysis.cancelledAt,
                }), 'derived', { state: analysis.status, observedAt: analysis.completedAt ?? analysis.requestedAt })];
            if (sections.has('scorecard'))
                records.push(storedRecord('scorecard', 'current', stableReportJson({ scorecard: analysis.scorecard, scorecardV2: analysis.scorecardV2 }), 'derived', { observedAt: analysis.completedAt }));
            if (sections.has('recommendations')) {
                const states = new Map(analysis.recommendationStates.map((state) => [state.recommendationId, {
                        recommendationId: state.recommendationId, analysisVersion: state.analysisVersion, state: state.state,
                        version: state.version, stateChangedAt: state.stateChangedAt, appliedAt: state.appliedAt,
                        baselineAnchorAt: state.baselineAnchorAt, contentHash: state.contentHash,
                        analysisContentHash: state.analysisContentHash, hashStatus: state.hashStatus,
                    }]));
                analysis.recommendations.forEach((recommendation) => records.push(storedRecord('recommendation', recommendation.id, stableReportJson({ recommendation, decision: states.get(recommendation.id) ?? null }), 'generated', { state: states.get(recommendation.id)?.state ?? 'open', observedAt: states.get(recommendation.id)?.stateChangedAt ?? analysis.completedAt })));
            }
            if (sections.has('brief')) {
                analysis.briefVersions.forEach((version) => records.push(storedRecord('brief-version', version.versionId, stableReportJson(version), 'generated', { observedAt: version.savedAt })));
                if (analysis.brief !== null && analysis.briefVersions.length === 0)
                    records.push(storedRecord('brief', 'current', stableReportJson(analysis.brief), 'generated', { observedAt: analysis.completedAt }));
            }
            const selectedDraft = context.selection.draftVersion
                ? analysis.draftVersions.find((version) => version.versionId === context.selection.draftVersion)
                : analysis.draftVersions.at(-1);
            const draftMarkdown = selectedDraft?.markdown ?? (typeof analysis.draft === 'string' ? analysis.draft : null);
            if (context.selection.draftVersion && !selectedDraft)
                throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.errors.notFound' });
            if (sections.has('draft') && draftMarkdown !== null)
                records.push(storedRecord('draft', selectedDraft?.versionId ?? 'current', stableReportJson({ markdown: draftMarkdown, wordCount: selectedDraft?.wordCount ?? null, savedAt: selectedDraft?.savedAt ?? analysis.completedAt }), 'generated', { observedAt: selectedDraft?.savedAt ?? analysis.completedAt }));
            if (sections.has('citations'))
                analysis.citations.forEach((citation, index) => records.push(storedRecord('citation', String(index + 1), stableReportJson(citation), 'observation', { observedAt: analysis.completedAt })));
            return {
                siteLabel: site.displayName || site.domain, observedAt: analysis.completedAt ?? analysis.requestedAt ?? new Date(0).toISOString(),
                sourceVersionValue: analysis, records,
                ...(draftMarkdown !== null && sections.has('draft') ? { artifact: { format: 'md' as const, label: `${analysis.analysisId}.md`, value: draftMarkdown } } : {}),
            };
        },
    });
}
const outcomeSelectionSchema = z.object({ window: z.literal(28).optional(), version: z.string().trim().min(1).max(64).optional() }).strict();
type OutcomeSelection = z.infer<typeof outcomeSelectionSchema>;
function outcomeIds(resourceId: string): {
    analysisId: string;
    recommendationId: string;
} {
    const separator = resourceId.indexOf(':');
    if (separator < 1 || separator === resourceId.length - 1)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_RECOMMENDATIONS_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.recommendations.errors.notFound' });
    return { analysisId: resourceId.slice(0, separator), recommendationId: resourceId.slice(separator + 1) };
}
async function outcomeBase(db: ApplicationDb, context: ContentIntelligenceExportContext) {
    assertSiteResourceTarget(context.target);
    const ids = outcomeIds(context.target.resourceId);
    const analysis = await getAnalysis({ accountId: context.accountId, siteId: context.target.siteId, analysisId: ids.analysisId, locale: context.locale });
    const [outcome, applicationCheck, history] = await Promise.all([
        getStoredRecommendationOutcome(db, { accountId: context.accountId, ...ids }),
        getRecommendationApplicationCheck({ accountId: context.accountId, ...ids }),
        listRecommendationHistory(db, { accountId: context.accountId, ...ids }),
    ]);
    const recommendation = analysis.recommendations.find((item) => item.id === ids.recommendationId) ?? null;
    const decisionState = analysis.recommendationStates.find((item) => item.recommendationId === ids.recommendationId) ?? null;
    return {
        analysis, outcome, applicationCheck,
        history: history.map(({ actorUserId: _actorUserId, ...event }) => event),
        recommendation, decisionState: decisionState ? {
            recommendationId: decisionState.recommendationId, analysisVersion: decisionState.analysisVersion,
            state: decisionState.state, version: decisionState.version, stateChangedAt: decisionState.stateChangedAt,
            appliedAt: decisionState.appliedAt, baselineAnchorAt: decisionState.baselineAnchorAt,
            contentHash: decisionState.contentHash, analysisContentHash: decisionState.analysisContentHash,
            hashStatus: decisionState.hashStatus,
        } : null,
        ids,
    };
}
function createOutcomeAdapter(db: ApplicationDb) {
    return createStoredReportAdapter<OutcomeSelection>({
        kind: 'content.recommendation_outcome', localizationStem: 'contentRecommendationOutcome', formats: ['pdf', 'json'], selectionSchema: outcomeSelectionSchema,
        access: (context) => outcomeBase(db, context),
        async load(context): Promise<LoadedStoredReport> {
            const loaded = await outcomeBase(db, context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const outcome = loaded.outcome;
            const observedAt = outcome.available ? outcome.appliedAt : loaded.analysis.completedAt ?? loaded.analysis.requestedAt ?? new Date(0).toISOString();
            const records = !outcome.available ? [storedRecord('outcome', loaded.ids.recommendationId, stableReportJson({
                    available: false, recommendation: loaded.recommendation, decisionState: loaded.decisionState,
                    applicationCheck: loaded.applicationCheck, history: loaded.history,
                }), 'derived', { state: loaded.decisionState?.state ?? 'unavailable', observedAt })] : [
                storedRecord('outcome-summary', loaded.ids.recommendationId, stableReportJson({
                    available: true, dataAvailable: outcome.dataAvailable, aggregationVersion: outcome.aggregationVersion,
                    recommendation: loaded.recommendation, decisionState: loaded.decisionState,
                    applicationCheck: loaded.applicationCheck, history: loaded.history,
                    appliedAt: outcome.appliedAt, contentHash: outcome.contentHash, hashStatus: outcome.hashStatus,
                    window: outcome.window, coverage: outcome.coverage, metrics: outcome.metrics, laterEdit: outcome.laterEdit,
                }), 'derived', { state: outcome.dataAvailable ? 'available' : 'unavailable', observedAt }),
                ...outcome.series.map((row, index) => storedRecord('outcome-observation', String(index + 1), stableReportJson(row), 'observation', { label: row.source, state: row.phase, observedAt: row.observedAt })),
            ];
            return { siteLabel: site.displayName || site.domain, observedAt, sourceVersionValue: loaded, selectedItems: outcome.available ? outcome.series.length : 0, records };
        },
    });
}
const inventorySelectionSchema = z.object({
    page: z.array(z.string().url().max(2048)).max(1000).optional(),
    flag: z.array(z.enum(['thin', 'orphan', 'weakly_linked'])).max(3).optional(),
    cluster: z.array(z.string().trim().min(1).max(128)).max(1000).optional(),
    gap: z.array(z.string().trim().min(1).max(128)).max(1000).optional(),
}).strict();
type InventorySelection = z.infer<typeof inventorySelectionSchema>;
async function inventoryBase(context: ContentIntelligenceExportContext) {
    assertSiteResourceTarget(context.target);
    const run = await getInventoryRun({ accountId: context.accountId, runId: context.target.resourceId, locale: context.locale });
    if (run.siteId !== context.target.siteId)
        throw HttpError.notFound({ code: 'CONTENT_INTELLIGENCE_INVENTORY_ERRORS_NOT_FOUND', messageKey: 'contentIntelligence.inventory.errors.notFound' });
    await getSite(context.accountId, context.target.siteId);
    return run;
}
function createInventoryAdapter() {
    return createStoredReportAdapter<InventorySelection>({
        kind: 'content.inventory_run', localizationStem: 'contentInventoryRun', formats: ['pdf', 'csv', 'json'], selectionSchema: inventorySelectionSchema,
        access: (context) => inventoryBase(context),
        async load(context): Promise<LoadedStoredReport> {
            const run = await inventoryBase(context);
            assertSiteResourceTarget(context.target);
            const site = await getSite(context.accountId, context.target.siteId);
            const pageSet = new Set(context.selection.page ?? []);
            const findings = run.findings;
            const records = [storedRecord('inventory-run', run.runId, stableReportJson({
                    origin: run.origin, locale: run.locale, status: run.status, input: run.input, progress: run.progress,
                    warnings: run.warnings, error: run.error, thresholdsVersion: run.thresholdsVersion,
                    requestedAt: run.requestedAt, startedAt: run.startedAt, completedAt: run.completedAt, cancelledAt: run.cancelledAt,
                }), 'derived', { state: run.status, observedAt: run.completedAt ?? run.requestedAt })];
            run.pages.filter((page) => pageSet.size === 0 || pageSet.has(page.url)).forEach((page) => records.push(storedRecord('page', page.url, stableReportJson(page.facts), 'observation', { label: page.url, observedAt: run.completedAt })));
            if (findings) {
                const clusterSet = new Set(context.selection.cluster ?? []);
                findings.clusters.filter((item) => clusterSet.size === 0 || clusterSet.has(item.id)).forEach((item) => records.push(storedRecord('topic-cluster', item.id, stableReportJson(item), 'derived', { label: item.label, observedAt: run.completedAt })));
                findings.duplicates.forEach((item) => records.push(storedRecord('duplicate-group', item.id, stableReportJson(item), 'derived', { state: item.kind, observedAt: run.completedAt })));
                const flags = new Set(context.selection.flag ?? []);
                [...findings.thinPages, ...findings.orphanPages].filter((item) => flags.size === 0 || flags.has(item.reason)).forEach((item, index) => records.push(storedRecord('flagged-page', `${item.url}:${index}`, stableReportJson(item), 'derived', { label: item.url, state: item.reason, observedAt: run.completedAt })));
                findings.cannibalization.forEach((item) => records.push(storedRecord('cannibalization', item.id, stableReportJson(item), 'derived', { observedAt: run.completedAt })));
                const gaps = new Set(context.selection.gap ?? []);
                findings.gaps.filter((item) => gaps.size === 0 || gaps.has(item.id)).forEach((item) => records.push(storedRecord('topical-gap', item.id, stableReportJson(item), 'derived', { label: item.query, state: item.confidence, observedAt: run.completedAt })));
                if (findings.opportunityExplanation)
                    records.push(storedRecord('opportunity-explanation', 'current', findings.opportunityExplanation, 'generated', { value: findings.opportunityExplanation, observedAt: run.completedAt }));
            }
            return { siteLabel: site.displayName || site.domain, observedAt: run.completedAt ?? run.requestedAt ?? new Date(0).toISOString(), sourceVersionValue: run, selectedItems: Math.max(0, records.length - 1), records };
        },
    });
}
export function createContentIntelligenceReportExportAdapters(db: ApplicationDb) {
    return [createAnalysisAdapter(), createOutcomeAdapter(db), createInventoryAdapter()];
}
export const contentIntelligenceReportExportTestables = Object.freeze({
    analysisSelectionSchema,
    analysisBase,
    createAnalysisAdapter,
    outcomeSelectionSchema,
    outcomeIds,
    outcomeBase,
    createOutcomeAdapter,
    inventorySelectionSchema,
    inventoryBase,
    createInventoryAdapter,
});
