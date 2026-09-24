/**
 * Link Intelligence accessibility certification.
 *
 * The keyboard-traversal, visible-focus, `dir="rtl"` and paired light/dark
 * contrast contracts are asserted by other suites
 * (`deep-views.test.tsx`, `gap-workspace.test.tsx`,
 * `link-intelligence-contrast.test.ts`). This file closes two remaining
 * gaps:
 *
 * 1. `prefers-reduced-motion: reduce` must leave the referring-link history
 *    chart completely static — no Web Animations call, no unconditional
 *    `animate-*` / `transition*` utility anywhere in its subtree.
 * 2. Every component added by the Link Intelligence surface must use logical
 *    directional utilities only, so the Arabic RTL rendering has no physical
 *    left/right leakage. The other suites only scanned `BacklinksPanel`.
 *
 * It also extends keyboard traversal past the point the deep-view suite stops:
 * once a spend preview exists the form swaps its single preview button for the
 * confirm/cancel pair, and both must stay reachable with a visible focus ring.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { HistoryChart } from './components/HistoryChart';
import { ReferringDomainsView } from './components/DeepPullViews';
import { backlinksReducer, initialState } from './store/slice';
import type { DeepPullState, SpendPreview } from './types';

const HISTORY_POINTS = [
  { year: 2026, month: 5, backlinks: 40, referringDomains: 12 },
  { year: 2026, month: 6, backlinks: 55, referringDomains: 15 },
  { year: 2026, month: 7, backlinks: 61, referringDomains: 17 },
];

/** Every Link Intelligence component, plus the tab host. */
const LINK_INTELLIGENCE_SOURCES = [
  'BacklinksWorkspace',
  'BacklinksWorkspaceRoute',
  'DeepPullViews',
  'GapWorkspace',
  'HistoryChart',
  'SpendPreviewPanel',
  'ToxicityWorkspace',
] as const;

const previewFixture = (): SpendPreview => ({
  feature: 'link_intelligence',
  operation: 'refDomains',
  cachedStatus: 'fresh_required',
  breakdown: [
    {
      operationKey: 'refDomains',
      metric: 'link_intel_checks',
      productUnits: 1,
      cachedStatus: 'fresh_required',
    },
  ],
  estimatedAt: '2026-07-22T12:00:00.000Z',
});

const cleanDeep = (): DeepPullState => ({
  preview: null,
  run: null,
  previewLoading: false,
  runLoading: false,
  submitting: false,
  error: '',
  errorKind: null,
});

function renderReferringDomains(state: Partial<DeepPullState>) {
  const store = configureStore({
    reducer: { backlinks: backlinksReducer },
    preloadedState: {
      backlinks: {
        ...initialState,
        siteId: 'site-1',
        deepPulls: {
          refDomains: { ...cleanDeep(), ...state },
          anchors: cleanDeep(),
          history: cleanDeep(),
          bulkRanks: cleanDeep(),
        },
      },
    },
  });
  return render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/sites/site-1/backlinks?tab=domains']}>
          <ReferringDomainsView
            siteId="site-1"
            domain="example.com"
            loadStored={false}
          />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
}

/** Utility tokens that apply in EVERY motion mode (no `variant:` prefix). */
function unconditionalTokens(element: Element): string[] {
  return String(element.getAttribute('class') ?? '')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !token.includes(':'));
}

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.restoreAllMocks();
});

describe('Link Intelligence reduced-motion contract', () => {
  it('renders the history chart statically under prefers-reduced-motion: reduce', () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal('matchMedia', matchMedia);
    const animate = vi.fn(() => ({ cancel: vi.fn(), finish: vi.fn() }));
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      writable: true,
      value: animate,
    });

    render(
      <I18nextProvider i18n={i18n}>
        <HistoryChart points={HISTORY_POINTS} />
      </I18nextProvider>,
    );

    const chart = screen.getByTestId('link-history-chart');
    expect(chart).toHaveAttribute('data-motion', 'static');
    // The chart never drives the Web Animations API in any motion mode.
    expect(animate).not.toHaveBeenCalled();
    const svg = chart.querySelector('svg');
    expect(svg).not.toBeNull();
    // The chart shell and its plotted geometry never animate unconditionally.
    // (The data-table fallback below it is the vendored shadcn `Table`, whose
    // `transition-colors` row hover is a colour change, not motion.)
    for (const node of [chart, svg!, ...svg!.querySelectorAll('*')]) {
      for (const token of unconditionalTokens(node)) {
        expect(token).not.toMatch(/^animate-/);
        expect(token).not.toMatch(/^transition/);
      }
    }
    for (const node of [chart, svg!, ...svg!.querySelectorAll('path')]) {
      const className = String(node.getAttribute('class') ?? '');
      expect(className).toContain('motion-reduce:animate-none');
      expect(className).toContain('motion-reduce:transition-none');
    }
    // The accessible data-table fallback stays available in reduced motion.
    expect(screen.getByTestId('link-history-table')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});

describe('Link Intelligence RTL-safe styling', () => {
  it.each(LINK_INTELLIGENCE_SOURCES)('%s uses logical directional utilities only', async (name) => {
    const source = (await import(`./components/${name}.tsx?raw`)) as { default: string };
    expect(source.default).not.toMatch(/\btext-(?:left|right)\b/);
    expect(source.default).not.toMatch(/\bfloat-(?:left|right)\b/);
    expect(source.default).not.toMatch(/(?:^|["' \t]|:)[mp][lr]-\d/);
    expect(source.default).not.toMatch(/(?:^|["' \t]|:)(?:left|right)-\d/);
  });
});

describe('Link Intelligence keyboard traversal past the preview step', () => {
  it('keeps confirm and cancel reachable with a visible focus ring', async () => {
    const user = userEvent.setup();
    renderReferringDomains({ preview: previewFixture() });

    const order = [
      screen.getByLabelText('Minimum domain rank'),
      screen.getByLabelText('Minimum backlinks'),
      screen.getByTestId('link-intel-confirm-refDomains'),
      screen.getByTestId('link-intel-cancel-refDomains'),
    ];
    for (const control of order) {
      await user.tab();
      expect(control).toHaveFocus();
      expect(control.className).toContain('focus-visible:');
    }
  });
});
