import { describe, expect, it } from 'vitest';
import { formatSignedNumber, isolateSignedNumber, isRtlLocale, MINUS_SIGN } from './signedNumber';

describe('signed numbers', () => {
  it('keeps signs with locale-formatted digits and uses the typographic minus', () => {
    expect(formatSignedNumber(-1234, 'en')).toBe(`${MINUS_SIGN}1,234`);
    expect(formatSignedNumber(4, 'en')).toBe('+4');
    expect(formatSignedNumber(0, 'en')).toBe('0');
    expect(formatSignedNumber(4, 'en', { signDisplay: 'never' })).toBe('4');
    expect(formatSignedNumber(-1.5, 'de', { maximumFractionDigits: 1 })).toBe('−1,5');
    expect(isolateSignedNumber(-2, 'en')).toBe('\u2066−2\u2069');
  });

  it('preserves native RTL signs and direction marks', () => {
    expect(formatSignedNumber(-12, 'ar')).toBe(new Intl.NumberFormat('ar', { signDisplay: 'exceptZero' }).format(-12));
    expect(isRtlLocale('AR-sa')).toBe(true);
    expect(isRtlLocale('he')).toBe(true);
    expect(isRtlLocale('')).toBe(false);
    expect(isRtlLocale('de')).toBe(false);
  });
});
