import { renderEmailTemplate } from '../../../shared/utils/email-template.js';
import { sendEmail as sendProviderEmail, } from '../../../shared/providers/email-registry.js';
import type { EmailMessage as ProviderEmailMessage, } from '../../../shared/providers/email-registry.js';
export interface EmailMessage extends ProviderEmailMessage {
    /** Controls the shared HTML document language/direction; invalid values fall back safely. */
    locale?: string;
}
/** Product mail facade: preserve text fallback and add the shared HTML shell. */
export function sendEmail(message: EmailMessage) {
    const { locale, ...providerMessage } = message;
    return sendProviderEmail({
        ...providerMessage,
        html: message.html ?? renderEmailTemplate({
            subject: message.subject,
            text: message.text,
            locale,
        }),
    });
}
export { getResendTransport, getEmailSenderIdentity, isEmailTransportConfigured, setResendTransport, } from '../../../shared/providers/email-registry.js';
export type { EmailSendResult, ResendTransport, } from '../../../shared/providers/email-registry.js';
