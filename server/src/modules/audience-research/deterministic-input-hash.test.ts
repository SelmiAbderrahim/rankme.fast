import { describe, expect, it } from 'vitest';
import {
  computeDeterministicInputHash,
  computeDeterministicInputHashV2,
} from './deterministic-input-hash.js';
import type { SiteMarket } from '../../shared/observations/types.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/locales.js';

const siteMarket: SiteMarket = {
  country: 'US',
  region: null,
  city: null,
  language: 'en',
  device: 'all',
};

const baseInput = {
  accountId: 'acc-1',
  siteId: 'site-1',
  siteMarket,
  competitorDomains: ['acme.com', 'zeta.com'],
  seedTopics: ['pricing', 'onboarding'],
  queryTemplateVersion: 1,
};

describe('computeDeterministicInputHash', () => {
  it('returns identical hash for identical input', () => {
    const a = computeDeterministicInputHash(baseInput);
    const b = computeDeterministicInputHash({ ...baseInput });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is order-insensitive for seed topics and competitors', () => {
    const a = computeDeterministicInputHash(baseInput);
    const b = computeDeterministicInputHash({
      ...baseInput,
      seedTopics: ['onboarding', 'pricing'],
      competitorDomains: ['zeta.com', 'acme.com'],
    });
    expect(a).toBe(b);
  });

  it('is case-insensitive for text fields', () => {
    const a = computeDeterministicInputHash(baseInput);
    const b = computeDeterministicInputHash({
      ...baseInput,
      seedTopics: ['PRICING', 'Onboarding'],
      competitorDomains: ['ACME.com', 'Zeta.COM'],
    });
    expect(a).toBe(b);
  });

  it('changes when the template version changes', () => {
    const a = computeDeterministicInputHash(baseInput);
    const b = computeDeterministicInputHash({ ...baseInput, queryTemplateVersion: 2 });
    expect(a).not.toBe(b);
  });

  it('changes when the SiteMarket flips', () => {
    const a = computeDeterministicInputHash(baseInput);
    const b = computeDeterministicInputHash({
      ...baseInput,
      siteMarket: { ...siteMarket, country: 'GB' },
    });
    expect(a).not.toBe(b);
    const c = computeDeterministicInputHash({
      ...baseInput,
      siteMarket: { ...siteMarket, device: 'mobile' },
    });
    expect(a).not.toBe(c);
  });

  it('encodes explicit region/city when set', () => {
    const a = computeDeterministicInputHash({
      ...baseInput,
      siteMarket: { ...siteMarket, region: 'CA', city: 'San Francisco' },
    });
    const b = computeDeterministicInputHash({
      ...baseInput,
      siteMarket: { ...siteMarket, region: 'ca', city: 'san francisco' },
    });
    expect(a).toBe(b);
    expect(a).not.toBe(computeDeterministicInputHash(baseInput));
  });

  it('changes when account or site changes', () => {
    const a = computeDeterministicInputHash(baseInput);
    expect(computeDeterministicInputHash({ ...baseInput, accountId: 'acc-2' })).not.toBe(a);
    expect(computeDeterministicInputHash({ ...baseInput, siteId: 'site-2' })).not.toBe(a);
  });

  it('versions every output locale separately while leaving the legacy identity stable', () => {
    const legacy = computeDeterministicInputHash(baseInput);
    const localeHashes = SUPPORTED_LOCALES.map((outputLocale) =>
      computeDeterministicInputHashV2({ ...baseInput, outputLocale }));
    expect(new Set(localeHashes).size).toBe(SUPPORTED_LOCALES.length);
    expect(localeHashes).not.toContain(legacy);
    expect(computeDeterministicInputHash(baseInput)).toBe(legacy);
  });
});
