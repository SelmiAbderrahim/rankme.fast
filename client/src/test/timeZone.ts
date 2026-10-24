import { vi } from 'vitest';

/** Default formatters to a viewer zone; explicit UTC/date-only options win. */
export function stubViewerTimeZone(timeZone: string): void {
  const Original = Intl.DateTimeFormat;
  function DateTimeFormat(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    return new Original(locales, { timeZone, ...options });
  }
  DateTimeFormat.prototype = Original.prototype;
  DateTimeFormat.supportedLocalesOf = Original.supportedLocalesOf;
  vi.stubGlobal('Intl', Object.assign(Object.create(Intl) as typeof Intl, { DateTimeFormat }));
}
