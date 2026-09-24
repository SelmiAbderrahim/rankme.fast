/**
 * Master-key decoder shared by the env schema refinement and the crypto helper.
 *
 * A MASTER_ENCRYPTION_KEY is accepted in three encodings, tried in order:
 *   1. hex   — even-length string of [0-9a-fA-F]; decoded via `Buffer.from(s, 'hex')`
 *   2. base64 — decoded via `Buffer.from(s, 'base64')` and only accepted if the
 *      round-trip re-encoding equals the input (rejects loose base64 input)
 *   3. utf8  — raw bytes of the string
 *
 * Whichever encoding first yields ≥ 32 bytes wins. The AES-256 key is the
 * first 32 bytes of the decoded buffer. Anything shorter returns `null`.
 *
 * Pure function — no env, no logging, no side effects. Never accepts / returns
 * a secret over any wire — the raw key exists only in memory as a Buffer.
 */
export const MASTER_KEY_BYTES = 32;
const HEX_RE = /^[0-9a-fA-F]+$/;
function tryHex(raw: string): Buffer | null {
    if (raw.length % 2 !== 0)
        return null;
    if (!HEX_RE.test(raw))
        return null;
    const buf = Buffer.from(raw, 'hex');
    return buf.length >= MASTER_KEY_BYTES ? buf : null;
}
function tryBase64(raw: string): Buffer | null {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length < MASTER_KEY_BYTES)
        return null;
    const reencoded = buf.toString('base64');
    const normalized = raw.replace(/=+$/, '');
    const normalizedRe = reencoded.replace(/=+$/, '');
    if (normalized !== normalizedRe)
        return null;
    return buf;
}
function tryUtf8(raw: string): Buffer | null {
    const buf = Buffer.from(raw, 'utf8');
    return buf.length >= MASTER_KEY_BYTES ? buf : null;
}
export function decodeMasterKey(raw: string): Buffer | null {
    if (typeof raw !== 'string' || raw.length === 0)
        return null;
    const buf = tryHex(raw) ?? tryBase64(raw) ?? tryUtf8(raw);
    if (!buf)
        return null;
    return buf.subarray(0, MASTER_KEY_BYTES);
}
