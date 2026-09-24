import { createHmac } from 'node:crypto';
import { getEmailSenderIdentity, isEmailTransportConfigured, sendEmail, type EmailSendResult, } from './mailers/resend.js';
import type { ContactFormInput } from './communication.schema.js';
import { translate, DEFAULT_LOCALE, type SupportedLocale, } from '../../shared/i18n/index.js';
import { env } from '../../config/env.js';
import { normalizedAppUrl } from '../../shared/utils/client-url.js';
import { escapeEmailHtml, renderEmailAction, renderEmailTemplate, } from '../../shared/utils/email-template.js';
import { resolveNotificationPreferences, type NotificationChannel, } from '../users/users.service.js';
import { resolveRecipientLocale } from './recipient-locale.js';
function contactFormRecipient(sender: string): string {
    // Preferred inbox is env.CONTACT_FORM_RECIPIENT; falls back to the mail
    // sender address so we still route somewhere legitimate. When neither is set
    // AND Resend is configured, throw so misconfig fails loudly instead of mail
    // vanishing. When Resend is unconfigured, sendEmail short-circuits so we
    // route echo-style to the submitter — the payload never leaves the process.
    const explicit = env.CONTACT_FORM_RECIPIENT;
    if (explicit)
        return explicit;
    const fallback = env.RESEND_FROM;
    if (fallback)
        return fallback;
    if (env.RESEND_API_KEY) {
        throw new Error('Contact form recipient is not configured. Set CONTACT_FORM_RECIPIENT or RESEND_FROM.');
    }
    return sender;
}
/**
 * Strip characters that could inject additional headers into the outgoing
 * Subject line or make the human-readable sender label misleading.
 */
function sanitizeHeaderField(value: string): string {
    return value.replace(/[\r\n<>]/g, '').trim();
}
export async function deliverContactForm(input: ContactFormInput, locale: SupportedLocale = DEFAULT_LOCALE): Promise<void> {
    const senderAddress = input.email;
    const fromName = `${sanitizeHeaderField(input.firstName)} ${sanitizeHeaderField(input.lastName)}`;
    await sendEmail({
        to: contactFormRecipient(senderAddress),
        replyTo: senderAddress,
        subject: sanitizeHeaderField(input.subject),
        text: translate(locale, 'email.contact.notification', {
            name: fromName,
            email: senderAddress,
            message: input.message,
        }),
        locale,
    });
}
/**
 * Preference gate — consulted by every NON-SECURITY mailer before hitting
 * Resend. Security email (password reset, verification,
 * password-changed confirmation) SKIPS this call on purpose and always
 * sends regardless of the user's prefs.
 */
export async function shouldSendNotification(userId: string, channel: NotificationChannel): Promise<boolean> {
    const prefs = await resolveNotificationPreferences(userId);
    return prefs[channel];
}
/**
 * Result for preference-gated mail. A refusal by the user is terminal; a
 * provider/transport failure is retryable by callers that own a retry state
 * machine (notably alert dispatch).
 */
export type NotificationSendResult = EmailSendResult & {
    reason?: 'opted-out' | 'transport-failure';
};
// SECURITY-TRANSACTIONAL — never gated by notification preferences.
// The four mailers below are wired into Better Auth (auth.ts) and reflect
// account-security events the user cannot opt out of.
export async function deliverPasswordResetEmail(email: string, resetUrl: string, locale: SupportedLocale = DEFAULT_LOCALE): Promise<void> {
    const frozenLocale = resolveRecipientLocale({ requestLocale: locale });
    const text = translate(frozenLocale, 'email.passwordReset.body', { resetUrl });
    await sendEmail({
        to: email,
        subject: translate(frozenLocale, 'email.passwordReset.subject'),
        text,
        locale: frozenLocale,
    });
}
export async function deliverVerificationEmail(email: string, verifyUrl: string, locale: SupportedLocale = DEFAULT_LOCALE): Promise<void> {
    const frozenLocale = resolveRecipientLocale({ requestLocale: locale });
    const text = translate(frozenLocale, 'email.verifyEmail.body', { verifyUrl });
    await sendEmail({
        to: email,
        subject: translate(frozenLocale, 'email.verifyEmail.subject'),
        text,
        locale: frozenLocale,
    });
}
export async function deliverPasswordChangedEmail(email: string, locale: SupportedLocale = DEFAULT_LOCALE): Promise<void> {
    const frozenLocale = resolveRecipientLocale({ requestLocale: locale });
    const text = translate(frozenLocale, 'email.passwordChanged.body');
    await sendEmail({
        to: email,
        subject: translate(frozenLocale, 'email.passwordChanged.subject'),
        text,
        locale: frozenLocale,
    });
}
/**
 * Sent to the NEW email when a signed-in user asks Better Auth to change
 * their address. The account email only rolls over after the recipient
 * follows this link — the old address keeps working until then.
 */
export async function deliverEmailChangeVerification(newEmail: string, verifyUrl: string, locale: SupportedLocale = DEFAULT_LOCALE): Promise<void> {
    const frozenLocale = resolveRecipientLocale({ requestLocale: locale });
    const text = translate(frozenLocale, 'email.emailChangeVerification.body', { verifyUrl });
    await sendEmail({
        to: newEmail,
        subject: translate(frozenLocale, 'email.emailChangeVerification.subject'),
        text,
        locale: frozenLocale,
    });
}
export interface WelcomeEmailInput {
    email: string;
    name: string;
    /**
     * User id used to consult the marketing preference. Optional so legacy
     * callers (fixtures, one-off scripts) can still fire the mail — a missing
     * id resolves to the all-true default and the mail sends.
     */
    userId?: string;
    locale?: SupportedLocale;
}
export interface TeamInviteEmailInput {
    email: string;
    inviterName: string;
    teamName: string;
    acceptUrl?: string;
    rejectUrl?: string;
    signInUrl?: string;
    /** Backward-compatible input for older internal callers. */
    link?: string;
    role?: string;
    sites?: string;
    temporaryPassword?: string;
    locale?: SupportedLocale;
    /** Opaque event key frozen by the invitation service before delivery. */
    idempotencyKey?: string;
}
export async function deliverTeamInviteEmail(input: TeamInviteEmailInput): Promise<EmailSendResult> {
    const locale = resolveRecipientLocale({ artifactLocale: input.locale });
    const acceptUrl = input.acceptUrl ?? input.link ?? normalizedAppUrl();
    const rejectUrl = input.rejectUrl ?? acceptUrl;
    const signInUrl = input.signInUrl ?? `${normalizedAppUrl()}/login`;
    const vars = {
        inviterName: input.inviterName,
        teamName: input.teamName,
        acceptUrl,
        rejectUrl,
        signInUrl,
        role: translate(locale, input.role === 'admin'
            ? 'email.teamInvite.roles.admin'
            : 'email.teamInvite.roles.member'),
        sites: input.sites ?? translate(locale, 'email.teamInvite.allSites'),
        credentials: input.temporaryPassword
            ? translate(locale, 'email.teamInvite.credentials', {
                email: input.email,
                password: input.temporaryPassword,
            })
            : '',
    };
    const text = translate(locale, 'email.teamInvite.body', vars);
    const safeText = escapeEmailHtml(text).replaceAll('\n', '<br>');
    const subject = translate(locale, 'email.teamInvite.subject', {
        teamName: input.teamName,
    });
    const html = renderEmailTemplate({
        subject,
        text,
        locale,
        bodyHtml: `<p style="margin:0">${safeText}</p><p style="margin:20px -4px 0">${renderEmailAction(translate(locale, 'email.teamInvite.accept'), acceptUrl, 'primary')}${renderEmailAction(translate(locale, 'email.teamInvite.reject'), rejectUrl, 'destructive')}</p>`,
    });
    return sendEmail({
        to: input.email,
        idempotencyKey: input.idempotencyKey,
        expectedSenderIdentity: getEmailSenderIdentity(),
        subject,
        text,
        html,
        locale,
    });
}
export async function deliverWelcomeEmail(input: WelcomeEmailInput): Promise<NotificationSendResult> {
    if (input.userId && !(await shouldSendNotification(input.userId, 'emailMarketing'))) {
        return { delivered: false, reason: 'opted-out' };
    }
    const locale = resolveRecipientLocale({ artifactLocale: input.locale });
    const text = translate(locale, 'email.welcome.body', {
        name: input.name,
        clientUrl: normalizedAppUrl(),
    });
    return sendEmail({
        to: input.email,
        subject: translate(locale, 'email.welcome.subject'),
        text,
        locale,
    });
}
// Gated mailers below — every call MUST resolve to a `userId` so the
// preference gate can short-circuit before spending Resend budget.
export interface AuditCompleteEmailInput {
    email: string;
    userId: string;
    siteLabel: string;
    reportUrl: string;
    locale?: SupportedLocale;
}
export async function deliverAuditCompleteEmail(input: AuditCompleteEmailInput): Promise<NotificationSendResult> {
    if (!(await shouldSendNotification(input.userId, 'emailAuditComplete'))) {
        return { delivered: false, reason: 'opted-out' };
    }
    const locale = resolveRecipientLocale({ artifactLocale: input.locale });
    const text = translate(locale, 'email.auditComplete.body', {
        siteLabel: input.siteLabel,
        reportUrl: input.reportUrl,
    });
    return sendEmail({
        to: input.email,
        subject: translate(locale, 'email.auditComplete.subject', { siteLabel: input.siteLabel }),
        text,
        locale,
    });
}
export interface RankDropEmailInput {
    email: string;
    userId: string;
    keyword: string;
    previousPosition: string;
    currentPosition: string;
    siteUrl: string;
    locale?: SupportedLocale;
}
export async function deliverRankDropEmail(input: RankDropEmailInput): Promise<NotificationSendResult> {
    if (!(await shouldSendNotification(input.userId, 'emailRankDrop'))) {
        return { delivered: false, reason: 'opted-out' };
    }
    const locale = resolveRecipientLocale({ artifactLocale: input.locale });
    const text = translate(locale, 'email.rankDrop.body', {
        keyword: input.keyword,
        previousPosition: input.previousPosition,
        currentPosition: input.currentPosition,
        siteUrl: input.siteUrl,
    });
    return sendEmail({
        to: input.email,
        subject: translate(locale, 'email.rankDrop.subject', { keyword: input.keyword }),
        text,
        locale,
    });
}
export interface AlertEmailInput {
    email: string;
    userId: string;
    /** Stable opaque alert-delivery key used by the live email adapter. */
    idempotencyKey: string;
    /** Sender captured at the same boundary as the durable request binding. */
    expectedSenderIdentity?: string | null;
    /** The alert outbox already froze preference eligibility for this event. */
    eligibilityFrozen?: boolean;
    /** Already localized + evidence-bounded by the dispatch renderer. */
    subject: string;
    text: string;
    locale?: SupportedLocale;
    html?: string;
}
/**
 * Customer-configured alert rule notification.
 * Gated by the dedicated `emailAlerts` preference so muting alert rules never
 * also mutes the courtesy rank-drop notice or page monitoring.
 *
 * The subject and body arrive fully rendered from the dispatch service, which
 * builds them from the FROZEN stored observation pair — this mailer never sees
 * a vendor row, a raw URL list, or any secret.
 */
export async function deliverAlertEmail(input: AlertEmailInput): Promise<NotificationSendResult> {
    if (!input.eligibilityFrozen &&
        !(await shouldSendNotification(input.userId, 'emailAlerts'))) {
        return { delivered: false, reason: 'opted-out' };
    }
    const result = await sendEmail({
        to: input.email,
        idempotencyKey: input.idempotencyKey,
        ...(Object.prototype.hasOwnProperty.call(input, 'expectedSenderIdentity')
            ? { expectedSenderIdentity: input.expectedSenderIdentity }
            : {}),
        subject: input.subject,
        text: input.text,
        locale: input.locale,
        html: input.html,
    });
    return result.delivered
        ? result
        : { ...result, delivered: false, reason: 'transport-failure' };
}
/** Preference is frozen once, before an alert request is provider-bound. */
export async function isAlertEmailEligible(userId: string): Promise<boolean> {
    return shouldSendNotification(userId, 'emailAlerts');
}
export interface MonitorChangeEmailInput {
    email: string;
    /** Exact rendered values frozen by the durable content-monitor outbox. */
    subject: string;
    text: string;
    html: string;
    /** Exact configured From identity captured before the first request. */
    senderIdentity: string | null;
    /** Stable receipt-derived key; contains no email address or page content. */
    idempotencyKey: string;
    locale?: SupportedLocale;
}
/**
 * Material-change alert for a public-page monitor. Recipient
 * eligibility is frozen in the durable outbox before the first request; this
 * transport function must not re-read mutable preferences during an ambiguous
 * idempotent replay. The body carries no diff text, page prose, or raw HTML.
 */
export async function deliverMonitorChangeEmail(input: MonitorChangeEmailInput): Promise<NotificationSendResult> {
    const result = await sendEmail({
        to: input.email,
        idempotencyKey: input.idempotencyKey,
        expectedSenderIdentity: input.senderIdentity,
        subject: input.subject,
        text: input.text,
        locale: input.locale,
        html: input.html,
    });
    return result.delivered
        ? result
        : { ...result, delivered: false, reason: 'transport-failure' };
}
export interface ClientReportEmailRecipient {
    email: string;
    userId?: string;
    membership: 'active' | 'removed' | 'external';
    /** Stable opaque per-run/per-recipient retry key; never contains an address. */
    idempotencyKey: string;
}
export interface FrozenClientReportEmailRecipient {
    email: string;
    idempotencyKey: string;
}
interface FrozenClientReportEmailPayloadBase {
    senderIdentity: string | null;
    subject: string;
    text: string;
    html: string;
    attachment: {
        filename: 'client-report.pdf';
        contentBase64: string;
        contentType: 'application/pdf';
    };
}
export type FrozenClientReportEmailPayload = (FrozenClientReportEmailPayloadBase & {
    /** Rendered legacy request; locale is recoverable only from stored HTML. */
    version: 'rankmefast.client-report-email.v1';
}) | (FrozenClientReportEmailPayloadBase & {
    version: 'rankmefast.client-report-email.v2';
    locale: SupportedLocale;
});
export interface ClientReportEmailInput {
    recipients: ClientReportEmailRecipient[];
    siteLabel: string;
    snapshotDate: string;
    pdfBytes: Uint8Array;
    locale?: SupportedLocale;
    transportAvailable?: () => boolean;
}
export interface PreparedClientReportEmail {
    payload: FrozenClientReportEmailPayload;
    recipients: FrozenClientReportEmailRecipient[];
    suppressed: ClientReportEmailOutcome[];
}
export interface ClientReportEmailOutcome {
    email: string;
    status: 'sent' | 'failed' | 'suppressed';
    suppressionReason: 'preference' | 'removed_user' | 'transport' | null;
    errorCode: 'transport_reported_failure' | 'provider_outcome_unknown' | null;
    providerMessageId: string | null;
}
/**
 * Freeze mutable preference/membership/transport decisions and the exact
 * common provider request before any recipient is submitted. A preference
 * change after this boundary applies to future reports, not an ambiguous
 * replay of this one.
 */
export async function prepareClientReportEmail(input: ClientReportEmailInput): Promise<PreparedClientReportEmail> {
    const locale = resolveRecipientLocale({ artifactLocale: input.locale });
    const transportAvailable = input.transportAvailable ?? isEmailTransportConfigured;
    // Freeze one event-wide transport decision. A test seam or dynamic registry
    // must not classify recipients in the same report differently.
    const transportUp = transportAvailable();
    const unique = new Map<string, ClientReportEmailRecipient>();
    for (const recipient of input.recipients) {
        unique.set(recipient.email.trim().toLowerCase(), {
            ...recipient,
            email: recipient.email.trim().toLowerCase(),
        });
    }
    const recipients = [...unique.values()].sort((a, b) => a.email.localeCompare(b.email));
    const suppressed: ClientReportEmailOutcome[] = [];
    const eligible: FrozenClientReportEmailRecipient[] = [];
    const subject = translate(locale, 'clientReports.email.subject', {
        siteLabel: input.siteLabel,
    });
    const text = translate(locale, 'clientReports.email.body', {
        siteLabel: input.siteLabel,
        snapshotDate: input.snapshotDate,
    });
    const html = renderEmailTemplate({ subject, text, locale });
    const attachment = {
        filename: 'client-report.pdf' as const,
        contentBase64: Buffer.from(input.pdfBytes).toString('base64'),
        contentType: 'application/pdf' as const,
    };
    for (const recipient of recipients) {
        if (recipient.membership === 'removed') {
            suppressed.push({
                email: recipient.email,
                status: 'suppressed',
                suppressionReason: 'removed_user',
                errorCode: null,
                providerMessageId: null,
            });
            continue;
        }
        if (recipient.userId !== undefined &&
            !(await shouldSendNotification(recipient.userId, 'emailAuditComplete'))) {
            suppressed.push({
                email: recipient.email,
                status: 'suppressed',
                suppressionReason: 'preference',
                errorCode: null,
                providerMessageId: null,
            });
            continue;
        }
        if (!transportUp) {
            suppressed.push({
                email: recipient.email,
                status: 'suppressed',
                suppressionReason: 'transport',
                errorCode: null,
                providerMessageId: null,
            });
            continue;
        }
        eligible.push({
            email: recipient.email,
            idempotencyKey: recipient.idempotencyKey,
        });
    }
    return {
        payload: {
            version: 'rankmefast.client-report-email.v2',
            locale,
            senderIdentity: getEmailSenderIdentity(),
            subject,
            text,
            html,
            attachment,
        },
        recipients: eligible,
        suppressed,
    };
}
/** Opaque exact-request HMAC; neither address nor report content is exposed. */
export function clientReportEmailRequestFingerprint(payload: FrozenClientReportEmailPayload, recipient: FrozenClientReportEmailRecipient): string {
    const exactRequest = JSON.stringify({
        ...(payload.version === 'rankmefast.client-report-email.v2'
            ? { locale: payload.locale }
            : {}),
        from: payload.senderIdentity,
        to: [recipient.email],
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        attachments: [{
                filename: payload.attachment.filename,
                content: payload.attachment.contentBase64,
                content_type: payload.attachment.contentType,
            }],
        idempotencyKey: recipient.idempotencyKey,
    });
    const digest = createHmac('sha256', env.MASTER_ENCRYPTION_KEY)
        .update(exactRequest)
        .digest('hex');
    return `request-hmac-v1:${digest}`;
}
/**
 * Fan out one already-frozen client-report request. This intentionally does
 * not re-read preferences or membership; preparation owns that event-time
 * decision and retries must submit byte-identical provider payloads.
 */
export async function deliverClientReportEmail(input: {
    recipients: FrozenClientReportEmailRecipient[];
    payload: FrozenClientReportEmailPayload;
}): Promise<ClientReportEmailOutcome[]> {
    const unique = new Map<string, FrozenClientReportEmailRecipient>();
    for (const recipient of input.recipients) {
        unique.set(recipient.email.trim().toLowerCase(), {
            ...recipient,
            email: recipient.email.trim().toLowerCase(),
        });
    }
    const recipients = [...unique.values()].sort((a, b) => a.email.localeCompare(b.email));
    const outcomes: ClientReportEmailOutcome[] = [];
    for (const recipient of recipients) {
        const result = await sendEmail({
            to: recipient.email,
            idempotencyKey: recipient.idempotencyKey,
            expectedSenderIdentity: input.payload.senderIdentity,
            subject: input.payload.subject,
            text: input.payload.text,
            html: input.payload.html,
            attachments: [input.payload.attachment],
        });
        outcomes.push(result.delivered
            ? {
                email: recipient.email,
                status: 'sent',
                suppressionReason: null,
                errorCode: null,
                providerMessageId: result.providerMessageId ?? null,
            }
            : {
                email: recipient.email,
                status: 'failed',
                suppressionReason: null,
                errorCode: result.outcomeUnknown
                    ? 'provider_outcome_unknown'
                    : 'transport_reported_failure',
                providerMessageId: null,
            });
    }
    return outcomes;
}
