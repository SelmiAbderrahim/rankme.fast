import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { Types } from 'mongoose';
import { landscapeOpportunityAcceptances, type LandscapeOpportunityAcceptanceRow, } from '../../../db/schema/index.js';
import { HttpError } from '../../../shared/utils/http-error.js';
import { CompetitorLandscapeRun } from './landscape.model.js';
import { landscapeReportManifestSchema } from './landscape.schemas.js';
import type { LandscapeReportManifest } from './landscape.schemas.js';
export interface AcceptLandscapeOpportunityInput {
    accountId: string;
    siteId: string;
    reportId: string;
    opportunityId: string;
    acceptedByUserId: string;
    idempotencyKey: string;
}
export interface AcceptLandscapeOpportunityResult {
    acceptanceId: string;
    actionId: string;
    replayed: boolean;
}
export function competitorOpportunitySourceId(reportId: string, opportunityId: string): string {
    return `${reportId}:${opportunityId}`;
}
function competitorOpportunityActionId(input: {
    accountId: string;
    siteId: string;
    reportId: string;
    opportunityId: string;
}): string {
    return createHash('sha256')
        .update(input.accountId)
        .update('\0')
        .update(input.siteId)
        .update('\0')
        .update('competitor_opportunity')
        .update('\0')
        .update(competitorOpportunitySourceId(input.reportId, input.opportunityId))
        .digest('hex');
}
function result(row: LandscapeOpportunityAcceptanceRow, replayed: boolean): AcceptLandscapeOpportunityResult {
    return { acceptanceId: row.id, actionId: row.actionId, replayed };
}
async function findByIdempotency(db: ApplicationDb, accountId: string, idempotencyKey: string) {
    const rows = await db
        .select()
        .from(landscapeOpportunityAcceptances)
        .where(and(eq(landscapeOpportunityAcceptances.accountId, accountId), eq(landscapeOpportunityAcceptances.idempotencyKey, idempotencyKey)))
        .limit(1);
    return rows[0] ?? null;
}
async function findByOpportunity(db: ApplicationDb, input: Pick<AcceptLandscapeOpportunityInput, 'accountId' | 'reportId' | 'opportunityId'>) {
    const rows = await db
        .select()
        .from(landscapeOpportunityAcceptances)
        .where(and(eq(landscapeOpportunityAcceptances.accountId, input.accountId), eq(landscapeOpportunityAcceptances.reportId, input.reportId), eq(landscapeOpportunityAcceptances.opportunityId, input.opportunityId)))
        .limit(1);
    return rows[0] ?? null;
}
function sameDecision(row: LandscapeOpportunityAcceptanceRow, input: AcceptLandscapeOpportunityInput): boolean {
    return (row.siteId === input.siteId &&
        row.reportId === input.reportId &&
        row.opportunityId === input.opportunityId);
}
/** Explicit zero-spend acceptance of one immutable report opportunity. */
export async function acceptLandscapeOpportunity(db: ApplicationDb, input: AcceptLandscapeOpportunityInput): Promise<AcceptLandscapeOpportunityResult> {
    if (!Types.ObjectId.isValid(input.siteId) ||
        !Types.ObjectId.isValid(input.reportId)) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_NOT_FOUND', messageKey: 'competitors.landscape.errors.notFound' });
    }
    if (input.idempotencyKey.length < 1 ||
        input.idempotencyKey.length > 128 ||
        !/^[\x21-\x7e]+$/.test(input.idempotencyKey)) {
        throw HttpError.badRequest({ code: 'COMPETITORS_LANDSCAPE_ERRORS_IDEMPOTENCY_INVALID', messageKey: 'competitors.landscape.errors.idempotencyInvalid' });
    }
    const run = await CompetitorLandscapeRun.findOne({
        _id: input.reportId,
        accountId: input.accountId,
        siteId: input.siteId,
        state: { $in: ['completed', 'partial'] },
    }).lean();
    if (!run || !run.reportManifest) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_NOT_FOUND', messageKey: 'competitors.landscape.errors.notFound' });
    }
    const manifest = landscapeReportManifestSchema.parse(run.reportManifest);
    const opportunity = manifest.opportunities.find((candidate) => candidate.id === input.opportunityId);
    if (!opportunity) {
        throw HttpError.notFound({ code: 'COMPETITORS_LANDSCAPE_ERRORS_OPPORTUNITY_NOT_FOUND', messageKey: 'competitors.landscape.errors.opportunityNotFound' });
    }
    const idempotent = await findByIdempotency(db, input.accountId, input.idempotencyKey);
    if (idempotent) {
        if (!sameDecision(idempotent, input)) {
            throw HttpError.conflict({ code: 'ACTIONS_ERRORS_IDEMPOTENCY_MISMATCH', messageKey: 'actions.errors.idempotencyMismatch' });
        }
        return result(idempotent, true);
    }
    const accepted = await findByOpportunity(db, input);
    if (accepted)
        return result(accepted, true);
    const actionId = competitorOpportunityActionId(input);
    try {
        const inserted = await db
            .insert(landscapeOpportunityAcceptances)
            .values({
            accountId: input.accountId,
            siteId: input.siteId,
            reportId: input.reportId,
            opportunityId: opportunity.id,
            actionId,
            acceptedByUserId: input.acceptedByUserId,
            idempotencyKey: input.idempotencyKey,
        })
            .returning();
        const row = inserted[0];
        if (!row)
            throw new Error('landscape acceptance insert returned no row');
        return result(row, false);
    }
    catch (error) {
        const racedIdempotency = await findByIdempotency(db, input.accountId, input.idempotencyKey);
        if (racedIdempotency) {
            if (!sameDecision(racedIdempotency, input)) {
                throw HttpError.conflict({ code: 'ACTIONS_ERRORS_IDEMPOTENCY_MISMATCH', messageKey: 'actions.errors.idempotencyMismatch' });
            }
            return result(racedIdempotency, true);
        }
        const racedOpportunity = await findByOpportunity(db, input);
        if (racedOpportunity)
            return result(racedOpportunity, true);
        throw error;
    }
}
export async function listLandscapeOpportunityAcceptances(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
    reportId?: string;
}): Promise<LandscapeOpportunityAcceptanceRow[]> {
    const predicates = [
        eq(landscapeOpportunityAcceptances.accountId, input.accountId),
        eq(landscapeOpportunityAcceptances.siteId, input.siteId),
    ];
    if (input.reportId) {
        predicates.push(eq(landscapeOpportunityAcceptances.reportId, input.reportId));
    }
    return db
        .select()
        .from(landscapeOpportunityAcceptances)
        .where(and(...predicates));
}
export async function overlayLandscapeOpportunityAcceptances(db: ApplicationDb, input: {
    accountId: string;
    siteId: string;
    reportId: string;
    manifest: LandscapeReportManifest;
}) {
    const acceptances = await listLandscapeOpportunityAcceptances(db, input);
    const actionByOpportunity = new Map(acceptances.map((acceptance) => [acceptance.opportunityId, acceptance.actionId]));
    return {
        ...input.manifest,
        opportunities: input.manifest.opportunities.map((opportunity) => ({
            ...opportunity,
            acceptedActionId: actionByOpportunity.get(opportunity.id) ?? null,
        })),
    };
}
