/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '../../entry-server';
import type { ClientPortalReport } from './types';

const payload: ClientPortalReport = {
  locale: 'ar',
  site: { label: 'عميل تجريبي' },
  branding: { companyName: 'وكالة النور', accentColor: '#3366ff', logoDataUrl: null },
  sections: {
    audit: null,
    ranks: {
      snapshotDate: '2026-08-02T00:00:00.000Z',
      rows: [{ keyword: 'تحسين محركات البحث', engine: 'google', position: 4, checkedAt: '2026-08-02T00:00:00.000Z' }],
    },
    gsc: null,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('client portal SSR', () => {
  it('renders localized branded report content with RTL and noindex metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await render('/ar/portal/token-value-that-is-long-enough', {
      apiOrigin: 'http://api:8080',
    });
    expect(result.statusCode).toBe(200);
    expect(result.htmlAttrs).toContain('lang="ar"');
    expect(result.htmlAttrs).toContain('dir="rtl"');
    expect(result.headTags).toContain('noindex, nofollow');
    expect(result.appHtml).toContain('عميل تجريبي');
    expect(result.appHtml).toContain('google');
    expect(fetch).toHaveBeenCalledWith(
      'http://api:8080/api/client-portal/token-value-that-is-long-enough?locale=ar',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('SSR-renders a hard noindex not-found page for a revoked token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
    const result = await render('/portal/revoked-token-value');
    expect(result.statusCode).toBe(404);
    expect(result.headTags).toContain('noindex, nofollow');
    expect(result.appHtml).toContain('Report link unavailable');
    expect(result.appHtml).not.toContain('RankMeFast');
  });
});
