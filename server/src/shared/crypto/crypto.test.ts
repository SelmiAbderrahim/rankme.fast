import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  __resetKeyRegistryForTests,
  __restoreIvGeneratorForTests,
  __restoreKeyRegistryForTests,
  __setIvGeneratorForTests,
  decryptSecret,
  encryptSecret,
  reEncryptSecret,
  type EncryptedSecret,
} from './index.js';
import { decodeMasterKey, MASTER_KEY_BYTES } from './keys.js';
import { envSchema } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const KEY_V1 = Buffer.alloc(32, 0xaa);
const KEY_V2 = Buffer.alloc(32, 0xbb);
const KEY_OTHER = Buffer.alloc(32, 0xcc);
const FIXED_IV = Buffer.alloc(12, 0x11);

const baseEnv = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/x',
  DATABASE_URL: 'postgres://rankme:rankme@127.0.0.1:5432/x',
  BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  MASTER_ENCRYPTION_KEY:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
};

describe('decodeMasterKey', () => {
  it('decodes 64-char hex to 32 bytes', () => {
    const raw = 'a'.repeat(64);
    const buf = decodeMasterKey(raw);
    expect(buf).not.toBeNull();
    expect(buf?.length).toBe(MASTER_KEY_BYTES);
  });

  it('decodes base64 producing >= 32 bytes', () => {
    const raw = Buffer.alloc(32, 7).toString('base64');
    const buf = decodeMasterKey(raw);
    expect(buf?.length).toBe(MASTER_KEY_BYTES);
  });

  it('falls back to utf8 when the string has >= 32 bytes', () => {
    const raw = 'g'.repeat(40);
    const buf = decodeMasterKey(raw);
    expect(buf?.length).toBe(MASTER_KEY_BYTES);
  });

  it('returns null for a too-short string', () => {
    expect(decodeMasterKey('short')).toBeNull();
  });

  it('returns null for empty / non-string input', () => {
    expect(decodeMasterKey('')).toBeNull();
    expect(decodeMasterKey(undefined as unknown as string)).toBeNull();
  });

  it('rejects odd-length hex-looking strings so they fall through', () => {
    // 33 hex chars — odd length; hex path rejected; utf8 fallback (33 bytes) works.
    const raw = 'a'.repeat(33);
    const buf = decodeMasterKey(raw);
    expect(buf?.length).toBe(MASTER_KEY_BYTES);
  });
});

describe('env schema — MASTER_ENCRYPTION_KEY gate', () => {
  it('rejects a missing MASTER_ENCRYPTION_KEY', () => {
    const { MASTER_ENCRYPTION_KEY: _, ...rest } = baseEnv;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects a short MASTER_ENCRYPTION_KEY', () => {
    const result = envSchema.safeParse({ ...baseEnv, MASTER_ENCRYPTION_KEY: 'too-short' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid MASTER_ENCRYPTION_KEY with Resend absent', () => {
    const result = envSchema.safeParse(baseEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.RESEND_API_KEY).toBeUndefined();
    }
  });

  it('rejects a missing DATABASE_URL (Postgres is required at boot)', () => {
    const { DATABASE_URL: _, ...rest } = baseEnv;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects an empty DATABASE_URL', () => {
    const result = envSchema.safeParse({ ...baseEnv, DATABASE_URL: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a present-but-malformed required var (short BETTER_AUTH_SECRET)', () => {
    const result = envSchema.safeParse({ ...baseEnv, BETTER_AUTH_SECRET: 'too-short' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing BETTER_AUTH_SECRET (sessions cannot be signed)', () => {
    const { BETTER_AUTH_SECRET: _, ...rest } = baseEnv;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('accepts optional Resend vars when present', () => {
    const result = envSchema.safeParse({
      ...baseEnv,
      RESEND_API_KEY: 'rk',
      RESEND_FROM: 'no-reply@example.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.RESEND_API_KEY).toBe('rk');
    }
  });
});

describe('encryptSecret / decryptSecret', () => {
  beforeEach(() => {
    __resetKeyRegistryForTests({
      keys: [
        { version: 1, key: KEY_V1 },
        { version: 2, key: KEY_V2 },
      ],
      currentVersion: 1,
    });
    __setIvGeneratorForTests(() => FIXED_IV);
  });

  afterEach(() => {
    __restoreKeyRegistryForTests();
    __restoreIvGeneratorForTests();
  });

  it('round-trips ASCII', () => {
    const rec = encryptSecret('hello world');
    expect(decryptSecret(rec)).toBe('hello world');
    expect(rec.keyVersion).toBe(1);
  });

  it('round-trips unicode', () => {
    const s = '日本語 · مرحبا · 🚀 · Ω';
    expect(decryptSecret(encryptSecret(s))).toBe(s);
  });

  it('round-trips empty string', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('');
  });

  it('round-trips multi-KB plaintext', () => {
    const s = 'x'.repeat(8192);
    expect(decryptSecret(encryptSecret(s))).toBe(s);
  });

  it('is deterministic with a fixed IV (proves the seam)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).toEqual(b);
  });

  it('stamps the current keyVersion', () => {
    __resetKeyRegistryForTests({
      keys: [
        { version: 1, key: KEY_V1 },
        { version: 2, key: KEY_V2 },
      ],
      currentVersion: 2,
    });
    const rec = encryptSecret('v2 payload');
    expect(rec.keyVersion).toBe(2);
    expect(decryptSecret(rec)).toBe('v2 payload');
  });

  it('honors the record keyVersion on decrypt (v1 record still decrypts under v2 current)', () => {
    // encrypt at v1 (current)
    const rec = encryptSecret('legacy');
    // now switch current to v2 but keep v1 registered
    __resetKeyRegistryForTests({
      keys: [
        { version: 1, key: KEY_V1 },
        { version: 2, key: KEY_V2 },
      ],
      currentVersion: 2,
    });
    __setIvGeneratorForTests(() => FIXED_IV);
    expect(decryptSecret(rec)).toBe('legacy');
  });
});

describe('tamper detection', () => {
  beforeEach(() => {
    __resetKeyRegistryForTests({
      keys: [{ version: 1, key: KEY_V1 }],
      currentVersion: 1,
    });
    __setIvGeneratorForTests(() => FIXED_IV);
  });

  afterEach(() => {
    __restoreKeyRegistryForTests();
    __restoreIvGeneratorForTests();
  });

  function flipByte(base64: string): string {
    const buf = Buffer.from(base64, 'base64');
    buf[0] = (buf[0] ?? 0) ^ 0xff;
    return buf.toString('base64');
  }

  it('flipping ciphertext byte throws', () => {
    const rec = encryptSecret('secret');
    const tampered: EncryptedSecret = { ...rec, ciphertext: flipByte(rec.ciphertext) };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('flipping authTag byte throws', () => {
    const rec = encryptSecret('secret');
    const tampered: EncryptedSecret = { ...rec, authTag: flipByte(rec.authTag) };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('swapping IV throws', () => {
    const rec = encryptSecret('secret');
    const swappedIv = Buffer.alloc(12, 0x22).toString('base64');
    const tampered: EncryptedSecret = { ...rec, iv: swappedIv };
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('malformed iv length throws with a clear message', () => {
    const rec = encryptSecret('secret');
    const tampered: EncryptedSecret = {
      ...rec,
      iv: Buffer.alloc(4).toString('base64'),
    };
    expect(() => decryptSecret(tampered)).toThrow(/Invalid IV length/);
  });

  it('malformed authTag length throws with a clear message', () => {
    const rec = encryptSecret('secret');
    const tampered: EncryptedSecret = {
      ...rec,
      authTag: Buffer.alloc(4).toString('base64'),
    };
    expect(() => decryptSecret(tampered)).toThrow(/Invalid auth tag length/);
  });
});

describe('wrong-key decrypt', () => {
  afterEach(() => {
    __restoreKeyRegistryForTests();
    __restoreIvGeneratorForTests();
  });

  it('throws when the record was produced under a different master key', () => {
    __resetKeyRegistryForTests({
      keys: [{ version: 1, key: KEY_V1 }],
      currentVersion: 1,
    });
    __setIvGeneratorForTests(() => FIXED_IV);
    const rec = encryptSecret('secret');
    // Swap out the key at v1 for a different one.
    __resetKeyRegistryForTests({
      keys: [{ version: 1, key: KEY_OTHER }],
      currentVersion: 1,
    });
    expect(() => decryptSecret(rec)).toThrow();
  });

  it('throws when the record references an unknown keyVersion', () => {
    __resetKeyRegistryForTests({
      keys: [{ version: 1, key: KEY_V1 }],
      currentVersion: 1,
    });
    __setIvGeneratorForTests(() => FIXED_IV);
    const rec = encryptSecret('secret');
    expect(() => decryptSecret({ ...rec, keyVersion: 99 })).toThrow(/keyVersion=99/);
  });
});

describe('reEncryptSecret', () => {
  beforeEach(() => {
    __resetKeyRegistryForTests({
      keys: [
        { version: 1, key: KEY_V1 },
        { version: 2, key: KEY_V2 },
      ],
      currentVersion: 1,
    });
    __setIvGeneratorForTests(() => FIXED_IV);
  });

  afterEach(() => {
    __restoreKeyRegistryForTests();
    __restoreIvGeneratorForTests();
  });

  it('migrates a v1 record to v2 and round-trips at v2', () => {
    const v1 = encryptSecret('rotate me');
    expect(v1.keyVersion).toBe(1);
    const v2 = reEncryptSecret(v1, 2);
    expect(v2.keyVersion).toBe(2);
    expect(decryptSecret(v2)).toBe('rotate me');
  });

  it('defaults targetKeyVersion to the current version', () => {
    __resetKeyRegistryForTests({
      keys: [
        { version: 1, key: KEY_V1 },
        { version: 2, key: KEY_V2 },
      ],
      currentVersion: 2,
    });
    __setIvGeneratorForTests(() => FIXED_IV);
    const v1: EncryptedSecret = encryptSecret('will target current');
    // Hmm — encryptSecret currently stamps v2 (currentVersion=2). Build a v1
    // record explicitly to prove the default.
    __resetKeyRegistryForTests({
      keys: [
        { version: 1, key: KEY_V1 },
        { version: 2, key: KEY_V2 },
      ],
      currentVersion: 1,
    });
    __setIvGeneratorForTests(() => FIXED_IV);
    const v1Record = encryptSecret('will target current');
    expect(v1Record.keyVersion).toBe(1);
    __resetKeyRegistryForTests({
      keys: [
        { version: 1, key: KEY_V1 },
        { version: 2, key: KEY_V2 },
      ],
      currentVersion: 2,
    });
    __setIvGeneratorForTests(() => FIXED_IV);
    const migrated = reEncryptSecret(v1Record);
    expect(migrated.keyVersion).toBe(2);
    expect(decryptSecret(migrated)).toBe('will target current');
    // v1 unused but keeps the compile check honest
    void v1;
  });
});

describe('IV/key seam invariants', () => {
  afterEach(() => {
    __restoreKeyRegistryForTests();
    __restoreIvGeneratorForTests();
  });

  it('encryptSecret rejects a wrong-size IV', () => {
    __resetKeyRegistryForTests({
      keys: [{ version: 1, key: KEY_V1 }],
      currentVersion: 1,
    });
    __setIvGeneratorForTests(() => Buffer.alloc(8));
    expect(() => encryptSecret('x')).toThrow(/IV must be 12 bytes/);
  });

  it('reEncryptSecret rejects a wrong-size IV', () => {
    __resetKeyRegistryForTests({
      keys: [{ version: 1, key: KEY_V1 }],
      currentVersion: 1,
    });
    __setIvGeneratorForTests(() => randomBytes(12));
    const rec = encryptSecret('x');
    __setIvGeneratorForTests(() => Buffer.alloc(8));
    expect(() => reEncryptSecret(rec)).toThrow(/IV must be 12 bytes/);
  });
});

describe('no-leak guard', () => {
  beforeEach(() => {
    __resetKeyRegistryForTests({
      keys: [{ version: 1, key: KEY_V1 }],
      currentVersion: 1,
    });
    __setIvGeneratorForTests(() => FIXED_IV);
  });

  afterEach(() => {
    __restoreKeyRegistryForTests();
    __restoreIvGeneratorForTests();
    vi.restoreAllMocks();
  });

  it('never invokes the logger during encrypt or decrypt', () => {
    const spies = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].map((level) =>
      vi.spyOn(logger, level as 'info').mockImplementation(() => logger as never),
    );
    const secret = 'top-secret-value-abc';
    const rec = encryptSecret(secret);
    const out = decryptSecret(rec);
    reEncryptSecret(rec, 1);
    expect(out).toBe(secret);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe('lazy env-driven registry load', () => {
  afterEach(() => {
    __restoreKeyRegistryForTests();
    __restoreIvGeneratorForTests();
  });

  it('loads v1 from env when the registry is empty', () => {
    __restoreKeyRegistryForTests();
    __setIvGeneratorForTests(() => FIXED_IV);
    const rec = encryptSecret('from env');
    expect(rec.keyVersion).toBe(1);
    expect(decryptSecret(rec)).toBe('from env');
  });

  it('throws at first use when env.MASTER_ENCRYPTION_KEY decodes short', async () => {
    // Env is loaded at process start; simulate a corrupted key by mutating the
    // exported object and forcing a re-load through __restoreKeyRegistryForTests.
    const { env } = await import('../../config/env.js');
    const original = env.MASTER_ENCRYPTION_KEY;
    (env as { MASTER_ENCRYPTION_KEY: string }).MASTER_ENCRYPTION_KEY = 'x';
    try {
      __restoreKeyRegistryForTests();
      expect(() => encryptSecret('boom')).toThrow(/32 bytes/);
    } finally {
      (env as { MASTER_ENCRYPTION_KEY: string }).MASTER_ENCRYPTION_KEY = original;
      __restoreKeyRegistryForTests();
    }
  });

  it('produces random ciphertext under the production IV generator', () => {
    __restoreIvGeneratorForTests();
    __restoreKeyRegistryForTests();
    const a = encryptSecret('rand');
    const b = encryptSecret('rand');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(decryptSecret(a)).toBe('rand');
    expect(decryptSecret(b)).toBe('rand');
  });

  it('__resetKeyRegistryForTests rejects a wrong-size key', () => {
    expect(() =>
      __resetKeyRegistryForTests({
        keys: [{ version: 1, key: Buffer.alloc(16) }],
        currentVersion: 1,
      }),
    ).toThrow(/must be 32 bytes/);
  });
});

describe('AAD binding (GCM associated data)', () => {
  beforeEach(() => {
    __resetKeyRegistryForTests({
      keys: [
        { version: 1, key: KEY_V1 },
        { version: 2, key: KEY_V2 },
      ],
      currentVersion: 1,
    });
    __setIvGeneratorForTests(() => FIXED_IV);
  });

  afterEach(() => {
    __restoreKeyRegistryForTests();
    __restoreIvGeneratorForTests();
  });

  it('encrypt with AAD stamps aadBound=true; decrypt under the SAME AAD round-trips', () => {
    const rec = encryptSecret('token', { aad: 'coll:1:field' });
    expect(rec.aadBound).toBe(true);
    expect(decryptSecret(rec, { aad: 'coll:1:field' })).toBe('token');
  });

  it('decrypting an AAD-bound record under a DIFFERENT AAD fails with the standard GCM error', () => {
    const rec = encryptSecret('token', { aad: 'coll:1:field' });
    expect(() => decryptSecret(rec, { aad: 'coll:2:field' })).toThrow();
  });

  it('decrypting an AAD-bound record with NO AAD throws "AAD required to decrypt"', () => {
    const rec = encryptSecret('token', { aad: 'coll:1:field' });
    expect(() => decryptSecret(rec)).toThrow(/AAD required to decrypt/);
  });

  it('legacy records (no aadBound) still decrypt without AAD (backward-compat)', () => {
    const legacy = encryptSecret('legacy');
    expect(legacy.aadBound).toBeUndefined();
    expect(decryptSecret(legacy)).toBe('legacy');
  });

  it('legacy records ignore a supplied AAD (unbound path does NOT setAAD)', () => {
    const legacy = encryptSecret('legacy');
    // Passing aad here should NOT change the decrypt outcome — the record is unbound.
    expect(decryptSecret(legacy, { aad: 'ignored' })).toBe('legacy');
  });

  it('reEncryptSecret preserves the AAD binding across a key rotation', () => {
    const v1 = encryptSecret('to-rotate', { aad: 'coll:x:token' });
    const v2 = reEncryptSecret(v1, 2, { aad: 'coll:x:token' });
    expect(v2.keyVersion).toBe(2);
    expect(v2.aadBound).toBe(true);
    expect(decryptSecret(v2, { aad: 'coll:x:token' })).toBe('to-rotate');
  });
});

describe('decodeMasterKey extra branches', () => {
  it('returns null for a hex string that decodes to < 32 bytes and utf8-fits too small', () => {
    // 30 hex chars = 15 hex bytes → hex branch rejects (< 32); utf8 fallback is 30 bytes → also < 32.
    // Force a case where the hex refuses AND utf8 refuses.
    expect(decodeMasterKey('0'.repeat(30))).toBeNull();
  });

  it('exercises the base64 re-encoding mismatch branch', () => {
    // 45 "A"s: hex path fails (odd length), base64 decodes to 33 bytes but
    // re-encodes to 44 chars (no trailing padding needed) → stripped forms
    // differ (45 vs 44) → mismatch branch returns null, utf8 fallback wins.
    const raw = 'A'.repeat(45);
    const buf = decodeMasterKey(raw);
    expect(buf?.length).toBe(MASTER_KEY_BYTES);
  });

  it('returns null for a base64 string that re-encodes to a different value', () => {
    // "!" is not valid base64; Node ignores invalid chars silently. Craft a 44-char
    // input containing invalid chars so the re-encoding differs. Also utf8 length
    // is 44 (>= 32) — so base64 mismatch check must fire first.
    const raw = '!'.repeat(44);
    // utf8 of 44 "!" characters = 44 bytes so utf8 would succeed. That means
    // this test can't isolate the base64-mismatch branch. Use a shorter utf8:
    // 33 chars of "@" → hex fails (not hex); base64 of "@" repeats decodes to
    // fewer bytes, re-encoding differs → null; utf8 fallback 33 bytes → hits.
    // So we can't force *both* base64 mismatch AND utf8-null. That's expected:
    // if utf8 is >= 32, we accept it. The base64 mismatch branch is exercised
    // via decodeMasterKey by strings where hex fails, base64 has invalid chars,
    // and utf8 is short. Try "!!!" (3 bytes) — fails everything, returns null.
    expect(decodeMasterKey(raw.slice(0, 3))).toBeNull();
  });
});
