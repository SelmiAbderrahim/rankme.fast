import { describe, expect, it, afterEach } from 'vitest';
import { encryptSecret, decryptSecret, type EncryptedSecret } from './index.js';
import { rotateStore, type RotationTarget, type RotationStore } from './rotate.js';
import {
  __resetKeyRegistryForTests,
  __restoreKeyRegistryForTests,
  getCurrentKeyVersion,
  getKey,
  registerKey,
  setCurrentKeyVersion,
} from './keyRegistry.js';

const KEY_V1 = Buffer.alloc(32, 1);
const KEY_V2 = Buffer.alloc(32, 2);

afterEach(() => __restoreKeyRegistryForTests());

function seedTwoKeys(): void {
  __resetKeyRegistryForTests({
    keys: [
      { version: 1, key: KEY_V1 },
      { version: 2, key: KEY_V2 },
    ],
    currentVersion: 1,
  });
}

describe('rotateStore', () => {
  it('re-encrypts every record under the target key and reports counts', async () => {
    seedTwoKeys();
    const raw = [encryptSecret('alpha'), encryptSecret('beta')];
    const swapped: Record<string, EncryptedSecret> = {};
    const store: RotationStore = {
      list: async () => raw.map((r, i): RotationTarget => ({ id: String(i), record: r })),
      swap: async (id, next) => {
        swapped[id] = next;
      },
    };
    const result = await rotateStore(store, 2);
    expect(result.rotated).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failedAt).toBeUndefined();
    const zero = swapped['0'];
    const one = swapped['1'];
    if (!zero || !one) throw new Error('records missing after rotation');
    expect(zero.keyVersion).toBe(2);
    expect(one.keyVersion).toBe(2);
    // Round-trip: rotated ciphertext still decrypts to the original plaintext.
    expect(decryptSecret(zero)).toBe('alpha');
    expect(decryptSecret(one)).toBe('beta');
  });

  it('skips records already at the target key', async () => {
    seedTwoKeys();
    const store: RotationStore = {
      list: async () => [
        { id: 'a', record: { ...encryptSecret('x'), keyVersion: 2 } },
      ],
      swap: async () => {
        throw new Error('should not swap');
      },
    };
    const result = await rotateStore(store, 2);
    expect(result.rotated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('registers keys and moves the current version, rejecting bad input', () => {
    __resetKeyRegistryForTests({ keys: [{ version: 1, key: KEY_V1 }], currentVersion: 1 });
    expect(getCurrentKeyVersion()).toBe(1);
    expect(getKey(1).equals(KEY_V1)).toBe(true);
    expect(() => getKey(9)).toThrow(/No key registered/);

    expect(() => registerKey(2, Buffer.alloc(4))).toThrow(/must be/);
    registerKey(2, KEY_V2);
    expect(() => setCurrentKeyVersion(3)).toThrow(/not registered/);
    setCurrentKeyVersion(2);
    expect(getCurrentKeyVersion()).toBe(2);
  });

  it('rotates AAD-bound targets when the target carries an `aad` string', async () => {
    seedTwoKeys();
    const bound = encryptSecret('bound', { aad: 'coll:1:token' });
    const swapped: Record<string, EncryptedSecret> = {};
    const store: RotationStore = {
      list: async () => [{ id: 'a', record: bound, aad: 'coll:1:token' }],
      swap: async (id, next) => {
        swapped[id] = next;
      },
    };
    const result = await rotateStore(store, 2);
    expect(result.rotated).toBe(1);
    const rotated = swapped['a']!;
    expect(rotated.aadBound).toBe(true);
    expect(decryptSecret(rotated, { aad: 'coll:1:token' })).toBe('bound');
  });

  it('stops on the first failure and reports failedAt (rollback signal)', async () => {
    seedTwoKeys();
    const targets = [
      { id: 'good', record: encryptSecret('one') },
      { id: 'bad', record: encryptSecret('two') },
    ];
    const store: RotationStore = {
      list: async () => targets,
      swap: async (id) => {
        if (id === 'bad') throw new Error('db down');
      },
    };
    const result = await rotateStore(store, 2);
    expect(result.rotated).toBe(1);
    expect(result.failedAt).toBe('bad');
  });
});
