import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPresentationLocaleSnapshot, setPresentationLocale } from '@shared/i18n';
import { docsArticleLoader, docsCatalogLoader, docsSearchLoader } from './loaders';

const args = (url: string, extra: Record<string, unknown> = {}) => ({
  request: new Request(url),
  params: {},
  context: undefined,
  ...extra,
}) as never;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('documentation route loaders', () => {
  it('uses the injected reader during SSR for every data shape', async () => {
    const catalog = { locale: 'fr', home: {}, docs: [] };
    const search = { locale: 'fr', docs: [] };
    const article = { doc: { slug: 'ai-summary' } };
    const docsReader = {
      readCatalog: vi.fn(() => catalog),
      readSearch: vi.fn(() => search),
      readArticle: vi.fn(() => article),
    };
    const context = { docsReader };

    await expect(docsCatalogLoader(args('https://rank.test/fr/docs', { context }))).resolves.toBe(catalog);
    await expect(docsSearchLoader(args('https://rank.test/fr/docs', { context }))).resolves.toBe(search);
    await expect(docsArticleLoader(args('https://rank.test/fr/docs/ai-summary', {
      context,
      params: { slug: 'ai-summary' },
    }))).resolves.toBe(article);
    expect(docsReader.readCatalog).toHaveBeenCalledWith('fr');
    expect(docsReader.readSearch).toHaveBeenCalledWith('fr');
    expect(docsReader.readArticle).toHaveBeenCalledWith('fr', 'ai-summary');
  });

  it('loads the same-origin browser endpoints when no SSR reader exists', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ locale: 'en', docs: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ locale: 'en', docs: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ doc: { slug: 'pricing' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await docsCatalogLoader(args('https://rank.test/docs'));
    await docsSearchLoader(args('https://rank.test/docs'));
    await docsArticleLoader(args('https://rank.test/docs/pricing', { params: { slug: 'pricing' } }));

    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      'https://rank.test/_docs-data/en/catalog',
      'https://rank.test/_docs-data/en/search',
      'https://rank.test/_docs-data/en/pricing',
    ]);
    for (const call of fetchMock.mock.calls) {
      const headers = call[1]?.headers as Headers;
      expect(headers.get('Accept')).toBe('application/json');
      expect(headers.get('x-lang')).toBe('en');
    }
  });

  it('rejects a docs payload whose JSON finishes after the presentation locale changes', async () => {
    const originalLocale = getPresentationLocaleSnapshot().locale;
    const nextLocale = originalLocale === 'fr' ? 'en' : 'fr';
    let markJsonStarted!: () => void;
    const jsonStarted = new Promise<void>((resolve) => {
      markJsonStarted = resolve;
    });
    let resolveJson!: (value: { locale: string; docs: never[] }) => void;
    const jsonResult = new Promise<{ locale: string; docs: never[] }>((resolve) => {
      resolveJson = resolve;
    });
    const response = new Response('{}', { status: 200 });
    vi.spyOn(response, 'json').mockImplementation(async () => {
      markJsonStarted();
      return jsonResult;
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const pending = docsCatalogLoader(args('https://rank.test/docs'));
    await jsonStarted;
    setPresentationLocale(nextLocale);
    resolveJson({ locale: originalLocale, docs: [] });

    await expect(pending).rejects.toMatchObject({ status: 500 });
    setPresentationLocale(originalLocale);
  });

  it('returns route responses for invalid slugs and missing content', async () => {
    await expect(docsArticleLoader(args('https://rank.test/docs/nope', {
      params: { slug: 'nope' },
    }))).rejects.toMatchObject({ status: 404 });
    await expect(docsArticleLoader(args('https://rank.test/docs', {
      params: { slug: 'index' },
    }))).rejects.toMatchObject({ status: 404 });

    const missing = new Error('missing');
    missing.name = 'DocsNotFoundError';
    await expect(docsCatalogLoader(args('https://rank.test/docs', {
      context: { docsReader: { readCatalog: () => { throw missing; } } },
    }))).rejects.toMatchObject({ status: 404 });
  });

  it('preserves endpoint status responses and maps unexpected reader failures to 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await expect(docsSearchLoader(args('https://rank.test/docs'))).rejects.toMatchObject({ status: 503 });

    await expect(docsArticleLoader(args('https://rank.test/docs/pricing', {
      params: { slug: 'pricing' },
      context: { docsReader: { readArticle: () => { throw new Error('broken'); } } },
    }))).rejects.toMatchObject({ status: 500 });

    await expect(docsCatalogLoader(args('https://rank.test/docs', {
      context: { docsReader: { readCatalog: () => { throw 'broken'; } } },
    }))).rejects.toMatchObject({ status: 500 });
  });
});
