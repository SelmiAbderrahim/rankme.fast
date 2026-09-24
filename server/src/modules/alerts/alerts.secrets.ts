/**
 * Channel-secret handling for alert rules.
 *
 * Two secrets ever reach persistence:
 *   • the Slack incoming-webhook URL — a bearer credential in URL form;
 *   • the generic-webhook HMAC secret — minted here, shown to the customer
 *     exactly once, never returned again.
 *
 * Both are AES-256-GCM envelopes (`shared/crypto`) AAD-bound to
 * `alert_rules:<ruleId>:<field>`, so a ciphertext moved between rules or
 * between fields fails GCM verification rather than an application check. The
 * masked columns exist so a read endpoint never has to decrypt at all.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { decryptSecret, encryptSecret, type EncryptedSecret, } from '../../shared/crypto/index.js';
export type AlertSecretField = 'slack_webhook' | 'webhook_secret' | 'webhook_url';
/** GCM AAD context — see `.claude/rules/secrets-at-rest.md`. */
export function alertSecretAad(ruleId: string, field: AlertSecretField): string {
    return `alert_rules:${ruleId}:${field}`;
}
export function sealAlertSecret(plaintext: string, ruleId: string, field: AlertSecretField): EncryptedSecret {
    return encryptSecret(plaintext, { aad: alertSecretAad(ruleId, field) });
}
export function openAlertSecret(record: EncryptedSecret, ruleId: string, field: AlertSecretField): string {
    return decryptSecret(record, { aad: alertSecretAad(ruleId, field) });
}
/** Fresh rule id — minted in app code so the AAD is known before the INSERT. */
export function newRuleId(): string {
    return randomUUID();
}
/** 32 bytes of entropy, hex-encoded. Shown once, then only its last 4 chars. */
export function generateWebhookSecret(): string {
    return randomBytes(32).toString('hex');
}
export function webhookSecretLast4(secret: string): string {
    return secret.slice(-4);
}
/**
 * Display-safe rendering of a Slack incoming-webhook URL: host plus the first
 * path segment, everything after it replaced by a fixed dot run. Never derived
 * from the token bytes, so the mask leaks no entropy.
 *
 * `https://hooks.slack.com/services/T01/B02/xoxb-secret`
 *   → `hooks.slack.com/services/…`
 */
export function maskSlackWebhookUrl(rawUrl: string): string {
    const url = new URL(rawUrl);
    const [firstSegment = ''] = url.pathname.split('/').filter(Boolean);
    return firstSegment === ''
        ? `${url.host}/…`
        : `${url.host}/${firstSegment}/…`;
}
/**
 * Standard-Webhooks-shaped signature over the EXACT transmitted body string.
 * The caller passes the serialized string (never the object) so no
 * re-serialization can desynchronize the signature from the bytes on the wire.
 */
export function signAlertPayload(secret: string, rawBody: string, timestampSeconds: number): string {
    const mac = createHmac('sha256', secret)
        .update(`${timestampSeconds}.${rawBody}`)
        .digest('hex');
    return `t=${timestampSeconds},v1=${mac}`;
}
