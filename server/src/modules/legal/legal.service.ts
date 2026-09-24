import { randomUUID } from 'node:crypto';
import { HttpError } from '../../shared/utils/http-error.js';
import { DEFAULT_LOCALE } from '../../shared/i18n/index.js';
import { User } from '../users/index.js';
import { asc, eq } from 'drizzle-orm';
import { competitorContentEvents, contentAnalysisEvents, contentInventoryEvents, contentMonitorEvents, contentRecommendationEvents, contentRecommendationOutcomes, landscapeOpportunityAcceptances, landscapePageMatchReviews, } from '../../db/schema/index.js';
import { ContentAnalysis, ContentInventoryRun } from '../content-intelligence/index.js';
import { CompetitorContentRun } from '../competitor-content/index.js';
import { ContentMonitor } from '../content-monitoring/index.js';
import { exportLandscapeRuns } from '../competitors/index.js';
import { completePendingAccountCancellation, recordAccountDeletionAudit, } from './account-deletion-audit.js';
import type { ApplicationDb } from '../../shared/types/application-db.js';
export interface UserExport {
    account: {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
        role: string;
        language: string | null;
        createdAt: string | null;
        updatedAt: string | null;
        deletionScheduledAt: string | null;
        legalHold: boolean;
    };
    contentIntelligence: {
        analyses: Array<{
            analysisId: string;
            siteId: string;
            ownedUrl: string;
            keyword: string;
            locale: string;
            status: string;
            reviewedCompetitorUrls: string[];
            reviewedPageMatches: unknown[];
            scorecard: unknown;
            brief: unknown;
            briefVersions: unknown[];
            draft: unknown;
            draftVersions: unknown[];
            citations: unknown[];
            warnings: unknown[];
            recommendations: unknown[];
            recommendationStates: unknown[];
            requestedAt: string;
            completedAt: string | null;
        }>;
        usageEvents: Array<{
            scope: 'analysis' | 'inventory' | 'competitor' | 'monitor';
            recordId: string;
            kind: string;
            units: number;
            errorCategory: string | null;
            recordedAt: string;
        }>;
        recommendationEvents: Array<{
            analysisId: string;
            recommendationId: string;
            eventKind: string;
            priorState: string;
            newState: string;
            analysisVersion: string;
            stateVersion: number;
            actorUserId: string;
            note: string | null;
            contentHash: string | null;
            analysisContentHash: string | null;
            appliedAt: string | null;
            baselineAnchorAt: string | null;
            recordedAt: string;
        }>;
        outcomes: Array<{
            analysisId: string;
            recommendationId: string;
            aggregationVersion: string;
            source: string;
            phase: string;
            observedAt: string;
            clicks: number | null;
            impressions: number | null;
            ctr: number | null;
            averagePosition: number | null;
            rankPosition: number | null;
            laterEdit: boolean;
        }>;
        inventoryRuns: Array<{
            runId: string;
            siteId: string;
            status: string;
            pagesProcessed: number;
            requestedAt: string;
            completedAt: string | null;
        }>;
        competitorRuns: Array<{
            runId: string;
            siteId: string;
            status: string;
            competitorsProcessed: number;
            pagesScraped: number;
            pageMatches: unknown[];
            compatibilityMode: string;
            requestedAt: string;
            completedAt: string | null;
        }>;
        monitors: Array<{
            monitorId: string;
            siteId: string;
            targetUrl: string;
            targetKind: string;
            status: string;
            lastCheckAt: string | null;
            lastMaterialChangeAt: string | null;
            createdAt: string | null;
        }>;
    };
    competitorIntelligence: {
        landscapeRuns: Awaited<ReturnType<typeof exportLandscapeRuns>>;
        opportunityAcceptances: Array<{
            reportId: string;
            opportunityId: string;
            actionId: string;
            acceptedAt: string;
        }>;
        pageMatchReviews: Array<{
            reportId: string;
            suggestionId: string;
            competitorProfileId: string;
            decision: string;
            ownedUrl: string | null;
            competitorUrl: string | null;
            version: number;
            reviewedAt: string;
        }>;
    };
}
export interface ExportUserDataDeps {
    db?: ApplicationDb;
}
export async function exportUserData(userId: string, deps: ExportUserDataDeps = {}): Promise<UserExport> {
    const user = await User.findById(userId);
    if (!user)
        throw HttpError.notFound({ code: 'ERRORS_USER_NOT_FOUND', messageKey: 'errors.userNotFound' });
    const analyses = await ContentAnalysis.find({ accountId: userId }, {
        siteId: 1,
        ownedUrl: 1,
        keyword: 1,
        locale: 1,
        status: 1,
        reviewedCompetitorUrls: 1,
        reviewedPageMatches: 1,
        scorecardV2: 1,
        brief: 1,
        briefVersions: 1,
        draft: 1,
        draftVersions: 1,
        citations: 1,
        warnings: 1,
        recommendations: 1,
        recommendationStates: 1,
        requestedAt: 1,
        completedAt: 1,
    }).lean();
    const inventoryRuns = await ContentInventoryRun.find({ accountId: userId }, { siteId: 1, status: 1, progress: 1, requestedAt: 1, completedAt: 1 }).lean();
    const competitorRuns = await CompetitorContentRun.find({ accountId: userId }, { siteId: 1, status: 1, input: 1, progress: 1, requestedAt: 1, completedAt: 1 }).lean();
    const monitors = await ContentMonitor.find({ accountId: userId }, {
        siteId: 1,
        targetUrl: 1,
        targetKind: 1,
        status: 1,
        lastCheckAt: 1,
        lastMaterialChangeAt: 1,
        createdAt: 1,
    }).lean();
    const landscapeRuns = await exportLandscapeRuns(userId);
    const opportunityAcceptances = deps.db
        ? await deps.db
            .select({
            reportId: landscapeOpportunityAcceptances.reportId,
            opportunityId: landscapeOpportunityAcceptances.opportunityId,
            actionId: landscapeOpportunityAcceptances.actionId,
            acceptedAt: landscapeOpportunityAcceptances.acceptedAt,
        })
            .from(landscapeOpportunityAcceptances)
            .where(eq(landscapeOpportunityAcceptances.accountId, userId))
            .orderBy(asc(landscapeOpportunityAcceptances.acceptedAt))
        : [];
    const pageMatchReviews = deps.db
        ? await deps.db
            .select()
            .from(landscapePageMatchReviews)
            .where(eq(landscapePageMatchReviews.accountId, userId))
            .orderBy(asc(landscapePageMatchReviews.reviewedAt))
        : [];
    const events = deps.db
        ? await deps.db
            .select()
            .from(contentRecommendationEvents)
            .where(eq(contentRecommendationEvents.accountId, userId))
            .orderBy(asc(contentRecommendationEvents.recordedAt))
        : [];
    const outcomes = deps.db
        ? await deps.db
            .select()
            .from(contentRecommendationOutcomes)
            .where(eq(contentRecommendationOutcomes.accountId, userId))
            .orderBy(asc(contentRecommendationOutcomes.observedDate))
        : [];
    const analysisUsageEvents = deps.db
        ? await deps.db
            .select({
            recordId: contentAnalysisEvents.analysisId,
            kind: contentAnalysisEvents.kind,
            units: contentAnalysisEvents.units,
            errorCategory: contentAnalysisEvents.errorCategory,
            recordedAt: contentAnalysisEvents.recordedAt,
        })
            .from(contentAnalysisEvents)
            .where(eq(contentAnalysisEvents.accountId, userId))
            .orderBy(asc(contentAnalysisEvents.recordedAt))
        : [];
    const inventoryUsageEvents = deps.db
        ? await deps.db
            .select({
            recordId: contentInventoryEvents.runId,
            kind: contentInventoryEvents.kind,
            units: contentInventoryEvents.units,
            errorCategory: contentInventoryEvents.errorCategory,
            recordedAt: contentInventoryEvents.recordedAt,
        })
            .from(contentInventoryEvents)
            .where(eq(contentInventoryEvents.accountId, userId))
            .orderBy(asc(contentInventoryEvents.recordedAt))
        : [];
    const competitorUsageEvents = deps.db
        ? await deps.db
            .select({
            recordId: competitorContentEvents.runId,
            kind: competitorContentEvents.kind,
            units: competitorContentEvents.units,
            errorCategory: competitorContentEvents.errorCategory,
            recordedAt: competitorContentEvents.recordedAt,
        })
            .from(competitorContentEvents)
            .where(eq(competitorContentEvents.accountId, userId))
            .orderBy(asc(competitorContentEvents.recordedAt))
        : [];
    const monitorUsageEvents = deps.db
        ? await deps.db
            .select({
            recordId: contentMonitorEvents.monitorId,
            kind: contentMonitorEvents.kind,
            units: contentMonitorEvents.units,
            recordedAt: contentMonitorEvents.recordedAt,
        })
            .from(contentMonitorEvents)
            .where(eq(contentMonitorEvents.accountId, userId))
            .orderBy(asc(contentMonitorEvents.recordedAt))
        : [];
    return {
        account: {
            id: user._id.toString(),
            email: user.email,
            /* c8 ignore start -- schema defaults profile.firstName/lastName to '' so the nullish fallbacks never fire */
            firstName: user.profile?.firstName ?? '',
            lastName: user.profile?.lastName ?? '',
            /* c8 ignore stop */
            role: user.role,
            language: user.language ?? null,
            createdAt: toIso((user as unknown as {
                createdAt?: Date;
            }).createdAt),
            updatedAt: toIso((user as unknown as {
                updatedAt?: Date;
            }).updatedAt),
            deletionScheduledAt: toIso(user.deletionScheduledAt ?? null),
            legalHold: Boolean(user.legalHold),
        },
        contentIntelligence: {
            analyses: analyses.map((analysis) => ({
                analysisId: String(analysis._id),
                siteId: String(analysis.siteId),
                ownedUrl: analysis.ownedUrl,
                keyword: analysis.keyword,
                locale: analysis.locale,
                status: analysis.status,
                reviewedCompetitorUrls: analysis.reviewedCompetitorUrls ?? [],
                reviewedPageMatches: analysis.reviewedPageMatches ?? [],
                scorecard: analysis.scorecardV2 ?? null,
                brief: analysis.brief ?? null,
                briefVersions: analysis.briefVersions ?? [],
                draft: analysis.draft ?? null,
                draftVersions: analysis.draftVersions ?? [],
                citations: analysis.citations ?? [],
                warnings: analysis.warnings ?? [],
                recommendations: analysis.recommendations ?? [],
                recommendationStates: analysis.recommendationStates ?? [],
                requestedAt: new Date(analysis.requestedAt).toISOString(),
                completedAt: analysis.completedAt
                    ? new Date(analysis.completedAt).toISOString()
                    : null,
            })),
            usageEvents: [
                ...analysisUsageEvents.map((event) => ({
                    scope: 'analysis' as const,
                    recordId: event.recordId,
                    kind: event.kind,
                    units: event.units,
                    errorCategory: event.errorCategory,
                    recordedAt: event.recordedAt.toISOString(),
                })),
                ...inventoryUsageEvents.map((event) => ({
                    scope: 'inventory' as const,
                    recordId: event.recordId,
                    kind: event.kind,
                    units: event.units,
                    errorCategory: event.errorCategory,
                    recordedAt: event.recordedAt.toISOString(),
                })),
                ...competitorUsageEvents.map((event) => ({
                    scope: 'competitor' as const,
                    recordId: event.recordId,
                    kind: event.kind,
                    units: event.units,
                    errorCategory: event.errorCategory,
                    recordedAt: event.recordedAt.toISOString(),
                })),
                ...monitorUsageEvents.map((event) => ({
                    scope: 'monitor' as const,
                    recordId: event.recordId,
                    kind: event.kind,
                    units: event.units,
                    errorCategory: null,
                    recordedAt: event.recordedAt.toISOString(),
                })),
            ].sort((left, right) => left.recordedAt.localeCompare(right.recordedAt)),
            recommendationEvents: events.map((event) => ({
                analysisId: event.analysisId,
                recommendationId: event.recommendationId,
                eventKind: event.eventKind,
                priorState: event.priorState,
                newState: event.newState,
                analysisVersion: event.analysisVersion,
                stateVersion: event.stateVersion,
                actorUserId: event.actorUserId,
                note: event.note,
                contentHash: event.contentHash,
                analysisContentHash: event.analysisContentHash,
                appliedAt: event.appliedAt?.toISOString() ?? null,
                baselineAnchorAt: event.baselineAnchorAt?.toISOString() ?? null,
                recordedAt: event.recordedAt.toISOString(),
            })),
            outcomes: outcomes.map((outcome) => ({
                analysisId: outcome.analysisId,
                recommendationId: outcome.recommendationId,
                aggregationVersion: outcome.aggregationVersion,
                source: outcome.source,
                phase: outcome.phase,
                observedAt: outcome.observedDate.toISOString(),
                clicks: outcome.clicks,
                impressions: outcome.impressions,
                ctr: outcome.ctr,
                averagePosition: outcome.averagePosition,
                rankPosition: outcome.rankPosition,
                laterEdit: outcome.laterEdit === 1,
            })),
            inventoryRuns: inventoryRuns.map((run) => ({
                runId: String(run._id),
                siteId: String(run.siteId),
                status: String(run.status),
                pagesProcessed: Number(run.progress.pagesProcessed),
                requestedAt: new Date(run.requestedAt).toISOString(),
                completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null,
            })),
            competitorRuns: competitorRuns.map((run) => ({
                runId: String(run._id),
                siteId: String(run.siteId),
                status: String(run.status),
                competitorsProcessed: Number(run.progress.competitorsProcessed),
                pagesScraped: Number(run.progress.pagesScraped),
                pageMatches: run.input.pageMatches,
                compatibilityMode: run.input.compatibilityMode,
                requestedAt: new Date(run.requestedAt).toISOString(),
                completedAt: run.completedAt ? new Date(run.completedAt).toISOString() : null,
            })),
            monitors: monitors.map((monitor) => ({
                monitorId: String(monitor._id),
                siteId: String(monitor.siteId),
                targetUrl: String(monitor.targetUrl),
                targetKind: String(monitor.targetKind),
                status: String(monitor.status),
                lastCheckAt: monitor.lastCheckAt ? new Date(monitor.lastCheckAt).toISOString() : null,
                lastMaterialChangeAt: monitor.lastMaterialChangeAt
                    ? new Date(monitor.lastMaterialChangeAt).toISOString()
                    : null,
                // `createdAt` is always present (timestamps: true) on a selected lean doc.
                createdAt: new Date((monitor as {
                    createdAt: Date;
                }).createdAt).toISOString(),
            })),
        },
        competitorIntelligence: {
            landscapeRuns,
            opportunityAcceptances: opportunityAcceptances.map((acceptance) => ({
                reportId: acceptance.reportId,
                opportunityId: acceptance.opportunityId,
                actionId: acceptance.actionId,
                acceptedAt: acceptance.acceptedAt.toISOString(),
            })),
            pageMatchReviews: pageMatchReviews.map((review) => ({
                reportId: review.reportId,
                suggestionId: review.suggestionId,
                competitorProfileId: review.competitorProfileId,
                decision: review.decision,
                ownedUrl: review.ownedUrl,
                competitorUrl: review.competitorUrl,
                version: review.version,
                reviewedAt: review.reviewedAt.toISOString(),
            })),
        },
    };
}
export interface WarningMailer {
    sendDeletionWarning(input: {
        to: string;
        firstName: string;
        purgeAt: Date;
        locale: string;
    }): Promise<void>;
}
export interface PurgeQueue {
    enqueuePurge(input: {
        userId: string;
        purgeAt: Date;
    }): Promise<void>;
    cancelPurge?(input: {
        userId: string;
    }): Promise<void>;
}
export interface ScheduleAccountDeletionDeps {
    now?: () => Date;
    graceHours: number;
    mailer?: WarningMailer;
    queue: PurgeQueue;
    locale?: string;
    ip?: string;
}
export interface AccountDeletionScheduled {
    scheduledAt: string;
    purgeAt: string;
    warningEmailQueued: boolean;
}
export async function scheduleAccountDeletion(userId: string, deps: ScheduleAccountDeletionDeps): Promise<AccountDeletionScheduled> {
    const now = deps.now?.() ?? new Date();
    const purgeAt = new Date(now.getTime() + deps.graceHours * 60 * 60 * 1000);
    const lifecycleId = randomUUID();
    const user = await User.findOneAndUpdate({
        _id: userId,
        deletionScheduledAt: null,
        deletionCancellationRequestedAt: null,
        legalHold: { $ne: true },
    }, {
        $set: {
            deletionScheduledAt: purgeAt,
            deletionWarningSentAt: null,
            deletionLifecycleId: lifecycleId,
            deletionCancellationId: null,
            deletionCancellationRequestedAt: null,
        },
    }, { new: true });
    if (!user) {
        const existing = await User.findById(userId);
        if (!existing)
            throw HttpError.notFound({ code: 'ERRORS_USER_NOT_FOUND', messageKey: 'errors.userNotFound' });
        if (existing.legalHold) {
            throw HttpError.forbidden({ code: 'SECURITY_LEGAL_HOLD_DELETION_BLOCKED', messageKey: 'security.legalHold.deletionBlocked' });
        }
        throw HttpError.conflict({ code: 'SECURITY_DELETION_ALREADY_SCHEDULED', messageKey: 'security.deletion.alreadyScheduled' });
    }
    let purgeEnqueued = false;
    try {
        await deps.queue.enqueuePurge({ userId, purgeAt });
        purgeEnqueued = true;
        await recordAccountDeletionAudit({
            accountId: userId,
            lifecycleId,
            outcome: 'requested',
            ip: deps.ip,
        });
    }
    catch (error) {
        // Queue + durable requested evidence are both required before the API can
        // acknowledge a schedule. Roll back only this lifecycle so a retry can
        // reconstruct either missing side without erasing a concurrent reschedule.
        const rolledBack = await User.updateOne({
            _id: userId,
            deletionScheduledAt: purgeAt,
            deletionLifecycleId: lifecycleId,
            deletionStartedAt: null,
        }, {
            $set: {
                deletionScheduledAt: null,
                deletionWarningSentAt: null,
                deletionLifecycleId: null,
                deletionCancellationId: null,
                deletionCancellationRequestedAt: null,
            },
        });
        if (purgeEnqueued && rolledBack.modifiedCount === 1) {
            try {
                await deps.queue.cancelPurge?.({ userId });
            }
            catch {
                // A stale job is harmless because every processor re-reads Mongo.
            }
        }
        throw error;
    }
    let warningEmailQueued = false;
    if (deps.mailer) {
        try {
            const stillScheduled = await User.exists({
                _id: userId,
                deletionScheduledAt: purgeAt,
                deletionLifecycleId: lifecycleId,
                deletionStartedAt: null,
                deletionCancellationRequestedAt: null,
            });
            if (!stillScheduled) {
                return {
                    scheduledAt: now.toISOString(),
                    purgeAt: purgeAt.toISOString(),
                    warningEmailQueued: false,
                };
            }
            await deps.mailer.sendDeletionWarning({
                to: user.email,
                /* c8 ignore next -- schema defaults profile.firstName to '' so the nullish fallback never fires */
                firstName: user.profile?.firstName ?? '',
                purgeAt,
                locale: deps.locale ?? user.language ?? DEFAULT_LOCALE,
            });
            const marked = await User.updateOne({
                _id: userId,
                deletionScheduledAt: purgeAt,
                deletionLifecycleId: lifecycleId,
                deletionStartedAt: null,
                deletionCancellationRequestedAt: null,
            }, { $set: { deletionWarningSentAt: new Date() } });
            warningEmailQueued = marked.modifiedCount === 1;
        }
        catch {
            // Warning-email failure is non-fatal — the schedule stays intact and
            // a nightly sweep re-attempts before purge.
            warningEmailQueued = false;
        }
    }
    return {
        scheduledAt: now.toISOString(),
        purgeAt: purgeAt.toISOString(),
        warningEmailQueued,
    };
}
export interface AccountDeletionCancelled {
    cancelledAt: string;
}
export interface AccountDeletionStatus {
    scheduledAt: string | null;
    startedAt: string | null;
    cancellable: boolean;
}
export async function getAccountDeletionStatus(userId: string): Promise<AccountDeletionStatus> {
    const user = await User.findById(userId)
        .select('deletionScheduledAt deletionStartedAt')
        .lean();
    if (!user)
        throw HttpError.notFound({ code: 'ERRORS_USER_NOT_FOUND', messageKey: 'errors.userNotFound' });
    return {
        scheduledAt: toIso(user.deletionScheduledAt ?? null),
        startedAt: toIso(user.deletionStartedAt ?? null),
        cancellable: Boolean(user.deletionScheduledAt && !user.deletionStartedAt),
    };
}
export async function cancelAccountDeletion(userId: string, deps: {
    queue: PurgeQueue;
    now?: () => Date;
    ip?: string;
}): Promise<AccountDeletionCancelled> {
    const now = deps.now?.() ?? new Date();
    const cancellationId = randomUUID();
    const cancelled = await User.findOneAndUpdate({
        _id: userId,
        deletionScheduledAt: { $ne: null },
        deletionStartedAt: null,
        deletionCancellationRequestedAt: null,
    }, {
        $set: {
            deletionCancellationId: cancellationId,
            deletionCancellationRequestedAt: now,
        },
    }, { new: true });
    if (!cancelled) {
        const existing = await User.findById(userId)
            .select('deletionScheduledAt deletionStartedAt deletionCancellationRequestedAt')
            .lean();
        if (!existing)
            throw HttpError.notFound({ code: 'ERRORS_USER_NOT_FOUND', messageKey: 'errors.userNotFound' });
        if (existing.deletionStartedAt) {
            throw HttpError.conflict({ code: 'SECURITY_DELETION_ALREADY_STARTED', messageKey: 'security.deletion.alreadyStarted' });
        }
        if (existing.deletionCancellationRequestedAt) {
            await completePendingAccountCancellation(userId);
            try {
                await deps.queue.cancelPurge?.({ userId });
            }
            catch {
                // The processor observes the cleared durable schedule.
            }
            return { cancelledAt: existing.deletionCancellationRequestedAt.toISOString() };
        }
        throw HttpError.conflict({ code: 'SECURITY_DELETION_NOT_SCHEDULED', messageKey: 'security.deletion.notScheduled' });
    }
    await recordAccountDeletionAudit({
        accountId: userId,
        lifecycleId: cancellationId,
        outcome: 'cancelled',
        ip: deps.ip,
    });
    await completePendingAccountCancellation(userId);
    // Once the durable schedule is clear, an active job is harmless: its claim
    // returns not-scheduled and removeOnComplete erases the payload. Queue
    // cleanup is therefore best effort and cannot undo a successful cancel.
    try {
        await deps.queue.cancelPurge?.({ userId });
    }
    catch {
        // Reconciler/processor both consult Mongo before any teardown.
    }
    return { cancelledAt: now.toISOString() };
}
function toIso(d: Date | null | undefined): string | null {
    if (!d)
        return null;
    /* c8 ignore start -- callers only ever pass a Date or null; the coercion/NaN guards are belt-and-braces */
    const date = d instanceof Date ? d : new Date(d);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
    /* c8 ignore stop */
}
