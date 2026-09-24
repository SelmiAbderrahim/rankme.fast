/**
 * Dispatch — fan a confirmed transition out to every configured channel.
 *
 * Guarantees:
 *   • TERMINAL-LEG IDEMPOTENCY per (rule, transition, channel, recipient).
 *     Sent/suppressed legs never re-send; a later BullMQ attempt atomically
 *     reclaims only that same row after `failed` or a crash-stranded `pending`
 *     claim. Email retries share one provider key; generic webhooks share one
 *     receiver-visible delivery id.
 *   • PER-LEG ISOLATION. Each channel/recipient runs in its own try/catch and
 *     writes its own terminal row; a Slack 500 never blocks the email.
 *   • BOUNDED RETRIES. Attempt `ALERT_MAX_ATTEMPTS` writes the terminal
 *     `suppressed`/`retries_exhausted` row and lets the job throw into the
 *     shipped dead-letter queue. There is no infinite redelivery.
 *   • EVIDENCE-ONLY CONTENT. Every rendered body reads from the frozen,
 *     re-parsed observation pair. Nothing else — no vendor rows, no prose.
 */
import { createHmac, randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import { ALERT_MAX_ATTEMPTS, ALERT_REQUEST_PAYLOAD_MAX_BYTES, type AlertChannel, type AlertDeliveryRow, type AlertDeliveryErrorCode, type AlertRuleRow, type AlertSuppressionReason, type NewAlertDeliveryRow, type StoredAlertRequest, } from '../../db/schema/index.js';
import { translate, type SupportedLocale } from '../../shared/i18n/index.js';
import { resolveRecipientLocale, } from '../communication/index.js';
import { renderEmailTemplate } from '../../shared/utils/email-template.js';
import { fetchPublicUrlSafe, UnsafeUrlError, type FetchPublicUrlSafeOptions, } from '../../shared/security/url-safety.js';
import { bindDeliveryRequestFingerprint, claimFrozenAlertDeliveries, findRule, freezeAlertDeliveryPlan, listTransitionDeliveries, settleDelivery, } from './alerts.repo.js';
import { openAlertSecret, sealAlertSecret, signAlertPayload, } from './alerts.secrets.js';
import { ALERT_EMAIL_REQUEST_VERSION, ALERT_SLACK_REQUEST_VERSION, ALERT_WEBHOOK_REQUEST_VERSION, alertEvidenceSchema, alertRequestSchema, ALERT_DELIVERY_DEADLINE_MS, ALERT_DELIVERY_MAX_RESPONSE_BYTES, ALERT_PAYLOAD_VERSION, type AlertEvidence, type AlertRequest, } from './alerts.schema.js';
export interface AlertRecipient {
    email: string;
    locale: string;
    membership: 'active' | 'removed';
}
export interface AlertEmailMessage {
    to: string;
    userId: string;
    /** Stable provider retry boundary; opaque and free of recipient data. */
    idempotencyKey: string;
    expectedSenderIdentity: string | null;
    eligibilityFrozen: true;
    subject: string;
    text: string;
    /** Absent only for a proven legacy payload whose original bytes had no HTML. */
    html?: string;
    locale: SupportedLocale;
}
export interface AlertEmailSendResult {
    delivered: boolean;
    providerMessageId?: string | null;
    outcomeUnknown?: boolean;
    reason?: 'opted-out' | 'transport-failure';
}
export interface DispatchAlertDeps {
    db: Db;
    /** Deterministic seam for durable outbox race tests. */
    repository?: AlertDispatchRepository;
    /** Injected mailer — the concrete wiring is `deliverAlertEmail`. */
    sendEmail: (message: AlertEmailMessage) => Promise<AlertEmailSendResult>;
    transportAvailable: () => boolean;
    resolveRecipient: (input: {
        accountId: string;
        userId: string;
        siteId?: string;
    }) => Promise<AlertRecipient | null>;
    /** Preference is read once before the request fingerprint is bound. */
    isEmailEligible?: (userId: string) => Promise<boolean>;
    /** Exact configured From identity used by the provider adapter. */
    senderIdentity?: () => string | null;
    /** Test seam for the SSRF authority (DNS resolver / transport / clock). */
    urlSafety?: FetchPublicUrlSafeOptions;
    logger?: Logger;
    now?: () => Date;
}
export interface AlertDispatchRepository {
    bindDeliveryRequestFingerprint: typeof bindDeliveryRequestFingerprint;
    claimFrozenAlertDeliveries: typeof claimFrozenAlertDeliveries;
    findRule: typeof findRule;
    freezeAlertDeliveryPlan: typeof freezeAlertDeliveryPlan;
    listTransitionDeliveries: typeof listTransitionDeliveries;
    settleDelivery: typeof settleDelivery;
}
export const defaultAlertDispatchRepository: AlertDispatchRepository = {
    bindDeliveryRequestFingerprint,
    claimFrozenAlertDeliveries,
    findRule,
    freezeAlertDeliveryPlan,
    listTransitionDeliveries,
    settleDelivery,
};
/** Resend retains idempotency keys for 24 hours; keep one hour for skew. */
export const ALERT_IDEMPOTENCY_RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
/** Longer than the live email adapter's 15-second and webhook 5-second limits. */
export const ALERT_DELIVERY_CLAIM_LEASE_MS = 30000;
export const ALERT_DELIVERY_RECONCILE_LIMIT = 200;
export interface DispatchAlertInput {
    accountId: string;
    ruleId: string;
    transitionId: string;
    evidence: unknown;
    /** 1-based; BullMQ's `attemptsMade + 1`. */
    attempt: number;
}
export interface DispatchAlertOutcome {
    sent: number;
    failed: number;
    /** Failed legs that reached the retry ceiling and were terminally suppressed. */
    exhausted: number;
    suppressed: number;
    skipped: number;
    /** True when the caller must throw so BullMQ retries or dead-letters. */
    shouldThrow: boolean;
}
/** Deterministic, evidence-derived. Never a clock or a counter. */
export function alertIdempotencyKey(input: {
    ruleId: string;
    transitionId: string;
    channel: AlertChannel;
    recipientRef?: string | null;
}): string {
    return `alert:${input.ruleId}:${input.transitionId}:${input.channel}:${input.recipientRef ?? '-'}`;
}
/** Opaque HMAC of every field that affects the exact Resend request. */
export function alertEmailRequestFingerprint(input: {
    senderIdentity: string | null;
    to: string;
    idempotencyKey: string;
    subject: string;
    text: string;
    html?: string;
    locale: SupportedLocale;
}): string {
    const html = input.html ?? renderEmailTemplate({
        subject: input.subject,
        text: input.text,
        locale: input.locale,
    });
    const exactRequest = JSON.stringify({
        ...(input.html === undefined ? {} : { locale: input.locale }),
        from: input.senderIdentity,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html,
        idempotencyKey: input.idempotencyKey,
    });
    const digest = createHmac('sha256', env.MASTER_ENCRYPTION_KEY)
        .update(exactRequest)
        .digest('hex');
    return `request-hmac-v1:${digest}`;
}
function hmacExactAlertRequest(value: unknown): string {
    const digest = createHmac('sha256', env.MASTER_ENCRYPTION_KEY)
        .update(JSON.stringify(value))
        .digest('hex');
    return `request-hmac-v1:${digest}`;
}
function parseAlertRequest(value: unknown): AlertRequest {
    const request = alertRequestSchema.parse(value);
    if (Buffer.byteLength(JSON.stringify(request), 'utf8') > ALERT_REQUEST_PAYLOAD_MAX_BYTES) {
        throw new Error('alert request payload exceeds the durable outbox ceiling');
    }
    return request;
}
export const alertDispatchTestables = { parseAlertRequest };
/** HMAC the exact outbound request while keeping destinations/body out of logs. */
export function alertRequestFingerprint(input: {
    ruleId: string;
    deliveryId: string;
    channel: AlertChannel;
    request: AlertRequest;
}): string {
    if (input.channel === 'email' && input.request.version === ALERT_EMAIL_REQUEST_VERSION) {
        return alertEmailRequestFingerprint({
            senderIdentity: input.request.senderIdentity,
            to: input.request.to,
            idempotencyKey: `alert/${input.deliveryId}`,
            subject: input.request.subject,
            text: input.request.text,
            html: input.request.html,
            locale: input.request.locale,
        });
    }
    if (input.channel === 'slack' && input.request.version === ALERT_SLACK_REQUEST_VERSION) {
        const url = openAlertSecret(input.request.encryptedUrl, input.ruleId, 'slack_webhook');
        return hmacExactAlertRequest({
            ...(input.request.locale === undefined ? {} : { locale: input.request.locale }),
            method: 'POST',
            url,
            headers: { 'content-type': 'application/json' },
            body: input.request.body,
        });
    }
    if (input.channel === 'webhook' && input.request.version === ALERT_WEBHOOK_REQUEST_VERSION) {
        const url = openAlertSecret(input.request.encryptedUrl, input.ruleId, 'webhook_url');
        return hmacExactAlertRequest({
            method: 'POST',
            url,
            headers: {
                'content-type': 'application/json',
                'x-rankmefast-signature': input.request.signature,
                'x-rankmefast-delivery': input.deliveryId,
            },
            body: input.request.rawBody,
        });
    }
    throw new Error('alert request channel does not match its frozen payload');
}
// ---------------------------------------------------------------------------
// Rendering — evidence in, bounded localized text out
// ---------------------------------------------------------------------------
function positionLabel(locale: string, position: number | null): string {
    return position === null ? translate(locale, 'email.alert.notRanked') : String(position);
}
function dateLabel(iso: string): string {
    // Date only: the alert is about a day-over-day observation pair, and a full
    // timestamp would imply a precision the stored snapshot does not carry.
    return iso.slice(0, 10);
}
function domainList(locale: string, evidence: Extract<AlertEvidence, {
    kind: 'new_backlink' | 'lost_backlink';
}>): string {
    const shown = evidence.changedDomains.join(', ');
    const hidden = evidence.changedTotal - evidence.changedDomains.length;
    if (hidden <= 0)
        return shown;
    return `${shown} (${translate(locale, 'email.alert.andMore', { count: hidden })})`;
}
export function renderAlertEmail(locale: string, evidence: AlertEvidence): {
    subject: string;
    text: string;
} {
    if (evidence.kind === 'rank_drop') {
        return {
            subject: translate(locale, 'email.alert.rankDrop.subject', {
                keyword: evidence.keyword,
            }),
            text: translate(locale, 'email.alert.rankDrop.body', {
                threshold: evidence.threshold,
                before: positionLabel(locale, evidence.before.position),
                beforeAt: dateLabel(evidence.before.at),
                after: positionLabel(locale, evidence.after.position),
                afterAt: dateLabel(evidence.after.at),
            }),
        };
    }
    const key = evidence.kind === 'new_backlink' ? 'newBacklink' : 'lostBacklink';
    return {
        subject: translate(locale, `email.alert.${key}.subject`, {
            count: evidence.changedTotal,
        }),
        text: translate(locale, `email.alert.${key}.body`, {
            beforeCount: evidence.before.rowCount,
            beforeAt: dateLabel(evidence.before.at),
            afterCount: evidence.after.rowCount,
            afterAt: dateLabel(evidence.after.at),
            domains: domainList(locale, evidence),
        }),
    };
}
export function renderSlackText(locale: string, evidence: AlertEvidence): string {
    if (evidence.kind === 'rank_drop') {
        return translate(locale, 'alerts.slack.rankDrop', {
            keyword: evidence.keyword,
            before: positionLabel(locale, evidence.before.position),
            beforeAt: dateLabel(evidence.before.at),
            after: positionLabel(locale, evidence.after.position),
            afterAt: dateLabel(evidence.after.at),
        });
    }
    const key = evidence.kind === 'new_backlink' ? 'newBacklink' : 'lostBacklink';
    return translate(locale, `alerts.slack.${key}`, {
        count: evidence.changedTotal,
        beforeAt: dateLabel(evidence.before.at),
        afterAt: dateLabel(evidence.after.at),
    });
}
/** Secret-free, schema-versioned envelope. */
export function buildWebhookPayload(input: {
    deliveryId: string;
    ruleId: string;
    siteId: string;
    occurredAt: string;
    evidence: AlertEvidence;
}): Record<string, unknown> {
    return {
        version: ALERT_PAYLOAD_VERSION,
        id: input.deliveryId,
        type: input.evidence.kind,
        ruleId: input.ruleId,
        siteId: input.siteId,
        occurredAt: input.occurredAt,
        evidence: input.evidence,
    };
}
// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
interface LegPlan {
    channel: AlertChannel;
    recipientRef: string | null;
}
function planLegs(rule: AlertRuleRow): LegPlan[] {
    const legs: LegPlan[] = rule.emailRecipientIds.map((userId) => ({
        channel: 'email' as const,
        recipientRef: userId,
    }));
    if (rule.slackWebhook !== null)
        legs.push({ channel: 'slack', recipientRef: null });
    if (rule.webhookUrl !== null)
        legs.push({ channel: 'webhook', recipientRef: null });
    return legs;
}
function frozenPlanRow(input: {
    id: string;
    rule: AlertRuleRow;
    transitionId: string;
    evidence: AlertEvidence;
    leg: LegPlan;
    request: StoredAlertRequest | null;
    suppressedReason: AlertSuppressionReason | null;
    now: Date;
}): NewAlertDeliveryRow {
    const pending = input.request !== null;
    return {
        id: input.id,
        accountId: input.rule.accountId,
        siteId: input.rule.siteId,
        ruleId: input.rule.id,
        channel: input.leg.channel,
        recipientRef: input.leg.recipientRef,
        idempotencyKey: alertIdempotencyKey({
            ruleId: input.rule.id,
            transitionId: input.transitionId,
            channel: input.leg.channel,
            recipientRef: input.leg.recipientRef,
        }),
        transitionId: input.transitionId,
        transitionKind: input.rule.type,
        status: pending ? 'pending' : 'suppressed',
        attempt: pending ? 1 : 0,
        claimToken: pending ? randomUUID() : null,
        requestFingerprint: null,
        firstAttemptAt: null,
        requestPayload: input.request,
        errorCode: null,
        providerMessageId: null,
        suppressedReason: input.suppressedReason,
        evidence: input.evidence as unknown as Record<string, unknown>,
        createdAt: input.now,
        updatedAt: input.now,
        reconciledAt: null,
    };
}
/** Freeze the complete channel plan and every mutable eligibility decision. */
async function prepareFrozenDeliveryPlan(input: {
    rule: AlertRuleRow;
    transitionId: string;
    evidence: AlertEvidence;
    now: Date;
}, deps: DispatchAlertDeps): Promise<NewAlertDeliveryRow[]> {
    const rows: NewAlertDeliveryRow[] = [];
    const transportUp = input.rule.enabled ? deps.transportAvailable() : false;
    const senderIdentity = input.rule.enabled ? (deps.senderIdentity?.() ?? null) : null;
    const owner = !input.rule.enabled || input.rule.slackWebhook === null
        ? null
        : await deps.resolveRecipient({
            accountId: input.rule.accountId,
            userId: input.rule.accountId,
        });
    for (const leg of planLegs(input.rule)) {
        const id = randomUUID();
        if (!input.rule.enabled) {
            rows.push(frozenPlanRow({
                id,
                ...input,
                leg,
                request: null,
                suppressedReason: 'rule_disabled',
            }));
            continue;
        }
        if (leg.channel === 'email') {
            const recipient = await deps.resolveRecipient({
                accountId: input.rule.accountId,
                userId: leg.recipientRef as string,
                siteId: input.rule.siteId,
            });
            let suppressedReason: AlertSuppressionReason | null = null;
            if (recipient === null || recipient.membership === 'removed') {
                suppressedReason = 'membership_removed';
            }
            else if (!transportUp) {
                suppressedReason = 'no_transport';
            }
            else if (!(await (deps.isEmailEligible?.(leg.recipientRef as string) ?? true))) {
                suppressedReason = 'opted_out';
            }
            if (recipient === null || suppressedReason !== null) {
                rows.push(frozenPlanRow({
                    id,
                    ...input,
                    leg,
                    request: null,
                    suppressedReason,
                }));
                continue;
            }
            const locale = resolveRecipientLocale({ recipientLocale: recipient.locale });
            const rendered = renderAlertEmail(locale, input.evidence);
            const html = renderEmailTemplate({
                subject: rendered.subject,
                text: rendered.text,
                locale,
            });
            const request = parseAlertRequest({
                version: ALERT_EMAIL_REQUEST_VERSION,
                senderIdentity,
                to: recipient.email,
                subject: rendered.subject,
                text: rendered.text,
                html,
                locale,
            });
            rows.push(frozenPlanRow({
                id,
                ...input,
                leg,
                request,
                suppressedReason: null,
            }));
            continue;
        }
        if (leg.channel === 'slack') {
            const locale = resolveRecipientLocale({
                recipientLocale: owner !== null && owner.membership === 'active' ? owner.locale : undefined,
            });
            const request = parseAlertRequest({
                version: ALERT_SLACK_REQUEST_VERSION,
                encryptedUrl: input.rule.slackWebhook,
                body: JSON.stringify({ text: renderSlackText(locale, input.evidence) }),
                locale,
            });
            rows.push(frozenPlanRow({
                id,
                ...input,
                leg,
                request,
                suppressedReason: null,
            }));
            continue;
        }
        const rawBody = JSON.stringify(buildWebhookPayload({
            deliveryId: id,
            ruleId: input.rule.id,
            siteId: input.rule.siteId,
            occurredAt: input.evidence.after.at,
            evidence: input.evidence,
        }));
        const timestampSeconds = Math.floor(input.now.getTime() / 1000);
        const secret = openAlertSecret(input.rule.webhookSecret!, input.rule.id, 'webhook_secret');
        const request = parseAlertRequest({
            version: ALERT_WEBHOOK_REQUEST_VERSION,
            encryptedUrl: sealAlertSecret(input.rule.webhookUrl!, input.rule.id, 'webhook_url'),
            rawBody,
            timestampSeconds,
            signature: signAlertPayload(secret, rawBody, timestampSeconds),
        });
        rows.push(frozenPlanRow({
            id,
            ...input,
            leg,
            request,
            suppressedReason: null,
        }));
    }
    return rows;
}
export async function dispatchAlert(input: DispatchAlertInput, deps: DispatchAlertDeps): Promise<DispatchAlertOutcome> {
    const repository = deps.repository ?? defaultAlertDispatchRepository;
    const now = (deps.now ?? (() => new Date()))();
    const outcome: DispatchAlertOutcome = {
        sent: 0,
        failed: 0,
        exhausted: 0,
        suppressed: 0,
        skipped: 0,
        shouldThrow: false,
    };
    let plan = await repository.listTransitionDeliveries(deps.db, {
        accountId: input.accountId,
        ruleId: input.ruleId,
        transitionId: input.transitionId,
    });
    let claims: AlertDeliveryRow[] = [];
    let planCreated = false;
    if (plan.length === 0) {
        const rule = await repository.findRule(deps.db, input.accountId, input.ruleId);
        // A physically deleted rule with no accepted outbox has nothing to do.
        if (rule === null)
            return outcome;
        const evidence = alertEvidenceSchema.parse(input.evidence);
        const prepared = await prepareFrozenDeliveryPlan({
            rule,
            transitionId: input.transitionId,
            evidence,
            now,
        }, deps);
        const frozen = await repository.freezeAlertDeliveryPlan(deps.db, {
            accountId: input.accountId,
            ruleId: input.ruleId,
            transitionId: input.transitionId,
            expectedRuleUpdatedAt: rule.updatedAt,
            rows: prepared,
        });
        if (frozen.state === 'stale_rule') {
            // No provider boundary was crossed and no delivery attempt was burned.
            // Let BullMQ reload the new rule version (or observe its deletion).
            outcome.shouldThrow = true;
            return outcome;
        }
        plan = frozen.rows;
        planCreated = frozen.state === 'created';
        claims = planCreated
            ? plan.filter((row) => row.status === 'pending')
            : await repository.claimFrozenAlertDeliveries(deps.db, {
                rows: plan,
                now,
                staleBefore: new Date(now.getTime() - ALERT_DELIVERY_CLAIM_LEASE_MS),
                retryAfter: new Date(now.getTime() - ALERT_IDEMPOTENCY_RETRY_WINDOW_MS),
            });
    }
    else {
        // Durable rows, not mutable rule recipients/enabled/config, are the sole
        // retry plan. This also works after an explicit physical rule deletion.
        claims = await repository.claimFrozenAlertDeliveries(deps.db, {
            rows: plan,
            now,
            staleBefore: new Date(now.getTime() - ALERT_DELIVERY_CLAIM_LEASE_MS),
            retryAfter: new Date(now.getTime() - ALERT_IDEMPOTENCY_RETRY_WINDOW_MS),
        });
    }
    const claimedIds = new Set(claims.map((row) => row.id));
    for (const row of plan) {
        if (claimedIds.has(row.id))
            continue;
        if (planCreated && row.status === 'suppressed') {
            outcome.suppressed += 1;
        }
        else if (row.status === 'failed' && row.attempt >= ALERT_MAX_ATTEMPTS) {
            outcome.exhausted += 1;
            outcome.shouldThrow = true;
        }
        else {
            outcome.skipped += 1;
        }
    }
    for (const claimed of claims) {
        const claimToken = claimed.claimToken;
        if (!claimToken) {
            outcome.skipped += 1;
            continue;
        }
        const settled = await deliverLeg({ delivery: claimed, claimToken, now }, deps, repository);
        if (settled === null) {
            outcome.skipped += 1;
            continue;
        }
        const persisted = await repository.settleDelivery(deps.db, {
            id: claimed.id,
            status: settled.status,
            attempt: claimed.attempt,
            claimToken,
            errorCode: settled.errorCode ?? null,
            suppressedReason: settled.suppressedReason ?? null,
            providerMessageId: settled.providerMessageId ?? null,
            now,
        });
        if (!persisted) {
            outcome.skipped += 1;
            continue;
        }
        if (settled.status === 'sent')
            outcome.sent += 1;
        else if (settled.status === 'suppressed') {
            outcome.suppressed += 1;
            outcome.exhausted += 1;
            // `deliverLeg` emits `suppressed` only for a retry-ceiling outcome. The
            // row is terminal, but the final BullMQ attempt must still fail so the
            // worker's shipped dead-letter listener receives the job.
            outcome.shouldThrow = true;
        }
        else {
            outcome.failed += 1;
            if (claimed.attempt >= ALERT_MAX_ATTEMPTS)
                outcome.exhausted += 1;
            outcome.shouldThrow = true;
        }
    }
    return outcome;
}
interface LegResult {
    status: 'sent' | 'failed' | 'suppressed';
    errorCode?: AlertDeliveryErrorCode;
    suppressedReason?: AlertSuppressionReason;
    providerMessageId?: string | null;
}
interface LegContext {
    delivery: AlertDeliveryRow;
    claimToken: string;
    now: Date;
}
/** Terminal-on-last-attempt: a failure at the ceiling suppresses instead of looping. */
function exhaust(ctx: LegContext, errorCode: AlertDeliveryErrorCode): LegResult {
    if (ctx.delivery.attempt >= ALERT_MAX_ATTEMPTS) {
        return {
            status: 'suppressed',
            errorCode: 'retries_exhausted',
            suppressedReason: 'retries_exhausted',
        };
    }
    return { status: 'failed', errorCode };
}
/** Ambiguous acceptance is never rewritten as an ordinary exhausted failure. */
function providerOutcomeUnknown(): LegResult {
    return { status: 'failed', errorCode: 'provider_outcome_unknown' };
}
interface ValidatedFrozenRequest {
    request: AlertRequest;
    fingerprint: string;
    destinationUrl?: string;
}
function validateFrozenRequest(ctx: LegContext): ValidatedFrozenRequest {
    const request = parseAlertRequest(ctx.delivery.requestPayload);
    const fingerprint = alertRequestFingerprint({
        ruleId: ctx.delivery.ruleId,
        deliveryId: ctx.delivery.id,
        channel: ctx.delivery.channel,
        request,
    });
    if (ctx.delivery.requestFingerprint !== null &&
        ctx.delivery.requestFingerprint !== fingerprint) {
        throw new Error('alert request fingerprint drifted');
    }
    if (request.version === ALERT_SLACK_REQUEST_VERSION) {
        return {
            request,
            fingerprint,
            destinationUrl: openAlertSecret(request.encryptedUrl, ctx.delivery.ruleId, 'slack_webhook'),
        };
    }
    if (request.version === ALERT_WEBHOOK_REQUEST_VERSION) {
        return {
            request,
            fingerprint,
            destinationUrl: openAlertSecret(request.encryptedUrl, ctx.delivery.ruleId, 'webhook_url'),
        };
    }
    return { request, fingerprint };
}
async function deliverLeg(ctx: LegContext, deps: DispatchAlertDeps, repository: AlertDispatchRepository): Promise<LegResult | null> {
    let frozen: ValidatedFrozenRequest;
    try {
        frozen = validateFrozenRequest(ctx);
    }
    catch (err) {
        deps.logger?.warn({
            ruleId: ctx.delivery.ruleId,
            deliveryId: ctx.delivery.id,
            channel: ctx.delivery.channel,
            err: (err as Error).name,
        }, 'alert frozen request failed closed');
        return {
            status: 'failed',
            errorCode: 'provider_outcome_unknown_payload_drift',
        };
    }
    if (ctx.delivery.requestFingerprint === null) {
        const bound = await repository.bindDeliveryRequestFingerprint(deps.db, {
            id: ctx.delivery.id,
            attempt: ctx.delivery.attempt,
            claimToken: ctx.claimToken,
            fingerprint: frozen.fingerprint,
            now: ctx.now,
        });
        if (!bound)
            return null;
    }
    try {
        switch (frozen.request.version) {
            case ALERT_EMAIL_REQUEST_VERSION:
                return await deliverEmailLeg(ctx, frozen.request, deps);
            case ALERT_SLACK_REQUEST_VERSION:
                return await deliverSlackLeg(ctx, frozen.request, frozen.destinationUrl!, deps);
            case ALERT_WEBHOOK_REQUEST_VERSION:
                return await deliverWebhookLeg(ctx, frozen.request, frozen.destinationUrl!, deps);
        }
    }
    catch (err) {
        deps.logger?.warn({
            ruleId: ctx.delivery.ruleId,
            deliveryId: ctx.delivery.id,
            channel: ctx.delivery.channel,
            err: err instanceof Error ? err.name : 'NonError',
        }, 'alert provider outcome is unknown — leg isolated');
        if (err instanceof UnsafeUrlError)
            return exhaust(ctx, 'unsafe_url');
        return providerOutcomeUnknown();
    }
}
async function deliverEmailLeg(ctx: LegContext, request: Extract<AlertRequest, {
    version: typeof ALERT_EMAIL_REQUEST_VERSION;
}>, deps: DispatchAlertDeps): Promise<LegResult> {
    const result = await deps.sendEmail({
        to: request.to,
        userId: ctx.delivery.recipientRef as string,
        idempotencyKey: `alert/${ctx.delivery.id}`,
        expectedSenderIdentity: request.senderIdentity,
        eligibilityFrozen: true,
        subject: request.subject,
        text: request.text,
        html: request.html,
        locale: request.locale,
    });
    if (!result.delivered) {
        return result.outcomeUnknown
            ? providerOutcomeUnknown()
            : exhaust(ctx, 'transport_rejected');
    }
    return { status: 'sent', providerMessageId: result.providerMessageId ?? null };
}
function fetchOptions(deps: DispatchAlertDeps): FetchPublicUrlSafeOptions {
    return Object.assign({
        deadlineMs: ALERT_DELIVERY_DEADLINE_MS,
        maxResponseBytes: ALERT_DELIVERY_MAX_RESPONSE_BYTES,
    }, deps.urlSafety);
}
async function deliverSlackLeg(ctx: LegContext, request: Extract<AlertRequest, {
    version: typeof ALERT_SLACK_REQUEST_VERSION;
}>, url: string, deps: DispatchAlertDeps): Promise<LegResult> {
    const response = await fetchPublicUrlSafe(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: request.body,
    }, fetchOptions(deps));
    return response.ok ? { status: 'sent' } : exhaust(ctx, 'transport_rejected');
}
async function deliverWebhookLeg(ctx: LegContext, request: Extract<AlertRequest, {
    version: typeof ALERT_WEBHOOK_REQUEST_VERSION;
}>, url: string, deps: DispatchAlertDeps): Promise<LegResult> {
    const response = await fetchPublicUrlSafe(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-rankmefast-signature': request.signature,
            'x-rankmefast-delivery': ctx.delivery.id,
        },
        body: request.rawBody,
    }, fetchOptions(deps));
    return response.ok ? { status: 'sent' } : exhaust(ctx, 'transport_rejected');
}
