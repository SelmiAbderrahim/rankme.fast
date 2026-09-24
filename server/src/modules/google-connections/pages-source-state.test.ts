import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearCollections, startMemoryMongo, stopMemoryMongo } from '../../shared/testing/mongo.js';
import { GoogleConnection } from './google-connection.model.js';
import { Site } from '../sites/index.js';
import {
  hashStoredGscProperty,
  resolveStoredPagesGscState,
  storedGscPropertyCoversSite,
} from './pages-source-state.js';

const ACCOUNT = '507f1f77bcf86cd799439011';
const SITE = '507f1f77bcf86cd799439012';

beforeAll(startMemoryMongo);
afterAll(stopMemoryMongo);
beforeEach(clearCollections);

async function connection(status: 'connected' | 'needs_reconnect' | 'revoked', propertyUrl: string | null) {
  await Site.findOneAndUpdate(
    { _id: SITE },
    {
      $set: {
        accountId: ACCOUNT,
        url: 'https://example.com/',
        domain: 'example.com',
        gscPropertyUrl: propertyUrl,
        gscBindingGenerationId: propertyUrl ? 'legacy' : null,
      },
    },
    { upsert: true },
  );
  await GoogleConnection.create({
    accountId: ACCOUNT,
    googleAccountEmail: 'owner@example.com',
    encryptedRefreshToken: { ciphertext: 'x', iv: 'x', authTag: 'x', keyVersion: 1 },
    scopes: [],
    status,
    propertyUrl,
    connectedAt: new Date(),
  });
}

describe('stored Pages GSC state', () => {
  it.each([
    ['sc-domain:example.com', 'https://example.com/', true],
    ['sc-domain:example.com', 'https://blog.example.com/', true],
    ['sc-domain:example.com', 'https://example.com.evil.test/', false],
    ['https://example.com/', 'https://example.com/path', true],
    ['https://example.com/', 'https://example.com/', true],
    ['https://example.com/blog/', 'https://example.com/blog/post', true],
    ['https://example.com/blog/', 'https://example.com/blogger', false],
    ['http://example.com/', 'https://example.com/', false],
    ['http://example.com/', 'http://example.com/path', true],
    ['https://example.com:8443/', 'https://example.com/', false],
    ['https://example.com', 'https://example.com:443/path', true],
    ['https://example.com/path?view=', 'https://example.com/path?view=all', true],
    ['not-a-property', 'https://example.com/', false],
    ['sc-domain:', 'https://example.com/', false],
    ['sc-domain:example.com.', 'not a url', false],
  ])('matches %s against %s without network access', (property, site, expected) => {
    expect(storedGscPropertyCoversSite(property, site)).toBe(expected);
  });

  it('returns exact fallback reasons and only marks connected matching properties usable', async () => {
    expect(await resolveStoredPagesGscState(ACCOUNT, SITE, 'https://example.com/')).toEqual({ usable: false, propertyUrl: null, propertyUrlHash: null, bindingGenerationId: null, fallbackReason: 'gsc_not_connected' });
    await connection('needs_reconnect', 'sc-domain:example.com');
    expect(await resolveStoredPagesGscState(ACCOUNT, SITE, 'https://example.com/')).toMatchObject({ usable: false, fallbackReason: 'gsc_needs_reconnect', propertyUrlHash: hashStoredGscProperty('sc-domain:example.com') });
    await GoogleConnection.deleteMany({});
    await connection('needs_reconnect', null);
    expect(await resolveStoredPagesGscState(ACCOUNT, SITE, 'https://example.com/')).toMatchObject({ usable: false, fallbackReason: 'gsc_needs_reconnect', propertyUrlHash: null });
    await GoogleConnection.deleteMany({});
    await connection('revoked', 'sc-domain:example.com');
    expect(await resolveStoredPagesGscState(ACCOUNT, SITE, 'https://example.com/')).toMatchObject({ usable: false, fallbackReason: 'gsc_revoked', propertyUrlHash: hashStoredGscProperty('sc-domain:example.com') });
    await GoogleConnection.deleteMany({});
    await connection('revoked', null);
    expect(await resolveStoredPagesGscState(ACCOUNT, SITE, 'https://example.com/')).toMatchObject({ usable: false, fallbackReason: 'gsc_revoked', propertyUrlHash: null });
    await GoogleConnection.deleteMany({});
    await connection('connected', 'https://other.test/');
    expect(await resolveStoredPagesGscState(ACCOUNT, SITE, 'https://example.com/')).toMatchObject({ usable: false, fallbackReason: 'gsc_property_unmatched' });
    await GoogleConnection.deleteMany({});
    await connection('connected', null);
    expect(await resolveStoredPagesGscState(ACCOUNT, SITE, 'https://example.com/')).toMatchObject({ usable: false, fallbackReason: 'gsc_property_unmatched', propertyUrlHash: null });
    await GoogleConnection.deleteMany({});
    await connection('connected', 'sc-domain:example.com');
    expect(await resolveStoredPagesGscState(ACCOUNT, SITE, 'https://example.com/')).toMatchObject({ usable: true, fallbackReason: null });
  });

  it('uses the legacy generation for every state when old Site rows have no generation id', async () => {
    for (const [status, propertyUrl, fallbackReason] of [
      ['needs_reconnect', 'sc-domain:example.com', 'gsc_needs_reconnect'],
      ['revoked', 'sc-domain:example.com', 'gsc_revoked'],
      ['connected', 'https://other.test/', 'gsc_property_unmatched'],
      ['connected', 'sc-domain:example.com', null],
    ] as const) {
      await GoogleConnection.deleteMany({});
      await connection(status, propertyUrl);
      await Site.updateOne({ _id: SITE }, { $unset: { gscBindingGenerationId: 1 } });
      await expect(resolveStoredPagesGscState(ACCOUNT, SITE, 'https://example.com/'))
        .resolves.toMatchObject({ bindingGenerationId: 'legacy', fallbackReason });
    }
  });
});
