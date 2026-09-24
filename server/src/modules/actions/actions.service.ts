import { logger } from '../../config/logger.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { getSite } from '../sites/sites.service.js';
import { resolveCandidateForAction } from './actions.state.service.js';
import { hashActionId, buildSourceLink, legacyAuditActionId, } from './actions.identity.js';
import { ACTION_MAX_AFFECTED_URLS, compareActions, } from './actions.orders.js';
import { getSourceReaders, type SourceReaderResult, } from './actions.registry.js';
import { findLatestEventsForActions, listEventsForAction, } from './actions.events.repo.js';
import type { ActionItem, CandidateAction, SourceStatusEnvelope, } from './actions.types.js';
import type { ActionSourceType, ActionState } from '../../db/schema/action-events.js';
import { localizeSemanticCopy, type SupportedLocale, } from '../../shared/i18n/index.js';
import type { ActionEventRow } from '../../db/schema/action-events.js';
interface ListActionsInput {
    accountId: string;
    siteId: string;
    locale: SupportedLocale;
    db: ApplicationDb;
    filters?: {
        state?: readonly ActionState[];
        source?: readonly ActionSourceType[];
        severity?: readonly ('critical' | 'warning' | 'info')[];
        confidence?: readonly ('high' | 'medium' | 'low')[];
        effort?: readonly ('low' | 'medium' | 'high')[];
    };
    limit?: number;
    /** Offset cursor previously minted as `nextCursor` (digits only, zod-bound). */
    cursor?: string;
}
export interface ListActionsResult {
    items: ActionItem[];
    sourceStatus: SourceStatusEnvelope;
    nextCursor: string | null;
}
export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 50;
export async function listActionsForSite(input: ListActionsInput): Promise<ListActionsResult> {
    // Ownership check — throws 404 for cross-account.
    await getSite(input.accountId, input.siteId);
    const readers = getSourceReaders();
    const sourceStatus: SourceStatusEnvelope = {};
    const allCandidates: CandidateAction[] = [];
    await Promise.all(Array.from(readers.entries()).map(async ([sourceType, reader]) => {
        let result: SourceReaderResult;
        try {
            result = await reader({
                accountId: input.accountId,
                siteId: input.siteId,
                db: input.db,
            });
        }
        catch (err) {
            logger.warn({ sourceType, err: (err as Error).message }, 'action source reader failed');
            sourceStatus[sourceType] = { status: 'unavailable' };
            return;
        }
        sourceStatus[sourceType] = {
            status: result.status,
            lastObservedAt: result.lastObservedAt,
        };
        for (const candidate of result.actions) {
            allCandidates.push(candidate);
        }
    }));
    // Build stable IDs and normalize URLs.
    const identities = allCandidates.map((candidate) => {
        const id = hashActionId({
            accountId: input.accountId,
            siteId: input.siteId,
            sourceType: candidate.sourceType,
            sourceId: candidate.sourceId,
        });
        return {
            id,
            legacyId: legacyAuditActionId({
                accountId: input.accountId,
                siteId: input.siteId,
                sourceType: candidate.sourceType,
                sourceId: candidate.sourceId,
                sourceRef: candidate.evidence[0]?.sourceRef,
            }),
        };
    });
    const idsForOverlay = identities.flatMap(({ id, legacyId }) => legacyId ? [id, legacyId] : [id]);
    const overlays = idsForOverlay.length > 0
        ? await findLatestEventsForActions(input.db, input.accountId, idsForOverlay)
        : new Map<string, ActionEventRow>();
    const items: ActionItem[] = allCandidates.map((candidate, index) => {
        /* c8 ignore next -- index is bounded by allCandidates.length. */
        const identity = identities[index] ?? { id: '', legacyId: null };
        const id = identity.id;
        const currentOverlay = overlays.get(id);
        const overlay = currentOverlay ??
            (identity.legacyId ? overlays.get(identity.legacyId) : undefined);
        // For content_recommendation and citation_gap, the source stays
        // authoritative — the shipped recommendation service, not `action_events`.
        const state = candidate.sourceType === 'content_recommendation' ||
            candidate.sourceType === 'citation_gap'
            ? candidate.sourceState
            : (overlay?.newState ?? candidate.sourceState);
        // A legacy row supplies the state only. Version zero makes the next
        // transition establish the canonical rule-only history at ordinal one.
        const version = currentOverlay?.ordinal ?? 0;
        // The source still emits this candidate from an observation taken after
        // the user marked it done — surfaced so the UI can flag the claim instead
        // of quietly showing "completed".
        const reappearedAfterFix = state === 'completed' &&
            overlay !== undefined &&
            Date.parse(candidate.observedAt) > overlay.createdAt.getTime();
        const urls = candidate.affectedUrls.slice(0, ACTION_MAX_AFFECTED_URLS);
        const problemCopy = localizeSemanticCopy(input.locale, candidate.copyKeys.problem, candidate.copyVars);
        const whyCopy = localizeSemanticCopy(input.locale, candidate.copyKeys.whyItMatters, candidate.copyVars);
        const nextStepCopy = localizeSemanticCopy(input.locale, candidate.copyKeys.nextStep, candidate.copyVars);
        const retestReason = candidate.retestReasonKey
            ? localizeSemanticCopy(input.locale, candidate.retestReasonKey)
            : null;
        return {
            id,
            siteId: input.siteId,
            sourceType: candidate.sourceType,
            sourceId: candidate.sourceId,
            sourceLink: buildSourceLink(candidate.sourceType, input.siteId, candidate.sourceId),
            problem: problemCopy.message,
            whyItMatters: whyCopy.message,
            nextStep: nextStepCopy.message,
            copy: {
                problem: {
                    messageKey: problemCopy.messageKey,
                    ...(problemCopy.messageVars ? { messageVars: problemCopy.messageVars } : {}),
                },
                whyItMatters: {
                    messageKey: whyCopy.messageKey,
                    ...(whyCopy.messageVars ? { messageVars: whyCopy.messageVars } : {}),
                },
                nextStep: {
                    messageKey: nextStepCopy.messageKey,
                    ...(nextStepCopy.messageVars ? { messageVars: nextStepCopy.messageVars } : {}),
                },
            },
            affectedUrls: urls,
            evidence: candidate.evidence,
            severity: candidate.severity,
            firstPartyImpact: candidate.firstPartyImpact,
            confidence: candidate.confidence,
            effort: candidate.effort,
            state,
            version,
            reappearedAfterFix,
            observedAt: candidate.observedAt,
            lastVerifiedAt: candidate.lastVerifiedAt,
            retest: candidate.retestAvailable
                ? { available: true }
                : {
                    available: false,
                    ...(retestReason
                        ? {
                            reason: retestReason.message,
                            code: 'RETEST_UNSUPPORTED' as const,
                            messageKey: retestReason.messageKey,
                        }
                        : {}),
                },
            ...(candidate.codeFixPrompt
                ? {
                    codeFixPrompt: {
                        reference: candidate.codeFixPrompt.reference,
                        recommendedFix: localizeSemanticCopy(input.locale, candidate.codeFixPrompt.recommendedFixKey).message,
                        affectedUrlCount: candidate.codeFixPrompt.affectedUrlCount,
                    },
                }
                : {}),
        };
    });
    // Apply filters (before pagination and ordering).
    const filtered = items.filter((item) => {
        if (input.filters?.state && !input.filters.state.includes(item.state)) {
            return false;
        }
        if (input.filters?.source &&
            !input.filters.source.includes(item.sourceType)) {
            return false;
        }
        if (input.filters?.severity &&
            !input.filters.severity.includes(item.severity)) {
            return false;
        }
        if (input.filters?.confidence &&
            !input.filters.confidence.includes(item.confidence)) {
            return false;
        }
        if (input.filters?.effort && !input.filters.effort.includes(item.effort)) {
            return false;
        }
        return true;
    });
    filtered.sort(compareActions);
    const limit = Math.min(input.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
    const offset = input.cursor === undefined ? 0 : Number.parseInt(input.cursor, 10);
    const paged = filtered.slice(offset, offset + limit);
    const nextCursor = filtered.length > offset + limit ? String(offset + limit) : null;
    return { items: paged, sourceStatus, nextCursor };
}
export interface ListActionHistoryInput {
    accountId: string;
    siteId: string;
    actionId: string;
    db: ApplicationDb;
    locale: SupportedLocale;
}
export interface ActionHistoryEntry {
    ordinal: number;
    priorState: ActionState | null;
    newState: ActionState;
    eventKind: string;
    actorUserId: string;
    note: string | null;
    createdAt: string;
}
export async function getActionHistory(input: ListActionHistoryInput): Promise<{
    entries: ActionHistoryEntry[];
}> {
    await getSite(input.accountId, input.siteId);
    // Re-resolve + own the source before serving history — an unknown,
    // vanished, or cross-tenant action hash is a 404, never an empty-but-
    // acknowledged history. Append-only rows stay reachable for legal
    // export/purge through the events repo.
    const candidate = await resolveCandidateForAction(input.accountId, input.siteId, input.actionId, input.db);
    if (!candidate) {
        throw HttpError.notFound({ code: 'ACTIONS_ERRORS_NOT_FOUND', messageKey: 'actions.errors.notFound' });
    }
    const [currentRows, legacyRows] = await Promise.all([
        listEventsForAction(input.db, input.accountId, candidate.actionId),
        candidate.legacyActionId
            ? listEventsForAction(input.db, input.accountId, candidate.legacyActionId)
            : Promise.resolve([]),
    ]);
    const rows = [...legacyRows, ...currentRows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return {
        entries: rows.map((row, index) => ({
            ordinal: index + 1,
            priorState: row.priorState,
            newState: row.newState,
            eventKind: row.eventKind,
            actorUserId: row.actorUserId,
            note: row.note,
            createdAt: row.createdAt.toISOString(),
        })),
    };
}
