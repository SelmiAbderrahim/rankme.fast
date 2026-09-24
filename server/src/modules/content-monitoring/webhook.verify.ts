/**
 * Firecrawl webhook signature verification.
 *
 * The ONLY unauthenticated inbound surface in the batch, so it gets the
 * strictest hardening. This module is PURE — it takes the raw body, the request
 * headers, and explicit secret-to-credential bindings and either returns the
 * authorized credential reference or throws `MonitorWebhookVerifyError`. It reads no
 * env and touches no DB, so every adversarial branch is unit-testable.
 *
 * Contract (Phase-0, docs.firecrawl.dev/webhooks/security):
 *   - header `X-Firecrawl-Signature`, value `sha256=<hex>` (lowercase hex).
 *   - HMAC-SHA256 over the EXACT raw request body (verified BEFORE JSON parse).
 *   - NO timestamp in the signed payload → this verifier has no time window;
 *     replay defence is the unconditional receipt dedupe in the controller.
 *
 * Hardening:
 *   - strict single-header parse — a repeated header (Node joins duplicates with
 *     a comma) fails the `^sha256=<hex>$` shape; an array value is rejected.
 *   - exactly ONE documented algorithm — `sha1=`, `md5=`, `none`, a schemeless
 *     value, or a caller-selected algorithm all fail the shape check.
 *   - length-check BEFORE `timingSafeEqual` so the equal-length constant-time
 *     path is the only comparison and no throw leaks timing.
 *   - bounded rotation — current/previous secrets may map to one credential,
 *     but a secret can never authorize a different Firecrawl account.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
export const FIRECRAWL_SIGNATURE_HEADER = 'x-firecrawl-signature';
/** Only the documented algorithm is ever accepted — no caller selection. */
const SIGNATURE_PATTERN = /^sha256=([0-9a-f]+)$/;
export class MonitorWebhookVerifyError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = 'MonitorWebhookVerifyError';
        this.status = status;
    }
}
export interface MonitorWebhookSecretBinding {
    secret: string;
    credentialRef: string;
}
/** Read the single signature header value; reject a missing, empty, or duplicated header. */
function readSignatureHeader(headers: Record<string, string | string[] | undefined>): string {
    let value: string | string[] | undefined;
    for (const [key, raw] of Object.entries(headers)) {
        if (key.toLowerCase() === FIRECRAWL_SIGNATURE_HEADER) {
            value = raw;
            break;
        }
    }
    if (Array.isArray(value)) {
        // Multiple signature headers — a header-injection / confusion attempt.
        throw new MonitorWebhookVerifyError('multiple signature headers', 401);
    }
    if (typeof value !== 'string' || value.length === 0) {
        throw new MonitorWebhookVerifyError('missing signature header', 401);
    }
    return value;
}
export interface VerifyMonitorWebhookInput {
    rawBody: Buffer;
    headers: Record<string, string | string[] | undefined>;
    /** Explicit secret-to-account affinity, including bounded rotation values. */
    bindings: readonly MonitorWebhookSecretBinding[];
}
/**
 * Verify the delivery signature. Returns the authorized credential reference
 * on success; throws
 * `MonitorWebhookVerifyError` (401 for a bad/missing signature, 500 when no
 * secret is configured) otherwise. Leaks no detail about WHY beyond the status.
 */
export function verifyMonitorWebhookSignature(input: VerifyMonitorWebhookInput): string {
    if (input.bindings.length === 0) {
        throw new MonitorWebhookVerifyError('monitor webhook binding is not configured', 500);
    }
    const configuredSecrets = new Set<string>();
    for (const binding of input.bindings) {
        if (binding.secret.trim() === '' ||
            binding.credentialRef.trim() === '' ||
            configuredSecrets.has(binding.secret)) {
            throw new MonitorWebhookVerifyError('monitor webhook binding is invalid', 500);
        }
        configuredSecrets.add(binding.secret);
    }
    const header = readSignatureHeader(input.headers).trim();
    const match = SIGNATURE_PATTERN.exec(header);
    if (!match) {
        // Covers algorithm-confusion (`sha1=`, `md5=`), `none`, a schemeless value,
        // a non-hex payload, and a comma-joined duplicate header.
        throw new MonitorWebhookVerifyError('malformed signature header', 401);
    }
    const provided = Buffer.from(match[1]!, 'hex');
    for (const binding of input.bindings) {
        const expected = createHmac('sha256', binding.secret).update(input.rawBody).digest();
        // Length-check FIRST — timingSafeEqual throws on unequal lengths, and that
        // throw path would leak timing. Only equal-length buffers reach the
        // constant-time comparison.
        if (provided.length !== expected.length)
            continue;
        if (timingSafeEqual(provided, expected))
            return binding.credentialRef;
    }
    throw new MonitorWebhookVerifyError('signature mismatch', 401);
}
/**
 * Convenience for tests + tooling: produce the `sha256=<hex>` header value for a
 * body signed with `secret`. NEVER used in production request handling.
 */
export function signMonitorWebhookBody(rawBody: Buffer, secret: string): string {
    return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}
