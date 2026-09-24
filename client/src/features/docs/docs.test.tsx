import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelmetProvider } from 'react-helmet-async';
import { I18nextProvider } from 'react-i18next';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { toast } from 'sonner';
import { i18n, initI18n } from '@shared/i18n';
import { DocsLayout } from './components/DocsLayout';
import { DocsHome } from './components/DocsHome';
import { DocsArticle } from './components/DocsArticle';
import { DocsError } from './components/DocsError';
import { docsRoute } from './routes';
import type { DocsArticleData, DocsCatalog, DocsSearchData } from './types';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const catalog: DocsCatalog = {
  locale: 'en',
  home: {
    slug: 'index',
    locale: 'en',
    title: 'RankMeFast documentation',
    description: 'Guides for using RankMeFast.',
    section: 'start',
    order: 0,
  },
  docs: [
    ['getting-started', 'Getting started', 'start'],
    ['ai-summary', 'AI summary', 'audits'],
    ['rank-tracking', 'Rank tracking', 'research'],
    ['pricing', 'Pricing', 'account'],
    ['public-api', 'Public API', 'developers'],
  ].map(([slug, title, section], order) => ({
    slug: slug as DocsCatalog['docs'][number]['slug'],
    locale: 'en' as const,
    title: title!,
    description: `${title!} description`,
    section: section as DocsCatalog['docs'][number]['section'],
    order,
  })),
};

const searchData: DocsSearchData = {
  locale: 'en',
  docs: catalog.docs.map((doc) => ({ ...doc, searchText: `${doc.title} detailed answer` })),
};

const richBody = `## Start *here*

Read the paragraph with \`inline code\` and **strong text**.

### Details

- One
- Two

1. First
2. Second

> Important note.

| Name | Value |
| --- | --- |
| Audit | Ready |

\`\`\`js
const ready = true;
\`\`\`

---

[Another guide](./pricing.en.md), [pricing](/pricing), [this section](#start-here), [unsafe internal](//evil.example/path), and [external](https://example.com).

<script>window.compromised = true</script>
`;

function articleFor(slug: string, body = richBody, source = catalog): DocsArticleData {
  const meta = source.docs.find((doc) => doc.slug === slug) ?? {
    ...source.docs[0]!,
    slug: slug as DocsCatalog['docs'][number]['slug'],
    title: slug === 'troubleshooting' ? 'Troubleshooting' : slug,
  };
  return { doc: { ...meta, body } };
}

function renderRouter(routes: RouteObject[], path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <I18nextProvider i18n={i18n}>
      <HelmetProvider>
        <RouterProvider router={router} />
      </HelmetProvider>
    </I18nextProvider>,
  );
}

function renderDocs(path: string, options: { data?: DocsCatalog; body?: string } = {}) {
  const data = options.data ?? catalog;
  return renderRouter([
    {
      path: '/docs',
      element: <DocsLayout />,
      loader: () => data,
      errorElement: <DocsError />,
      children: [
        { index: true, element: <DocsHome />, loader: () => searchData },
        {
          path: ':slug',
          element: <DocsArticle />,
          loader: ({ params }) => articleFor(params.slug ?? 'getting-started', options.body, data),
        },
      ],
    },
  ], path);
}

beforeEach(() => {
  vi.clearAllMocks();
  initI18n({ initialLocale: 'en' });
});

afterEach(() => {
  cleanup();
});

describe('documentation experience', () => {
  it('renders the public hub, themed hero, search controls, and mobile navigation', async () => {
    renderDocs('/docs');
    const heading = await screen.findByRole('heading', { level: 1, name: catalog.home.title });
    expect(heading).toBeInTheDocument();
    expect(heading.closest('section')).toHaveClass('dark', 'bg-background', 'text-foreground');
    expect(heading.closest('section')).not.toHaveClass('bg-primary');
    expect(screen.getAllByRole('searchbox')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Operations' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open documentation navigation' }));
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
    expect(screen.getAllByText('Public API').length).toBeGreaterThan(1);
    fireEvent.submit(screen.getByRole('searchbox').closest('form')!);
    fireEvent.click(screen.getByRole('button', { name: 'Open documentation navigation' }));
    fireEvent.click(screen.getByRole('link', { name: 'Public API' }));
  });

  it('filters by query and section while preserving both in filter links', async () => {
    renderDocs('/docs?q=summary&section=audits');
    expect(await screen.findByText('1 results')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'AI summary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Account and billing' })).toHaveAttribute(
      'href',
      '/docs?q=summary&section=account',
    );
  });

  it('shows an actionable empty state and ignores invalid section parameters', async () => {
    const first = renderDocs('/docs?q=nothing&section=audits');
    expect(await screen.findByRole('heading', { name: 'No guides found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/docs');
    first.unmount();

    renderDocs('/docs?section=invalid');
    expect(await screen.findByRole('heading', { name: catalog.home.title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All' })).toHaveClass('bg-highlight/10');
  });

  it('renders safe rich Markdown, a matching table of contents, and article navigation', async () => {
    renderDocs('/docs/ai-summary');
    const heading = await screen.findByRole('heading', { level: 1, name: 'AI summary' });
    expect(heading).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Start here' })).toHaveAttribute('href', '#start-here');
    expect(screen.getByRole('link', { name: 'Another guide' })).toHaveAttribute('href', '/docs/pricing');
    expect(screen.getByRole('link', { name: 'pricing' })).toHaveAttribute('href', '/pricing');
    expect(screen.getByRole('link', { name: 'this section' })).not.toHaveAttribute('target');
    expect(screen.queryByRole('link', { name: 'unsafe internal' })).toBeNull();
    expect(screen.getByText('unsafe internal')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /external/ })).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Audit')).toBeInTheDocument();
    expect(screen.getByText('const ready = true;').closest('pre')).toHaveClass('bg-muted', 'text-foreground');
    expect(document.querySelector('.docs-markdown script')).toBeNull();
    expect(screen.getAllByText('Getting started').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Rank tracking').length).toBeGreaterThan(0);
  });

  it('copies an article as Markdown, plain text, or a page link and reports denied access', async () => {
    const user = userEvent.setup();
    renderDocs('/docs/ai-summary');
    await screen.findByRole('heading', { level: 1, name: 'AI summary' });
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    const articleBody = document.querySelector('.docs-markdown')?.parentElement;
    expect(articleBody).not.toBeNull();
    Object.defineProperty(articleBody!, 'innerText', {
      configurable: true,
      value: 'Start here\n\nReadable contents',
    });

    const openCopyMenu = async () => {
      await user.click(screen.getByRole('button', { name: 'Copy page' }));
    };

    await openCopyMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Markdown' }));
    await openCopyMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Plain text' }));
    await openCopyMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Page link' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenNthCalledWith(1, richBody);
      expect(writeText).toHaveBeenNthCalledWith(
        2,
        'AI summary\n\nAI summary description\n\nStart here\n\nReadable contents',
      );
      expect(writeText).toHaveBeenNthCalledWith(3, expect.stringMatching(/\/docs\/ai-summary$/));
      expect(toast.success).toHaveBeenCalledTimes(3);
    });

    writeText.mockRejectedValueOnce(new Error('Clipboard access denied'));
    await openCopyMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Markdown' }));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Could not copy. Check your browser permissions and try again.',
      );
    });
  });

  it('handles articles without a table of contents and both sequence boundaries', async () => {
    const first = renderDocs('/docs/getting-started', { body: 'A short guide.' });
    expect(await screen.findByRole('heading', { name: 'Getting started' })).toBeInTheDocument();
    expect(screen.queryByText('On this page')).toBeNull();
    expect(screen.queryByText('Previous')).toBeNull();
    expect(screen.getByText('Next')).toBeInTheDocument();
    first.unmount();

    renderDocs('/docs/public-api', { body: 'Final guide.' });
    expect(await screen.findByRole('heading', { name: 'Public API' })).toBeInTheDocument();
    expect(screen.getByText('Previous')).toBeInTheDocument();
    expect(screen.queryByText('Next')).toBeNull();
  });

  it('handles an article outside the ordered catalog and localized home paths', async () => {
    const localized: DocsCatalog = {
      locale: 'fr',
      home: { ...catalog.home, locale: 'fr' },
      docs: catalog.docs.map((doc) => ({ ...doc, locale: 'fr' as const })),
    };
    renderDocs('/docs/troubleshooting', { data: localized, body: 'Guide autonome.' });
    expect(await screen.findByRole('heading', { name: 'Troubleshooting' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/fr');
    expect(screen.queryByText('Previous')).toBeNull();
    expect(screen.queryByText('Next')).toBeNull();
  });

  it('omits empty navigation groups when a catalog is intentionally narrow', async () => {
    renderDocs('/docs', {
      data: {
        ...catalog,
        locale: 'fr',
        home: { ...catalog.home, locale: 'fr' },
        docs: [{ ...catalog.docs[1]!, locale: 'fr' }],
      },
    });
    await screen.findByRole('heading', { name: catalog.home.title });
    expect(
      within(screen.getByRole('navigation', { name: 'Documentation navigation' })).queryByText('Developers'),
    ).toBeNull();
  });

  it.each([
    [404, 'Guide not found'],
    [500, 'Documentation unavailable'],
  ])('renders the localized %s route error', async (status, title) => {
    renderRouter([
      {
        path: '/docs',
        loader: () => { throw new Response(null, { status }); },
        element: <div />,
        errorElement: <DocsError />,
      },
    ], '/docs');
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to documentation' })).toHaveAttribute('href', '/docs');
  });

  it('keeps both lazy route modules available from the public route definition', async () => {
    const home = await docsRoute.children?.[0]?.lazy?.();
    const article = await docsRoute.children?.[1]?.lazy?.();
    expect(home).toHaveProperty('Component', DocsHome);
    expect(article).toHaveProperty('Component', DocsArticle);
  });
});
