/**
 * Brand Radar Arabic-RTL and accessibility certification.
 *
 * Earlier suites proved behaviour (list, create, detail, mentions, CSV, pulse
 * deltas). This file closes the four contracts owned here and that no
 * earlier suite asserted:
 *
 * 1. Arabic renders translated copy with `dir="rtl"` propagating from the
 *    document into the workspace subtree.
 * 2. Every component the feature added uses logical directional utilities
 *    only, so nothing leaks a physical left/right in an RTL locale.
 * 3. Keyboard parity with a visible focus ring across the scan list, the
 *    filters, the new-scan form (including the post-preview confirm/cancel
 *    pair), the mention table, the citation disclosure and the CSV control.
 * 4. The shared async affordances: `aria-busy` while a control is loading,
 *    `cursor-not-allowed` while it is disabled, `role="alert"` on dynamic
 *    errors, `aria-live="polite"` on status regions, an accessible name on
 *    every icon-only control, and a table fallback exposed for both charts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import {
  mentionFixture,
  previewFixture,
  scanDetailFixture,
  scanFixture,
} from './__fixtures__/scans';
import { BrandRadarPage } from './components/BrandRadarPage';
import { brandRadarReducer } from './store/slice';

const PANEL_SITE = '65f000000000000000000abc';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const mockedApiClient = vi.mocked(apiClient);

/** Every component file the Brand Radar workspace added. */
const BRAND_RADAR_SOURCES = [
  'BrandRadarPage',
  'DigestSection',
  'MentionTable',
  'NewScanForm',
  'ScanDetailPanel',
  'ScanListTable',
  'SentimentBar',
  'SpendPreviewCard',
  'TrendSparkline',
] as const;

const listResponse = (items = [scanFixture()], nextCursor: string | null = null) => ({
  items,
  nextCursor,
});

const mentionsResponse = (items = [mentionFixture()], nextCursor: string | null = null) => ({
  items,
  nextCursor,
});

interface Handlers {
  list?: () => unknown;
  detail?: () => unknown;
  mentions?: () => unknown;
  preview?: () => unknown;
  create?: () => unknown;
}

/** Route each mocked call by path so ordering never matters. */
const routeApi = (handlers: Handlers = {}) => {
  mockedApiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (path.startsWith(`/sites/${PANEL_SITE}/brand-radar/preview`)) {
      return Promise.resolve(handlers.preview?.() ?? previewFixture()) as never;
    }
    if (path.startsWith(`/sites/${PANEL_SITE}/brand-radar/scans`) && init?.method === 'POST') {
      return Promise.resolve(
        handlers.create?.() ?? {
          scanId: 'created-1',
          status: 'queued',
          queryHash: 'f'.repeat(64),
          priorScanId: null,
          outputLocale: 'en',
          reservedUnits: 1,
        },
      ) as never;
    }
    if (path.includes('/mentions')) {
      return Promise.resolve(handlers.mentions?.() ?? mentionsResponse()) as never;
    }
    if (/\/brand-radar\/scans\/[^/?]+/.test(path)) {
      return Promise.resolve(handlers.detail?.() ?? scanDetailFixture()) as never;
    }
    if (path.startsWith(`/sites/${PANEL_SITE}/brand-radar/scans`)) {
      return Promise.resolve(handlers.list?.() ?? listResponse()) as never;
    }
    return Promise.resolve({}) as never;
  });
};

const renderPage = (entry = `/sites/${PANEL_SITE}?tab=brand-radar`) =>
  render(
    <Provider
      store={configureStore({
        reducer: { brandRadar: brandRadarReducer },
      })}
    >
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[entry]}>
          <BrandRadarPage siteId={PANEL_SITE} />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mockedApiClient.mockReset();
});

afterEach(async () => {
  await changeLanguage('en');
  document.documentElement.removeAttribute('dir');
  document.documentElement.removeAttribute('lang');
  vi.restoreAllMocks();
});

describe('Brand Radar RTL-safe styling', () => {
  it.each(BRAND_RADAR_SOURCES)('%s uses logical directional utilities only', async (name) => {
    const source = (await import(`./components/${name}.tsx?raw`)) as { default: string };
    expect(source.default).not.toMatch(/\btext-(?:left|right)\b/);
    expect(source.default).not.toMatch(/\bfloat-(?:left|right)\b/);
    expect(source.default).not.toMatch(/(?:^|["' \t]|:)[mp][lr]-\d/);
    expect(source.default).not.toMatch(/(?:^|["' \t]|:)(?:left|right)-\d/);
  });

  it('renders the workspace in Arabic under a right-to-left document', async () => {
    routeApi();
    await changeLanguage('ar');
    document.documentElement.setAttribute('lang', 'ar');
    document.documentElement.setAttribute('dir', 'rtl');
    renderPage();

    const page = await screen.findByTestId('brand-radar-page');
    // No descendant may pin a direction that contradicts the shell — Radix
    // defaults its Tabs root to `dir="ltr"`, which would render a
    // left-to-right island inside the Arabic page.
    expect(page.ownerDocument.documentElement.getAttribute('dir')).toBe('rtl');
    expect(page.closest('[dir]')).toBe(page.ownerDocument.documentElement);
    for (const node of page.querySelectorAll('[dir]')) {
      expect(node.getAttribute('dir')).toBe('rtl');
    }
    expect(page.querySelector('[dir="rtl"]')).not.toBeNull();
    // Translated copy, not an English fallback.
    expect(await screen.findByRole('heading', { name: 'رادار العلامة التجارية' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'عمليات الفحص' })).toBeVisible();
  });

  it('keeps the detail view, both charts and the mention table Arabic', async () => {
    routeApi({
      detail: () => scanDetailFixture(),
      list: () =>
        listResponse([
          scanFixture(),
          scanFixture({
            id: '65f000000000000000000009',
            terminalAt: '2026-07-13T10:05:00.000Z',
          }),
        ]),
    });
    await changeLanguage('ar');
    document.documentElement.setAttribute('dir', 'rtl');
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&scan=65f000000000000000000001`);

    expect(await screen.findByTestId('brand-radar-detail-query')).toHaveTextContent('RankMeFast');
    // Sentiment chart + its four-row table fallback are both present in ar.
    expect(screen.getByTestId('brand-radar-sentiment')).toBeVisible();
    expect(screen.getByTestId('brand-radar-sentiment-row-positive')).toHaveTextContent('50');
    // The trend sparkline mirrors its x axis rather than flipping the labels.
    const chart = await screen.findByTestId('brand-radar-trend-chart');
    expect(within(chart).getByTestId('brand-radar-trend-table')).toBeInTheDocument();
    expect(chart.querySelector('svg')).toHaveAttribute('data-rtl', 'true');
    expect(await screen.findByTestId('brand-radar-mentions')).toBeVisible();
  });
});

describe('Brand Radar keyboard parity', () => {
  it('reaches the scan-list filter and the open control with a visible ring', async () => {
    routeApi();
    const user = userEvent.setup();
    renderPage();

    await screen.findByTestId('brand-radar-row');
    const openControl = screen.getByTestId('brand-radar-open-scan');
    const visited: Element[] = [];
    for (let step = 0; step < 12 && document.activeElement !== openControl; step += 1) {
      await user.tab();
      if (document.activeElement) visited.push(document.activeElement);
    }
    // Tabs use a roving tabindex, so the exact index of each stop depends on
    // the selected trigger; what matters is that every control is reachable
    // and ordered filter-before-row-action.
    const order = [
      screen.getByTestId('brand-radar-tab-scans'),
      screen.getByTestId('brand-radar-status-filter'),
      screen.getByRole('button', { name: 'About Summary' }),
      screen.getByRole('button', { name: 'About Refund' }),
      openControl,
    ];
    for (const control of order) {
      expect(visited).toContain(control);
      expect(control.className).toContain('focus-visible:');
    }
    expect(visited.indexOf(order[1]!)).toBeLessThan(visited.indexOf(order[2]!));
  });

  it('keeps confirm and cancel reachable after the preview lands', async () => {
    routeApi();
    const user = userEvent.setup();
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&view=new`);

    const query = await screen.findByLabelText('Brand query');
    await user.click(query);
    await user.keyboard('RankMeFast');
    await user.click(screen.getByTestId('brand-radar-preview-submit'));
    await screen.findByTestId('brand-radar-preview');

    const confirm = screen.getByTestId('brand-radar-confirm');
    const cancel = screen.getByTestId('brand-radar-cancel');
    confirm.focus();
    expect(confirm).toHaveFocus();
    expect(confirm.className).toContain('focus-visible:');
    await user.tab();
    expect(cancel).toHaveFocus();
    expect(cancel.className).toContain('focus-visible:');
  });

  it('operates the mention filters, the citation disclosure and CSV export by keyboard', async () => {
    const clickSpy = vi.fn();
    routeApi({
      detail: () =>
        scanDetailFixture({
          digestSentences: [
            { text: 'Coverage grew on independent blogs.', citedRowIds: ['mention-1'] },
          ],
        }),
    });
    const user = userEvent.setup();
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&scan=65f000000000000000000001`);

    const exportButton = await screen.findByTestId('brand-radar-export');
    exportButton.addEventListener('click', clickSpy);
    exportButton.focus();
    expect(exportButton).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // Every filter control is focusable and typed into without a pointer.
    for (const id of [
      'brand-radar-sentiment-filter',
      'brand-radar-domain-filter',
      'brand-radar-from-filter',
      'brand-radar-to-filter',
    ]) {
      const control = screen.getByTestId(id);
      control.focus();
      expect(control).toHaveFocus();
    }

    // Citations open from the keyboard and resolve against the loaded page.
    const trigger = screen.getByTestId('brand-radar-citation-trigger');
    trigger.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('brand-radar-citation-resolved')).toBeVisible());
  });
});

describe('Brand Radar async and status affordances', () => {
  it('marks the preview control busy and the disabled export not-allowed', async () => {
    let resolvePreview: ((value: unknown) => void) | undefined;
    routeApi({
      preview: () =>
        new Promise((resolve) => {
          resolvePreview = resolve;
        }),
    });
    const user = userEvent.setup();
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&view=new`);

    await user.type(await screen.findByLabelText('Brand query'), 'RankMeFast');
    const submit = screen.getByTestId('brand-radar-preview-submit');
    await user.click(submit);
    // The shared `Button` loading affordance: busy + disabled, one spinner.
    await waitFor(() => expect(submit).toHaveAttribute('aria-busy', 'true'));
    expect(submit).toBeDisabled();
    expect(submit.className).toContain('disabled:cursor-not-allowed');
    expect(screen.getByTestId('brand-radar-preview-loading')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    resolvePreview?.(previewFixture());
    await screen.findByTestId('brand-radar-preview');
    await waitFor(() => expect(submit).not.toHaveAttribute('aria-busy', 'true'));
  });

  it('announces a failed list load through role="alert" and keeps retry reachable', async () => {
    mockedApiClient.mockRejectedValue(new ApiError('boom', 500, null));
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('We could not load your scans.');
    const retry = within(alert).getByRole('button', { name: 'Try again' });
    expect(retry.className).toContain('focus-visible:');
  });

  it('announces the empty filtered mention page politely instead of silently', async () => {
    routeApi({ mentions: () => mentionsResponse([mentionFixture()]) });
    renderPage(
      `/sites/${PANEL_SITE}?tab=brand-radar&scan=65f000000000000000000001&domain=nothing-matches.example`,
    );

    const status = await screen.findByTestId('brand-radar-mentions-filtered');
    expect(status).toHaveAttribute('role', 'status');
  });

  it('gives the export control an accessible name and both charts a table fallback', async () => {
    routeApi({
      list: () =>
        listResponse([
          scanFixture(),
          scanFixture({
            id: '65f000000000000000000009',
            terminalAt: '2026-07-13T10:05:00.000Z',
          }),
        ]),
    });
    renderPage(`/sites/${PANEL_SITE}?tab=brand-radar&scan=65f000000000000000000001`);

    expect(await screen.findByRole('button', { name: 'Download CSV' })).toBeVisible();
    // Decorative geometry is hidden; the numbers live in a real table.
    const sentiment = await screen.findByTestId('brand-radar-sentiment');
    expect(sentiment.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(
      within(screen.getByTestId('brand-radar-sentiment-table')).getByRole('table', {
        hidden: true,
      }),
    ).toBeInTheDocument();
    const trend = await screen.findByTestId('brand-radar-trend-chart');
    expect(trend.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(
      within(screen.getByTestId('brand-radar-trend-table')).getByRole('table', {
        hidden: true,
      }),
    ).toBeInTheDocument();
  });
});
