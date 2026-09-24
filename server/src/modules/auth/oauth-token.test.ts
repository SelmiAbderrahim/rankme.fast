import { symmetricEncrypt } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import {
  ensureStoredOAuthTokenEncrypted,
  hardenOAuthAccountMutation,
  looksLikeBetterAuthOAuthCiphertext,
  OAuthTokenDecryptionError,
  resolveStoredOAuthToken,
} from './oauth-token.js';

describe('Better Auth OAuth token storage compatibility', () => {
  it('decrypts the installed Better Auth single-secret ciphertext format', async () => {
    const ciphertext = await symmetricEncrypt({
      key: env.BETTER_AUTH_SECRET,
      data: 'google-refresh-secret',
    });

    expect(ciphertext).toMatch(/^[0-9a-f]+$/i);
    expect(ciphertext).not.toContain('google-refresh-secret');
    await expect(resolveStoredOAuthToken(ciphertext)).resolves.toBe(
      'google-refresh-secret',
    );
  });

  it('passes legacy plaintext through without persisting a decrypted rewrite', async () => {
    await expect(resolveStoredOAuthToken('legacy-google-token')).resolves.toBe(
      'legacy-google-token',
    );
  });

  it('encrypts plaintext once and authenticates existing ciphertext byte-for-byte', async () => {
    const encrypted = await ensureStoredOAuthTokenEncrypted('direct-link-access-token');
    expect(encrypted).not.toBe('direct-link-access-token');
    expect(encrypted && looksLikeBetterAuthOAuthCiphertext(encrypted)).toBe(true);
    await expect(resolveStoredOAuthToken(encrypted)).resolves.toBe(
      'direct-link-access-token',
    );
    await expect(ensureStoredOAuthTokenEncrypted(encrypted)).resolves.toBe(encrypted);
  });

  it('hardens account writes and never retains ID tokens', async () => {
    const existing = await symmetricEncrypt({
      key: env.BETTER_AUTH_SECRET,
      data: 'existing-refresh-token',
    });
    const created = await hardenOAuthAccountMutation({
      accessToken: 'direct-access-token',
      refreshToken: existing,
      idToken: 'jwt-must-not-be-retained',
      scope: 'openid',
    });
    expect(created.data.idToken).toBeNull();
    expect(created.data.refreshToken).toBe(existing);
    expect(created.data.accessToken).not.toBe('direct-access-token');
    await expect(resolveStoredOAuthToken(created.data.accessToken)).resolves.toBe(
      'direct-access-token',
    );

    const touchedLegacyRow = await hardenOAuthAccountMutation({ scope: 'openid email' });
    expect(touchedLegacyRow.data).toEqual({ idToken: null });
  });

  it.each([null, undefined, ''] as const)(
    'normalizes an absent token (%s) to null',
    async (value) => {
      await expect(resolveStoredOAuthToken(value)).resolves.toBeNull();
    },
  );

  it.each(['00', '$ba$1$not-hex'])(
    'fails closed without echoing malformed ciphertext: %s',
    async (ciphertext) => {
      let caught: unknown;
      try {
        await resolveStoredOAuthToken(ciphertext);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(OAuthTokenDecryptionError);
      expect((caught as Error).message).not.toContain(ciphertext);
      await expect(ensureStoredOAuthTokenEncrypted(ciphertext)).rejects.toThrow(
        OAuthTokenDecryptionError,
      );
    },
  );
});
