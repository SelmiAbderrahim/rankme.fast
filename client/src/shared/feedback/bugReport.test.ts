import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBugReportHref } from './bugReport';
import { appVersion } from '@shared/config/version';
import { i18n, initI18n } from '@shared/i18n';

const REPORT_FIELDS = ['version', 'edition', 'stage', 'route', 'browser', 'locale'] as const;

function decodedMailBody(href: string): string {
  const query = href.slice(href.indexOf('?') + 1);
  return new URLSearchParams(query).get('body') ?? '';
}

describe('buildBugReportHref', () => {
  beforeEach(async () => {
    initI18n({ initialLocale: 'en' });
    await i18n.changeLanguage('en');
    vi.stubEnv('VITE_GITHUB_URL', undefined as unknown as string);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await i18n.changeLanguage('en');
  });

  it('builds an encoded mail report with the complete allowed field set when no repository is configured', () => {
    const href = buildBugReportHref({
      routePattern: '/sites/:siteId/audits/:auditId',
      requestId: 'A1B2C3D4-1111-2222-3333-1234567890AB',
    });

    expect(href.startsWith('mailto:')).toBe(true);
    expect(href).toContain('subject=');
    const body = decodedMailBody(href);
    expect(body).toContain(`version: ${appVersion}`);
    expect(body).toContain('edition: cloud');
    expect(body).toContain('stage: beta');
    expect(body).toContain('route: /sites/:siteId/audits/:auditId');
    expect(body).toMatch(/browser: (?:Edge|Firefox|Chrome|Safari|Other)/u);
    expect(body).toContain('locale: en');
    expect(body).toContain('requestId: A1B2C3D4-1111-2222-3333-1234567890AB');
    expect(body.split('\n').map((line) => line.split(':', 1)[0])).toEqual([
      ...REPORT_FIELDS,
      'requestId',
    ]);
  });

  it('builds an issue-form URL with every allowed field URL-encoded when a safe repository is configured', () => {
    vi.stubEnv('VITE_GITHUB_URL', 'https://github.example/owner/repo/?ignored=1#old');

    const href = buildBugReportHref({ routePattern: '/files/*' });
    const url = new URL(href);

    expect(`${url.origin}${url.pathname}`).toBe('https://github.example/owner/repo/issues/new');
    expect(url.hash).toBe('');
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('version')).toBe(appVersion);
    expect(url.searchParams.get('edition')).toBe('cloud');
    expect(url.searchParams.get('stage')).toBe('beta');
    expect(url.searchParams.get('route')).toBe('/files/*');
    expect(url.searchParams.get('browser')).toMatch(/^(Edge|Firefox|Chrome|Safari|Other)$/u);
    expect(url.searchParams.get('locale')).toBe('en');
    expect(url.searchParams.get('ignored')).toBeNull();
    expect(url.search).toContain('template=bug_report.yml');
    expect(url.search).toContain(`version=${encodeURIComponent(appVersion)}`);
    expect(url.search).toContain('route=%2Ffiles%2F*');
  });

  it('caps hostile input by falling back to a bounded mail report', () => {
    vi.stubEnv('VITE_GITHUB_URL', `https://github.example/${'a'.repeat(2_100)}`);

    const href = buildBugReportHref({ routePattern: `/${'x'.repeat(301)}` });

    expect(href.startsWith('mailto:')).toBe(true);
    expect(href.length).toBeLessThan(2_000);
    expect(decodedMailBody(href)).toContain('route: /');
  });

  it.each([
    ['an issue-form URL', 'https://github.example/owner/repo'],
    ['a mail report', undefined],
  ])('excludes every PII-shaped builder input from %s', (_kind, repository) => {
    const pii = {
      concretePath: '/sites/507f1f77bcf86cd799439011/audits/507f191e810c19729de860ea',
      email: 'ada.lovelace@example.test',
      userId: 'user_01HX6V5R6DN63F6VJ6K5Q4E3X7',
      domain: 'customer-secret.example',
      keyword: 'buy private seo audit',
      query: '?token=top-secret&campaign=private',
    };
    vi.stubEnv('VITE_GITHUB_URL', repository as unknown as string);

    for (const hostile of Object.values(pii)) {
      const href = buildBugReportHref({ routePattern: hostile, requestId: hostile });
      const decoded = decodeURIComponent(href);
      for (const value of Object.values(pii)) {
        expect(href).not.toContain(value);
        expect(decoded).not.toContain(value);
      }
      if (href.startsWith('mailto:')) {
        expect(decodedMailBody(href)).toContain('route: /');
      } else {
        expect(new URL(href).searchParams.get('route')).toBe('/');
        expect(new URL(href).searchParams.get('body')).toBeNull();
      }
    }
  });

  it.each([
    ['Edge', 'Mozilla/5.0 Chrome/120.0 Safari/537.36 Edg/120.0'],
    ['Firefox', 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/121.0'],
    ['Chrome', 'Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0 Safari/537.36'],
    ['Safari', 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'],
    ['Other', 'curl/8.4.0'],
  ])('reports only the %s browser family', (family, userAgent) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
    expect(decodedMailBody(buildBugReportHref({ routePattern: '/' }))).toContain(
      `browser: ${family}`,
    );
    vi.restoreAllMocks();
  });

  it('reports Other when no navigator exists', () => {
    vi.stubGlobal('navigator', undefined);
    expect(decodedMailBody(buildBugReportHref({ routePattern: '/' }))).toContain(
      'browser: Other',
    );
    vi.unstubAllGlobals();
  });

  it('falls back to English for an unresolved or unsupported language', () => {
    const resolved = i18n.resolvedLanguage;
    const language = i18n.language;
    Object.assign(i18n, { resolvedLanguage: undefined, language: 'xx-YY' });
    try {
      expect(decodedMailBody(buildBugReportHref({ routePattern: '/' }))).toContain('locale: en');
    } finally {
      Object.assign(i18n, { resolvedLanguage: resolved, language });
    }
  });

  it.each([
    ['plain http', 'http://github.example/owner/repo'],
    ['embedded credentials', 'https://user:secret@github.example/owner/repo'],
  ])('ignores a repository URL with %s and uses mail', (_kind, repository) => {
    vi.stubEnv('VITE_GITHUB_URL', repository);
    const href = buildBugReportHref({ routePattern: '/' });
    expect(href.startsWith('mailto:')).toBe(true);
    expect(href).not.toContain('secret');
  });

  it('adds only a displayed request id to the issue form body', () => {
    vi.stubEnv('VITE_GITHUB_URL', 'https://github.example/owner/repo');
    const url = new URL(
      buildBugReportHref({
        routePattern: '/',
        requestId: 'a1b2c3d4-1111-2222-3333-1234567890ab',
      }),
    );
    expect(url.searchParams.get('body')).toBe('requestId: a1b2c3d4-1111-2222-3333-1234567890ab');
  });
});
