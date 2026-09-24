import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { EmailMessage, EmailSendResult, EmailTransport } from './email.js';
import { captureE2eEmail } from './e2e-email-capture.js';
import { createResendTransport } from './resend/client.js';
const liveTransport = createResendTransport({
    onHttpError: (status) => {
        // Status is useful operationally; response bodies can contain recipient
        // details and deliberately never cross the vendor boundary.
        logger.error({ status, transport: 'resend' }, 'resend send failed');
    },
    onMalformedResponse: () => {
        logger.error({ transport: 'resend' }, 'resend returned a malformed success response');
    },
});
let activeTransport: EmailTransport = liveTransport;
/** Test seam; `null` restores the shipped Resend adapter. */
export function setResendTransport(transport: EmailTransport | null): void {
    activeTransport = transport ?? liveTransport;
}
export function getResendTransport(): EmailTransport {
    return activeTransport;
}
export function isEmailTransportConfigured(): boolean {
    return env.EMAIL_TRANSPORT === 'fake' || Boolean(env.RESEND_API_KEY && env.RESEND_FROM);
}
/** Exact provider payload `from` identity without exposing any credential. */
export function getEmailSenderIdentity(): string | null {
    return env.EMAIL_TRANSPORT === 'fake' ? 'fake' : (env.RESEND_FROM ?? null);
}
/**
 * Select and invoke the configured email capability. The deterministic fake
 * is explicit test/development infrastructure; missing live credentials fail
 * closed as `delivered:false` and never fabricate a delivery.
 */
export async function sendEmail(message: EmailMessage): Promise<EmailSendResult> {
    if (Object.prototype.hasOwnProperty.call(message, 'expectedSenderIdentity') &&
        message.expectedSenderIdentity !== getEmailSenderIdentity()) {
        logger.warn({ transport: env.EMAIL_TRANSPORT }, 'email sender identity changed; refusing an unsafe idempotent replay');
        return { delivered: false };
    }
    if (env.EMAIL_TRANSPORT === 'fake') {
        if (env.E2E_EMAIL_CAPTURE)
            await captureE2eEmail(message);
        const digest = createHash('sha256')
            .update(`${message.to}\0${message.subject}\0${message.text}`)
            .digest('hex')
            .slice(0, 24);
        return { delivered: true, providerMessageId: `fake-${digest}` };
    }
    if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
        logger.warn({ transport: 'resend' }, 'resend is not configured; skipping email send');
        return { delivered: false };
    }
    try {
        return await activeTransport(message, env.RESEND_FROM, env.RESEND_API_KEY);
    }
    catch (err) {
        // Transport errors can contain a serialized request, recipient, or bearer
        // credential. Preserve only the error class for operations; never pass the
        // arbitrary message/stack across the provider boundary into logs.
        logger.error({
            errorName: err instanceof Error ? err.name : 'NonError',
            transport: 'resend',
        }, 'resend transport threw');
        return { delivered: false, outcomeUnknown: true };
    }
}
export type { EmailMessage, EmailSendResult, EmailTransport } from './email.js';
/** Backward-compatible name for the existing injection API. */
export type ResendTransport = EmailTransport;
