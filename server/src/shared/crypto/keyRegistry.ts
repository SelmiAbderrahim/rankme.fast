import { env } from '../../config/env.js';
import { decodeMasterKey, MASTER_KEY_BYTES } from './keys.js';
/**
 * In-memory registry of `keyVersion → 32-byte key`.
 *
 * Rotation model:
 *   - `keyVersion 1` is derived from `env.MASTER_ENCRYPTION_KEY`.
 *   - To rotate, a future prompt will introduce `MASTER_ENCRYPTION_KEY_V2` (etc.)
 *     and register it at a higher version, keeping the old version available so
 *     `reEncryptSecret` can decrypt-with-old → re-encrypt-at-new → atomic swap.
 *
 * The registry NEVER logs, serializes, or exposes keys. Test seams exist only
 * to inject deterministic material — production paths lazily derive from env.
 */
const registry = new Map<number, Buffer>();
let currentKeyVersion = 1;
let loaded = false;
function loadFromEnv(): void {
    if (loaded)
        return;
    const key = decodeMasterKey(env.MASTER_ENCRYPTION_KEY);
    if (!key || key.length !== MASTER_KEY_BYTES) {
        throw new Error('MASTER_ENCRYPTION_KEY missing or decodes to fewer than 32 bytes');
    }
    registry.set(1, key);
    loaded = true;
}
export function getCurrentKeyVersion(): number {
    loadFromEnv();
    return currentKeyVersion;
}
export function getKey(keyVersion: number): Buffer {
    loadFromEnv();
    const key = registry.get(keyVersion);
    if (!key) {
        throw new Error(`No key registered for keyVersion=${keyVersion}`);
    }
    return key;
}
/**
 * Runtime: bump the rotation head. Called by the rotation orchestrator once
 * the operator has provisioned a new `MASTER_ENCRYPTION_KEY_V<n>` env slot
 * and the runbook has verified the ciphertext-swap is atomic-ready.
 *
 * Existing versions remain readable — never evicted — so `reEncryptSecret`
 * can `decrypt-with-old → re-encrypt-at-new`.
 */
export function registerKey(version: number, keyMaterial: Buffer): void {
    loadFromEnv();
    if (keyMaterial.length !== MASTER_KEY_BYTES) {
        throw new Error(`Key at version=${version} must be ${MASTER_KEY_BYTES} bytes`);
    }
    registry.set(version, keyMaterial);
}
export function setCurrentKeyVersion(version: number): void {
    if (!registry.has(version)) {
        throw new Error(`Cannot set current keyVersion=${version}: not registered`);
    }
    currentKeyVersion = version;
}
/**
 * Test-only: replace the registry so ciphertext is deterministic in unit tests.
 * Production code MUST NOT call this — it exists solely for the vitest suite.
 */
export function __resetKeyRegistryForTests(entries: {
    keys: Array<{
        version: number;
        key: Buffer;
    }>;
    currentVersion: number;
}): void {
    registry.clear();
    for (const { version, key } of entries.keys) {
        if (key.length !== MASTER_KEY_BYTES) {
            throw new Error(`Test key at version=${version} must be ${MASTER_KEY_BYTES} bytes`);
        }
        registry.set(version, key);
    }
    currentKeyVersion = entries.currentVersion;
    loaded = true;
}
/** Test-only: restore lazy env-driven loading. */
export function __restoreKeyRegistryForTests(): void {
    registry.clear();
    currentKeyVersion = 1;
    loaded = false;
}
