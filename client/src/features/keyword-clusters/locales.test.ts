import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '@shared/i18n';
import { RESOURCES } from '@shared/i18n/resources';

const strings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>).flatMap(strings);
};

describe('keyword-cluster locale and honesty contract', () => {
  it('ships substantive copy in every supported locale', () => {
    const english = RESOURCES.en.keywordClusters as { title: string };
    for (const locale of SUPPORTED_LOCALES) {
      const resource = RESOURCES[locale].keywordClusters as { title: string };
      expect(resource.title.length, `${locale} title`).toBeGreaterThan(2);
      if (locale !== 'en') expect(resource.title).not.toBe(english.title);
    }
  });

  it('contains no uplift, traffic-impact, or ranking-gain promise', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const copy = strings(RESOURCES[locale].keywordClusters).join(' ');
      expect(copy, `${locale} keyword-cluster copy`).not.toMatch(
        /\buplift\b|traffic[- ]impact|increase(?:d|s)? rankings?|rank higher/iu,
      );
    }
  });

  it('never claims a search is performed — clustering is a stored read', () => {
    const english = strings(RESOURCES.en.keywordClusters).join(' ');
    expect(english).toMatch(/no new search is run/i);
    expect(english).toMatch(/reads stored results only/i);
  });

  it('always marks an AI label as a suggestion, never as a fact', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const resource = RESOURCES[locale].keywordClusters as {
        cluster: { aiSuggestion: string };
      };
      expect(resource.cluster.aiSuggestion.length, `${locale} suggestion marker`)
        .toBeGreaterThan(1);
    }
  });
});
