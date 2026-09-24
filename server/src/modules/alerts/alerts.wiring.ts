/**
 * Production wiring for the alert dispatch pipeline (community-requests spec
 * 06). Kept out of `worker.ts` so the composition root stays a thin, untested
 * seam while every collaborator it injects lives in a tested module.
 */
import type { Logger } from 'pino';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { teamMembers } from '../../db/schema/index.js';
import { DEFAULT_LOCALE } from '../../shared/i18n/index.js';
import { deliverAlertEmail, getEmailSenderIdentity, isAlertEmailEligible, isEmailTransportConfigured, } from '../communication/index.js';
import { findUserById } from '../users/index.js';
import type { AlertRecipient, DispatchAlertDeps } from './alert-dispatch.service.js';
import { canTeamUserAccessSite } from '../../shared/team-site-access/repository.js';
/**
 * Resolve a recipient from the Mongo user mirror. A missing user is reported as
 * `removed` so the delivery settles `suppressed_membership_removed` rather than
 * failing and burning retries on a person who no longer exists.
 */
export async function resolveAlertRecipient(input: {
    db: Db;
    accountId: string;
    userId: string;
    siteId?: string;
}): Promise<AlertRecipient | null> {
    const user = await findUserById(input.userId);
    if (!user)
        return null;
    const owner = input.userId === input.accountId;
    const activeMember = owner
        ? true
        : input.siteId
            ? await canTeamUserAccessSite(input.db, {
                teamId: input.accountId,
                userId: input.userId,
                siteId: input.siteId,
            })
            : (await input.db
                .select({ id: teamMembers.id })
                .from(teamMembers)
                .where(and(eq(teamMembers.teamId, input.accountId), eq(teamMembers.userId, input.userId), isNotNull(teamMembers.acceptedAt), isNull(teamMembers.revokedAt)))
                .limit(1)).length === 1;
    return {
        email: user.email,
        locale: user.language ?? DEFAULT_LOCALE,
        membership: activeMember ? 'active' : 'removed',
    };
}
export function createAlertDispatchDeps(input: {
    db: Db;
    logger: Logger;
}): DispatchAlertDeps {
    return {
        db: input.db,
        logger: input.logger,
        transportAvailable: isEmailTransportConfigured,
        senderIdentity: getEmailSenderIdentity,
        isEmailEligible: isAlertEmailEligible,
        resolveRecipient: (recipient) => resolveAlertRecipient({ ...recipient, db: input.db }),
        sendEmail: (message) => deliverAlertEmail({
            email: message.to,
            userId: message.userId,
            idempotencyKey: message.idempotencyKey,
            expectedSenderIdentity: message.expectedSenderIdentity,
            eligibilityFrozen: message.eligibilityFrozen,
            subject: message.subject,
            text: message.text,
            locale: message.locale,
            html: message.html,
        }),
    };
}
