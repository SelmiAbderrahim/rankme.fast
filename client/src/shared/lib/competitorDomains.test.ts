import { describe, expect, it } from 'vitest';
import { competitorDomainNormalizer, toCompetitorDomain } from './competitorDomains';

describe('competitor domain input', () => {
  it('normalizes URLs and host aliases into bare domains', () => {
    expect(toCompetitorDomain(' HTTPS://WWW.Example.COM.:443/path?q=1 ')).toBe('example.com');
    expect(toCompetitorDomain('example.com')).toBe('example.com');
    expect(toCompetitorDomain('مثال.إختبار')).toMatch(/^xn--/);
  });
  it.each(['', 'https://', 'localhost', '127.0.0.1', '[::1]', 'bad host.com', 'a'.repeat(254) + '.test'])('rejects non-domain input %j', (raw) => {
    expect(toCompetitorDomain(raw)).toBeNull();
  });
  it('matches the existing normalized-host ownership rule without grouping unrelated hosts', () => {
    const normalize = competitorDomainNormalizer('https://www.example.com/');
    expect(normalize('www.example.com')).toEqual({ rejected: 'own' });
    expect(normalize('bad')).toEqual({ rejected: 'invalid' });
    expect(normalize('example.com.evil.test')).toEqual({ value: 'example.com.evil.test' });
    expect(normalize('other.example.com')).toEqual({ value: 'other.example.com' });
    expect(competitorDomainNormalizer()('other.test')).toEqual({ value: 'other.test' });
    expect(competitorDomainNormalizer('')('other.test')).toEqual({ value: 'other.test' });
  });
});
