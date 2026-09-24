import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from './schema';

describe('seo/schema JSON-LD builders', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('monthToIso expands valid months and falls back for garbage', () => {
    expect(schema.monthToIso('2026-07')).toBe('2026-07-01');
    expect(schema.monthToIso('nope')).toBe(schema.SITE_LAST_UPDATED);
  });

  it('graph wraps nodes in an @graph document', () => {
    const doc = schema.graph({ '@type': 'A' }, { '@type': 'B' });
    expect(doc['@context']).toBe('https://schema.org');
    expect((doc['@graph'] as unknown[]).length).toBe(2);
  });

  it('organization / website expose stable @ids', () => {
    expect(schema.organization()['@type']).toBe('Organization');
    expect(schema.website()['@type']).toBe('WebSite');
  });

  it('lists GitHub in organization profiles only after a valid repository is configured', () => {
    vi.stubEnv('VITE_GITHUB_URL', undefined as unknown as string);
    expect(schema.organization().sameAs).toEqual(['https://x.com/rahim_selmi']);
    vi.stubEnv('VITE_GITHUB_URL', 'https://github.com/rankmefast/rankmefast');
    expect(schema.organization().sameAs).toEqual([
      'https://x.com/rahim_selmi',
      'https://github.com/rankmefast/rankmefast',
    ]);
  });

  it('softwareApplication describes the self-hostable web app without offers', () => {
    const app = schema.softwareApplication();
    expect(app['@type']).toBe('SoftwareApplication');
    expect(app.applicationCategory).toBe('BusinessApplication');
    expect(app).not.toHaveProperty('offers');
  });

  it('webApplication describes an env-derived free browser utility', () => {
    const doc = schema.webApplication({
      name: 'SERP sensor',
      description: 'Daily displacement',
      path: '/serp-sensor',
    });
    expect(doc['@type']).toBe('WebApplication');
    expect(doc.url).toMatch(/\/serp-sensor$/);
    expect(doc.isAccessibleForFree).toBe(true);
    expect(doc.provider).toEqual({ '@id': expect.stringContaining('#organization') });
  });

  it('dataset exposes the visible spatial, temporal, and measurement limits', () => {
    const doc = schema.dataset({
      name: 'Daily SERP displacement',
      description: 'Aggregate top-20 movement',
      path: '/serp-sensor',
      spatialCoverage: 'United States',
      temporalCoverage: 'Daily rolling 30-day history',
      measurementTechnique: 'Normalized rank-set distance',
      variableMeasured: 'Top-20 displacement from 0 to 10',
    });
    expect(doc['@type']).toBe('Dataset');
    expect(doc.spatialCoverage).toBe('United States');
    expect(doc.temporalCoverage).toContain('30-day');
    expect(doc.measurementTechnique).toContain('rank-set');
    expect(doc.variableMeasured).toContain('0 to 10');
  });

  it('breadcrumbList / itemList number their entries from 1', () => {
    const bc = schema.breadcrumbList([{ name: 'Home', path: '/' }]);
    expect((bc.itemListElement as Array<{ position: number }>)[0]?.position).toBe(1);
    const il = schema.itemList([{ name: 'A', path: '/a' }]);
    expect((il.itemListElement as Array<{ position: number }>)[0]?.position).toBe(1);
  });

  it('faqPage maps questions to accepted answers', () => {
    const doc = schema.faqPage([{ question: 'q?', answer: 'a' }]);
    const q = (doc.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>)[0];
    expect(q?.name).toBe('q?');
    expect(q?.acceptedAnswer.text).toBe('a');
  });

  it('article defaults dates and honours overrides', () => {
    const def = schema.article({ headline: 'H', description: 'D', path: '/g' });
    expect(def.datePublished).toBe(schema.SITE_LAST_UPDATED);
    expect(def.dateModified).toBe(schema.SITE_LAST_UPDATED);
    const over = schema.article({
      headline: 'H',
      description: 'D',
      path: '/g',
      datePublished: '2026-01-01',
      dateModified: '2026-02-02',
    });
    expect(over.dateModified).toBe('2026-02-02');
  });

  it('howTo numbers its steps', () => {
    const doc = schema.howTo('Setup', [{ name: 'Step 1', text: 'do it' }]);
    expect((doc.step as Array<{ position: number }>)[0]?.position).toBe(1);
  });
});
