import type { Job } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from '../../db/client.js';
import { scheduledReportDeliveries, scheduledReports, teamMembers, type ScheduledReportRow, } from '../../db/schema/index.js';
import { clientReportJobSchema, parseConsumedPayload, } from '../../shared/queue/index.js';
import { translate, type SupportedLocale } from '../../shared/i18n/index.js';
import { canTeamUserAccessSite } from '../../shared/team-site-access/repository.js';
import { renderAuditReportPdf } from '../audits/index.js';
import { deliverClientReportEmail, prepareClientReportEmail, type ClientReportEmailRecipient, type FrozenClientReportEmailPayload, } from '../communication/index.js';
import { User } from '../users/users.model.js';
import { composeClientReport } from './report-composer.service.js';
import { nextClientReportRunAt } from './scheduler.js';
import { claimClientReportRunDeliveries, clientReportDeliveryIdempotencyKey, freezeClientReportRun, loadClientReportRun, parseFrozenClientReportPayload, purgeClientReportRunIfTerminal, settleClientReportDelivery, type ClientReportDeliveryClaim, } from './delivery-outbox.service.js';
export interface ClientReportProcessorDeps {
    db: Db;
    logger?: Logger;
    now?: () => Date;
    deliver?: typeof deliverClientReportEmail;
    freezeRun?: typeof freezeClientReportRun;
}
export interface ClientReportProcessorOutcome {
    scheduleId: string;
    attempted: number;
    sent: number;
    failed: number;
    suppressed: number;
    skipped: boolean;
}
export class ClientReportDeliveryIncompleteError extends Error {
    constructor(public readonly outcome: ClientReportProcessorOutcome) {
        super(`client report delivery incomplete: ${outcome.failed} recipient(s) failed`);
        this.name = 'ClientReportDeliveryIncompleteError';
    }
}
export function clientReportRunKey(scheduleId: string, scheduledFor: Date): string {
    const minute = scheduledFor.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    return `${scheduleId}-${minute}`;
}
export { clientReportDeliveryIdempotencyKey } from './delivery-outbox.service.js';
async function resolveRecipient(db: Db, accountId: string, siteId: string, email: string, idempotencyKey: string): Promise<ClientReportEmailRecipient> {
    const user = await User.findOne({ email }).select('_id').lean();
    if (!user)
        return { email, membership: 'external', idempotencyKey };
    const userId = user._id.toString();
    if (userId === accountId) {
        return { email, userId, membership: 'active', idempotencyKey };
    }
    const membership = await db.query.teamMembers.findFirst({
        where: and(eq(teamMembers.teamId, accountId), eq(teamMembers.email, email)),
    });
    if (!membership)
        return { email, membership: 'external', idempotencyKey };
    if (membership.revokedAt !== null || membership.acceptedAt === null) {
        return { email, userId, membership: 'removed', idempotencyKey };
    }
    if (!(await canTeamUserAccessSite(db, { teamId: accountId, userId, siteId }))) {
        return { email, userId, membership: 'removed', idempotencyKey };
    }
    return { email, userId, membership: 'active', idempotencyKey };
}
async function recordCompositionFailures(db: Db, input: {
    schedule: ScheduledReportRow;
    runKey: string;
    recipients: string[];
    now: Date;
}): Promise<void> {
    if (input.recipients.length === 0)
        return;
    await db.insert(scheduledReportDeliveries).values(input.recipients.map((recipient) => ({
        scheduleId: input.schedule.id,
        accountId: input.schedule.accountId,
        siteId: input.schedule.siteId,
        runKey: input.runKey,
        recipient,
        status: 'failed' as const,
        attempt: 0,
        claimToken: null,
        requestFingerprint: null,
        firstAttemptAt: null,
        suppressionReason: null,
        errorCode: 'composition_failed' as const,
        providerMessageId: null,
        snapshotDate: null,
        createdAt: input.now,
        updatedAt: input.now,
        finishedAt: input.now,
    }))).onConflictDoNothing({
        target: [
            scheduledReportDeliveries.scheduleId,
            scheduledReportDeliveries.runKey,
            scheduledReportDeliveries.recipient,
        ],
    });
}
function resolveDeliveryTransport(override: ClientReportProcessorDeps['deliver']): typeof deliverClientReportEmail {
    return override ?? deliverClientReportEmail;
}
async function settleClaims(deps: ClientReportProcessorDeps, input: {
    schedule: ScheduledReportRow;
    runKey: string;
    payload: FrozenClientReportEmailPayload;
    claims: ClientReportDeliveryClaim[];
    suppressed: number;
    now: Date;
}): Promise<ClientReportProcessorOutcome> {
    if (input.claims.length === 0) {
        await purgeClientReportRunIfTerminal(deps.db, input.schedule.id, input.runKey);
        return {
            scheduleId: input.schedule.id,
            attempted: input.suppressed,
            sent: 0,
            failed: 0,
            suppressed: input.suppressed,
            skipped: input.suppressed === 0,
        };
    }
    const recipients = input.claims.map((claim) => ({
        email: claim.recipient,
        idempotencyKey: clientReportDeliveryIdempotencyKey(claim.scheduleId, claim.runKey, claim.recipient),
    }));
    // A thrown transport override intentionally leaves every claim pending. The
    // stale-lease reconciler then replays the exact frozen payload and keys.
    const outcomes = await resolveDeliveryTransport(deps.deliver)({
        recipients,
        payload: input.payload,
    });
    const byRecipient = new Map(outcomes.map((outcome) => [outcome.email, outcome]));
    let sent = 0;
    let failed = 0;
    for (const claim of input.claims) {
        const outcome = byRecipient.get(claim.recipient);
        const persisted = await settleClientReportDelivery(deps.db, claim, outcome
            ? {
                status: outcome.status === 'sent' ? 'sent' : 'failed',
                errorCode: outcome.status === 'sent'
                    ? null
                    : outcome.errorCode ?? 'provider_outcome_unknown',
                providerMessageId: outcome.providerMessageId,
            }
            : {
                status: 'failed',
                // The fan-out crossed a provider boundary but returned no result
                // for this recipient; acceptance is unknowable, not a known throw.
                errorCode: 'provider_outcome_unknown',
                providerMessageId: null,
            }, input.now);
        if (!persisted)
            continue;
        if (persisted.status === 'sent')
            sent += 1;
        else
            failed += 1;
    }
    await purgeClientReportRunIfTerminal(deps.db, input.schedule.id, input.runKey);
    const result: ClientReportProcessorOutcome = {
        scheduleId: input.schedule.id,
        attempted: input.claims.length + input.suppressed,
        sent,
        failed,
        suppressed: input.suppressed,
        skipped: false,
    };
    // Any isolated failed leg must make BullMQ retry; the previous all-failed
    // check silently stranded partial failures after a successful sibling.
    if (failed > 0)
        throw new ClientReportDeliveryIncompleteError(result);
    return result;
}
async function settleWinningClientReportRun(deps: ClientReportProcessorDeps, schedule: ScheduledReportRow, runKey: string, now: Date): Promise<ClientReportProcessorOutcome> {
    const winningRun = await loadClientReportRun(deps.db, schedule.id, runKey);
    if (!winningRun)
        throw new Error('client report outbox winner disappeared');
    const winningPayload = parseFrozenClientReportPayload(winningRun.payload);
    const claims = await claimClientReportRunDeliveries(deps.db, {
        scheduleId: schedule.id,
        runKey,
        payload: winningPayload,
        now,
    });
    return settleClaims(deps, {
        schedule,
        runKey,
        payload: winningPayload,
        claims,
        suppressed: 0,
        now,
    });
}
export const clientReportProcessorTestables = {
    recordCompositionFailures,
    resolveDeliveryTransport,
    resolveRecipient,
    settleWinningClientReportRun,
};
export async function processClientReportJob(job: Job, deps: ClientReportProcessorDeps): Promise<ClientReportProcessorOutcome> {
    const payload = parseConsumedPayload(clientReportJobSchema, job.data);
    const now = (deps.now ?? (() => new Date()))();
    const schedule = await deps.db.query.scheduledReports.findFirst({
        where: eq(scheduledReports.id, payload.scheduleId),
    });
    if (!schedule) {
        return {
            scheduleId: payload.scheduleId,
            attempted: 0,
            sent: 0,
            failed: 0,
            suppressed: 0,
            skipped: true,
        };
    }
    const scheduledFor = payload.runKey === 'template'
        ? new Date(job.timestamp)
        : new Date(payload.scheduledFor);
    const runKey = payload.runKey === 'template'
        ? clientReportRunKey(schedule.id, scheduledFor)
        : payload.runKey;
    const existingRun = await loadClientReportRun(deps.db, schedule.id, runKey);
    if (existingRun) {
        const frozen = parseFrozenClientReportPayload(existingRun.payload);
        const claims = await claimClientReportRunDeliveries(deps.db, {
            scheduleId: schedule.id,
            runKey,
            payload: frozen,
            now,
        });
        return settleClaims(deps, {
            schedule,
            runKey,
            payload: frozen,
            claims,
            suppressed: 0,
            now,
        });
    }
    if (!schedule.enabled) {
        return {
            scheduleId: schedule.id,
            attempted: 0,
            sent: 0,
            failed: 0,
            suppressed: 0,
            skipped: true,
        };
    }
    const terminal = await deps.db
        .select({ recipient: scheduledReportDeliveries.recipient })
        .from(scheduledReportDeliveries)
        .where(and(eq(scheduledReportDeliveries.scheduleId, schedule.id), eq(scheduledReportDeliveries.runKey, runKey), inArray(scheduledReportDeliveries.status, ['sent', 'suppressed'])));
    const settled = new Set(terminal.map((row) => row.recipient));
    const pendingRecipients = schedule.recipients.filter((email) => !settled.has(email));
    if (pendingRecipients.length === 0) {
        return {
            scheduleId: schedule.id,
            attempted: 0,
            sent: 0,
            failed: 0,
            suppressed: 0,
            skipped: true,
        };
    }
    let deliveryBoundaryCrossed = false;
    try {
        const snapshot = await composeClientReport({
            accountId: schedule.accountId,
            siteId: schedule.siteId,
            locale: schedule.locale as SupportedLocale,
            sections: schedule.sections,
        }, deps.db);
        const companyName = snapshot.branding.companyName.trim() ||
            translate(snapshot.locale, 'report.pdf.neutralBrand');
        const pdfBytes = await renderAuditReportPdf({
            report: snapshot.sections.audit?.report ?? null,
            branding: { companyName, accentColor: snapshot.branding.accentColor },
            locale: snapshot.locale,
            generatedAt: new Date(snapshot.generatedAt),
            siteDomain: snapshot.siteDomain,
            logoPngBytes: snapshot.branding.logoPngBase64
                ? Buffer.from(snapshot.branding.logoPngBase64, 'base64')
                : null,
            auditSnapshotDate: snapshot.sections.audit?.snapshotDate ?? null,
            rankSummary: snapshot.sections.ranks,
            gscSummary: snapshot.sections.gsc,
        });
        const recipients = await Promise.all(pendingRecipients.map((email) => resolveRecipient(deps.db, schedule.accountId, schedule.siteId, email, clientReportDeliveryIdempotencyKey(schedule.id, runKey, email))));
        const prepared = await prepareClientReportEmail({
            recipients,
            siteLabel: snapshot.siteLabel,
            snapshotDate: snapshot.generatedAt,
            pdfBytes,
            locale: snapshot.locale,
            ...(deps.deliver ? { transportAvailable: () => true } : {}),
        });
        const frozen = await (deps.freezeRun ?? freezeClientReportRun)(deps.db, {
            schedule: { ...schedule, recipients: pendingRecipients },
            runKey,
            scheduledFor,
            snapshotDate: new Date(snapshot.generatedAt),
            prepared,
            now,
        });
        deliveryBoundaryCrossed = true;
        if (frozen.created) {
            await deps.db.update(scheduledReports).set({
                lastRunAt: scheduledFor,
                nextRunAt: nextClientReportRunAt(schedule, scheduledFor),
                updatedAt: now,
            }).where(eq(scheduledReports.id, schedule.id));
            return await settleClaims(deps, {
                schedule,
                runKey,
                payload: prepared.payload,
                claims: frozen.claims,
                suppressed: prepared.suppressed.length,
                now,
            });
        }
        return await settleWinningClientReportRun(deps, schedule, runKey, now);
    }
    catch (error) {
        // A durable outbox means preparation completed; never overwrite its
        // claims when a transport/process error escapes after that boundary.
        if (deliveryBoundaryCrossed)
            throw error;
        await recordCompositionFailures(deps.db, {
            schedule,
            runKey,
            recipients: pendingRecipients,
            now,
        });
        deps.logger?.error({
            scheduleId: schedule.id,
            runKey,
            errorClass: error instanceof Error ? error.name : 'unknown',
        }, 'client-report composition failed');
        throw error;
    }
}
export function createClientReportProcessor(deps: ClientReportProcessorDeps) {
    return async (job: Job): Promise<ClientReportProcessorOutcome> => processClientReportJob(job, deps);
}
