/**
 * Confirm a rank drop with a FRESH, separate SERP observation before invoking
 * any drop effect.
 *
 * The service is invoked ONLY after a candidate ranking has already been
 * inserted successfully AND the unchanged `detectRankDrop` returned true.
 * Injection is used for every collaborator so the service typechecks in
 * isolation and can be tested without pulling the entire audit graph into
 * the test.
 *
 * Order of operations (LOCKED):
 *   1. Claim the confirmation attempt idempotently by candidate `rankingId`.
 *   2. Cross the vendor-call boundary via atomic single-winner UPDATE.
 *   3. Call the RankProvider capability with cache bypass.
 *   4. Settle to confirmed/volatile/unconfirmed.
 *   5. Only `confirmed` may claim the alert dispatch and invoke effects.
 *
 * Non-goals: second confirmation, local-pack confirmation, new queue family,
 * new vendor.
 */
import type { Logger } from 'pino';
import type { Db } from '../../db/client.js';
import type { AltEngineRankResult, RankCheckInput, RankCheckResult, RankProvider, } from '../../shared/providers/types.js';
import { ProviderError, VendorAuthError, VendorMalformedError, VendorQuotaError, VendorTimeoutError, VendorUnavailableError, } from '../../shared/providers/errors.js';
import type { RankDropConfirmationReason, RankDropConfirmationRow, RankDropConfirmationState, } from '../../db/schema/index.js';
import { isAltRankEngine, type RankEngineKind } from '../../db/schema/keywords.js';
import { detectRankDrop, type RankDropEvent } from './rank-drop.service.js';
import { claimAlertDispatch, claimAttempt, claimProviderCall, recordAlertDelivery, recordAlertError, settle, } from './rank-drop-confirmations.repo.js';
export interface AlertEffects {
    deliverEmail(event: RankDropEvent): Promise<void>;
    requestAutoRerun(event: RankDropEvent): Promise<void>;
}
export interface ConfirmationCandidate {
    accountId: string;
    siteId: string;
    siteUrl: string;
    keywordId: string;
    keyword: string;
    rankingId: string;
    previousPosition: number;
    candidatePosition: number | null;
    candidateObservedAt: Date;
    locationCode: number;
    languageCode: string;
    device: 'desktop' | 'mobile';
    domain: string;
    engine: RankEngineKind;
    /** Exact-match token for YouTube/Amazon; null for Google/Bing. */
    engineTarget: string | null;
}
export interface ConfirmRankDropDeps {
    db: Db;
    provider: RankProvider;
    effects: AlertEffects;
    logger: Logger;
    now?: () => Date;
}
export interface ConfirmRankDropResult {
    state: RankDropConfirmationState;
    reason: RankDropConfirmationReason | null;
    confirmationPosition: number | null;
    /** True iff this call was the winner that both settled and dispatched. */
    dispatched: boolean;
    /** True iff a duplicate/replay lost the attempt claim. */
    duplicate: boolean;
}
/**
 * Map a provider error to a customer-safe reason key. The raw message is
 * NEVER exposed on evidence or in the UI — only the category key survives.
 */
export function classifyProviderError(err: unknown): RankDropConfirmationReason {
    if (err instanceof VendorTimeoutError)
        return 'provider_timeout';
    if (err instanceof VendorQuotaError)
        return 'provider_quota';
    if (err instanceof VendorMalformedError)
        return 'provider_malformed';
    if (err instanceof VendorAuthError)
        return 'provider_unavailable';
    if (err instanceof VendorUnavailableError)
        return 'provider_unavailable';
    if (err instanceof ProviderError)
        return 'provider_unavailable';
    return 'provider_unavailable';
}
/**
 * One confirmation attempt for one candidate.
 *
 * Callers pass a fully-formed `ConfirmationCandidate` — this service never
 * accepts market/device/state/unit selection from a client. The candidate is
 * always reconstructed from persisted rank + keyword rows on the server.
 */
export async function confirmRankDrop(candidate: ConfirmationCandidate, deps: ConfirmRankDropDeps): Promise<ConfirmRankDropResult> {
    const now = deps.now ?? (() => new Date());
    // 1. Claim the attempt. Loser exits silently — replay/concurrency safe.
    const initial = await claimAttempt(deps.db, {
        accountId: candidate.accountId,
        siteId: candidate.siteId,
        keywordId: candidate.keywordId,
        rankingId: candidate.rankingId,
        state: 'unconfirmed',
        reason: 'interrupted',
        previousPosition: candidate.previousPosition,
        candidatePosition: candidate.candidatePosition,
        confirmationPosition: null,
        candidateObservedAt: candidate.candidateObservedAt,
        confirmationObservedAt: null,
        locationCode: candidate.locationCode,
        languageCode: candidate.languageCode,
        device: candidate.device,
        attemptReservedAt: now(),
        providerCalledAt: null,
        settledAt: now(),
    });
    if (initial === null) {
        return {
            state: 'unconfirmed',
            reason: null,
            confirmationPosition: null,
            dispatched: false,
            duplicate: true,
        };
    }
    // 2. Cross the vendor-call boundary atomically. A crash between here and
    //    provider return settles as `interrupted` on the next observation.
    const provWon = await claimProviderCall(deps.db, initial.id, now());
    if (!provWon) {
        // Concurrency lost this — do NOT re-invoke the provider.
        return {
            state: 'unconfirmed',
            reason: null,
            confirmationPosition: null,
            dispatched: false,
            duplicate: true,
        };
    }
    // 3. Fresh provider call — deliberately bypasses the ordinary SERP cache.
    const providerInput: RankCheckInput = {
        keyword: candidate.keyword,
        domain: candidate.domain,
        locationCode: candidate.locationCode,
        languageCode: candidate.languageCode,
        device: candidate.device,
    };
    let providerResult: Pick<RankCheckResult, 'position' | 'checkedAt'> | null = null;
    let providerError: unknown = null;
    try {
        if (isAltRankEngine(candidate.engine)) {
            const altResult: AltEngineRankResult = await deps.provider.checkAltEngineRank({
                ...providerInput,
                engine: candidate.engine,
                engineTarget: candidate.engineTarget,
            });
            providerResult = {
                position: altResult.position,
                checkedAt: altResult.checkedAt,
            };
        }
        else {
            providerResult = await deps.provider.checkRank(providerInput);
        }
    }
    catch (err) {
        providerError = err;
    }
    if (providerResult === null) {
        // Provider failed — settle unconfirmed with the categorized reason.
        const reason = classifyProviderError(providerError);
        await settle(deps.db, {
            id: initial.id,
            state: 'unconfirmed',
            reason,
            confirmationPosition: null,
            confirmationObservedAt: null,
            settledAt: now(),
        });
        deps.logger.warn({
            accountId: candidate.accountId,
            keywordId: candidate.keywordId,
            rankingId: candidate.rankingId,
            reason,
        }, 'rank-drop confirmation: provider unavailable — settled unconfirmed');
        return {
            state: 'unconfirmed',
            reason,
            confirmationPosition: null,
            dispatched: false,
            duplicate: false,
        };
    }
    // 4. Successful fresh observation. A `null` position is a VALID observation
    //    (domain not in vendor depth), NOT a failure.
    const stillDropped = detectRankDrop(candidate.previousPosition, providerResult.position);
    const state: RankDropConfirmationState = stillDropped ? 'confirmed' : 'volatile';
    await settle(deps.db, {
        id: initial.id,
        state,
        reason: null,
        confirmationPosition: providerResult.position,
        confirmationObservedAt: providerResult.checkedAt,
        settledAt: now(),
    });
    if (state !== 'confirmed') {
        return {
            state,
            reason: null,
            confirmationPosition: providerResult.position,
            dispatched: false,
            duplicate: false,
        };
    }
    // 5. Alert dispatch — atomic single-winner claim.
    const alertWon = await claimAlertDispatch(deps.db, initial.id, now());
    if (!alertWon) {
        return {
            state,
            reason: null,
            confirmationPosition: providerResult.position,
            dispatched: false,
            duplicate: false,
        };
    }
    const event: RankDropEvent = {
        accountId: candidate.accountId,
        siteId: candidate.siteId,
        keywordId: candidate.keywordId,
        keyword: candidate.keyword,
        previousPosition: candidate.previousPosition,
        currentPosition: providerResult.position,
        siteUrl: candidate.siteUrl,
    };
    try {
        await deps.effects.deliverEmail(event);
    }
    catch (err) {
        await recordAlertError(deps.db, initial.id, 'email_failed');
        deps.logger.warn({
            accountId: candidate.accountId,
            keywordId: candidate.keywordId,
            err: (err as Error).message,
        }, 'rank-drop confirmation: email failed — job continues');
    }
    try {
        await deps.effects.requestAutoRerun(event);
    }
    catch (err) {
        await recordAlertError(deps.db, initial.id, 'audit_rerun_failed');
        deps.logger.warn({
            accountId: candidate.accountId,
            siteId: candidate.siteId,
            err: (err as Error).message,
        }, 'rank-drop confirmation: audit rerun failed — job continues');
    }
    await recordAlertDelivery(deps.db, initial.id, now());
    return {
        state: 'confirmed',
        reason: null,
        confirmationPosition: providerResult.position,
        dispatched: true,
        duplicate: false,
    };
}
/** Convenience: safe DTO shape for the customer API. */
export function toConfirmationDto(row: RankDropConfirmationRow): {
    id: string;
    state: RankDropConfirmationState;
    reason: RankDropConfirmationReason | null;
    previousPosition: number | null;
    candidatePosition: number | null;
    confirmationPosition: number | null;
    candidateObservedAt: string;
    confirmationObservedAt: string | null;
    locationCode: number;
    languageCode: string;
    device: 'desktop' | 'mobile';
} {
    return {
        id: row.id,
        state: row.state,
        reason: row.reason,
        previousPosition: row.previousPosition,
        candidatePosition: row.candidatePosition,
        confirmationPosition: row.confirmationPosition,
        candidateObservedAt: row.candidateObservedAt.toISOString(),
        confirmationObservedAt: row.confirmationObservedAt?.toISOString() ?? null,
        locationCode: row.locationCode,
        languageCode: row.languageCode,
        device: row.device,
    };
}
