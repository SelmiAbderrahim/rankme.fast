/**
 * Provider error taxonomy.
 *
 * Every provider method rejects with exactly one of these classes. Job
 * processors map `retryable` onto BullMQ retry behavior: retryable errors
 * re-enter the queue with backoff; non-retryable errors fail fast to the
 * dead-letter queue.
 */
export interface ProviderErrorContext {
    /** Registry key of the provider that failed, e.g. `dataforseo`. */
    provider: string;
    /** Logical operation, e.g. `serp-task-get`. */
    operation: string;
    /** HTTP response status when the failure followed a vendor response. */
    httpStatus?: number;
    cause?: unknown;
}
export class ProviderError extends Error {
    readonly provider: string;
    readonly operation: string;
    readonly retryable: boolean;
    readonly httpStatus: number | undefined;
    constructor(message: string, retryable: boolean, ctx: ProviderErrorContext) {
        super(message, ctx.cause === undefined ? undefined : { cause: ctx.cause });
        this.name = new.target.name;
        this.provider = ctx.provider;
        this.operation = ctx.operation;
        this.retryable = retryable;
        this.httpStatus = ctx.httpStatus;
    }
}
/** The vendor did not answer inside the request deadline. Retryable. */
export class VendorTimeoutError extends ProviderError {
    constructor(message: string, ctx: ProviderErrorContext) {
        super(message, true, ctx);
    }
}
/**
 * The vendor answered, but the payload failed zod validation (or was not
 * JSON at all). Not retryable — the same request would fail the same way;
 * a human must look at the contract drift.
 */
export class VendorMalformedError extends ProviderError {
    constructor(message: string, ctx: ProviderErrorContext) {
        super(message, false, ctx);
    }
}
/**
 * Quota / rate limit / balance exhausted. Retryable-later; when the vendor
 * reports a wait, `retryAfterSeconds` carries it.
 */
export class VendorQuotaError extends ProviderError {
    readonly retryAfterSeconds?: number;
    constructor(message: string, ctx: ProviderErrorContext & {
        retryAfterSeconds?: number;
    }) {
        super(message, true, ctx);
        this.retryAfterSeconds = ctx.retryAfterSeconds;
    }
}
/** Credentials rejected — misconfiguration, not a transient fault. Not retryable. */
export class VendorAuthError extends ProviderError {
    constructor(message: string, ctx: ProviderErrorContext) {
        super(message, false, ctx);
    }
}
/** Vendor-side 5xx / network failure. Retryable. */
export class VendorUnavailableError extends ProviderError {
    constructor(message: string, ctx: ProviderErrorContext) {
        super(message, true, ctx);
    }
}
/**
 * GSC-specific: the refresh token is dead (HTTP 401 or `invalid_grant`).
 *
 * Expected state per Google's consent-screen-in-testing 7-day expiry,
 * 6-month unuse, and >100-tokens/client limits. The module marks the
 * connection `needs_reconnect`, the UI prompts re-consent — never a crash.
 * Not retryable — retrying with the same dead token cannot succeed.
 */
export class GscReconnectRequiredError extends ProviderError {
    constructor(message: string, ctx: ProviderErrorContext) {
        super(message, false, ctx);
    }
}
