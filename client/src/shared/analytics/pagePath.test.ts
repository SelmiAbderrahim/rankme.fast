import { describe, expect, it } from 'vitest';
import { sanitizeAnalyticsPath } from './pagePath';

describe('sanitizeAnalyticsPath', () => {
  it('replaces a site id and keeps the route shape', () => {
    expect(sanitizeAnalyticsPath('/sites/6aba2d0c494c7d1f4ccde3a1')).toBe('/sites/:id');
    expect(sanitizeAnalyticsPath('/sites/6aba2d0c494c7d1f4ccde3a1/keywords')).toBe(
      '/sites/:id/keywords',
    );
  });

  it('replaces several ids in one path, including uuids and numeric ids', () => {
    expect(
      sanitizeAnalyticsPath(
        '/sites/6aba2d0c494c7d1f4ccde3a1/audits/123e4567-e89b-12d3-a456-426614174000/findings/missing-h1',
      ),
    ).toBe('/sites/:id/audits/:id/findings/missing-h1');
    expect(sanitizeAnalyticsPath('/orders/42')).toBe('/orders/:id');
  });

  it('redacts capability tokens by route, whatever they look like', () => {
    expect(sanitizeAnalyticsPath('/team/accept/abc')).toBe('/team/accept/:id');
    expect(sanitizeAnalyticsPath('/team/reject/abc/')).toBe('/team/reject/:id/');
    expect(sanitizeAnalyticsPath('/share/short')).toBe('/share/:id');
    expect(sanitizeAnalyticsPath('/fr/portal/short')).toBe('/fr/portal/:id');
  });

  it('redacts long opaque tokens but keeps readable slugs', () => {
    expect(sanitizeAnalyticsPath('/r/Zm9vYmFyYmF6cXV4MTIzNDU2Nzg')).toBe('/r/:id');
    expect(sanitizeAnalyticsPath('/docs/getting-started')).toBe('/docs/getting-started');
    expect(sanitizeAnalyticsPath('/docs/a-very-long-readable-slug-without-digits')).toBe(
      '/docs/a-very-long-readable-slug-without-digits',
    );
  });

  it('keeps the root and bare static routes', () => {
    expect(sanitizeAnalyticsPath('/')).toBe('/');
    expect(sanitizeAnalyticsPath('')).toBe('/');
    expect(sanitizeAnalyticsPath('/exports')).toBe('/exports');
  });
});
