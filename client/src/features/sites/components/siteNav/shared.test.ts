import { isPlainKey, isTypingTarget } from "@shared/lib/keyboard";
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeTabFromLocation,
  readRecentSites,
  readSiteGroups,
  readSiteSidebarCookie,
  rememberRecentSite,
  siteIdFromPath,
  siteLabel,
  siteSecondaryLine,
  splitMatch,
  switchSiteHref,
  writeSiteGroups,
  writeSiteSidebarCookie,
} from './shared';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.cookie = 'site_sidebar_state=; path=/; max-age=0';
});

describe('site navigation helpers', () => {
  it('reads the site id and the active tab from the location', () => {
    expect(siteIdFromPath('/dashboard')).toBeNull();
    expect(siteIdFromPath('/sites/abc/report')).toBe('abc');
    expect(activeTabFromLocation('/dashboard', '?tab=apps')).toBe('overview');
    expect(activeTabFromLocation('/sites/abc/report', '')).toBe('report');
    expect(activeTabFromLocation('/sites/abc/unknown', '?tab=apps')).toBe('apps');
    expect(activeTabFromLocation('/sites/abc', '?tab=backlinks')).toBe('backlinks');
  });

  it('labels a site by its name, else its domain, and adds the domain only when it differs', () => {
    const site = (displayName: string, domain: string) => ({ displayName, domain });
    expect(siteLabel(site('  ', 'a.com'))).toBe('a.com');
    expect(siteLabel({ domain: 'a.com' } as never)).toBe('a.com');
    expect(siteSecondaryLine(site('', 'a.com'))).toBeNull();
    expect(siteSecondaryLine(site('A.com', 'a.com'))).toBeNull();
    expect(siteSecondaryLine(site('www.a.com', 'a.com'))).toBeNull();
    expect(siteSecondaryLine(site('a.com', 'www.a.com'))).toBeNull();
    expect(siteSecondaryLine(site('Brand', 'a.com'))).toBe('a.com');
  });

  it('reads and writes the site sidebar cookie', () => {
    expect(readSiteSidebarCookie()).toBeNull();
    writeSiteSidebarCookie(false);
    expect(readSiteSidebarCookie()).toBe(false);
    writeSiteSidebarCookie(true);
    expect(readSiteSidebarCookie()).toBe(true);
    document.cookie = 'site_sidebar_state=maybe; path=/';
    expect(readSiteSidebarCookie()).toBeNull();
  });

  it('keeps group state per user and tolerates bad or missing storage', () => {
    expect(readSiteGroups('u1')).toEqual({});
    writeSiteGroups('u1', { search: true });
    expect(readSiteGroups('u1')).toEqual({ search: true });
    window.localStorage.setItem('rankmefast.site-groups.u2', '[1]');
    expect(readSiteGroups('u2')).toEqual({});
    window.localStorage.setItem('rankmefast.site-groups.u3', 'null');
    expect(readSiteGroups('u3')).toEqual({});
    window.localStorage.setItem('rankmefast.site-groups.u4', '{broken');
    expect(readSiteGroups('u4')).toEqual({});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => writeSiteGroups('u1', { search: false })).not.toThrow();
  });

  it('remembers the five most recent sites, newest first, without duplicates', () => {
    window.localStorage.setItem('rankmefast.recent-sites.u1', '{"not":"a list"}');
    expect(readRecentSites('u1')).toEqual([]);
    window.localStorage.setItem('rankmefast.recent-sites.u1', '["a", 3, "b"]');
    expect(readRecentSites('u1')).toEqual(['a', 'b']);
    for (const id of ['c', 'd', 'e', 'f', 'a']) rememberRecentSite('u1', id);
    expect(readRecentSites('u1')).toEqual(['a', 'f', 'e', 'd', 'c']);
  });

  it('builds the switch target: the same page, its sub-view, nothing else', () => {
    expect(switchSiteHref('s 2', 'overview', '?tab=overview&view=x&run=1')).toBe('/sites/s%202');
    expect(switchSiteHref('s2', 'content', '?tab=content&view=briefs&run=1')).toBe(
      '/sites/s2?tab=content&view=briefs',
    );
    expect(switchSiteHref('s2', 'apps', '?tab=apps&run=1')).toBe('/sites/s2?tab=apps');
  });

  it('splits a label around the first case-insensitive match', () => {
    expect(splitMatch('Keyword research', '  ')).toBeNull();
    expect(splitMatch('Keyword research', 'zzz')).toBeNull();
    expect(splitMatch('Keyword research', 'KEY')).toEqual({
      before: '',
      match: 'Key',
      after: 'word research',
    });
    // "İ" lowercases to two code units, so indexes would no longer line up.
    expect(splitMatch('İstanbul', 'stan')).toBeNull();
  });
});

it('uses plain keys only outside editable fields', () => {
  expect(isTypingTarget(null)).toBe(false);
  expect(isTypingTarget(document.createElement('input'))).toBe(true);
  expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
  expect(isTypingTarget(document.createElement('select'))).toBe(true);
  expect(isTypingTarget(document.createElement('button'))).toBe(false);
  const editable = document.createElement('div');
  Object.defineProperty(editable, 'isContentEditable', { value: true });
  expect(isTypingTarget(editable)).toBe(true);
  expect(isPlainKey(new KeyboardEvent('keydown'))).toBe(true);
  for (const modifier of ['metaKey', 'ctrlKey', 'altKey', 'isComposing']) {
    expect(isPlainKey(new KeyboardEvent('keydown', { [modifier]: true }))).toBe(false);
  }
});
