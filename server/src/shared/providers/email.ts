/**
 * Provider-neutral transactional email capability.
 *
 * Feature modules depend on this shape only. Vendor request/response details
 * stay inside `shared/providers/resend/`, in the same boundary as every other
 * live external client.
 */
export interface EmailMessage {
    to: string;
    /** Optional validated reply target; the adapter always owns the From sender. */
    replyTo?: string;
    /**
     * Stable, feature-owned retry key. Live adapters map it to the provider's
     * idempotency boundary; it must never contain recipient or message content.
     */
    idempotencyKey?: string;
    /**
     * Frozen From identity for idempotent retries. When present (including null),
     * the registry refuses to send if runtime configuration no longer matches.
     */
    expectedSenderIdentity?: string | null;
    subject: string;
    text: string;
    html?: string;
    attachments?: Array<{
        filename: string;
        contentBase64: string;
        contentType: string;
    }>;
}
export interface EmailSendResult {
    delivered: boolean;
    providerMessageId?: string | null;
    /**
     * True only when no authoritative provider response was observed (for
     * example a timeout or connection loss). The request may have been accepted,
     * so durable callers must replay the same payload/idempotency key or close as
     * provider-outcome-unknown. A normal provider rejection leaves this absent.
     */
    outcomeUnknown?: boolean;
}
/** Injectable vendor-boundary transport used by the registry and tests. */
export type EmailTransport = (message: EmailMessage, from: string, apiKey: string) => Promise<EmailSendResult>;
