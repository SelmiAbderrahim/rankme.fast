import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import {
  DEFAULT_PAGES_URL_STATE,
  canonicalizePagesSearch,
  changePagesContext,
  changePagesCursor,
  changePagesDetail,
  pagesDetailCacheKey,
  pagesHistoryMode,
  pagesListCacheKey,
  pagesListQueryFromUrlState,
  parsePagesUrlState,
  serializePagesListQuery,
  serializePagesUrlState,
  usePagesUrlState,
} from './urlState';
import { DEFAULT_PAGES_DIRECTIONS, PAGES_INSIGHTS, PAGES_RANGES, PAGES_SORTS } from './types';

const PAGE_ID = 'a'.repeat(43);

describe('Pages URL parsing and canonical serialization', () => {
  it('uses every documented default and canonicalizes tab=pages', () => {
    expect(parsePagesUrlState('')).toEqual(DEFAULT_PAGES_URL_STATE);
    expect(canonicalizePagesSearch('')).toBe('tab=pages');
    expect(canonicalizePagesSearch('?tab=wrong')).toBe('tab=pages');
  });

  it('accepts every range, insight, sort, direction, and limit value', () => {
    for (const range of PAGES_RANGES) {
      expect(parsePagesUrlState(`range=${range}`).range).toBe(range);
    }
    for (const insight of PAGES_INSIGHTS) {
      expect(parsePagesUrlState(`insight=${insight}`).insight).toBe(insight);
    }
    for (const sort of PAGES_SORTS) {
      expect(parsePagesUrlState(`sort=${sort}`).sort).toBe(sort);
      expect(parsePagesUrlState(`sort=${sort}`).direction).toBe(DEFAULT_PAGES_DIRECTIONS[sort]);
    }
    expect(parsePagesUrlState('direction=asc').direction).toBe('asc');
    expect(parsePagesUrlState('direction=desc').direction).toBe('desc');
    expect(parsePagesUrlState('limit=25').limit).toBe(25);
    expect(parsePagesUrlState('limit=50').limit).toBe(50);
    expect(parsePagesUrlState('limit=100').limit).toBe(100);
    expect(parsePagesUrlState('indexability=indexable').indexability).toBe('indexable');
    expect(parsePagesUrlState('indexability=non_indexable').indexability).toBe('non_indexable');
    expect(parsePagesUrlState('visibility=measured').visibility).toBe('measured');
    expect(parsePagesUrlState('visibility=unmeasured').visibility).toBe('unmeasured');
  });

  it('drops every invalid, empty, duplicate-default, and over-bounded value', () => {
    const parsed = parsePagesUrlState(new URLSearchParams({
      range: '1d',
      q: 'x'.repeat(201),
      insight: 'other',
      indexability: 'google_indexed',
      visibility: 'all',
      sort: 'unknown',
      direction: 'sideways',
      cursor: 'x'.repeat(2049),
      limit: '75',
      pageId: 'short',
    }));
    expect(parsed).toEqual(DEFAULT_PAGES_URL_STATE);
    expect(parsePagesUrlState('q=+++&cursor=&pageId=')).toEqual(DEFAULT_PAGES_URL_STATE);
    expect(canonicalizePagesSearch('range=28d&sort=opportunity&direction=desc&limit=25')).toBe(
      'tab=pages',
    );
  });

  it('trims search, accepts bounded cursor/pageId, and round-trips non-defaults', () => {
    const input = new URLSearchParams({
      tab: 'pages',
      range: '90d',
      q: '  a b  ',
      insight: 'winning',
      indexability: 'indexable',
      visibility: 'measured',
      sort: 'clicks',
      direction: 'asc',
      cursor: 'c+/=',
      limit: '100',
      pageId: PAGE_ID,
    });
    const parsed = parsePagesUrlState(input);
    expect(parsed).toMatchObject({ q: 'a b', cursor: 'c+/=', pageId: PAGE_ID });
    const canonical = serializePagesUrlState('', parsed).toString();
    expect(parsePagesUrlState(canonical)).toEqual(parsed);
    expect(canonical).toContain('q=a+b');
    expect(canonical).toContain('cursor=c%2B%2F%3D');
  });

  it('preserves and stably sorts unrelated repeated parameters', () => {
    const first = canonicalizePagesSearch('z=2&tab=bad&a=2&a=1&range=90d');
    const second = canonicalizePagesSearch(first);
    expect(first).toBe('a=1&a=2&z=2&tab=pages&range=90d');
    expect(second).toBe(first);
  });

  it('serializes a stable server query and cache keys without page detail state', () => {
    const state = parsePagesUrlState(
      `tab=pages&range=7d&q=a+b&insight=low_ctr&indexability=non_indexable&visibility=unmeasured&sort=ctr&direction=asc&cursor=c%2F1&limit=50&pageId=${PAGE_ID}`,
    );
    const query = pagesListQueryFromUrlState(state);
    expect(query).not.toHaveProperty('pageId');
    expect(serializePagesListQuery(query)).toBe(
      'range=7d&q=a+b&insight=low_ctr&indexability=non_indexable&visibility=unmeasured&sort=ctr&direction=asc&cursor=c%2F1&limit=50',
    );
    expect(pagesListCacheKey('site', query)).toContain('site?range=7d');
    expect(pagesDetailCacheKey('site', '7d', PAGE_ID)).toBe(`site/7d/${PAGE_ID}`);
  });
});

describe('Pages atomic URL changes and history policy', () => {
  const populated = parsePagesUrlState(
    `range=90d&q=query&insight=winning&indexability=indexable&visibility=measured&sort=clicks&direction=asc&cursor=next&limit=100&pageId=${PAGE_ID}`,
  );

  it('clears cursor and pageId for every context-changing control', () => {
    const patches = [
      { range: '7d' as const },
      { q: 'next' },
      { insight: 'declining' as const },
      { indexability: 'non_indexable' as const },
      { visibility: 'unmeasured' as const },
      { sort: 'url' as const },
      { direction: 'desc' as const },
      { limit: 50 as const },
    ];
    for (const patch of patches) {
      expect(changePagesContext(populated, patch)).toMatchObject({ cursor: null, pageId: null });
    }
    expect(changePagesContext(populated, { sort: 'url' }).direction).toBe('asc');
    expect(changePagesContext(populated, { sort: 'url', direction: 'desc' }).direction).toBe('desc');
  });

  it('detail changes only pageId while pagination clears only pageId', () => {
    expect(changePagesDetail(populated, null)).toEqual({ ...populated, pageId: null });
    expect(changePagesDetail(populated, PAGE_ID)).toEqual({ ...populated, pageId: PAGE_ID });
    expect(changePagesCursor(populated, 'later')).toEqual({
      ...populated,
      cursor: 'later',
      pageId: null,
    });
  });

  it('replaces debounced searches and pushes every deliberate action', () => {
    expect(pagesHistoryMode('search')).toBe('replace');
    expect(pagesHistoryMode('context')).toBe('push');
    expect(pagesHistoryMode('pagination')).toBe('push');
    expect(pagesHistoryMode('detail')).toBe('push');
  });
});

const HistoryHarness = () => {
  const pages = usePagesUrlState();
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="search">{location.search}</output>
      <output data-testid="state">{JSON.stringify(pages.state)}</output>
      <button onClick={() => pages.setSearch('new query')}>search</button>
      <button onClick={() => pages.changeContext({ range: '7d' })}>range</button>
      <button onClick={() => pages.setCursor('next cursor')}>next</button>
      <button onClick={() => pages.setPageId(PAGE_ID)}>detail</button>
      <button onClick={() => pages.setPageId(null)}>close</button>
      <button onClick={() => navigate({ search: 'tab=actions' }, { replace: true })}>actions</button>
      <button onClick={() => navigate(-1)}>back</button>
      <button onClick={() => navigate(1)}>forward</button>
    </>
  );
};

describe('usePagesUrlState', () => {
  it('does not reclaim the workspace tab after navigation leaves Pages', async () => {
    render(
      <MemoryRouter initialEntries={['/sites/site?tab=pages']}>
        <HistoryHarness />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'actions' }));
    expect(screen.getByTestId('search')).toHaveTextContent('?tab=actions');
  });

  it('canonicalizes invalid URLs with replace and restores pushed list/detail state', async () => {
    render(
      <MemoryRouter initialEntries={['/sites/site?keep=1&tab=pages&range=nope']}>
        <HistoryHarness />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('keep=1&tab=pages'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'search' }));
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('q=new+query'));
    await user.click(screen.getByRole('button', { name: 'range' }));
    await user.click(screen.getByRole('button', { name: 'next' }));
    await user.click(screen.getByRole('button', { name: 'detail' }));
    expect(screen.getByTestId('search')).toHaveTextContent(`pageId=${PAGE_ID}`);
    await user.click(screen.getByRole('button', { name: 'close' }));
    expect(screen.getByTestId('search')).not.toHaveTextContent('pageId=');
    await user.click(screen.getByRole('button', { name: 'back' }));
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(`pageId=${PAGE_ID}`));
    await user.click(screen.getByRole('button', { name: 'back' }));
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('cursor=next+cursor'));
    await user.click(screen.getByRole('button', { name: 'forward' }));
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(`pageId=${PAGE_ID}`));
  });
});
