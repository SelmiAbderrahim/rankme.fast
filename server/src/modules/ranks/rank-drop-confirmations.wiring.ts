/** Production adapter for the confirmed rank-drop state machine. */
import type { Logger } from 'pino';
import type { Db } from '../../db/client.js';
import type { RankProvider } from '../../shared/providers/index.js';
import { confirmRankDrop, type AlertEffects, type ConfirmationCandidate, type ConfirmRankDropResult, } from './rank-drop-confirmations.service.js';
export interface RankDropConfirmationHandlerDeps {
    db: Db;
    provider: RankProvider;
    effects: AlertEffects;
    logger: Logger;
    now?: () => Date;
}
export type RankDropConfirmationHandler = (candidate: ConfirmationCandidate) => Promise<ConfirmRankDropResult>;
/**
 * Build the live processor hook. Database/programming failures propagate to
 * the processor's isolated hook boundary and therefore fail closed without a
 * notification.
 */
export function createRankDropConfirmationHandler(deps: RankDropConfirmationHandlerDeps): RankDropConfirmationHandler {
    return (candidate) => confirmRankDrop(candidate, {
        db: deps.db,
        provider: deps.provider,
        effects: deps.effects,
        logger: deps.logger,
        ...(deps.now ? { now: deps.now } : {}),
    });
}
