import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  CLUSTER_DECISION_FILTERS,
  DEFAULT_CLUSTER_DECISION_FILTER,
  DEFAULT_GAP_ROW_FILTER,
  DEFAULT_WORKSPACE_TAB,
  GAP_ROW_FILTERS,
  WORKSPACE_TABS,
  isClusterDecisionFilter,
  isGapRowFilter,
  isWorkspaceTab,
  parseKeywordWorkspaceQuery,
  serializeKeywordWorkspaceQuery,
  useKeywordWorkspaceQuery,
  useWorkspaceTab,
} from './tabState';

const RUN_ID = 'a'.repeat(64);

describe('workspace tab union', () => {
  it('declares the five-tab union with research default', () => {
    // `live-trends` is a SIBLING of the Labs `trends` tab —
    // both must stay in the union, they meter different metrics.
    expect(WORKSPACE_TABS).toEqual([
      'research',
      'gap',
      'trends',
      'live-trends',
      'clusters',
    ]);
    expect(DEFAULT_WORKSPACE_TAB).toBe('research');
  });

  it.each(WORKSPACE_TABS)('isWorkspaceTab accepts %s', (tab) => {
    expect(isWorkspaceTab(tab)).toBe(true);
  });

  it('isWorkspaceTab rejects unknown and non-string values', () => {
    expect(isWorkspaceTab('overview')).toBe(false);
    expect(isWorkspaceTab(42)).toBe(false);
    expect(isWorkspaceTab(null)).toBe(false);
  });
});

describe('filter guards', () => {
  it.each(GAP_ROW_FILTERS)('isGapRowFilter accepts %s', (f) => {
    expect(isGapRowFilter(f)).toBe(true);
  });
  it('isGapRowFilter rejects unknowns', () => {
    expect(isGapRowFilter('ahead')).toBe(false);
    expect(isGapRowFilter(7)).toBe(false);
  });
  it.each(CLUSTER_DECISION_FILTERS)('isClusterDecisionFilter accepts %s', (f) => {
    expect(isClusterDecisionFilter(f)).toBe(true);
  });
  it('isClusterDecisionFilter rejects unknowns', () => {
    expect(isClusterDecisionFilter('done')).toBe(false);
    expect(isClusterDecisionFilter(undefined)).toBe(false);
  });
});

describe('parseKeywordWorkspaceQuery', () => {
  it('returns documented defaults for an empty query', () => {
    expect(parseKeywordWorkspaceQuery('')).toEqual({
      pair: null,
      gapFilter: DEFAULT_GAP_ROW_FILTER,
      q: '',
      run: null,
      decision: DEFAULT_CLUSTER_DECISION_FILTER,
    });
  });

  it('accepts valid values (string and URLSearchParams input)', () => {
    const search = `pair=rival.example&gapFilter=missing&q=audit&run=${RUN_ID}&decision=accepted`;
    const fromString = parseKeywordWorkspaceQuery(search);
    const fromParams = parseKeywordWorkspaceQuery(new URLSearchParams(search));
    for (const state of [fromString, fromParams]) {
      expect(state.pair).toBe('rival.example');
      expect(state.gapFilter).toBe('missing');
      expect(state.q).toBe('audit');
      expect(state.run).toBe(RUN_ID);
      expect(state.decision).toBe('accepted');
    }
  });

  it('lowercases the pair domain', () => {
    expect(parseKeywordWorkspaceQuery('pair=Rival.Example').pair).toBe(
      'rival.example',
    );
  });

  it('normalizes malformed values to defaults without throwing', () => {
    const state = parseKeywordWorkspaceQuery(
      `pair=<script>&gapFilter=nope&q=${'x'.repeat(90)}&run=zzz&decision=maybe`,
    );
    expect(state.pair).toBeNull();
    expect(state.gapFilter).toBe('all');
    expect(state.q).toBe('');
    expect(state.run).toBeNull();
    expect(state.decision).toBe('all');
  });

  it('rejects run ids that are not 64 lowercase hex', () => {
    expect(parseKeywordWorkspaceQuery(`run=${'A'.repeat(64)}`).run).toBeNull();
    expect(parseKeywordWorkspaceQuery(`run=${'a'.repeat(63)}`).run).toBeNull();
  });
});

describe('serializeKeywordWorkspaceQuery', () => {
  it('is a read-modify-write — unrelated params survive', () => {
    const current = new URLSearchParams('tab=gap&location=2840');
    const next = serializeKeywordWorkspaceQuery(current, { pair: 'rival.example' });
    expect(next.get('tab')).toBe('gap');
    expect(next.get('location')).toBe('2840');
    expect(next.get('pair')).toBe('rival.example');
  });

  it('removes keys set to null, undefined, or their documented default', () => {
    const current = new URLSearchParams(
      `pair=rival.example&gapFilter=missing&q=x&run=${RUN_ID}&decision=accepted`,
    );
    const next = serializeKeywordWorkspaceQuery(current, {
      pair: null,
      gapFilter: 'all',
      q: '',
      run: undefined,
      decision: 'all',
    });
    expect(next.get('pair')).toBeNull();
    expect(next.get('gapFilter')).toBeNull();
    expect(next.get('q')).toBeNull();
    // `undefined` also removes (default is absent).
    expect(next.get('run')).toBeNull();
    expect(next.get('decision')).toBeNull();
  });
});

const TabProbe = () => {
  const [tab, setTab] = useWorkspaceTab();
  const location = useLocation();
  return (
    <div>
      <span data-testid="active-tab">{tab}</span>
      <span data-testid="search">{location.search}</span>
      <button type="button" onClick={() => setTab('clusters')}>
        go-clusters
      </button>
    </div>
  );
};

const QueryProbe = () => {
  const [state, setState] = useKeywordWorkspaceQuery();
  const location = useLocation();
  return (
    <div>
      <span data-testid="pair">{state.pair ?? 'none'}</span>
      <span data-testid="filter">{state.gapFilter}</span>
      <span data-testid="search">{location.search}</span>
      <button
        type="button"
        onClick={() => setState({ pair: 'rival.example', gapFilter: 'behind' })}
      >
        set
      </button>
      <button type="button" onClick={() => setState({ pair: null, gapFilter: 'all' })}>
        reset
      </button>
    </div>
  );
};

describe('useWorkspaceTab', () => {
  it('reads the tab from the URL and falls back on invalid values', () => {
    render(
      <MemoryRouter initialEntries={['/keyword-research?tab=bogus']}>
        <TabProbe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('active-tab').textContent).toBe('research');
  });

  it('writes the tab into the URL preserving unrelated params', () => {
    render(
      <MemoryRouter initialEntries={['/keyword-research?location=2840']}>
        <TabProbe />
      </MemoryRouter>,
    );
    act(() => screen.getByText('go-clusters').click());
    expect(screen.getByTestId('active-tab').textContent).toBe('clusters');
    expect(screen.getByTestId('search').textContent).toContain('tab=clusters');
    expect(screen.getByTestId('search').textContent).toContain('location=2840');
  });
});

describe('useKeywordWorkspaceQuery', () => {
  it('round-trips a patch through the URL and preserves ?tab=', () => {
    render(
      <MemoryRouter initialEntries={['/keyword-research?tab=gap']}>
        <QueryProbe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('pair').textContent).toBe('none');
    act(() => screen.getByText('set').click());
    expect(screen.getByTestId('pair').textContent).toBe('rival.example');
    expect(screen.getByTestId('filter').textContent).toBe('behind');
    expect(screen.getByTestId('search').textContent).toContain('tab=gap');
    act(() => screen.getByText('reset').click());
    expect(screen.getByTestId('pair').textContent).toBe('none');
    expect(screen.getByTestId('filter').textContent).toBe('all');
    // Defaults removed → canonical URL keeps only ?tab=.
    expect(screen.getByTestId('search').textContent).toBe('?tab=gap');
  });
});
