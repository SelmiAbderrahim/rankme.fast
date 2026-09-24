/**
 * Public surface journey: root redirect, docs, sitemap, and public chrome.
 *
 * The self-hosted edition ships no marketing site. `/` and every locale root
 * redirect to sign-in; the only server-rendered public pages are the docs
 * inside the slim `PublicLayout`. Runs against the composed stack with no
 * account, no vendor call, and no metered unit. Raw response assertions prove
 * SSR output before hydration; browser assertions cover Arabic directionality
 * and axe in both themes.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const LOCALES = ['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh'] as const;

/** Feature docs slugs that must stay enumerated in the docs sitemap. */
const DOCS_SLUGS = [
  'getting-started',
  'serp-features',
  'keyword-clustering',
  'alt-engine-tracking',
  'cannibalization',
  'toxic-links',
  'alerts',
  'internal-linking',
  'content-briefs',
  'geogrid',
  'schema-markup',
  'client-reports',
] as const;

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((nextTheme) => {
    localStorage.setItem('theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  }, theme);
  await page.reload();
}

async function scan(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

test.describe.configure({ mode: 'serial' });

test.describe('public pages (docs-only self-hosted edition)', () => {
  test('the root and every locale root redirect to sign-in', async ({ request, page }) => {
    const root = await request.get('/', { maxRedirects: 0 });
    expect(root.status(), '/ status').toBe(302);
    expect(new URL(root.headers()['location'] ?? '', 'http://x').pathname).toBe('/login');

    for (const locale of LOCALES.filter((candidate) => candidate !== 'en')) {
      const response = await request.get(`/${locale}`, { maxRedirects: 0 });
      expect(response.status(), `/${locale} status`).toBe(302);
      const location = new URL(response.headers()['location'] ?? '', 'http://x');
      expect(location.pathname, `/${locale} redirect target`).toBe('/login');
      expect(location.searchParams.get('lng'), `/${locale} carries its locale`).toBe(locale);
    }

    await page.goto('/');
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.locator('#login-email')).toBeVisible();
  });

  test('public beta chrome remains accessible in both themes and its dismissal survives reload', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/docs');
    const banner = page.getByTestId('release-stage-banner');
    await expect(banner).toBeVisible();
    await expect(page.getByTestId('release-stage-badge').first()).toBeVisible();

    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await expect(banner).toBeVisible();
      await scan(page, `beta chrome ${theme}`);
    }

    await page.getByRole('button', { name: /hide.*beta/i }).press('Enter');
    await expect(banner).toBeHidden();
    await page.reload();
    await expect(banner).toBeHidden();
  });

  test('the docs pages server-render head and hreflang alternates', async ({ request }) => {
    for (const path of ['/docs', '/docs/getting-started', '/docs/schema-markup']) {
      const response = await request.get(path);
      expect(response.status(), `${path} status`).toBe(200);
      const html = await response.text();

      const title = /<title[^>]*>([^<]+)<\/title>/.exec(html)?.[1] ?? '';
      expect(title.trim().length, `${path} <title>`).toBeGreaterThan(0);
      expect(html, `${path} canonical`).toMatch(/rel="canonical"/);
      for (const locale of LOCALES) {
        expect(html, `${path} hreflang ${locale}`).toMatch(new RegExp(`href[Ll]ang="${locale}"`));
      }
      expect(html, `${path} skip-link target`).toContain('id="public-main"');
      expect(html, `${path} no JSON-LD script breakout`).not.toContain('</script><script');
    }
  });

  test('the sitemap index lists only the docs sitemap, which enumerates the docs slugs', async ({
    request,
  }) => {
    const index = await request.get('/sitemap.xml');
    expect(index.status(), '/sitemap.xml status').toBe(200);
    const indexXml = await index.text();
    const children = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(match[1] as string).pathname,
    );
    expect(children).toEqual(['/sitemap-docs.xml']);

    const docs = await request.get('/sitemap-docs.xml');
    expect(docs.status(), '/sitemap-docs.xml status').toBe(200);
    const docsXml = await docs.text();
    for (const slug of DOCS_SLUGS) {
      expect(docsXml, `sitemap contains /docs/${slug}`).toContain(`/docs/${slug}<`);
    }
    expect(docsXml, 'no marketing routes in the sitemap').not.toMatch(
      /<loc>[^<]*\/(pricing|free-audit|serp-sensor|alternatives|vs)\b[^<]*<\/loc>/,
    );
  });

  test('unknown non-docs paths get the CSR app shell and a client-rendered NotFound', async ({
    page,
    request,
  }) => {
    // Only docs, portals, and report shares are server-rendered. Every other
    // path (including the removed marketing routes) is handed to the SPA with
    // HTTP 200 and an empty root; the client router paints the shared NotFound.
    for (const path of ['/pricing', '/free-audit', '/schema-markup', '/nope', '/ar/pricing']) {
      const raw = await request.get(path, { maxRedirects: 0 });
      expect(raw.status(), `${path} raw status`).toBe(200);
      const html = await raw.text();
      expect(html, `${path} is the CSR shell`).toContain('<div id="root"></div>');
      expect(html, `${path} is not server-rendered`).not.toContain('window.__SSR__=true');

      const response = await page.goto(path);
      expect(response?.status(), `${path} status`).toBe(200);
      const title = page.locator('[data-slot="empty-title"]');
      await expect(title, `${path} NotFound`).toHaveText(/^(Page not found|الصفحة غير موجودة)$/u);
      if (!path.startsWith('/ar/')) await expect(title).toHaveText('Page not found');
    }
  });

  test('unknown docs slugs stay server-rendered with a real HTTP 404', async ({
    page,
    request,
  }) => {
    for (const [path, heading] of [
      ['/docs/nope', 'Guide not found'],
      ['/ar/docs/nope', 'الدليل غير موجود'],
    ] as const) {
      const raw = await request.get(path, { maxRedirects: 0 });
      expect(raw.status(), `${path} raw status`).toBe(404);
      const html = await raw.text();
      expect(html, `${path} is server-rendered`).toContain('window.__SSR__=true');
      expect(html, `${path} SSR not-found copy`).toContain(heading);

      const response = await page.goto(path);
      expect(response?.status(), `${path} status`).toBe(404);
      await expect(page.locator('#public-main h1').first()).toHaveText(heading);
    }
  });

  test('the docs pages render in English and Arabic', async ({ page }) => {
    await page.goto('/docs/schema-markup');
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('body')).toContainText('JSON-LD');

    await page.goto('/ar/docs/schema-markup');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('axe is clean in light and dark on the representative docs pages', async ({ page }) => {
    for (const path of ['/docs', '/docs/getting-started', '/ar/docs']) {
      await page.goto(path);
      await setTheme(page, 'light');
      await scan(page, `${path} light`);
      await setTheme(page, 'dark');
      await scan(page, `${path} dark`);
    }
  });

  test('the Arabic public header keeps the locale on docs and auth entry links', async ({
    page,
  }) => {
    await page.goto('/ar/docs');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    // Auth entry links may be absolute when a split app origin is configured;
    // compare path + query so the assertion holds for either deployment shape.
    const hrefs = await page
      .locator('header a[href]')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const url = new URL((node as HTMLAnchorElement).href);
          return `${url.pathname}${url.search}`;
        }),
      );
    const isAuthEntry = (href: string) => /^\/(login|register)(\?|\/|$)/.test(href);
    const auth = hrefs.filter(isAuthEntry);
    expect(auth.length, 'arabic header renders sign-in entry points').toBeGreaterThan(0);
    for (const href of auth) {
      expect(href, `${href} carries the arabic locale into the app`).toMatch(/[?&]lng=ar(&|$)/);
    }
    const docs = hrefs.filter((href) => /^\/(ar\/)?docs(\/|$)/.test(href));
    expect(docs.length, 'arabic header renders the docs link').toBeGreaterThan(0);
    for (const href of docs) {
      expect(href, `${href} keeps the /ar prefix`).toMatch(/^\/ar\/docs(\/|$)/);
    }
  });
});
