/**
 * Public-page change monitoring — material-change notification.
 *
 * `prepareMonitorMaterialChangeNotification` freezes every feature-controlled
 * Resend payload field before the first request: normalized recipient, exact
 * sender identity, localized subject, and localized text. Retries consume those
 * frozen values so a stable idempotency key is never paired with a changed
 * payload. Diff text/page prose/raw HTML are never included.
 */
import { createHmac } from 'node:crypto';
import { env } from '../../config/env.js';
import { deliverMonitorChangeEmail, getEmailSenderIdentity, resolveRecipientLocale, shouldSendNotification, } from '../communication/index.js';
import { User } from '../users/index.js';
import { normalizedAppUrl } from '../../shared/utils/client-url.js';
import { DEFAULT_LOCALE, translate, type SupportedLocale } from '../../shared/i18n/index.js';
import { renderEmailTemplate } from '../../shared/utils/email-template.js';
export interface PrepareMonitorMaterialChangeInput {
    ownerUserId: string;
    siteId: string;
    targetUrl: string;
    locale: string;
}
export interface PreparedMonitorMaterialChange {
    locale: SupportedLocale;
    recipientEmail: string | null;
    senderIdentity: string | null;
    suppressionReason: 'opted-out' | 'no-recipient' | null;
    subject: string;
    text: string;
    html: string;
}
export interface NotifyMonitorMaterialChangeInput {
    ownerUserId: string;
    recipientEmail: string | null;
    senderIdentity: string | null;
    suppressionReason: 'opted-out' | 'no-recipient' | null;
    subject: string;
    text: string;
    html: string;
    locale: SupportedLocale;
    idempotencyKey: string;
    requestFingerprint: string;
}
export interface NotifyMonitorMaterialChangeOutcome {
    delivered: boolean;
    reason?: 'opted-out' | 'transport-failure' | 'no-recipient';
    providerMessageId?: string | null;
    /** No authoritative provider response was observed; retry only under the same key. */
    outcomeUnknown?: boolean;
}
/**
 * A valid monitored URL may be 2,048 characters. Email copy needs a readable
 * label and the subject has a deliberately smaller storage/provider bound, so
 * freeze a deterministic abbreviated display value while the dashboard link
 * remains the authoritative destination.
 */
export function monitorTargetDisplayLabel(targetUrl: string): string {
    const maxChars = 240;
    if (targetUrl.length <= maxChars)
        return targetUrl;
    return `${targetUrl.slice(0, maxChars - 1)}…`;
}
/** Deep link into the monitoring sub-view for a site. */
export function monitoringDashboardUrl(siteId: string, locale?: SupportedLocale): string {
    const base = normalizedAppUrl().replace(/\/+$/, '');
    const prefix = locale && locale !== DEFAULT_LOCALE ? `/${locale}` : '';
    return `${base}${prefix}/sites/${siteId}?tab=content&view=monitoring`;
}
/** Capture the exact retry payload before any provider request is attempted. */
export async function prepareMonitorMaterialChangeNotification(input: PrepareMonitorMaterialChangeInput): Promise<PreparedMonitorMaterialChange> {
    const owner = await User.findById(input.ownerUserId).select('email').lean();
    const locale = resolveRecipientLocale({ artifactLocale: input.locale });
    const monitorUrl = monitoringDashboardUrl(input.siteId, locale);
    const targetLabel = monitorTargetDisplayLabel(input.targetUrl);
    const recipientEmail = owner?.email.trim().toLowerCase() ?? null;
    const suppressionReason = !recipientEmail
        ? 'no-recipient'
        : (await shouldSendNotification(input.ownerUserId, 'emailMonitorChange'))
            ? null
            : 'opted-out';
    const text = translate(locale, 'email.monitorChange.body', {
        targetUrl: targetLabel,
        monitorUrl,
    });
    const subject = translate(locale, 'email.monitorChange.subject', {
        targetUrl: targetLabel,
    });
    return {
        locale,
        recipientEmail,
        senderIdentity: getEmailSenderIdentity(),
        suppressionReason,
        subject,
        text,
        html: renderEmailTemplate({ subject, text, locale }),
    };
}
/** Opaque binding for locale metadata and every provider-visible field. */
export function monitorNotificationRequestFingerprint(input: {
    locale: SupportedLocale;
    recipientEmail: string | null;
    senderIdentity: string | null;
    subject: string;
    text: string;
    html: string;
    idempotencyKey: string;
}): string {
    const digest = createHmac('sha256', env.MASTER_ENCRYPTION_KEY)
        .update(JSON.stringify({
        locale: input.locale,
        from: input.senderIdentity,
        to: input.recipientEmail === null ? [] : [input.recipientEmail],
        subject: input.subject,
        text: input.text,
        html: input.html,
        idempotencyKey: input.idempotencyKey,
    }))
        .digest('hex');
    return `request-hmac-v1:${digest}`;
}
/** Deliver exactly the payload frozen in the receipt's notification outbox. */
export async function notifyMonitorMaterialChange(input: NotifyMonitorMaterialChangeInput): Promise<NotifyMonitorMaterialChangeOutcome> {
    const expected = monitorNotificationRequestFingerprint(input);
    if (expected !== input.requestFingerprint) {
        throw new Error('content-monitor notification request fingerprint drifted');
    }
    if (input.suppressionReason) {
        return { delivered: false, reason: input.suppressionReason };
    }
    if (!input.recipientEmail) {
        throw new Error('eligible content-monitor notification is missing its recipient');
    }
    const result = await deliverMonitorChangeEmail({
        email: input.recipientEmail,
        subject: input.subject,
        text: input.text,
        html: input.html,
        senderIdentity: input.senderIdentity,
        idempotencyKey: input.idempotencyKey,
        locale: input.locale,
    });
    return result.reason ? { delivered: result.delivered, reason: result.reason } : result;
}
