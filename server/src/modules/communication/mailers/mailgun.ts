/**
 * @deprecated Mailgun transport was replaced by Resend. This file
 * is a thin re-export of the Resend transport for any lingering import path;
 * new code should consume the provider-neutral communication/public provider
 * API rather than importing a concrete vendor adapter.
 */
export { sendEmail, setResendTransport, getResendTransport } from './resend.js';
export type { EmailMessage, EmailSendResult, ResendTransport } from './resend.js';
