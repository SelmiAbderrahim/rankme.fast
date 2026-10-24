import { describe, expect, it } from 'vitest';
import { SITE_NAV_ITEMS, siteTabHref, getSiteNavItem } from './siteNavigation';
import { SITE_TABS, SITE_TAB_GROUPS, SITE_TAB_LABEL_KEYS, resolveSiteTab, SITE_TAB_ALIASES } from './tabState';

describe('canonical site destinations', () => {
  it('derives the existing labels and groups from one item for every tab', () => {
    expect(SITE_NAV_ITEMS.map(({ id }) => id)).toEqual(SITE_TABS);
    expect(new Set(SITE_NAV_ITEMS.map(({ id }) => id)).size).toBe(24);
    for (const item of SITE_NAV_ITEMS) {
      expect(item.labelKey).toBe(SITE_TAB_LABEL_KEYS[item.id]);
      expect(SITE_TAB_GROUPS.find(({ tabs }) => tabs.includes(item.id))?.id ?? null).toBe(item.group);
    }
  });
  it('builds encoded site links while retaining query and hash', () => {
    expect(siteTabHref('a/b', 'google', '?view=queries&filter=all', '#details')).toBe('/sites/a%2Fb?view=queries&filter=all&tab=google#details');
  });
  it('resolves absent, exact, mixed case and legacy slugs through one parser', () => {
    expect(resolveSiteTab(null)).toEqual({ kind: 'absent', tab: 'overview' });
    expect(resolveSiteTab('  ')).toEqual({ kind: 'absent', tab: 'overview' });
    for (const tab of SITE_TABS) {
      expect(resolveSiteTab(tab)).toEqual({ kind: 'valid', tab });
      expect(resolveSiteTab(tab.toUpperCase())).toEqual({ kind: 'alias', tab, requested: tab.toUpperCase() });
    }
    for (const [alias, tab] of Object.entries(SITE_TAB_ALIASES)) {
      expect(resolveSiteTab(alias)).toEqual({ kind: 'alias', tab, requested: alias });
    }
    expect(resolveSiteTab(' Keyword_Research ')).toEqual({ kind: 'alias', tab: 'research', requested: ' Keyword_Research ' });
    expect(resolveSiteTab('missing')).toEqual({ kind: 'unknown', tab: 'overview', requested: 'missing' });
    expect(resolveSiteTab('__proto__')).toEqual({ kind: 'unknown', tab: 'overview', requested: '__proto__' });
  });
});

it('defensively falls back to the overview item for invalid runtime input', () => {
  expect(getSiteNavItem('missing' as never)).toBe(SITE_NAV_ITEMS[0]);
  expect(resolveSiteTab('constructor')).toEqual({ kind: 'unknown', tab: 'overview', requested: 'constructor' });
});
