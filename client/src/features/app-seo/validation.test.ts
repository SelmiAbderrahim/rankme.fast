import { describe, expect, it } from 'vitest';
import {
  APP_STORE_ID_MAX_LENGTH,
  APP_STORE_ID_REGEX,
  PLAY_PACKAGE_ID_MAX_LENGTH,
  PLAY_PACKAGE_ID_REGEX,
  buildAppProfileSchema,
} from './validation';
import { appGapResearchInputSchema } from './research-types';

const schema = buildAppProfileSchema((key) => key);

describe('App profile client validation', () => {
  it('pins the server regexes and length limits', () => {
    expect(PLAY_PACKAGE_ID_REGEX.source).toBe('^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+$');
    expect(APP_STORE_ID_REGEX.source).toBe('^\\d{6,12}$');
    expect(PLAY_PACKAGE_ID_MAX_LENGTH).toBe(255);
    expect(APP_STORE_ID_MAX_LENGTH).toBe(12);
  });

  it.each([
    { playPackageId: 'com.example.app', appStoreId: '', paired: false },
    { playPackageId: '', appStoreId: '123456', paired: false },
    { playPackageId: 'io.rankme.app', appStoreId: '123456789012', paired: true },
  ])('accepts valid store combinations', (value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  it('rejects empty, malformed, overlong, and incomplete paired values', () => {
    const cases = [
      { playPackageId: '', appStoreId: '', paired: false },
      { playPackageId: 'not-a-package', appStoreId: '', paired: false },
      { playPackageId: 'a'.repeat(256), appStoreId: '', paired: false },
      { playPackageId: '', appStoreId: 'abc', paired: false },
      { playPackageId: '', appStoreId: '1'.repeat(13), paired: false },
      { playPackageId: 'com.example.app', appStoreId: '', paired: true },
    ];
    for (const value of cases) expect(schema.safeParse(value).success).toBe(false);
  });
});

describe('App research client validation', () => {
  it('validates store-specific Google Play and App Store identifiers', () => {
    const common = { profileId: 'profile-one', locationCode: 2840, languageCode: 'en' } as const;
    expect(
      appGapResearchInputSchema.safeParse({
        ...common,
        store: 'google_play',
        appIds: ['com.example.primary', 'com.example.competitor'],
      }).success,
    ).toBe(true);
    expect(
      appGapResearchInputSchema.safeParse({
        ...common,
        store: 'google_play',
        appIds: ['com.example.primary', 'invalid'],
      }).success,
    ).toBe(false);
    expect(
      appGapResearchInputSchema.safeParse({
        ...common,
        store: 'app_store',
        appIds: ['123456', '987654321'],
      }).success,
    ).toBe(true);
    expect(
      appGapResearchInputSchema.safeParse({
        ...common,
        store: 'app_store',
        appIds: ['123456', 'com.example.invalid'],
      }).success,
    ).toBe(false);
  });
});
