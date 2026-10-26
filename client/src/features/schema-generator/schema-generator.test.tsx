import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider, useSelector } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { formatAbsoluteDate } from '@shared/lib/datetime';
import { GenerationList } from './components/GenerationList';
import { writeToClipboard } from '@shared/lib/clipboard';
import { SchemaGeneratorPanel } from './components/SchemaGeneratorPanel';
import { StateNotice } from './components/StateNotice';
import { schemaGeneratorReducer } from './store/slice';
import {
  selectSchemaDetail,
  selectSchemaGenerations,
  selectSchemaGeneratorSlice,
  selectSchemaRegistryVersion,
} from './store/selectors';
import { toSchemaGate } from './gate';
import { isValidPastedPageUrl } from './validation';
import { isSchemaView } from './urlState';
import { filterPages, groupPages, pathGroupOf } from './pageGroups';
import {
  initialSchemaGeneratorState,
  isSupportedSchemaType,
  type GenerationDetail,
  type SchemaGeneratorState,
  type SchemaTypeProjection,
} from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

vi.mock('@shared/lib/clipboard', () => ({ writeToClipboard: vi.fn() }));

const mockedApiClient = vi.mocked(apiClient);
const mockedClipboard = vi.mocked(writeToClipboard);

const SITE_ID = 'a'.repeat(24);
const GENERATION_ID = 'b'.repeat(24);
const AUDITED_URL = 'https://example.test/guide';
const INVENTORY_URL = 'https://example.test/pricing';

const typeProjection = (
  type: SchemaTypeProjection['type'],
  required: string[],
  recommended: string[],
  richResults: SchemaTypeProjection['richResults'] = null,
): SchemaTypeProjection => ({
  type,
  richResults,
  required: required.map((name) => ({
    name,
    class: 'required' as const,
    fill: 'ai-selected' as const,
    evidenceFactIds: ['page.title'],
    neverFilled: false,
  })),
  recommended: recommended.map((name) => ({
    name,
    class: 'recommended' as const,
    fill: 'ai-selected' as const,
    evidenceFactIds: [],
    neverFilled: true,
  })),
});

const typesResponse = () => ({
  registryVersion: '1',
  types: [
    typeProjection('WebPage', ['name', 'url'], ['inLanguage']),
    typeProjection('Article', ['headline', 'datePublished'], ['author']),
  ],
});

const sourcesResponse = (overrides: Record<string, unknown> = {}) => ({
  siteId: SITE_ID,
  runId: 'c'.repeat(24),
  auditedPages: [
    {
      url: AUDITED_URL,
      title: 'A guide',
      hasStructuredData: false,
      structuredDataErrors: 2,
      richResultsVerdict: 'FAIL',
    },
    {
      url: 'https://example.test/other',
      title: null,
      hasStructuredData: true,
      structuredDataErrors: 0,
      richResultsVerdict: null,
    },
  ],
  auditedPagesTotal: 2,
  inventoryPages: [
    { url: INVENTORY_URL, schemaTypes: ['Article'], hasSchemaOrgArticle: false },
  ],
  ...overrides,
});

const detailResponse = (overrides: Partial<GenerationDetail> = {}): GenerationDetail => ({
  id: GENERATION_ID,
  siteId: SITE_ID,
  pageUrl: AUDITED_URL,
  source: 'audited-page',
  schemaType: 'WebPage',
  registryVersion: '1',
  status: 'complete',
  conformanceStatus: 'gaps',
  failureReason: null,
  generatedAt: '2026-08-01T09:00:00.000Z',
  payload: '{"@context":"https://schema.org","@type":"WebPage","name":"A guide"}',
  mediaType: 'application/ld+json',
  evidence: [
    {
      property: 'name',
      factId: 'page.title',
      factLabel: 'Page title',
      value: 'A guide',
    },
  ],
  omissions: [{ property: 'url', reasonCode: 'no_evidence', class: 'required' }],
  conformance: {
    registryVersion: '1',
    status: 'gaps',
    requiredGaps: [{ property: 'url', reasonCode: 'no_evidence' }],
    recommendedSuggestions: [{ property: 'inLanguage', reasonCode: 'not_applicable' }],
  },
  ...overrides,
});

const summaryOf = (detail: GenerationDetail) => ({
  id: detail.id,
  siteId: detail.siteId,
  pageUrl: detail.pageUrl,
  source: detail.source,
  schemaType: detail.schemaType,
  registryVersion: detail.registryVersion,
  status: detail.status,
  conformanceStatus: detail.conformanceStatus,
  failureReason: detail.failureReason,
  generatedAt: detail.generatedAt,
});

interface Handlers {
  types?: () => unknown;
  sources?: () => unknown;
  list?: () => unknown;
  preview?: () => unknown;
  create?: () => unknown;
  detail?: () => unknown;
  download?: () => unknown;
  regenerate?: (init?: { body?: unknown }) => unknown;
}

/** Route each mocked call by path so ordering never matters. */
const routeApi = (handlers: Handlers = {}) => {
  mockedApiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.startsWith('/schema-generator/types')) {
      return Promise.resolve(handlers.types?.() ?? typesResponse()) as never;
    }
    if (path.startsWith('/schema-generator/sources')) {
      return Promise.resolve(handlers.sources?.() ?? sourcesResponse()) as never;
    }
    if (path.endsWith('/download')) {
      return Promise.resolve(handlers.download?.() ?? '{"@type":"WebPage"}') as never;
    }
    if (path.startsWith('/schema-generator/preview')) {
      return Promise.resolve(handlers.preview?.() ?? {}) as never;
    }
    if (path === '/schema-generator/generations' && init?.method === 'POST') {
      return Promise.resolve(handlers.create?.() ?? detailResponse()) as never;
    }
    if (path.endsWith('/regenerate')) {
      return Promise.resolve(handlers.regenerate?.(init as { body?: unknown }) ?? detailResponse()) as never;
    }
    if (path.startsWith('/schema-generator/generations/')) {
      return Promise.resolve(handlers.detail?.() ?? detailResponse()) as never;
    }
    if (path.startsWith('/schema-generator/generations')) {
      return Promise.resolve(handlers.list?.() ?? { items: [] }) as never;
    }
    throw new Error(`unexpected path ${path}`);
  });
};

let search = '';
const LocationProbe = () => {
  search = useLocation().search;
  return null;
};

const renderPanel = (
  entry = `/sites/${SITE_ID}?tab=schema`,
  props: { initialState?: SchemaGeneratorState } = {},
) => {
  search = '';
  const store = configureStore({
    reducer: { schemaGenerator: schemaGeneratorReducer },
    ...(props.initialState ? { preloadedState: { schemaGenerator: props.initialState } } : {}),
  });
  return {
    store,
    ...render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[entry]}>
            <SchemaGeneratorPanel siteId={SITE_ID} />
            <LocationProbe />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    ),
  };
};

const httpError = (status: number, message?: string) =>
  new ApiError('failed', status, message ? { error: { message } } : undefined);

beforeEach(async () => {
  await initI18n();
  await changeLanguage('en');
  mockedApiClient.mockReset();
  mockedClipboard.mockReset();
  mockedClipboard.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pure helpers', () => {
  it('recognises the seven supported types and rejects anything else', () => {
    expect(isSupportedSchemaType('FAQPage')).toBe(true);
    expect(isSupportedSchemaType('Recipe')).toBe(false);
    expect(isSupportedSchemaType(7)).toBe(false);
  });

  it('accepts only absolute https URLs without credentials', () => {
    expect(isValidPastedPageUrl('https://example.test/page')).toBe(true);
    expect(isValidPastedPageUrl('http://example.test/page')).toBe(false);
    expect(isValidPastedPageUrl('https://user:pw@example.test/page')).toBe(false);
    expect(isValidPastedPageUrl('not a url')).toBe(false);
    expect(isValidPastedPageUrl('')).toBe(false);
  });

  it('recognises the two panes and nothing else', () => {
    expect(isSchemaView('detail')).toBe(true);
    expect(isSchemaView('queries')).toBe(false);
    expect(isSchemaView(null)).toBe(false);
  });

  it('maps every refusal status onto its honest state', () => {
    expect(toSchemaGate(httpError(409, 'conflict'), 'fb')).toEqual({
      kind: 'failed',
      message: 'conflict',
    });
    expect(toSchemaGate(httpError(403), 'fb').kind).toBe('killSwitch');
    expect(toSchemaGate(httpError(404), 'fb').kind).toBe('notFound');
    expect(toSchemaGate(httpError(400), 'fb').kind).toBe('unsafeUrl');
    expect(toSchemaGate(httpError(429), 'fb').kind).toBe('rateLimited');
    expect(toSchemaGate(httpError(502), 'fb').kind).toBe('failed');
    expect(toSchemaGate(httpError(500), 'fb')).toEqual({ kind: 'failed', message: 'fb' });
    expect(toSchemaGate(new Error('boom'), 'fb')).toEqual({
      kind: 'failed',
      message: 'fb',
    });
    // A non-string server message falls back to the client sentence.
    expect(
      toSchemaGate(new ApiError('x', 409, { error: { message: 7 } }), 'fb').message,
    ).toBe('fb');
  });

  it('falls back to the initial state when the lazy slice is absent', () => {
    const bare = {} as never;
    expect(selectSchemaDetail(bare)).toBeNull();
    expect(selectSchemaGenerations(bare)).toEqual([]);
    expect(selectSchemaRegistryVersion(bare)).toBe(
      initialSchemaGeneratorState.registryVersion,
    );
  });

  it('mounts a selector consumer safely before the lazy reducer is injected', () => {
    const bareStore = configureStore({
      reducer: { placeholder: (state = 0) => state },
    });
    const Consumer = () => {
      const slice = useSelector((state: unknown) => selectSchemaGeneratorSlice(state as never));
      return <span data-testid="schema-fallback-status">{slice.typesStatus}</span>;
    };

    render(
      <Provider store={bareStore}>
        <Consumer />
      </Provider>,
    );
    expect(screen.getByTestId('schema-fallback-status')).toHaveTextContent('idle');
  });
});

describe('StateNotice', () => {
  it('prefers the server sentence and falls back to the localized copy', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <StateNotice kind="failed" />
        <StateNotice kind="rateLimited" message="Slow down." />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('schema-state-failed')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByTestId('schema-state-rateLimited')).toHaveTextContent('Slow down.');
  });
});

describe('SchemaGeneratorPanel — pickers', () => {
  it('keeps FAQPage and HowTo last and says what Google does with them now', async () => {
    routeApi({
      types: () => ({
        registryVersion: '1',
        types: [
          typeProjection('WebPage', ['name', 'url'], ['inLanguage']),
          typeProjection('Article', ['headline', 'datePublished'], ['author']),
          typeProjection('FAQPage', ['mainEntity'], [], 'limited'),
          typeProjection('HowTo', ['name', 'step'], ['description'], 'retired'),
        ],
      }),
    });
    renderPanel();

    const picker = await screen.findByTestId('schema-type-picker');
    const order = Array.from(picker.querySelectorAll('[data-testid^="schema-type-"]'))
      .map((el) => el.getAttribute('data-testid'))
      .filter((id) => /^schema-type-[A-Z]\w*$/.test(id ?? ''));
    expect(order).toEqual(['schema-type-WebPage', 'schema-type-Article', 'schema-type-FAQPage', 'schema-type-HowTo']);
    expect(screen.getByTestId('schema-type-note-FAQPage')).toHaveTextContent(
      'Google shows FAQ answers in search results only for well-known government and health sites. The markup is still valid.',
    );
    expect(screen.getByTestId('schema-type-note-HowTo')).toHaveTextContent(
      'Google no longer shows HowTo steps in search results. The markup is still valid.',
    );
    expect(screen.queryByTestId('schema-type-note-WebPage')).toBeNull();
    expect(screen.queryByTestId('schema-type-note-Article')).toBeNull();
    // The note is announced with the option, and the option is still selectable.
    const howTo = screen.getByRole('radio', { name: /HowTo/ });
    expect(howTo).toHaveAccessibleDescription('Google no longer shows HowTo steps in search results. The markup is still valid.');
    expect(screen.getByRole('radio', { name: /WebPage/ })).not.toHaveAttribute('aria-describedby');
    await userEvent.click(howTo);
    expect(howTo).toBeChecked();
  });


  it('loads the registry, the stored work lists and the stored generations', async () => {
    routeApi({ list: () => ({ items: [summaryOf(detailResponse())] }) });
    renderPanel();

    expect(await screen.findByTestId('schema-type-picker')).toBeInTheDocument();
    expect(screen.getByTestId('schema-type-WebPage')).toHaveTextContent('Required: 2');
    expect(screen.getByTestId('schema-type-WebPage')).toHaveTextContent('Recommended: 1');
    expect(await screen.findByTestId('schema-audited-option-0')).toHaveTextContent(
      AUDITED_URL,
    );
    // Crawled page titles are untrusted mixed-direction text.
    expect(screen.getByText('A guide')).toHaveAttribute('dir', 'ltr');
    // Crawl + Search Console context travels with the page row.
    expect(screen.getByTestId('schema-audited-option-0')).toHaveTextContent(
      'No structured data found',
    );
    expect(screen.getByTestId('schema-audited-option-0')).toHaveTextContent(
      'Structured-data errors: 2',
    );
    expect(screen.getByTestId('schema-audited-option-0')).toHaveTextContent(
      'Search Console verdict: FAIL',
    );
    expect(screen.getByTestId('schema-audited-option-1')).toHaveTextContent(
      'Already has structured data',
    );
    expect(
      await screen.findByTestId(`schema-generation-${GENERATION_ID}`),
    ).toBeInTheDocument();
  });

  it('shows the inventory work list and marks a type the page already declares', async () => {
    routeApi({
      sources: () =>
        sourcesResponse({
          inventoryPages: [
            { url: INVENTORY_URL, schemaTypes: ['Article'], hasSchemaOrgArticle: false },
            {
              url: 'https://example.test/no-schema',
              schemaTypes: [],
              hasSchemaOrgArticle: false,
            },
          ],
        }),
    });
    renderPanel();
    await screen.findByTestId('schema-page-picker');

    await userEvent.click(screen.getByLabelText('Inventory page'));
    expect(await screen.findByTestId('schema-inventory-option-0')).toHaveTextContent(INVENTORY_URL);
    expect(screen.getByTestId('schema-inventory-option-0')).toHaveTextContent(
      'Already declares: Article',
    );
    expect(screen.getByTestId('schema-inventory-option-1')).toHaveTextContent(
      'Declares no schema.org type',
    );
    await userEvent.click(screen.getByTestId('schema-inventory-option-0'));
    expect(await screen.findByTestId('schema-type-declared-Article')).toBeInTheDocument();
  });

  it('says so when the audit stored more pages than the picker lists', async () => {
    routeApi({ sources: () => sourcesResponse({ auditedPagesTotal: 1200 }) });
    renderPanel();
    await screen.findByTestId('schema-audited-option-0');
    expect(screen.getByText('Showing 2 of 1200')).toBeInTheDocument();
    expect(screen.getByTestId('schema-audited-capped')).toHaveTextContent(
      'This list holds the first 2 of 1200 crawled pages.',
    );
  });

  it('treats a server that predates the audited-page total as a complete list', async () => {
    routeApi({ sources: () => sourcesResponse({ auditedPagesTotal: undefined }) });
    renderPanel();
    await screen.findByTestId('schema-audited-option-0');
    expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument();
    expect(screen.queryByTestId('schema-audited-capped')).not.toBeInTheDocument();
  });

  it('shows no partial-list note when the list holds every audited page', async () => {
    routeApi({ sources: () => sourcesResponse() });
    renderPanel();
    await screen.findByTestId('schema-audited-option-0');
    expect(screen.queryByTestId('schema-audited-capped')).not.toBeInTheDocument();
  });

  it('filters a long audited list and groups it by language folder', async () => {
    routeApi({
      sources: () =>
        sourcesResponse({
          auditedPagesTotal: 3,
          auditedPages: [
            {
              url: 'https://example.test/ar/episode-1',
              title: 'حلقة EpisodeBrief الأولى',
              hasStructuredData: false,
              structuredDataErrors: 0,
              richResultsVerdict: null,
            },
            {
              url: 'https://example.test/about',
              title: 'About us',
              hasStructuredData: false,
              structuredDataErrors: 0,
              richResultsVerdict: null,
            },
            {
              url: 'https://example.test/ar/episode-2',
              title: null,
              hasStructuredData: true,
              structuredDataErrors: 0,
              richResultsVerdict: null,
            },
          ],
        }),
    });
    renderPanel();
    await screen.findByTestId('schema-audited-option-0');

    // Grouped by the first path segment, in first-seen order.
    expect(screen.getByRole('group', { name: '/ar/ (2)' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Top-level pages (1)' })).toBeInTheDocument();
    // Mixed-direction titles are bidi-isolated in their dominant direction.
    const title = screen.getByTestId('schema-audited-title-0');
    expect(title.tagName).toBe('BDI');
    expect(title).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('Showing 3 of 3')).toBeInTheDocument();

    const filter = screen.getByLabelText('Find a page');
    await userEvent.type(filter, 'about');
    expect(screen.getByText('Showing 1 of 3')).toBeInTheDocument();
    expect(screen.queryByTestId('schema-audited-option-0')).not.toBeInTheDocument();
    // Ids stay tied to the original position, and one group needs no heading.
    expect(screen.getByTestId('schema-audited-option-1')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Top-level pages/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('schema-audited-group-/')).not.toHaveAttribute('role');
    await userEvent.click(screen.getByTestId('schema-audited-option-1'));
    expect(screen.getByLabelText(/example\.test\/about/)).toBeChecked();

    await userEvent.clear(filter);
    await userEvent.type(filter, 'nothing-here');
    expect(screen.getByTestId('schema-audited-no-matches')).toHaveTextContent(
      'No page matches that search.',
    );
  });

  it('filters the inventory list too', async () => {
    routeApi({
      sources: () =>
        sourcesResponse({
          inventoryPages: [
            { url: INVENTORY_URL, schemaTypes: [], hasSchemaOrgArticle: false },
            { url: 'https://example.test/blog/post', schemaTypes: [], hasSchemaOrgArticle: false },
          ],
        }),
    });
    renderPanel();
    await screen.findByTestId('schema-page-picker');
    await userEvent.click(screen.getByLabelText('Inventory page'));
    await userEvent.type(await screen.findByTestId('schema-inventory-filter'), 'blog');
    expect(screen.getByTestId('schema-inventory-option-1')).toBeInTheDocument();
    expect(screen.queryByTestId('schema-inventory-option-0')).not.toBeInTheDocument();
  });

  it('validates a pasted URL before anything leaves the browser', async () => {
    routeApi();
    renderPanel();
    await screen.findByTestId('schema-page-picker');

    await userEvent.click(screen.getByLabelText('Paste a URL'));
    const field = await screen.findByLabelText('Page address');
    await userEvent.type(field, 'http://example.test/x');
    expect(await screen.findByTestId('schema-url-error')).toBeInTheDocument();
    expect(screen.getByTestId('schema-preview-button')).toBeDisabled();
    expect(mockedApiClient).not.toHaveBeenCalledWith(
      '/schema-generator/preview',
      expect.anything(),
    );

    await userEvent.clear(field);
    await userEvent.type(field, 'https://example.test/x');
    await waitFor(() => expect(screen.queryByTestId('schema-url-error')).toBeNull());
    expect(screen.getByTestId('schema-preview-button')).toBeEnabled();
  });

  it('operates both page and type radio pickers with the keyboard', async () => {
    routeApi();
    renderPanel();
    await screen.findByTestId('schema-page-picker');

    const firstPage = screen.getByRole('radio', { name: new RegExp(AUDITED_URL) });
    act(() => firstPage.focus());
    await userEvent.keyboard('{ArrowDown}');
    const secondPage = screen.getByRole('radio', { name: /other/ });
    expect(secondPage).toHaveFocus();
    await userEvent.keyboard(' ');
    await waitFor(() => expect(secondPage).toBeChecked());

    const webPageType = screen.getByRole('radio', { name: /WebPage/ });
    act(() => webPageType.focus());
    await userEvent.keyboard('{ArrowDown}');
    const articleType = screen.getByRole('radio', { name: /Article/ });
    expect(articleType).toHaveFocus();
    await userEvent.keyboard(' ');
    await waitFor(() => expect(articleType).toBeChecked());
  });

  it('renders honest empty lists for a site with no audit and no inventory gap', async () => {
    routeApi({
      sources: () =>
        sourcesResponse({ runId: null, auditedPages: [], auditedPagesTotal: 0, inventoryPages: [] }),
    });
    renderPanel();
    expect(await screen.findByTestId('schema-state-empty')).toBeInTheDocument();
    expect(screen.getByTestId('schema-audited-empty')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Inventory page'));
    expect(await screen.findByTestId('schema-inventory-empty')).toBeInTheDocument();
    expect(await screen.findByTestId('schema-list-empty')).toBeInTheDocument();
  });

  it('still renders the page picker when the registry read fails', async () => {
    routeApi({
      types: () => {
        throw httpError(500);
      },
    });
    renderPanel();
    expect(await screen.findByTestId('schema-page-picker')).toBeInTheDocument();
    expect(screen.getByTestId('schema-state-failed')).toBeInTheDocument();
    // No type cards without a registry — the picker never invents a type list.
    expect(screen.queryByTestId('schema-type-WebPage')).toBeNull();
    expect(screen.getByTestId('schema-preview-button')).toBeDisabled();
  });

});

describe('SchemaGeneratorPanel — preview then generate', () => {
  const pickAuditedPage = async () => {
    await screen.findByTestId('schema-page-picker');
    await userEvent.click(await screen.findByTestId('schema-audited-option-0'));
  };

  it('discloses unmetered usage before the confirm button exists', async () => {
    routeApi();
    renderPanel();
    await pickAuditedPage();

    expect(screen.queryByTestId('schema-generate-button')).toBeNull();
    await userEvent.click(screen.getByTestId('schema-preview-button'));
    expect(await screen.findByTestId('schema-preview')).toHaveTextContent(
      "Usage limits aren't applied on this server.",
    );
    const disclosure = screen.getByTestId('schema-preview');
    const confirm = screen.getByTestId('schema-generate-button');
    expect(confirm).toBeInTheDocument();
    expect(
      disclosure.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('generates, opens the detail pane and records the deep link', async () => {
    // A stored row already exists, so the fresh generation has to be merged in
    // front of it rather than replacing the list.
    routeApi({
      list: () => ({ items: [summaryOf(detailResponse({ id: 'd'.repeat(24) }))] }),
    });
    renderPanel();
    await pickAuditedPage();
    await userEvent.click(screen.getByTestId('schema-preview-button'));
    await screen.findByTestId('schema-preview');
    await userEvent.click(screen.getByTestId('schema-generate-button'));

    expect(await screen.findByTestId('schema-result')).toBeInTheDocument();
    expect(search).toContain('view=detail');
    expect(search).toContain(`generation=${GENERATION_ID}`);
  });

  it('uses the shared loading button to prevent a double generation submit', async () => {
    let finishCreate: ((detail: GenerationDetail) => void) | undefined;
    routeApi({
      create: () =>
        new Promise<GenerationDetail>((resolve) => {
          finishCreate = resolve;
        }),
    });
    renderPanel();
    await pickAuditedPage();
    await userEvent.click(screen.getByTestId('schema-preview-button'));
    await screen.findByTestId('schema-preview');

    const generate = screen.getByTestId('schema-generate-button');
    await userEvent.click(generate);
    expect(generate).toBeDisabled();
    expect(generate).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(generate);
    expect(
      mockedApiClient.mock.calls.filter(
        ([path, init]) => path === '/schema-generator/generations' && init?.method === 'POST',
      ),
    ).toHaveLength(1);

    await act(async () => finishCreate?.(detailResponse()));
    expect(await screen.findByTestId('schema-result')).toBeInTheDocument();
  });

  it('surfaces the localized create refusal and shows no result', async () => {
    routeApi({
      create: () => {
        throw httpError(500, 'The generation could not be stored.');
      },
    });
    renderPanel();
    await pickAuditedPage();
    await userEvent.click(screen.getByTestId('schema-preview-button'));
    await screen.findByTestId('schema-preview');
    await userEvent.click(screen.getByTestId('schema-generate-button'));

    expect(await screen.findByTestId('schema-state-failed')).toHaveTextContent(
      'The generation could not be stored.',
    );
    expect(screen.queryByTestId('schema-result')).toBeNull();
  });

  it('surfaces the kill switch on the preview entry point', async () => {
    routeApi({
      preview: () => {
        throw httpError(403, 'New generations are paused right now.');
      },
    });
    renderPanel();
    await pickAuditedPage();
    await userEvent.click(screen.getByTestId('schema-preview-button'));

    expect(await screen.findByTestId('schema-state-killSwitch')).toHaveTextContent(
      'New generations are paused right now.',
    );
  });

  it('surfaces a refused unsafe URL from the server', async () => {
    routeApi({
      create: () => {
        throw httpError(400, 'That address is not reachable.');
      },
    });
    renderPanel();
    await screen.findByTestId('schema-page-picker');
    await userEvent.click(screen.getByLabelText('Paste a URL'));
    await userEvent.type(
      await screen.findByLabelText('Page address'),
      'https://internal.test/x',
    );
    await userEvent.click(screen.getByTestId('schema-preview-button'));
    await screen.findByTestId('schema-preview');
    await userEvent.click(screen.getByTestId('schema-generate-button'));

    expect(await screen.findByTestId('schema-state-unsafeUrl')).toHaveTextContent(
      'That address is not reachable.',
    );
  });

  it('surfaces a 502 generation failure as its own failed state', async () => {
    routeApi({
      create: () => {
        throw httpError(502, 'The model could not finish this generation.');
      },
    });
    renderPanel();
    await pickAuditedPage();
    await userEvent.click(screen.getByTestId('schema-preview-button'));
    await screen.findByTestId('schema-preview');
    await userEvent.click(screen.getByTestId('schema-generate-button'));

    expect(await screen.findByTestId('schema-state-failed')).toHaveTextContent(
      'The model could not finish this generation.',
    );
  });

  it('surfaces a refused work list and a refused stored list', async () => {
    routeApi({
      sources: () => {
        throw httpError(404, 'Site not found.');
      },
      list: () => {
        throw httpError(429);
      },
    });
    renderPanel();
    expect(await screen.findByTestId('schema-state-notFound')).toHaveTextContent(
      'Site not found.',
    );
    expect(await screen.findByTestId('schema-state-rateLimited')).toBeInTheDocument();
  });
});

describe('SchemaGeneratorPanel — result and stored reads', () => {
  it('renders the payload as text, its evidence, omissions and conformance gaps', async () => {
    routeApi();
    renderPanel(
      `/sites/${SITE_ID}?tab=schema&view=detail&generation=${GENERATION_ID}`,
    );

    const payload = await screen.findByTestId('schema-payload');
    expect(payload).toHaveTextContent('"@type":"WebPage"');
    // TEXT node only — the markup never becomes live DOM.
    expect(payload.querySelector('script')).toBeNull();
    expect(screen.getByTestId('schema-evidence-name')).toHaveTextContent(
      'from Page title',
    );
    expect(screen.getByTestId('schema-omission-url')).toHaveTextContent(
      'we hold no fact for it',
    );
    expect(screen.getByTestId('schema-conformance-status')).toHaveTextContent(
      'does not yet conform to schema.org requirements for type WebPage',
    );
    expect(screen.getByTestId('schema-required-gap-url')).toBeInTheDocument();
    expect(screen.getByTestId('schema-recommended-suggestions')).toHaveTextContent(
      'inLanguage',
    );
    expect(screen.getByTestId('schema-registry-version')).toHaveTextContent('1');
  });

  it('renders hostile page facts inert', async () => {
    const hostile = detailResponse({
      payload:
        '{"@type":"WebPage","name":"\\u003C/script\\u003E\\u003Cimg src=x onerror=alert(1)\\u003E"}',
      evidence: [
        {
          property: 'name',
          factId: 'page.title',
          factLabel: 'Page title',
          value: '</script><script>alert(1)</script><img src=x onerror=alert(1)>',
        },
      ],
    });
    routeApi({ detail: () => hostile });
    const { container } = renderPanel(
      `/sites/${SITE_ID}?tab=schema&view=detail&generation=${GENERATION_ID}`,
    );

    expect(await screen.findByTestId('schema-payload')).toHaveTextContent('onerror');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });

  it('localizes persisted evidence labels from their stable fact ids', async () => {
    await changeLanguage('ar');
    routeApi();
    renderPanel(`/sites/${SITE_ID}?tab=schema&view=detail&generation=${GENERATION_ID}`);

    expect(await screen.findByTestId('schema-evidence-name')).toHaveTextContent('عنوان الصفحة');
    expect(screen.getByTestId('schema-evidence-name')).not.toHaveTextContent('Page title');
    expect(screen.getByTestId('schema-payload')).toHaveAttribute('dir', 'ltr');
  });

  it('falls back to an unknown stable fact id instead of persisted server copy', async () => {
    routeApi({
      detail: () =>
        detailResponse({
          evidence: [
            {
              property: 'name',
              factId: 'future.fact[2]',
              factLabel: 'Persisted English label',
              value: 'Traceable value',
            },
          ],
        }),
    });
    renderPanel(`/sites/${SITE_ID}?tab=schema&view=detail&generation=${GENERATION_ID}`);

    expect(await screen.findByTestId('schema-evidence-name')).toHaveTextContent('future.fact[2]');
    expect(screen.getByTestId('schema-evidence-name')).not.toHaveTextContent(
      'Persisted English label',
    );
  });

  it('renders a conforming verdict with no gap sections', async () => {
    routeApi({
      detail: () =>
        detailResponse({
          conformanceStatus: 'conforms',
          omissions: [],
          evidence: [],
          conformance: {
            registryVersion: '1',
            status: 'conforms',
            requiredGaps: [],
            recommendedSuggestions: [],
          },
        }),
    });
    renderPanel(`/sites/${SITE_ID}?tab=schema&view=detail&generation=${GENERATION_ID}`);

    expect(await screen.findByTestId('schema-conformance-status')).toHaveTextContent(
      'conforms to schema.org requirements for type WebPage',
    );
    expect(screen.queryByTestId('schema-required-gaps')).toBeNull();
    expect(screen.queryByTestId('schema-recommended-suggestions')).toBeNull();
    expect(screen.getByTestId('schema-evidence-empty')).toBeInTheDocument();
    expect(screen.getByTestId('schema-omissions-empty')).toBeInTheDocument();
  });

  it('copies the payload and downloads it as a JSON-LD attachment', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:schema');
    const revokeObjectURL = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    routeApi();
    renderPanel(`/sites/${SITE_ID}?tab=schema&view=detail&generation=${GENERATION_ID}`);

    await userEvent.click(await screen.findByTestId('schema-copy'));
    await waitFor(() => expect(mockedClipboard).toHaveBeenCalledOnce());
    expect(await screen.findByTestId('schema-copy')).toHaveTextContent('Copied');

    await userEvent.click(screen.getByTestId('schema-download'));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
    const blob = createObjectURL.mock.calls[0]![0];
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(blob.type).toBe('application/ld+json');
    expect(click).toHaveBeenCalledOnce();
    expect(anchor.href).toBe('blob:schema');
    expect(anchor.download).toBe(`WebPage-${GENERATION_ID}.jsonld`);
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('disables the copy action while the clipboard write is in flight', async () => {
    let finishCopy: ((ok: boolean) => void) | undefined;
    mockedClipboard.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishCopy = resolve;
        }),
    );
    routeApi();
    renderPanel(`/sites/${SITE_ID}?tab=schema&view=detail&generation=${GENERATION_ID}`);

    const copy = await screen.findByTestId('schema-copy');
    await userEvent.click(copy);
    expect(copy).toBeDisabled();
    expect(copy).toHaveAttribute('aria-busy', 'true');

    await act(async () => finishCopy?.(true));
    await waitFor(() => expect(copy).toBeEnabled());
    expect(copy).toHaveTextContent('Copied');
  });

  it('says so when the download call fails', async () => {
    routeApi({
      download: () => {
        throw httpError(404);
      },
    });
    renderPanel(`/sites/${SITE_ID}?tab=schema&view=detail&generation=${GENERATION_ID}`);
    await userEvent.click(await screen.findByTestId('schema-download'));
    expect(await screen.findByTestId('schema-download-failed')).toBeInTheDocument();
  });

  it('keeps the copy control quiet when the clipboard is unavailable', async () => {
    mockedClipboard.mockResolvedValue(false);
    routeApi();
    renderPanel(`/sites/${SITE_ID}?tab=schema&view=detail&generation=${GENERATION_ID}`);
    await userEvent.click(await screen.findByTestId('schema-copy'));
    await waitFor(() => expect(mockedClipboard).toHaveBeenCalledOnce());
    expect(screen.getByTestId('schema-copy')).toHaveTextContent('Copy');
  });

  it('explains a provider failure, with nothing to copy', async () => {
    routeApi({
      detail: () =>
        detailResponse({
          status: 'failed',
          conformanceStatus: null,
          failureReason: 'ai_provider_failed',
          payload: null,
          evidence: [],
          omissions: [],
          conformance: null,
        }),
    });
    renderPanel(`/sites/${SITE_ID}?tab=schema&view=detail&generation=${GENERATION_ID}`);

    expect(await screen.findByTestId('schema-result-failed')).toHaveTextContent(
      'The model did not answer',
    );
    expect(screen.queryByTestId('schema-payload')).toBeNull();
    expect(screen.queryByTestId('schema-copy')).toBeNull();
  });

  it('explains a rejected model answer that kept its provable fields', async () => {
    routeApi({
      detail: () =>
        detailResponse({
          status: 'failed',
          failureReason: 'ai_output_rejected',
        }),
    });
    renderPanel(`/sites/${SITE_ID}?tab=schema&view=detail&generation=${GENERATION_ID}`);

    expect(await screen.findByTestId('schema-result-failed')).toHaveTextContent(
      'failed our fact check',
    );
    expect(screen.getByTestId('schema-payload')).toBeInTheDocument();
  });

  it('surfaces a refused stored detail read', async () => {
    routeApi({
      detail: () => {
        throw httpError(404, 'That generation is no longer available.');
      },
    });
    renderPanel(`/sites/${SITE_ID}?tab=schema&view=detail&generation=${GENERATION_ID}`);
    expect(await screen.findByTestId('schema-state-notFound')).toHaveTextContent(
      'That generation is no longer available.',
    );
  });

  it('re-opens a stored generation for free and returns to the list', async () => {
    const detail = detailResponse();
    routeApi({ list: () => ({ items: [summaryOf(detail)] }) });
    renderPanel();

    await userEvent.click(await screen.findByTestId(`schema-open-${GENERATION_ID}`));
    expect(await screen.findByTestId('schema-result')).toBeInTheDocument();
    expect(search).toContain('view=detail');
    // Re-opening only reads: no preview and no create call was made.
    expect(
      mockedApiClient.mock.calls.filter(([path]) => path === '/schema-generator/preview'),
    ).toHaveLength(0);

    await userEvent.click(screen.getByTestId('schema-back'));
    await screen.findByTestId('schema-page-picker');
    expect(search).not.toContain('view=detail');
    expect(search).not.toContain('generation=');
    expect(screen.getByRole('radio', { name: new RegExp(AUDITED_URL) })).toBeChecked();
    expect(screen.getByLabelText(/WebPage/)).toBeChecked();
  });

  it('renders the three stored statuses in the list', async () => {
    routeApi({
      list: () => ({
        items: [
          summaryOf(detailResponse()),
          summaryOf(
            detailResponse({ id: 'd'.repeat(24), conformanceStatus: 'conforms' }),
          ),
          summaryOf(
            detailResponse({
              id: 'e'.repeat(24),
              status: 'failed',
              conformanceStatus: null,
              failureReason: 'ai_provider_failed',
            }),
          ),
        ],
      }),
    });
    renderPanel();

    const list = await screen.findByTestId('schema-generation-list');
    expect(list).toHaveTextContent('Missing a required property');
    expect(list).toHaveTextContent('Requirements met');
    expect(list).toHaveTextContent('Not generated');
  });

  it('preselects the page named by the report CTA deep link', async () => {
    routeApi();
    renderPanel(`/sites/${SITE_ID}?tab=schema&page=${encodeURIComponent(AUDITED_URL)}`, {
      initialState: {
        ...initialSchemaGeneratorState,
        siteId: SITE_ID,
        form: {
          source: 'url',
          pageUrl: 'https://previous.example.test/page',
          schemaType: 'WebPage',
        },
      },
    });
    await screen.findByTestId('schema-page-picker');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: new RegExp(AUDITED_URL) })).toBeChecked(),
    );
    expect(screen.getByLabelText('Audited page')).toBeChecked();
    expect(screen.getByLabelText('Paste a URL')).not.toBeChecked();
  });

  it('switches the type on the same page and generates again', async () => {
    routeApi({
      create: () =>
        detailResponse({
          id: 'f'.repeat(24),
          schemaType: 'Article',
          conformance: {
            registryVersion: '1',
            status: 'gaps',
            requiredGaps: [{ property: 'datePublished', reasonCode: 'no_evidence' }],
            recommendedSuggestions: [],
          },
        }),
    });
    renderPanel();
    await screen.findByTestId('schema-page-picker');
    await userEvent.click(await screen.findByTestId('schema-audited-option-0'));
    await userEvent.click(screen.getByLabelText(/Article/));
    await userEvent.click(screen.getByTestId('schema-preview-button'));
    await screen.findByTestId('schema-preview');
    await userEvent.click(screen.getByTestId('schema-generate-button'));

    expect(
      await screen.findByTestId('schema-required-gap-datePublished'),
    ).toBeInTheDocument();
  });
});

describe('schema page picker helpers', () => {
  it('groups by the first path segment only when a page sits below one', () => {
    expect(pathGroupOf('https://example.test/ar/page')).toBe('/ar/');
    expect(pathGroupOf('https://example.test/ar/')).toBe('/');
    expect(pathGroupOf('https://example.test/')).toBe('/');
    expect(pathGroupOf('not a url')).toBe('/');
  });

  it('matches the address or the title, case-insensitively, keeping original indexes', () => {
    const pages = [
      { url: 'https://example.test/a', title: 'Hello World' },
      { url: 'https://example.test/B-page', title: null },
      { url: 'https://example.test/c' },
    ];
    expect(filterPages(pages, '  ').map((entry) => entry.index)).toEqual([0, 1, 2]);
    expect(filterPages(pages, 'world').map((entry) => entry.index)).toEqual([0]);
    expect(filterPages(pages, 'b-PAGE').map((entry) => entry.index)).toEqual([1]);
    expect(filterPages(pages, 'zzz')).toEqual([]);
    const groups = groupPages(
      filterPages(
        [
          { url: 'https://example.test/fr/x' },
          { url: 'https://example.test/y' },
          { url: 'https://example.test/fr/z' },
        ],
        '',
      ),
    );
    expect(groups.map((group) => [group.prefix, group.pages.map((entry) => entry.index)])).toEqual([
      ['/fr/', [0, 2]],
      ['/', [1]],
    ]);
  });
});

describe('GenerationList — localized dates', () => {
  it.each(['en', 'ar', 'de'] as const)('shows the generation date for %s', async (locale) => {
    await changeLanguage(locale);
    const generatedAt = '2026-08-01T09:00:00.000Z';
    render(
      <I18nextProvider i18n={i18n}>
        <GenerationList
          generations={[summaryOf(detailResponse({ generatedAt }))]}
          onOpen={vi.fn()}
        />
      </I18nextProvider>,
    );
    const row = screen.getByTestId(`schema-generation-${GENERATION_ID}`);
    expect(row).toHaveTextContent(formatAbsoluteDate(generatedAt, locale));
    expect(row).not.toHaveTextContent('2026-08-01');
    await changeLanguage('en');
  });
});

describe('SchemaGeneratorPanel — user-supplied facts ', () => {
  const REBUILT_ID = 'd'.repeat(24);
  const ALL_SUPPLIABLE = [
    'name', 'headline', 'description', 'inLanguage', 'datePublished',
    'dateModified', 'logo', 'image', 'primaryImageOfPage',
  ] as const;
  const omitted = (properties: readonly string[]) =>
    properties.map((property) => ({ property, reasonCode: 'no_evidence' as const, class: 'recommended' as const }));
  const detailUrl = `/sites/${SITE_ID}?tab=schema&view=detail&generation=${GENERATION_ID}`;

  it('offers an input for every omitted property the user can state, and only those', async () => {
    routeApi({ detail: () => detailResponse({ omissions: [...omitted(ALL_SUPPLIABLE), ...omitted(['sameAs', 'url'])] }) });
    renderPanel(detailUrl);
    await screen.findByTestId('schema-user-facts');
    for (const property of ALL_SUPPLIABLE) {
      expect(screen.getByTestId(`schema-user-fact-${property}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('schema-user-fact-sameAs')).toBeNull();
    expect(screen.queryByTestId('schema-user-fact-url')).toBeNull();
    expect(screen.getByLabelText('Description').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Language')).toHaveAccessibleDescription('A language code such as en or pt-BR.');
    expect(screen.getByLabelText('Logo address')).toHaveAttribute('type', 'url');
    expect(screen.getByLabelText('Logo address')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByLabelText('Publication date')).toHaveAttribute('maxLength', '64');
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('dir');
    expect(screen.getByLabelText('Name')).not.toHaveAccessibleDescription();
    expect(screen.getByText('Free: we reuse the facts already found and use no generation.')).toBeInTheDocument();
  });

  it('rebuilds with trimmed, non-empty values and opens the new generation', async () => {
    const calls: unknown[] = [];
    const rebuilt = detailResponse({
      id: REBUILT_ID,
      regeneratedFrom: GENERATION_ID,
      omissions: [],
      evidence: [
        { property: 'name', factId: 'page.titleBrand', factLabel: 'Brand in the page title', value: 'Guides' },
        { property: 'inLanguage', factId: 'user.inLanguage', factLabel: 'Provided by you', value: 'en' },
      ],
    });
    routeApi({
      detail: () => (calls.length > 0 ? rebuilt : detailResponse({ omissions: omitted(['description', 'inLanguage']) })),
      regenerate: (init) => {
        calls.push(init?.body);
        return rebuilt;
      },
    });
    const { store } = renderPanel(detailUrl);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Language'), 'en');
    await user.type(screen.getByLabelText('Description'), '   ');
    await user.click(screen.getByTestId('schema-user-facts-submit'));

    await waitFor(() => expect(search).toContain(`generation=${REBUILT_ID}`));
    expect(calls).toEqual([{ facts: { inLanguage: 'en' } }]);
    expect(await screen.findByTestId('schema-result-regenerated')).toHaveTextContent('No generation was used.');
    expect(screen.getByTestId('schema-provided-by-you-inLanguage')).toHaveTextContent('Provided by you');
    expect(screen.getByTestId('schema-evidence-name')).toHaveTextContent('from Brand name in the page title');
    // Nothing left out → no form; the rebuilt row leads the stored list.
    expect(screen.queryByTestId('schema-user-facts')).toBeNull();
    expect(selectSchemaGenerations(store.getState() as never)[0]).toMatchObject({ id: REBUILT_ID, regeneratedFrom: GENERATION_ID });
    // The original is never fetched again once the rebuild exists.
    const originalReads = mockedApiClient.mock.calls.filter(([path]) => path === `/schema-generator/generations/${GENERATION_ID}`);
    expect(originalReads).toHaveLength(1);
  });

  it('asks for at least one value instead of sending an empty rebuild', async () => {
    routeApi({ detail: () => detailResponse({ omissions: omitted(['inLanguage']) }) });
    renderPanel(detailUrl);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('schema-user-facts-submit'));
    expect(screen.getByTestId('schema-user-facts-empty')).toHaveTextContent('Fill in at least one field.');
    expect(mockedApiClient.mock.calls.some(([path]) => String(path).endsWith('/regenerate'))).toBe(false);
  });

  it('shows the server refusal beside the form and keeps the original open', async () => {
    routeApi({
      detail: () => detailResponse({ omissions: omitted(['inLanguage']) }),
      regenerate: () => {
        throw httpError(400, 'Enter a valid value.');
      },
    });
    renderPanel(detailUrl);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Language'), 'not a tag');
    await user.click(screen.getByTestId('schema-user-facts-submit'));
    expect(await screen.findByTestId('schema-user-facts-error')).toHaveTextContent('Enter a valid value.');
    expect(search).toContain(`generation=${GENERATION_ID}`);
  });

  it('localizes the new provenance labels and the form in Arabic', async () => {
    await changeLanguage('ar');
    routeApi({
      detail: () => detailResponse({
        omissions: omitted(['inLanguage']),
        evidence: [
          { property: 'name', factId: 'page.ogSiteName', factLabel: 'Site name (og:site_name)', value: 'Brand' },
          { property: 'url', factId: 'page.jsonLdName', factLabel: 'Name in the page’s structured data', value: 'Brand' },
        ],
      }),
    });
    renderPanel(detailUrl);
    expect(await screen.findByTestId('schema-evidence-name')).toHaveTextContent('og:site_name');
    expect(screen.getByTestId('schema-evidence-name')).not.toHaveTextContent('Site name (');
    expect(screen.getByTestId('schema-evidence-url')).toHaveTextContent('البيانات المنظَّمة');
    expect(screen.getByLabelText('اللغة')).toBeInTheDocument();
  });

  it('offers no form for a generation without markup', async () => {
    routeApi({ detail: () => detailResponse({ payload: null, status: 'failed', failureReason: 'ai_provider_failed', omissions: omitted(['inLanguage']) }) });
    renderPanel(detailUrl);
    await screen.findByTestId('schema-result-failed');
    expect(screen.queryByTestId('schema-user-facts')).toBeNull();
  });
});

describe('schemaGeneratorReducer — regenerate ', () => {
  it('records a rebuild refusal, with or without a server gate', () => {
    const base = { ...initialSchemaGeneratorState, regenerateStatus: 'loading' as const };
    const rejected = (payload?: unknown) => ({
      type: 'schemaGenerator/regenerate/rejected',
      payload,
      error: { message: 'Rejected' },
    });
    expect(schemaGeneratorReducer(base, rejected())).toMatchObject({ regenerateStatus: 'error', regenerateGate: null });
    expect(schemaGeneratorReducer(base, rejected({ kind: 'failed', message: 'No' }))).toMatchObject({
      regenerateStatus: 'error',
      regenerateGate: { kind: 'failed', message: 'No' },
    });
  });
});
