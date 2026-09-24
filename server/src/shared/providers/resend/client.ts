import type { EmailTransport } from '../email.js';
const RESEND_API_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 15000;
export interface ResendTransportOptions {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    onHttpError?: (status: number) => void;
    onMalformedResponse?: () => void;
}
/**
 * Concrete Resend HTTP adapter. It deliberately exposes only the neutral
 * email result and never logs response bodies, recipient data, or API keys.
 */
export function createResendTransport(options: ResendTransportOptions = {}): EmailTransport {
    const timeoutMs = options.timeoutMs ?? RESEND_TIMEOUT_MS;
    return async (message, from, apiKey) => {
        const body: Record<string, unknown> = {
            // Never allow feature input to override the verified configured sender.
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
        };
        if (message.replyTo)
            body.reply_to = message.replyTo;
        if (message.html)
            body.html = message.html;
        if (message.attachments) {
            body.attachments = message.attachments.map((attachment) => ({
                filename: attachment.filename,
                content: attachment.contentBase64,
                content_type: attachment.contentType,
            }));
        }
        // Resolve the global at call time so test interception and runtime fetch
        // instrumentation remain effective after module initialization.
        const headers: Record<string, string> = {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        };
        if (message.idempotencyKey) {
            headers['Idempotency-Key'] = message.idempotencyKey;
        }
        const response = await (options.fetchImpl ?? globalThis.fetch)(RESEND_API_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
            options.onHttpError?.(response.status);
            return { delivered: false };
        }
        const payload = (await response.json().catch(() => null)) as {
            id?: unknown;
        } | null;
        if (typeof payload?.id !== 'string' ||
            payload.id.length === 0 ||
            payload.id.length > 256) {
            options.onMalformedResponse?.();
            // A 2xx means the provider may already have accepted the request even
            // when its acknowledgement is unreadable. Durable callers must not
            // strengthen that ambiguity into a definite non-delivery.
            return { delivered: false, outcomeUnknown: true };
        }
        return { delivered: true, providerMessageId: payload.id };
    };
}
export const resendHttpTransport: EmailTransport = createResendTransport();
