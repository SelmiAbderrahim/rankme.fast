import { describe, expect, it } from 'vitest';
import { countryCodeFromAlpha3, countryLabelFromAlpha3, localizeEnglishCountryName } from './countries';
import { countryFromDomain, countryName, formatCountryFromLocation, languageName } from './format';

describe('country and language labels', () => {
  it.each([['usa', 'US'], ['are', 'AE'], ['fra', 'FR'], ['deu', 'DE'], ['rus', 'RU'], ['chn', 'CN'], ['xkk', 'XK']])('maps country observation code %s', (code, country) => {
    expect(countryCodeFromAlpha3(code)).toBe(country);
  });

  it('localizes code and English-name observations through the existing formatter', () => {
    expect(countryCodeFromAlpha3(' USA ')).toBe('US');
    expect(countryCodeFromAlpha3('zzz')).toBeNull();
    expect(countryLabelFromAlpha3('deu', 'fr')).toBe('Allemagne');
    expect(countryLabelFromAlpha3('zzz', 'en')).toBe('ZZZ');
    expect(countryLabelFromAlpha3('usa', 'not_a_locale')).toBe('USA');
    expect(localizeEnglishCountryName(' Germany ', 'fr')).toBe('Allemagne');
    expect(localizeEnglishCountryName('France', 'de')).toBe('Frankreich');
    expect(localizeEnglishCountryName('France', 'not_a_locale')).toBe('France');
    expect(localizeEnglishCountryName('(not set)', 'ar')).toBe('(not set)');
    expect(localizeEnglishCountryName('Vendor spelling', 'en')).toBe('Vendor spelling');
    expect(countryName('XY', 'en')).toBeNull();
    expect(languageName('qzz', 'en')).toBeNull();
    expect(formatCountryFromLocation(999, 'en', 'Unknown country', [{ countryCode: 'XY', locationCode: 999, languageCodes: [] }])).toBe('Unknown country');
  });

  it.each([
    ['cashback.sa', 'SA'], ['brand.co.uk', 'GB'], ['https://WWW.Example.DE./path', 'DE'],
    ['brand.io', null], ['brand.ai', null], ['brand.com', null], ['brand.eu', null],
    ['brand.xy', null], ['sa', null], ['', null], ['bad host.sa', null],
  ] as const)('infers only a supported non-generic country from %s', (domain, country) => {
    expect(countryFromDomain(domain)).toBe(country);
  });
});
