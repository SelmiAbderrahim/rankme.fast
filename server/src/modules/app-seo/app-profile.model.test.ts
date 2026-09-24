import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AppProfile } from './app-profile.model.js';
import {
  APP_STORE_ID_REGEX,
  PLAY_PACKAGE_ID_REGEX,
  registerAppProfileBodySchema,
} from './app-seo.schema.js';

const accountId = new mongoose.Types.ObjectId();
const siteId = new mongoose.Types.ObjectId();

describe('AppProfile model', () => {
  it.each([
    [{ playPackageId: 'com.example_rankme.app' }, false],
    [{ appStoreId: '123456789' }, false],
    [
      {
        playPackageId: 'fast.rankme.mobile',
        appStoreId: '123456789012',
        paired: true,
      },
      true,
    ],
  ] as const)('accepts supported store-id combinations', async (storeIds, paired) => {
    const profile = new AppProfile({ accountId, siteId, ...storeIds });
    await expect(profile.validate()).resolves.toBeUndefined();
    expect(profile.paired).toBe(paired);
  });

  it('rejects a profile without either store id', async () => {
    const profile = new AppProfile({ accountId, siteId });
    await expect(profile.validate()).rejects.toMatchObject({
      errors: { playPackageId: { message: 'appSeo.errors.storeIdRequired' } },
    });
  });

  it('rejects pairing unless both store ids are present', async () => {
    const profile = new AppProfile({
      accountId,
      siteId,
      playPackageId: 'com.example.app',
      paired: true,
    });
    await expect(profile.validate()).rejects.toMatchObject({
      errors: { paired: { message: 'appSeo.errors.pairedStoreIdsRequired' } },
    });
  });

  it.each([
    ['1com.example', '12345'],
    ['com.example-with-dash', '1234567890123'],
    ['single_segment', '12A456'],
  ])('rejects malformed Play and Apple ids', async (playPackageId, appStoreId) => {
    expect(PLAY_PACKAGE_ID_REGEX.test(playPackageId)).toBe(false);
    expect(APP_STORE_ID_REGEX.test(appStoreId)).toBe(false);
    const profile = new AppProfile({ accountId, siteId, playPackageId, appStoreId });
    await expect(profile.validate()).rejects.toMatchObject({
      errors: {
        playPackageId: expect.anything(),
        appStoreId: expect.anything(),
      },
    });
  });

  it('declares owner/site history and per-store uniqueness indexes', () => {
    const indexes = AppProfile.schema.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        [{ siteId: 1 }, expect.any(Object)],
        [{ accountId: 1, siteId: 1, createdAt: -1 }, expect.any(Object)],
        [
          { accountId: 1, playPackageId: 1 },
          expect.objectContaining({ unique: true }),
        ],
        [
          { accountId: 1, appStoreId: 1 },
          expect.objectContaining({ unique: true }),
        ],
      ]),
    );
  });
});

describe('app profile registration schema', () => {
  it('trims ids and defaults paired to false', () => {
    expect(
      registerAppProfileBodySchema.parse({ playPackageId: ' com.example.app ' }),
    ).toEqual({ playPackageId: 'com.example.app', paired: false });
  });

  it('rejects unknown keys and empty store ids', () => {
    expect(
      registerAppProfileBodySchema.safeParse({
        playPackageId: ' ',
        vendorLookup: true,
      }).success,
    ).toBe(false);
  });
});
