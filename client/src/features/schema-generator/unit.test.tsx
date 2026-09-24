/**
 * Unit-level cover for the seams the workspace journey cannot reach: abort
 * signals on the read calls, the `?page=` writer, the defensive allowance
 * fallback, and every reducer branch that only fires when a thunk rejects
 * without a `rejectWithValue` payload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import {
  createGeneration,
  createSchemaGeneration,
  downloadSchemaGeneration,
  fetchGeneration,
  fetchGenerations,
  fetchSources,
  fetchTypes,
  fetchSchemaGeneration,
  fetchSchemaGenerations,
  fetchSchemaSources,
  fetchSchemaTypes,
  previewGeneration,
  previewSchemaGeneration,
} from './api';
import { GenerationResult } from './components/GenerationResult';
import { SpendDisclosure } from './components/SpendDisclosure';
import { schemaGeneratorReducer } from './store/slice';
import {
  createSchemaGenerationThunk,
  loadSchemaGeneration,
  loadSchemaGenerations,
  loadSchemaSources,
  loadSchemaTypes,
  previewSchemaGenerationThunk,
} from './store/thunks';
import { useSchemaUrlState } from './urlState';
import { initialSchemaGeneratorState } from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

vi.mock('@shared/lib/clipboard', () => ({
  writeToClipboard: vi.fn(async () => true),
}));

const mockedApiClient = vi.mocked(apiClient);

beforeEach(async () => {
  await initI18n();
  await changeLanguage('en');
  mockedApiClient.mockReset();
  mockedApiClient.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api wrappers', () => {
  it('exposes the six frozen spec call names as aliases of the shipped wrappers', () => {
    expect(fetchTypes).toBe(fetchSchemaTypes);
    expect(fetchSources).toBe(fetchSchemaSources);
    expect(previewGeneration).toBe(previewSchemaGeneration);
    expect(createGeneration).toBe(createSchemaGeneration);
    expect(fetchGenerations).toBe(fetchSchemaGenerations);
    expect(fetchGeneration).toBe(fetchSchemaGeneration);
  });

  it('forwards an abort signal on every read and omits it when absent', async () => {
    const controller = new AbortController();
    const signal = controller.signal;

    await fetchSchemaTypes({ signal });
    await fetchSchemaTypes();
    await fetchSchemaSources('site-1', { signal });
    await fetchSchemaSources('site-1');
    await fetchSchemaGenerations('site-1', { signal });
    await fetchSchemaGenerations('site-1');
    await fetchSchemaGeneration('gen-1', { signal });
    await fetchSchemaGeneration('gen-1');

    const calls = mockedApiClient.mock.calls;
    expect(calls[0]?.[1]).toEqual({ signal });
    expect(calls[1]?.[1]).toEqual({});
    expect(calls[2]?.[0]).toBe('/schema-generator/sources?siteId=site-1');
    expect(calls[3]?.[1]).toEqual({});
    expect(calls[4]?.[0]).toBe('/schema-generator/generations?siteId=site-1');
    expect(calls[5]?.[1]).toEqual({});
    expect(calls[6]?.[0]).toBe('/schema-generator/generations/gen-1');
    expect(calls[7]?.[1]).toEqual({});
  });

  it('posts the preview and create bodies and asks for JSON-LD on download', async () => {
    const request = {
      siteId: 'site-1',
      source: 'url' as const,
      pageUrl: 'https://example.test/x',
      schemaType: 'WebPage' as const,
    };
    await previewSchemaGeneration(request);
    await createSchemaGeneration(request);
    await downloadSchemaGeneration('gen-1');

    expect(mockedApiClient.mock.calls[0]).toEqual([
      '/schema-generator/preview',
      { method: 'POST', body: request },
    ]);
    expect(mockedApiClient.mock.calls[1]).toEqual([
      '/schema-generator/generations',
      { method: 'POST', body: request, timeoutMs: 60_000 },
    ]);
    expect(mockedApiClient.mock.calls[2]).toEqual([
      '/schema-generator/generations/gen-1/download',
      {
        localeMode: 'artifact',
        allowLegacyNullContentLanguage: true,
        headers: { Accept: 'application/ld+json' },
      },
    ]);
  });
});

describe('useSchemaUrlState', () => {
  const Probe = () => {
    const [state, setState] = useSchemaUrlState();
    const location = useLocation();
    return (
      <div>
        <span data-testid="view">{state.view}</span>
        <span data-testid="generation">{state.generationId ?? 'none'}</span>
        <span data-testid="page">{state.page ?? 'none'}</span>
        <span data-testid="search">{location.search}</span>
        <button type="button" onClick={() => setState({ page: 'https://example.test/a' })}>
          set page
        </button>
        <button type="button" onClick={() => setState({ page: null })}>
          clear page
        </button>
      </div>
    );
  };

  const renderProbe = (entry: string) =>
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Probe />
      </MemoryRouter>,
    );

  it('coerces an unknown view without rewriting a sibling tab deep link', () => {
    renderProbe('/sites/1?tab=google&view=queries');
    expect(screen.getByTestId('view')).toHaveTextContent('list');
    // Read-only coercion: the Google tab's own `?view=` survives untouched.
    expect(screen.getByTestId('search')).toHaveTextContent('view=queries');
  });

  it('reads a detail deep link and writes the page parameter both ways', async () => {
    renderProbe('/sites/1?tab=schema&view=detail&generation=g1&page=https%3A%2F%2Fx.test');
    expect(screen.getByTestId('view')).toHaveTextContent('detail');
    expect(screen.getByTestId('generation')).toHaveTextContent('g1');
    expect(screen.getByTestId('page')).toHaveTextContent('https://x.test');

    await userEvent.click(screen.getByRole('button', { name: 'set page' }));
    expect(screen.getByTestId('page')).toHaveTextContent('https://example.test/a');

    await userEvent.click(screen.getByRole('button', { name: 'clear page' }));
    expect(screen.getByTestId('page')).toHaveTextContent('none');
    expect(screen.getByTestId('search')).not.toHaveTextContent('page=');
  });
});

describe('SpendDisclosure', () => {
  it('discloses that usage is not metered', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SpendDisclosure />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('schema-preview')).toHaveTextContent(
      'Plan usage limits are not metered in self-hosted mode.',
    );
  });
});

describe('GenerationResult copy affordance', () => {
  it('returns the copy button to its resting label after the confirmation window', async () => {
    render(
      <I18nextProvider i18n={i18n}>
        <GenerationResult
          detail={{
            id: 'g1',
            siteId: 's1',
            pageUrl: 'https://example.test/x',
            source: 'audited-page',
            schemaType: 'WebPage',
            registryVersion: '1',
            status: 'complete',
            conformanceStatus: 'conforms',
            failureReason: null,
            refunded: false,
            generatedAt: '2026-08-01T09:00:00.000Z',
            payload: '{"@type":"WebPage"}',
            mediaType: 'application/ld+json',
            evidence: [],
            omissions: [],
            conformance: null,
          }}
        />
      </I18nextProvider>,
    );

    await userEvent.click(screen.getByTestId('schema-copy'));
    expect(screen.getByTestId('schema-copy')).toHaveTextContent('Copied');
    // Real timers: `initI18n` in `beforeEach` awaits a real microtask chain,
    // which deadlocks under `vi.useFakeTimers()`. The window is 2s.
    await waitFor(
      () => expect(screen.getByTestId('schema-copy')).toHaveTextContent('Copy'),
      { timeout: 4_000 },
    );
  });
});

describe('schemaGeneratorReducer', () => {
  const reduce = schemaGeneratorReducer;

  it('records a failed registry read', () => {
    const next = reduce(initialSchemaGeneratorState, loadSchemaTypes.rejected(
      new Error('x'),
      'rid',
      undefined,
    ));
    expect(next.typesStatus).toBe('error');
  });

  it('falls back to a null gate when a thunk rejects without a payload', () => {
    const error = new Error('boom');
    const cases = [
      { action: loadSchemaSources.rejected(error, 'r', 'site-1'), key: 'sourcesGate' },
      { action: loadSchemaGenerations.rejected(error, 'r', 'site-1'), key: 'listGate' },
      { action: loadSchemaGeneration.rejected(error, 'r', 'gen-1'), key: 'detailGate' },
    ] as const;
    for (const entry of cases) {
      const next = reduce(initialSchemaGeneratorState, entry.action);
      expect(next[entry.key]).toBeNull();
    }

    const request = {
      siteId: 'site-1',
      source: 'audited-page' as const,
      pageUrl: 'https://example.test/x',
      schemaType: 'WebPage' as const,
    };
    expect(
      reduce(
        initialSchemaGeneratorState,
        previewSchemaGenerationThunk.rejected(error, 'r', request),
      ).previewGate,
    ).toBeNull();
    expect(
      reduce(
        initialSchemaGeneratorState,
        createSchemaGenerationThunk.rejected(error, 'r', request),
      ).generateGate,
    ).toBeNull();
  });

  it('keeps the registry projection when the site changes and resets on a new site', () => {
    const seeded = {
      ...initialSchemaGeneratorState,
      siteId: 'site-1',
      registryVersion: '1',
      typesStatus: 'ready' as const,
      generations: [
        {
          id: 'g1',
          siteId: 'site-1',
          pageUrl: 'https://example.test/x',
          source: 'audited-page' as const,
          schemaType: 'WebPage' as const,
          registryVersion: '1',
          status: 'complete' as const,
          conformanceStatus: 'conforms' as const,
          failureReason: null,
          refunded: false,
          generatedAt: '2026-08-01T09:00:00.000Z',
        },
      ],
    };
    const same = reduce(seeded, { type: 'schemaGenerator/setSchemaSiteId', payload: 'site-1' });
    expect(same.generations).toHaveLength(1);

    const moved = reduce(seeded, {
      type: 'schemaGenerator/setSchemaSiteId',
      payload: 'site-2',
    });
    expect(moved.generations).toEqual([]);
    expect(moved.registryVersion).toBe('1');
    expect(moved.typesStatus).toBe('ready');
  });

  it('drops the chosen page and any stale preview when the source changes', () => {
    const seeded = {
      ...initialSchemaGeneratorState,
      form: {
        ...initialSchemaGeneratorState.form,
        pageUrl: 'https://example.test/x',
      },
      preview: {},
      previewStatus: 'ready' as const,
    };
    const next = reduce(seeded, {
      type: 'schemaGenerator/setSchemaSource',
      payload: 'url',
    });
    expect(next.form.pageUrl).toBe('');
    expect(next.preview).toBeNull();
    expect(next.previewStatus).toBe('idle');

    const cleared = reduce(seeded, { type: 'schemaGenerator/clearSchemaPreview' });
    expect(cleared.preview).toBeNull();
  });
});
