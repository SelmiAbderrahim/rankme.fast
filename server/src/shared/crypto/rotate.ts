import { reEncryptSecret, type EncryptedSecret } from './index.js';
import { getCurrentKeyVersion } from './keyRegistry.js';
export interface RotationTarget {
    id: string;
    record: EncryptedSecret;
    /**
     * AAD context string for AAD-bound records. Stores that produce records
     * with `encryptSecret(plaintext, { aad })` MUST supply the same string here
     * so `reEncryptSecret` can decrypt and re-encrypt under the same binding.
     * Legacy (unbound) records leave this undefined.
     */
    aad?: string;
}
export interface RotationStore {
    list(): Promise<RotationTarget[]>;
    swap(id: string, next: EncryptedSecret): Promise<void>;
}
export interface RotationResult {
    targetKeyVersion: number;
    rotated: number;
    skipped: number;
    failedAt?: string;
}
/**
 * Master-key rotation orchestrator.
 *
 * All-or-nothing per store: iterate every ciphertext under the store,
 * `decrypt-with-old → re-encrypt-at-new → swap`. If any single swap throws,
 * the orchestrator stops and reports `failedAt`; callers roll back by
 * *not* bumping `currentKeyVersion` in the registry — every un-swapped
 * record still decrypts under the old key, and every already-swapped record
 * decrypts under the new key that is still registered.
 *
 * Rotation NEVER logs or returns plaintext. On failure, the operator inspects
 * `failedAt`, resolves the underlying error, and re-runs; the re-run is
 * idempotent because THIS orchestrator short-circuits any target whose
 * `record.keyVersion` already equals `targetKeyVersion` (`skipped += 1`
 * below). `reEncryptSecret` itself does NOT short-circuit — it always
 * decrypts and re-encrypts, so the check must live here.
 */
export async function rotateStore(store: RotationStore, targetKeyVersion: number = getCurrentKeyVersion()): Promise<RotationResult> {
    const targets = await store.list();
    let rotated = 0;
    let skipped = 0;
    for (const target of targets) {
        if (target.record.keyVersion === targetKeyVersion) {
            skipped += 1;
            continue;
        }
        try {
            const next = reEncryptSecret(target.record, targetKeyVersion, target.aad !== undefined ? { aad: target.aad } : {});
            await store.swap(target.id, next);
            rotated += 1;
        }
        catch {
            return {
                targetKeyVersion,
                rotated,
                skipped,
                failedAt: target.id,
            };
        }
    }
    return { targetKeyVersion, rotated, skipped };
}
