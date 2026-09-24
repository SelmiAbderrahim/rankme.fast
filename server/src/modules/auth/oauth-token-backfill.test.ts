import { symmetricEncrypt } from 'better-auth/crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { account, user } from '../../db/schema/auth.js';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  backfillStoredOAuthTokens,
  OAuthTokenDecryptionError,
  resolveStoredOAuthToken,
} from './oauth-token.js';

async function seedUser(id: string, email: string): Promise<void> {
  await getTestDb().insert(user).values({
    id,
    name: 'OAuth Backfill',
    email,
    emailVerified: true,
  });
}

describe('Better Auth OAuth token startup backfill', () => {
  beforeAll(async () => {
    await startTestPostgres();
  });

  afterAll(async () => {
    await stopTestPostgres();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  it('encrypts legacy bearer credentials, erases ID tokens, and is idempotent', async () => {
    await seedUser('oauth-backfill-user', 'oauth-backfill@example.com');
    const existingCiphertext = await symmetricEncrypt({
      key: env.BETTER_AUTH_SECRET,
      data: 'already-encrypted-access',
    });
    await getTestDb().insert(account).values([
      {
        id: 'a-legacy-google',
        accountId: 'google-legacy',
        providerId: 'google',
        userId: 'oauth-backfill-user',
        accessToken: 'legacy-access-value',
        refreshToken: 'legacy-refresh-value',
        idToken: 'legacy-id-jwt',
      },
      {
        id: 'b-encrypted-google',
        accountId: 'google-encrypted',
        providerId: 'google',
        userId: 'oauth-backfill-user',
        accessToken: existingCiphertext,
      },
      {
        id: 'c-credential',
        accountId: 'oauth-backfill-user',
        providerId: 'credential',
        userId: 'oauth-backfill-user',
        password: 'password-hash-is-better-auth-owned',
        idToken: 'defensive-credential-sentinel',
      },
    ]);

    await expect(backfillStoredOAuthTokens(getTestDb())).resolves.toEqual({
      scannedRows: 2,
      changedRows: 1,
      encryptedTokens: 2,
      clearedIdTokens: 1,
    });

    const rows = await getTestDb().select().from(account).orderBy(asc(account.id));
    expect(rows[0]?.accessToken).not.toBe('legacy-access-value');
    expect(rows[0]?.refreshToken).not.toBe('legacy-refresh-value');
    expect(rows[0]?.idToken).toBeNull();
    await expect(resolveStoredOAuthToken(rows[0]?.accessToken)).resolves.toBe(
      'legacy-access-value',
    );
    await expect(resolveStoredOAuthToken(rows[0]?.refreshToken)).resolves.toBe(
      'legacy-refresh-value',
    );
    expect(rows[1]?.accessToken).toBe(existingCiphertext);
    expect(rows[2]?.idToken).toBe('defensive-credential-sentinel');

    await expect(backfillStoredOAuthTokens(getTestDb())).resolves.toEqual({
      scannedRows: 2,
      changedRows: 0,
      encryptedTokens: 0,
      clearedIdTokens: 0,
    });
  });

  it('rolls the entire pass back when encrypted-looking data is malformed', async () => {
    await seedUser('oauth-malformed-user', 'oauth-malformed@example.com');
    await getTestDb().insert(account).values([
      {
        id: 'a-would-change',
        accountId: 'google-would-change',
        providerId: 'google',
        userId: 'oauth-malformed-user',
        accessToken: 'plaintext-before-malformed-row',
        idToken: 'id-before-malformed-row',
      },
      {
        id: 'b-malformed',
        accountId: 'google-malformed',
        providerId: 'google',
        userId: 'oauth-malformed-user',
        refreshToken: '00',
      },
    ]);

    await expect(backfillStoredOAuthTokens(getTestDb())).rejects.toThrow(
      OAuthTokenDecryptionError,
    );
    const [unchanged] = await getTestDb()
      .select()
      .from(account)
      .where(eq(account.id, 'a-would-change'));
    expect(unchanged?.accessToken).toBe('plaintext-before-malformed-row');
    expect(unchanged?.idToken).toBe('id-before-malformed-row');
  });
});
