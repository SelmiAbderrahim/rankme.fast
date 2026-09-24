import { and, desc, eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { landscapeOpportunityAcceptances } from '../../../db/schema/index.js';
import { CompetitorLandscapeReportPage, CompetitorLandscapeRun, competitorOpportunitySourceId, landscapeReportManifestSchema, landscapeReportRowSchema, } from '../../competitors/index.js';
import { hashActionId } from '../actions.identity.js';
import type { SourceReader } from '../actions.registry.js';
import type { ActionEvidence, CandidateAction } from '../actions.types.js';
const MAX_ACCEPTED_OPPORTUNITIES = 200;
export const competitorOpportunityActionAdapter: SourceReader = async (ctx) => {
    const acceptances = await ctx.db
        .select()
        .from(landscapeOpportunityAcceptances)
        .where(and(eq(landscapeOpportunityAcceptances.accountId, ctx.accountId), eq(landscapeOpportunityAcceptances.siteId, ctx.siteId)))
        .orderBy(desc(landscapeOpportunityAcceptances.acceptedAt))
        .limit(MAX_ACCEPTED_OPPORTUNITIES);
    if (acceptances.length === 0)
        return { actions: [], status: 'available' };
    const reportIds = [...new Set(acceptances.map((row) => row.reportId))].filter((id) => Types.ObjectId.isValid(id));
    const runs = await CompetitorLandscapeRun.find({
        _id: { $in: reportIds },
        accountId: ctx.accountId,
        siteId: ctx.siteId,
        state: { $in: ['completed', 'partial'] },
    }, { reportManifest: 1, completedAt: 1 }).lean();
    const runById = new Map(runs.map((run) => [String(run._id), run]));
    const pages = await CompetitorLandscapeReportPage.find({
        accountId: ctx.accountId,
        siteId: ctx.siteId,
        runId: { $in: reportIds },
    }, { runId: 1, rows: 1 }).lean();
    const rowsByReport = new Map<string, Map<string, ReturnType<typeof landscapeReportRowSchema.parse>>>();
    for (const page of pages) {
        const reportRows = rowsByReport.get(String(page.runId)) ?? new Map();
        for (const rawRow of page.rows) {
            const row = landscapeReportRowSchema.parse(rawRow);
            reportRows.set(row.id, row);
        }
        rowsByReport.set(String(page.runId), reportRows);
    }
    const actions: CandidateAction[] = [];
    for (const acceptance of acceptances) {
        const run = runById.get(acceptance.reportId);
        if (!run?.reportManifest)
            continue;
        const manifest = landscapeReportManifestSchema.parse(run.reportManifest);
        const opportunity = manifest.opportunities.find((candidate) => candidate.id === acceptance.opportunityId);
        if (!opportunity)
            continue;
        const sourceId = competitorOpportunitySourceId(acceptance.reportId, acceptance.opportunityId);
        const expectedActionId = hashActionId({
            accountId: ctx.accountId,
            siteId: ctx.siteId,
            sourceType: 'competitor_opportunity',
            sourceId,
        });
        if (acceptance.actionId !== expectedActionId)
            continue;
        const reportRows = rowsByReport.get(acceptance.reportId) ?? new Map();
        const evidenceRows = opportunity.evidenceRowIds
            .map((id) => reportRows.get(id))
            .filter((row): row is NonNullable<typeof row> => row !== undefined);
        const observedAt = manifest.sourceDates
            .map((source) => source.capturedAt)
            .filter((value): value is string => value !== null)
            .sort()
            .at(-1) ?? acceptance.acceptedAt.toISOString();
        const evidence: ActionEvidence[] = evidenceRows.map((row) => ({
            sourceRef: row.id,
            ...(row.competitorUrl ? { url: row.competitorUrl } : {}),
            observation: {
                sourceKind: 'provider_observation',
                sourceLabel: 'competitor_landscape',
                observedAt,
                freshUntil: null,
                freshness: 'unknown',
                market: null,
                sampleCount: 1,
                coverageNoteKey: 'observations.coverage.competitorLandscape',
            },
        }));
        const affectedUrls = [...new Set(evidenceRows.flatMap((row) => row.ownedUrl ? [row.ownedUrl] : []))].sort();
        actions.push({
            sourceType: 'competitor_opportunity',
            sourceId,
            affectedUrls,
            evidence,
            severity: 'warning',
            firstPartyImpact: opportunity.kind === 'ranking_deficit' ? 'medium' : 'none',
            confidence: opportunity.confidence,
            effort: opportunity.kind === 'missing_keyword' ? 'high' : 'medium',
            sourceState: 'open',
            observedAt: acceptance.acceptedAt.toISOString(),
            lastVerifiedAt: observedAt,
            retestAvailable: false,
            retestReasonKey: 'actions.errors.retestUnsupported',
            copyKeys: {
                problem: opportunity.titleKey,
                whyItMatters: 'actions.competitorOpportunity.whyItMatters',
                nextStep: opportunity.recommendationKey,
            },
            copyVars: {
                ...opportunity.titleVars,
                ...opportunity.recommendationVars,
                count: opportunity.keywordKeys.length,
                ...(affectedUrls[0] ? { url: affectedUrls[0] } : {}),
            },
        });
    }
    return {
        actions,
        status: 'available',
        lastObservedAt: acceptances[0]?.acceptedAt.toISOString(),
    };
};
