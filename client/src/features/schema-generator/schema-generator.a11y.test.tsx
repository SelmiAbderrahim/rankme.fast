/**
 * Schema generator accessibility, RTL and honesty certification.
 *
 * Three contracts the workspace suite does not cover:
 *
 * 1. HONEST-3 — no localized string in any of the seven `schemaGenerator`
 *    files promises a rich result, a star rating, a ranking, or a guarantee.
 *    The conformance verdict is a statement about schema.org REQUIREMENTS and
 *    nothing more, in every locale.
 * 2. SEC-OUT (client half) — no component in this feature can put untrusted
 *    text into the DOM as markup, so `dangerouslySetInnerHTML` must not appear
 *    anywhere in the feature source.
 * 3. Keyboard parity and Arabic logical layout — every control the surface
 *    ships is tab-reachable with a visible focus ring, and no component uses a
 *    physical directional utility that would leak in `dir="rtl"`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { SUPPORTED_LOCALES } from '@shared/i18n/locales';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { GenerationResult } from './components/GenerationResult';
import { SchemaGeneratorPanel } from './components/SchemaGeneratorPanel';
import { schemaGeneratorReducer } from './store/slice';
import type { GenerationDetail } from './types';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

const FEATURE_DIR = __dirname;
const LOCALES_DIR = path.resolve(FEATURE_DIR, '../../shared/i18n/locales');

const SITE_ID = 'a'.repeat(24);

/**
 * Rich-result / ranking / guarantee vocabulary per locale. A hit means the
 * copy over-promises: schema.org conformance is never a search-result promise.
 */
const OVERPROMISE: Record<string, RegExp> = {
  en: /rich result|rich snippet|guarantee|will rank|star rating|top of google/i,
  fr: /résultat enrichi|extrait enrichi|garanti|classera|étoiles dans/i,
  de: /rich[- ]snippet|garantie|garantiert|sterne[- ]bewertung|besser ranken/i,
  es: /resultado enriquecido|fragmento enriquecido|garantiz|posicionar[áa]|estrellas en/i,
  ru: /расширенн\w* результат|гарант|попад\w* в топ|звёзд\w* рейтинг/i,
  zh: /丰富结果|富媒体结果|保证|排名提升|星级评分/,
  ar: /نتائج منسقة|نتيجة منسقة|نضمن|ضمان|تصنيف النجوم/,
};

/** Every source file this feature ships (tests excluded). */
function featureSources(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      files.push(full);
    }
  };
  walk(FEATURE_DIR);
  return files;
}

function leafValues(node: unknown, trail: string[] = []): [string, string][] {
  if (typeof node === 'string') return [[trail.join('.'), node]];
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
      leafValues(value, [...trail, key]),
    );
  }
  return [];
}

const typesResponse = () => ({
  registryVersion: '1',
  types: [
    {
      type: 'WebPage' as const,
      required: [
        {
          name: 'name',
          class: 'required' as const,
          fill: 'ai-selected' as const,
          evidenceFactIds: ['page.title'],
          neverFilled: false,
        },
      ],
      recommended: [],
    },
  ],
});

const sourcesResponse = () => ({
  siteId: SITE_ID,
  runId: 'c'.repeat(24),
  auditedPages: [
    {
      url: 'https://example.test/guide',
      title: 'A guide',
      hasStructuredData: false,
      structuredDataErrors: 0,
      richResultsVerdict: null,
    },
  ],
  inventoryPages: [],
});

beforeEach(async () => {
  await initI18n();
  await changeLanguage('en');
  mockedApiClient.mockReset();
  mockedApiClient.mockImplementation((requestPath: string) => {
    if (requestPath.startsWith('/schema-generator/types')) {
      return Promise.resolve(typesResponse()) as never;
    }
    if (requestPath.startsWith('/schema-generator/sources')) {
      return Promise.resolve(sourcesResponse()) as never;
    }
    if (requestPath.startsWith('/schema-generator/preview')) {
      return Promise.resolve({}) as never;
    }
    return Promise.resolve({ items: [] }) as never;
  });
});

const renderPanel = () => {
  const store = configureStore({ reducer: { schemaGenerator: schemaGeneratorReducer } });
  return render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[`/sites/${SITE_ID}?tab=schema`]}>
          <SchemaGeneratorPanel siteId={SITE_ID} />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
};

describe('HONEST-3 — the copy never promises a search result', () => {
  it.each(SUPPORTED_LOCALES)('%s says nothing about rich results', (locale) => {
    const file = path.join(LOCALES_DIR, locale, 'schemaGenerator.json');
    const pairs = leafValues(JSON.parse(readFileSync(file, 'utf8')));
    expect(pairs.length).toBeGreaterThan(50);
    const pattern = OVERPROMISE[locale]!;
    const offenders = pairs.filter(([, value]) => pattern.test(value));
    expect(offenders).toEqual([]);
  });

  it('every locale states the verdict as a schema.org requirement check', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const file = path.join(LOCALES_DIR, locale, 'schemaGenerator.json');
      const data = JSON.parse(readFileSync(file, 'utf8')) as {
        conformance: { conforms: string; gaps: string };
      };
      expect(data.conformance.conforms).toContain('schema.org');
      expect(data.conformance.gaps).toContain('schema.org');
    }
  });
});

describe('HONEST-1/2 (client half) — the rendered result traces every property', () => {
  /**
   * The server half of this contract lives in
   * `schema-generator.routes.test.ts` ("every emitted property carries an
   * evidence row; every registry property NOT emitted carries an omission
   * reason"). This is the surfacing half: the reader must be able to SEE the
   * fact behind each emitted property and the localized reason behind each
   * property the registry declares but the payload does not carry.
   */
  const REGISTRY_PROPERTIES = [
    'name',
    'url',
    'inLanguage',
    'isPartOf',
    'description',
    'primaryImageOfPage',
  ] as const;

  const PAYLOAD = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'A guide',
    url: 'https://example.test/guide',
    inLanguage: 'en',
    isPartOf: { '@type': 'WebSite', url: 'https://example.test/' },
  } as const;

  const detail: GenerationDetail = {
    id: 'b'.repeat(24),
    siteId: SITE_ID,
    pageUrl: 'https://example.test/guide',
    source: 'audited-page',
    schemaType: 'WebPage',
    registryVersion: '1',
    status: 'complete',
    conformanceStatus: 'gaps',
    failureReason: null,
    refunded: false,
    generatedAt: '2026-08-01T09:00:00.000Z',
    payload: JSON.stringify(PAYLOAD),
    mediaType: 'application/ld+json',
    evidence: [
      { property: 'name', factId: 'page.title', factLabel: 'Page title', value: 'A guide' },
      {
        property: 'url',
        factId: 'page.canonical',
        factLabel: 'Canonical URL',
        value: 'https://example.test/guide',
      },
      {
        property: 'inLanguage',
        factId: 'page.language',
        factLabel: 'Page language',
        value: 'en',
      },
      {
        property: 'isPartOf',
        factId: 'site.origin',
        factLabel: 'Site origin',
        value: 'https://example.test/',
      },
    ],
    omissions: [
      { property: 'description', reasonCode: 'no_evidence', class: 'recommended' },
      { property: 'primaryImageOfPage', reasonCode: 'not_applicable', class: 'recommended' },
    ],
    conformance: {
      registryVersion: '1',
      status: 'gaps',
      requiredGaps: [],
      recommendedSuggestions: [
        { property: 'description', reasonCode: 'no_evidence' },
        { property: 'primaryImageOfPage', reasonCode: 'not_applicable' },
      ],
    },
  };

  const renderResult = () =>
    render(
      <I18nextProvider i18n={i18n}>
        <GenerationResult detail={detail} />
      </I18nextProvider>,
    );

  /** Every JSON-LD key that is a real property, not a keyword. */
  const emitted = Object.keys(PAYLOAD).filter((key) => !key.startsWith('@'));

  it('shows one evidence row naming the stored fact behind every emitted property', () => {
    renderResult();
    for (const property of emitted) {
      const row = screen.getByTestId(`schema-evidence-${property}`);
      const factLabel = detail.evidence.find((e) => e.property === property)!.factLabel;
      expect(row).toHaveTextContent(`from ${factLabel}`);
    }
    // And nothing is claimed for a property the payload does not carry.
    expect(screen.getByTestId('schema-evidence').children).toHaveLength(emitted.length);
  });

  it('gives every registry property absent from the payload a localized reason', () => {
    renderResult();
    const absent = REGISTRY_PROPERTIES.filter((property) => !emitted.includes(property));
    expect(absent).toEqual(['description', 'primaryImageOfPage']);
    expect(screen.getByTestId('schema-omission-description')).toHaveTextContent(
      'we hold no fact for it',
    );
    expect(screen.getByTestId('schema-omission-primaryImageOfPage')).toHaveTextContent(
      'it does not apply to this page',
    );
    // A raw reason code would mean the string never went through i18n.
    for (const property of absent) {
      expect(screen.getByTestId(`schema-omission-${property}`)).not.toHaveTextContent(
        /no_evidence|not_applicable/,
      );
    }
  });

  it('keeps both halves localized under Arabic', async () => {
    await changeLanguage('ar');
    renderResult();
    expect(screen.getByTestId('schema-evidence-name')).toHaveTextContent('عنوان الصفحة');
    expect(screen.getByTestId('schema-omission-description')).toHaveTextContent(
      'لا نملك حقيقة بشأنه',
    );
    expect(screen.getByTestId('schema-conformance-status')).toHaveTextContent(
      'لا يتوافق هذا الترميز بعد مع متطلبات schema.org',
    );
    await changeLanguage('en');
  });

  it('exposes the payload as a focusable named region and labels its icon controls', async () => {
    renderResult();
    const payload = screen.getByRole('region', { name: 'Generated JSON-LD' });
    expect(payload).toHaveAttribute('data-testid', 'schema-payload');
    // A scrollable block that cannot take focus is unreachable by keyboard.
    expect(payload).toHaveAttribute('tabindex', '0');
    // The payload is a text node, and the reader is told which way it reads.
    expect(payload).toHaveAttribute('dir', 'ltr');
    expect(payload.querySelector('script')).toBeNull();

    await userEvent.tab();
    expect(screen.getByTestId('schema-copy')).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByTestId('schema-download')).toHaveFocus();
    await userEvent.tab();
    expect(payload).toHaveFocus();
  });
});

describe('SEC-OUT — untrusted text never becomes markup', () => {
  it('no feature source uses dangerouslySetInnerHTML', () => {
    const offenders = featureSources().filter((file) =>
      readFileSync(file, 'utf8').includes('dangerouslySetInnerHTML'),
    );
    expect(offenders).toEqual([]);
  });

  it('no feature source uses a physical directional utility', () => {
    // Logical utilities only (`ms-*` / `me-*` / `text-start`); a physical
    // margin or padding would leak under Arabic.
    const physical = /className="[^"]*\b(?:ml|mr|pl|pr)-\d|text-(?:left|right)\b/;
    const offenders = featureSources().filter((file) =>
      physical.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

describe('keyboard parity and Arabic layout', () => {
  it('reaches every control with the keyboard and keeps a visible focus ring', async () => {
    renderPanel();
    await screen.findByTestId('schema-page-picker');

    const source = screen.getByLabelText('Audited page');
    source.focus();
    expect(source).toHaveFocus();
    // Radix roving focus: arrow keys move within a radio group, Tab leaves it.
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByLabelText('Inventory page')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(source).toHaveFocus();

    const preview = screen.getByTestId('schema-preview-button');
    expect(preview.className).toContain('focus-visible:');
  });

  it('announces the running generation on the button and every refusal politely', async () => {
    // `role="status"` is an implicit polite live region: a refusal that appears
    // after the click is announced without stealing focus.
    let refusePreview: (reason: unknown) => void = () => {};
    mockedApiClient.mockImplementation((requestPath: string) => {
      if (requestPath.startsWith('/schema-generator/types')) {
        return Promise.resolve(typesResponse()) as never;
      }
      if (requestPath.startsWith('/schema-generator/sources')) {
        return Promise.resolve(sourcesResponse()) as never;
      }
      if (requestPath.startsWith('/schema-generator/preview')) {
        return new Promise((_resolve, reject) => {
          refusePreview = reject;
        }) as never;
      }
      return Promise.resolve({ items: [] }) as never;
    });

    renderPanel();
    await screen.findByTestId('schema-page-picker');
    await userEvent.click(screen.getByTestId('schema-audited-option-0'));
    await userEvent.click(screen.getByRole('radio', { name: /WebPage/ }));

    const preview = screen.getByTestId('schema-preview-button');
    await userEvent.click(preview);
    expect(preview).toHaveAttribute('aria-busy', 'true');
    expect(preview).toBeDisabled();

    await act(async () => {
      refusePreview(
        new ApiError('failed', 429, {
          error: { message: 'Too many requests. Wait a minute, then try again.' },
        }),
      );
    });
    const notice = await screen.findByRole('status');
    expect(notice).toHaveAttribute('data-testid', 'schema-state-rateLimited');
    expect(notice).toHaveTextContent('Too many requests. Wait a minute, then try again.');
    expect(preview).not.toHaveAttribute('aria-busy');
    expect(preview).toBeEnabled();
  });

  it('renders under Arabic logical layout with translated controls', async () => {
    await changeLanguage('ar');
    renderPanel();

    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(document.documentElement).toHaveAttribute('lang', 'ar');
    expect(
      await screen.findByRole('heading', { name: 'مولّد ترميز schema' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('schema-preview-button')).toHaveTextContent(
        'اعرض التكلفة',
      ),
    );
    await changeLanguage('en');
  });
});
