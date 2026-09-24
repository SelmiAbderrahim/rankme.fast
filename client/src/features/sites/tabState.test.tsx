import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  APP_SEO_VIEWS,
  DEFAULT_APP_SEO_VIEW,
  DEFAULT_SITE_TAB,
  SITE_TAB_GROUPS,
  SITE_TAB_LABEL_KEYS,
  SITE_SUB_VIEWS,
  SITE_TABS,
  getSiteTabGroup,
  getSiteTabLabelKey,
  isAppSeoView,
  isSiteSubView,
  isSiteTab,
  useAppSeoView,
  useSiteSubView,
  useSiteTab,
  type AppSeoView,
  type SiteSubView,
  type SiteTab,
} from './tabState';

describe('sites/tabState — constants + guards', () => {
  it('lists the twenty-four workspace tabs in the documented order', () => {
    expect(SITE_TABS).toEqual([
      'overview',
      'pages',
      'actions',
      'report',
      'client-reports',
      'keywords',
      'serp-features',
      'keyword-clusters',
      'research',
      'traffic',
      'backlinks',
      'competitors',
      'ai-visibility',
      'brand-radar',
      'apps',
      'local-seo',
      'reviews',
      'geogrid',
      'google',
      'content',
      'internal-links',
      'cannibalization',
      'audience-research',
      'schema',
    ]);
    expect(DEFAULT_SITE_TAB).toBe('overview');
  });

  it('isSiteTab accepts valid tab strings and rejects everything else', () => {
    for (const tab of SITE_TABS) {
      expect(isSiteTab(tab)).toBe(true);
    }
    expect(isSiteTab('nope')).toBe(false);
    expect(isSiteTab(null)).toBe(false);
    expect(isSiteTab(undefined)).toBe(false);
    expect(isSiteTab(42)).toBe(false);
  });

  it('groups every non-overview destination exactly once in workflow order', () => {
    expect(SITE_TAB_GROUPS.map(({ id, tabs }) => ({ id, tabs: [...tabs] }))).toEqual([
      {
        id: 'audit-reports',
        tabs: ['actions', 'pages', 'report', 'client-reports'],
      },
      {
        id: 'search',
        tabs: ['keywords', 'serp-features', 'keyword-clusters', 'research', 'google'],
      },
      {
        id: 'visibility',
        tabs: ['traffic', 'backlinks', 'competitors', 'ai-visibility', 'brand-radar'],
      },
      {
        id: 'content',
        tabs: ['content', 'internal-links', 'cannibalization', 'audience-research', 'schema'],
      },
      {
        id: 'local-apps',
        tabs: ['local-seo', 'reviews', 'geogrid', 'apps'],
      },
    ]);
    const groupedTabs = SITE_TAB_GROUPS.flatMap((group) => [...group.tabs]);
    expect(groupedTabs).toHaveLength(SITE_TABS.length - 1);
    expect(new Set(groupedTabs).size).toBe(groupedTabs.length);
    expect(new Set(['overview', ...groupedTabs])).toEqual(new Set(SITE_TABS));
    expect(getSiteTabGroup('overview')).toBeUndefined();
    expect(getSiteTabGroup('brand-radar')?.id).toBe('visibility');
    expect(getSiteTabGroup('apps')?.id).toBe('local-apps');
  });

  it('defines one canonical translation key for every destination', () => {
    expect(Object.keys(SITE_TAB_LABEL_KEYS)).toEqual([...SITE_TABS]);
    for (const tab of SITE_TABS) {
      expect(getSiteTabLabelKey(tab)).toBe(SITE_TAB_LABEL_KEYS[tab]);
    }
    expect(getSiteTabLabelKey('pages')).toBe('pages:workspaceTab');
    expect(getSiteTabLabelKey('traffic')).toBe('competitorsTraffic:title');
    expect(getSiteTabLabelKey('client-reports')).toBe('clientReports:dashboard.title');
  });
});

const AppViewHarness = () => {
  const [view, setView] = useAppSeoView();
  return (
    <>
      <HistoryProbe />
      <div data-testid="app-view-value">{view}</div>
      <button data-testid="set-app-reviews" onClick={() => setView('reviews')}>
        set
      </button>
    </>
  );
};

describe('sites/tabState — App SEO URL-backed views', () => {
  it('declares all seven views with profiles as the default', () => {
    expect(APP_SEO_VIEWS).toEqual([
      'profiles',
      'keywords',
      'listing',
      'charts',
      'research',
      'reviews',
      'compare',
    ]);
    expect(DEFAULT_APP_SEO_VIEW).toBe('profiles');
    for (const view of APP_SEO_VIEWS as readonly AppSeoView[]) {
      expect(isAppSeoView(view)).toBe(true);
    }
    expect(isAppSeoView('nope')).toBe(false);
    expect(isAppSeoView(null)).toBe(false);
  });

  it('defaults and normalizes an invalid value to profiles', async () => {
    renderAt('/sites/site-1?tab=apps&view=nope', <AppViewHarness />);
    expect(screen.getByTestId('app-view-value')).toHaveTextContent('profiles');
    await waitFor(() => expect(capturedSearch).toBe('?tab=apps&view=profiles'));
  });

  it('reads every valid value and writes view without pushing history', async () => {
    for (const view of APP_SEO_VIEWS) {
      const { unmount } = renderAt(`/sites/site-1?tab=apps&view=${view}`, <AppViewHarness />);
      expect(screen.getByTestId('app-view-value')).toHaveTextContent(view);
      unmount();
    }
    renderAt('/sites/site-1?tab=apps', <AppViewHarness />);
    const before = historyLength;
    await userEvent.setup().click(screen.getByTestId('set-app-reviews'));
    await waitFor(() => expect(capturedSearch).toBe('?tab=apps&view=reviews'));
    expect(historyLength).toBe(before);
  });
});

let capturedSearch = '';
let historyLength = 0;

const HistoryProbe = () => {
  const location = useLocation();
  capturedSearch = location.search;
  historyLength = window.history.length;
  return null;
};

const Harness = ({ start }: { start?: SiteTab } = {}) => {
  const [tab, setTab] = useSiteTab();
  return (
    <>
      <HistoryProbe />
      <div data-testid="tab-value">{tab}</div>
      <button data-testid="set-report" onClick={() => setTab(start ?? 'report')}>
        set
      </button>
    </>
  );
};

const renderAt = (path: string, element: React.ReactNode = <Harness />) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sites/:siteId" element={element} />
      </Routes>
    </MemoryRouter>,
  );

describe('useSiteTab — default, deep link, invalid, setter', () => {
  it('defaults to overview when no ?tab= is present', () => {
    renderAt('/sites/site-1');
    expect(screen.getByTestId('tab-value')).toHaveTextContent('overview');
  });

  it('reads a valid ?tab= value from the URL', () => {
    renderAt('/sites/site-1?tab=keywords');
    expect(screen.getByTestId('tab-value')).toHaveTextContent('keywords');
  });

  it('falls back to overview for an invalid ?tab= value', () => {
    renderAt('/sites/site-1?tab=bogus');
    expect(screen.getByTestId('tab-value')).toHaveTextContent('overview');
  });

  it('setter writes ?tab= without pushing to browser history (replace:true)', async () => {
    renderAt('/sites/site-1');
    const before = historyLength;
    const user = userEvent.setup();
    await user.click(screen.getByTestId('set-report'));
    await waitFor(() => expect(capturedSearch).toBe('?tab=report'));
    expect(historyLength).toBe(before);
  });

  it('setter preserves unrelated query parameters', async () => {
    renderAt('/sites/site-1?utm=workspace&view=summary');
    await userEvent.setup().click(screen.getByTestId('set-report'));
    await waitFor(() => expect(new URLSearchParams(capturedSearch).get('tab')).toBe('report'));
    const params = new URLSearchParams(capturedSearch);
    expect(params.get('utm')).toBe('workspace');
    expect(params.get('view')).toBe('summary');
  });
});

const SubViewHarness = () => {
  const [view, setView] = useSiteSubView();
  return (
    <>
      <HistoryProbe />
      <div data-testid="view-value">{view ?? 'none'}</div>
      <button data-testid="set-queries" onClick={() => setView('queries')}>
        set
      </button>
      <button data-testid="clear-view" onClick={() => setView(null)}>
        clear
      </button>
    </>
  );
};

describe('sites/tabState — sub-view constants + guards', () => {
  it('lists the five drill-in views in the documented order', () => {
    expect(SITE_SUB_VIEWS).toEqual(['queries', 'pages', 'countries', 'devices', 'sitemaps']);
  });

  it('isSiteSubView accepts valid views and rejects everything else', () => {
    for (const view of SITE_SUB_VIEWS) {
      expect(isSiteSubView(view)).toBe(true);
    }
    expect(isSiteSubView('nope')).toBe(false);
    expect(isSiteSubView(null)).toBe(false);
    expect(isSiteSubView(undefined)).toBe(false);
    expect(isSiteSubView(42)).toBe(false);
  });
});

describe('useSiteSubView — default, deep link, invalid, setter, clear', () => {
  it('reads null (overview) when no ?view= is present', () => {
    renderAt('/sites/site-1?tab=google', <SubViewHarness />);
    expect(screen.getByTestId('view-value')).toHaveTextContent('none');
  });

  it('reads a valid ?view= value from the URL', () => {
    renderAt('/sites/site-1?tab=google&view=pages', <SubViewHarness />);
    expect(screen.getByTestId('view-value')).toHaveTextContent('pages');
  });

  it('falls back to null for an invalid ?view= value', () => {
    renderAt('/sites/site-1?tab=google&view=bogus', <SubViewHarness />);
    expect(screen.getByTestId('view-value')).toHaveTextContent('none');
  });

  it('setter writes ?view= while preserving ?tab=google, without a history push', async () => {
    renderAt('/sites/site-1?tab=google', <SubViewHarness />);
    const before = historyLength;
    const user = userEvent.setup();
    await user.click(screen.getByTestId('set-queries'));
    await waitFor(() => expect(capturedSearch).toBe('?tab=google&view=queries'));
    expect(screen.getByTestId('view-value')).toHaveTextContent('queries');
    expect(historyLength).toBe(before);
  });

  it('setter(null) clears ?view= and keeps ?tab=google (the back link)', async () => {
    renderAt('/sites/site-1?tab=google&view=queries', <SubViewHarness />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('clear-view'));
    await waitFor(() => expect(capturedSearch).toBe('?tab=google'));
    expect(screen.getByTestId('view-value')).toHaveTextContent('none');
  });

  it('accepts every declared view value round-trip', () => {
    for (const view of SITE_SUB_VIEWS as readonly SiteSubView[]) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[`/sites/site-1?tab=google&view=${view}`]}>
          <Routes>
            <Route path="/sites/:siteId" element={<SubViewHarness />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.getByTestId('view-value')).toHaveTextContent(view);
      unmount();
    }
  });
});
