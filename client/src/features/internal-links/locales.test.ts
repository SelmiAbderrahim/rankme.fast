import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '@shared/i18n';
import { RESOURCES } from '@shared/i18n/resources';

const strings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap(strings);
};

describe('internal-link locale and honesty contract', () => {
  it('ships substantive copy in every supported locale', () => {
    const english = RESOURCES.en.internalLinks as { title: string };
    for (const locale of SUPPORTED_LOCALES) {
      const resource = RESOURCES[locale].internalLinks as { title: string };
      expect(resource.title.length, `${locale} title`).toBeGreaterThan(2);
      if (locale !== 'en') expect(resource.title).not.toBe(english.title);
    }
  });

  it('contains no uplift, traffic-impact, or ranking-gain promise', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const copy = strings(RESOURCES[locale].internalLinks).join(' ');
      expect(copy, `${locale} internal-link copy`).not.toMatch(
        /\buplift\b|traffic[- ]impact|increase(?:d|s)? rankings?|rank higher/iu,
      );
    }
  });
});
