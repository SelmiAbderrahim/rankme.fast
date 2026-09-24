import { describe, expect, it } from 'vitest';
import { audienceResearchInputSchema } from './audience-research.schemas.js';

const validMarket = {
  country: 'US',
  region: null,
  city: null,
  language: 'en',
  device: 'all' as const,
};

describe('audienceResearchInputSchema', () => {
  it('accepts a minimal input with defaults', () => {
    const out = audienceResearchInputSchema.parse({ siteMarket: validMarket });
    expect(out.seedTopics).toEqual([]);
    expect(out.competitorDomains).toEqual([]);
  });

  it('trims and Unicode-normalizes seed topics', () => {
    const out = audienceResearchInputSchema.parse({
      siteMarket: validMarket,
      seedTopics: ['  pricing  ', 'onboarding\n'],
    });
    expect(out.seedTopics).toEqual(['pricing', 'onboarding']);
  });

  it('dedupes seed topics case-insensitively', () => {
    const out = audienceResearchInputSchema.parse({
      siteMarket: validMarket,
      seedTopics: ['SEO', 'seo', 'Seo'],
    });
    expect(out.seedTopics).toEqual(['SEO']);
  });

  it('rejects topics shorter than the min', () => {
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        seedTopics: ['x'],
      }),
    ).toThrow();
  });

  it('rejects topics longer than the max', () => {
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        seedTopics: ['x'.repeat(200)],
      }),
    ).toThrow();
  });

  it('rejects control characters in seed topics', () => {
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        seedTopics: ['badtopic'],
      }),
    ).toThrow();
  });

  it('rejects markup in seed topics', () => {
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        seedTopics: ['<script>alert(1)</script>'],
      }),
    ).toThrow();
  });

  it('rejects markup-only topics', () => {
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        seedTopics: ['<>=;'],
      }),
    ).toThrow();
  });

  it.each([
    'http://10.0.0.1/x',
    'http://172.16.0.1/x',
    'http://127.0.0.1/x',
    'https://[::1]/x',
    'http://localhost/x',
    'https://user:pass@example.com/x',
    'ftp://example.com/x',
  ])('rejects unsafe URL seed %s through the shared preflight', (seedTopic) => {
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        seedTopics: [seedTopic],
      }),
    ).toThrow();
  });

  it('rejects malformed URL seeds', () => {
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        seedTopics: ['https://:::/x'],
      }),
    ).toThrow();
  });

  it('accepts valid public HTTP and HTTPS URL-like topics', () => {
    const out = audienceResearchInputSchema.parse({
      siteMarket: validMarket,
      seedTopics: ['https://example.com/what', 'http://example.org/why'],
    });
    expect(out.seedTopics).toEqual(['https://example.com/what', 'http://example.org/why']);
  });

  it('normalizes and dedupes competitor domains', () => {
    const out = audienceResearchInputSchema.parse({
      siteMarket: validMarket,
      competitorDomains: ['ACME.com', ' zeta.com.', 'acme.com'],
    });
    expect(out.competitorDomains).toEqual(['acme.com', 'zeta.com']);
  });

  it('rejects a competitor URL, expecting bare domains', () => {
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        competitorDomains: ['https://acme.com'],
      }),
    ).toThrow();
  });

  it('rejects private/reserved competitor domains', () => {
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        competitorDomains: ['localhost'],
      }),
    ).toThrow();
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        competitorDomains: ['10.0.0.1'],
      }),
    ).toThrow();
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        competitorDomains: ['172.16.0.1'],
      }),
    ).toThrow();
  });

  it('rejects IPv6 loopback and unique-local competitor hosts', () => {
    for (const bad of ['::1', 'fc00::1', 'fd12:3456:789a::1']) {
      expect(() =>
        audienceResearchInputSchema.parse({
          siteMarket: validMarket,
          competitorDomains: [bad],
        }),
      ).toThrow();
    }
  });

  it('accepts a public IPv4 (drives the not-private branch)', () => {
    const out = audienceResearchInputSchema.parse({
      siteMarket: validMarket,
      competitorDomains: ['8.8.8.8'],
    });
    expect(out.competitorDomains).toEqual(['8.8.8.8']);
  });

  it('rejects IPv6-like competitor that is not private', () => {
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        competitorDomains: ['2001:db8::1'],
      }),
    ).toThrow();
  });

  it('rejects invalid competitor domain shapes', () => {
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        competitorDomains: ['not_a_domain'],
      }),
    ).toThrow();
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        competitorDomains: [''],
      }),
    ).toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        secretField: 'nope',
      }),
    ).toThrow();
  });

  it('rejects more than 10 topics or 5 competitors', () => {
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        seedTopics: Array.from({ length: 11 }, (_, i) => `topic${i}`),
      }),
    ).toThrow();
    expect(() =>
      audienceResearchInputSchema.parse({
        siteMarket: validMarket,
        competitorDomains: Array.from({ length: 6 }, (_, i) => `c${i}.com`),
      }),
    ).toThrow();
  });
});
