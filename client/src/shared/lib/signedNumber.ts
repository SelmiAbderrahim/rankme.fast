/** Signed values remain a single numeric run in either interface direction. */
export const MINUS_SIGN = '−';
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);
export type SignedNumberOptions = Intl.NumberFormatOptions;

export function isRtlLocale(locale: string): boolean {
  return RTL_LANGUAGES.has((locale || '').split('-')[0]!.toLowerCase());
}

export function formatSignedNumber(value: number, locale: string, options: SignedNumberOptions = {}): string {
  const parts = new Intl.NumberFormat(locale, { signDisplay: 'exceptZero', ...options }).formatToParts(value);
  if (isRtlLocale(locale)) return parts.map((part) => part.value).join('');
  return parts.map((part) => part.type === 'minusSign' ? part.value.replace('-', MINUS_SIGN) : part.value).join('');
}

export function isolateSignedNumber(value: number, locale: string, options?: SignedNumberOptions): string {
  return `\u2066${formatSignedNumber(value, locale, options)}\u2069`;
}
