import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { __resetKeyRegistryForTests, __restoreKeyRegistryForTests, getCurrentKeyVersion, getKey, } from './keyRegistry.js';
/**
 * Envelope for a secret encrypted at rest.
 *
 * All byte fields are base64-encoded so the record is safely embeddable inside
 * a Mongoose sub-schema without extra encoding gymnastics. The record shape is
 * frozen — downstream consumers (billing, GSC connections) will `InferSchemaType` off
 * a Mongoose sub-schema whose fields mirror these exact names & types.
 *
 * `aadBound` (optional) — when true, the record was produced with an
 * Additional Authenticated Data string bound to it via GCM AAD; decryption
 * MUST supply the same string. Legacy records (no `aadBound`) predate the
 * binding and decrypt without AAD; this backward-compatibility branch is
 * mandatory — dropping it would orphan every existing envelope.
 */
export interface EncryptedSecret {
    ciphertext: string;
    iv: string;
    authTag: string;
    keyVersion: number;
    aadBound?: boolean;
}
/**
 * Optional AAD context string bound to the ciphertext via GCM AAD. The
 * convention is `"<collection>:<recordId>:<field>"` so a rogue swap that
 * moves a valid ciphertext into a different record/field fails GCM
 * verification, not just an application-level check.
 */
export interface CryptoAadOptions {
    aad?: string;
}
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const defaultIvGenerator = (): Buffer => randomBytes(IV_BYTES);
let ivGenerator: () => Buffer = defaultIvGenerator;
export function encryptSecret(plaintext: string, opts: CryptoAadOptions = {}): EncryptedSecret {
    const keyVersion = getCurrentKeyVersion();
    const key = getKey(keyVersion);
    const iv = ivGenerator();
    if (iv.length !== IV_BYTES) {
        throw new Error(`IV must be ${IV_BYTES} bytes`);
    }
    const cipher = createCipheriv(ALGO, key, iv);
    if (opts.aad !== undefined) {
        cipher.setAAD(Buffer.from(opts.aad, 'utf8'));
    }
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const record: EncryptedSecret = {
        ciphertext: ct.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        keyVersion,
    };
    if (opts.aad !== undefined) {
        record.aadBound = true;
    }
    return record;
}
export function decryptSecret(record: EncryptedSecret, opts: CryptoAadOptions = {}): string {
    const key = getKey(record.keyVersion);
    const iv = Buffer.from(record.iv, 'base64');
    const authTag = Buffer.from(record.authTag, 'base64');
    const ct = Buffer.from(record.ciphertext, 'base64');
    if (iv.length !== IV_BYTES) {
        throw new Error(`Invalid IV length (expected ${IV_BYTES} bytes)`);
    }
    if (authTag.length !== AUTH_TAG_BYTES) {
        throw new Error(`Invalid auth tag length (expected ${AUTH_TAG_BYTES} bytes)`);
    }
    if (record.aadBound && opts.aad === undefined) {
        throw new Error('AAD required to decrypt this record');
    }
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    if (record.aadBound) {
        // opts.aad is defined here (guard above). A wrong AAD surfaces as
        // the standard GCM auth failure from decipher.final().
        decipher.setAAD(Buffer.from(opts.aad as string, 'utf8'));
    }
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
}
/**
 * Building block for the master-key rotation runbook: decrypt with the record's
 * stored `keyVersion`, then re-encrypt under `targetKeyVersion`. Callers perform
 * the atomic swap of the DB document containing the record.
 *
 * When the record was AAD-bound, the same AAD MUST be threaded through both
 * halves — the caller passes `opts.aad` and the re-encrypted record stays
 * bound to the same context.
 */
export function reEncryptSecret(record: EncryptedSecret, targetKeyVersion?: number, opts: CryptoAadOptions = {}): EncryptedSecret {
    const plaintext = decryptSecret(record, opts);
    const target = targetKeyVersion ?? getCurrentKeyVersion();
    const key = getKey(target);
    const iv = ivGenerator();
    if (iv.length !== IV_BYTES) {
        throw new Error(`IV must be ${IV_BYTES} bytes`);
    }
    const cipher = createCipheriv(ALGO, key, iv);
    if (opts.aad !== undefined) {
        cipher.setAAD(Buffer.from(opts.aad, 'utf8'));
    }
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const next: EncryptedSecret = {
        ciphertext: ct.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        keyVersion: target,
    };
    if (opts.aad !== undefined) {
        next.aadBound = true;
    }
    return next;
}
/** Test-only: inject a deterministic IV generator for round-trip assertions. */
export function __setIvGeneratorForTests(fn: () => Buffer): void {
    ivGenerator = fn;
}
/** Test-only: restore the production random IV generator. */
export function __restoreIvGeneratorForTests(): void {
    ivGenerator = defaultIvGenerator;
}
export { __resetKeyRegistryForTests, __restoreKeyRegistryForTests };
