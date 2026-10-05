import { describe, expect, it } from 'vitest';
import { formatAppTitle, resolveAppTitleTarget } from './appTitle';

describe('resolveAppTitleTarget', () => {
  it.each([
    ['/dashboard', '', 'nav.dashboard'],
    ['/assistant', '', 'nav.assistant'],
    ['/sites', '', 'nav.sites'],
    ['/keyword-research/history', '', 'nav.keywordResearch'],
    ['/dashboard/alerts', '', 'alerts:title'],
    ['/profile', '', 'shell.profile'],
    ['/profile', '?tab=security', 'nav.security'],
    ['/settings/team', '', 'nav.team'],
    ['/exports', '', 'nav.exports'],
  ])('names the account page %s%s from the shared nav config', (path, search, key) => {
    expect(resolveAppTitleTarget(path, search)).toEqual({ pageKey: key, siteId: null });
  });

  it('has no page name for an unknown route', () => {
    expect(resolveAppTitleTarget('/nope', '')).toEqual({ pageKey: null, siteId: null });
  });

  it('uses the ?tab= panel on a site workspace, defaulting to overview', () => {
    expect(resolveAppTitleTarget('/sites/s1', '?tab=keywords')).toEqual({
      pageKey: 'sites:workspace.tabs.keywords',
      siteId: 's1',
    });
    expect(resolveAppTitleTarget('/sites/s1', '?tab=bogus').pageKey).toBe(
      'sites:workspace.tabs.overview',
    );
    expect(resolveAppTitleTarget('/sites/s1', '').pageKey).toBe('sites:workspace.tabs.overview');
  });

  it('names site sub-routes after the tab they belong to', () => {
    expect(resolveAppTitleTarget('/sites/s1/report/r9', '').pageKey).toBe(
      'sites:workspace.tabs.report',
    );
    expect(resolveAppTitleTarget('/sites/s1/backlinks', '?tab=history').pageKey).toBe(
      'sites:workspace.tabs.backlinks',
    );
    expect(resolveAppTitleTarget('/sites/s1/content-briefs/b1/editor', '').pageKey).toBe(
      'sites:workspace.tabs.content',
    );
  });

  it('keeps the site but drops the page for an unmapped site sub-route', () => {
    expect(resolveAppTitleTarget('/sites/s1/elsewhere', '')).toEqual({
      pageKey: null,
      siteId: 's1',
    });
  });
});

describe('formatAppTitle', () => {
  it('joins page, site and brand, dropping absent parts', () => {
    expect(formatAppTitle('Keywords', 'example.com')).toBe('Keywords · example.com · RankMeFast');
    expect(formatAppTitle('Dashboard', null)).toBe('Dashboard · RankMeFast');
    expect(formatAppTitle(null, 'example.com')).toBe('example.com · RankMeFast');
    expect(formatAppTitle(null, null)).toBe('RankMeFast');
  });
});
