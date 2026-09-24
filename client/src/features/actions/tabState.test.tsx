import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  ACTIONS_CONFIDENCE_FILTERS,
  ACTIONS_EFFORT_FILTERS,
  ACTIONS_FILTER_KEYS,
  ACTIONS_SEVERITY_FILTERS,
  ACTIONS_SOURCE_FILTERS,
  ACTIONS_STATE_FILTERS,
  DEFAULT_ACTIONS_QUERY,
  nextActionsRequestSeq,
  parseActionsQuery,
  safeInternalHref,
  serializeActionsQuery,
  useActionsQuery,
} from './tabState';

describe('actions/tabState — constants', () => {
  it('every filter list is the closed enum prefixed with all', () => {
    expect(ACTIONS_STATE_FILTERS).toEqual([
      'all',
      'open',
      'planned',
      'dismissed',
      'completed',
    ]);
    expect(ACTIONS_SOURCE_FILTERS[0]).toBe('all');
    expect(ACTIONS_SOURCE_FILTERS).toContain('audit_finding');
    expect(ACTIONS_SEVERITY_FILTERS).toEqual(['all', 'critical', 'warning', 'info']);
    expect(ACTIONS_CONFIDENCE_FILTERS).toEqual(['all', 'high', 'medium', 'low']);
    expect(ACTIONS_EFFORT_FILTERS).toEqual(['all', 'low', 'medium', 'high']);
    expect(ACTIONS_FILTER_KEYS).toEqual([
      'state',
      'source',
      'severity',
      'confidence',
      'effort',
    ]);
  });
});

describe('parseActionsQuery', () => {
  it('returns defaults for an empty query', () => {
    expect(parseActionsQuery('')).toEqual(DEFAULT_ACTIONS_QUERY);
  });

  it('reads every valid filter and the cursor', () => {
    expect(
      parseActionsQuery(
        'state=planned&source=audit_finding&severity=critical&confidence=low&effort=high&cursor=50',
      ),
    ).toEqual({
      state: 'planned',
      source: 'audit_finding',
      severity: 'critical',
      confidence: 'low',
      effort: 'high',
      cursor: '50',
    });
  });

  it('replaces invalid enum values with the default', () => {
    const parsed = parseActionsQuery(
      'state=bogus&source=vendor_raw&severity=meh&confidence=none&effort=huge',
    );
    expect(parsed).toEqual(DEFAULT_ACTIONS_QUERY);
  });

  it('drops malformed or oversized cursors', () => {
    expect(parseActionsQuery('cursor=<script>').cursor).toBeNull();
    expect(parseActionsQuery(`cursor=${'a'.repeat(201)}`).cursor).toBeNull();
    expect(parseActionsQuery('cursor=').cursor).toBeNull();
  });

  it('accepts a URLSearchParams instance', () => {
    const params = new URLSearchParams('state=open');
    expect(parseActionsQuery(params).state).toBe('open');
  });
});

describe('serializeActionsQuery', () => {
  it('preserves unrelated params (the ?tab= authority above all)', () => {
    const next = serializeActionsQuery(
      new URLSearchParams('tab=actions&theme=dark'),
      { state: 'planned' },
    );
    expect(next.get('tab')).toBe('actions');
    expect(next.get('theme')).toBe('dark');
    expect(next.get('state')).toBe('planned');
  });

  it('removes defaults from the URL instead of writing them literally', () => {
    const next = serializeActionsQuery(
      new URLSearchParams('tab=actions&state=planned'),
      { state: 'all' },
    );
    expect(next.get('state')).toBeNull();
    expect(next.get('tab')).toBe('actions');
  });

  it('clears the cursor whenever any filter changes', () => {
    const next = serializeActionsQuery(
      new URLSearchParams('tab=actions&cursor=50&severity=critical'),
      { severity: 'warning' },
    );
    expect(next.get('cursor')).toBeNull();
    expect(next.get('severity')).toBe('warning');
  });

  it('keeps the cursor on a pure pagination write', () => {
    const next = serializeActionsQuery(new URLSearchParams('tab=actions'), {
      cursor: '50',
    });
    expect(next.get('cursor')).toBe('50');
  });

  it('removes the cursor when patched to null or to an invalid value', () => {
    expect(
      serializeActionsQuery(new URLSearchParams('cursor=50'), { cursor: null }).get(
        'cursor',
      ),
    ).toBeNull();
    expect(
      serializeActionsQuery(new URLSearchParams('cursor=50'), {
        cursor: 'bad value with spaces',
      }).get('cursor'),
    ).toBeNull();
  });

  it('treats undefined patch values as removal', () => {
    const next = serializeActionsQuery(new URLSearchParams('state=open'), {
      state: undefined,
    });
    expect(next.get('state')).toBeNull();
  });

  it('leaves the query untouched for an empty patch', () => {
    const next = serializeActionsQuery(
      new URLSearchParams('tab=actions&state=open&cursor=50'),
      {},
    );
    expect(next.toString()).toBe('tab=actions&state=open&cursor=50');
  });
});

let capturedSearch = '';
let historyLength = 0;

const Probe = () => {
  const location = useLocation();
  capturedSearch = location.search;
  historyLength = window.history.length;
  return null;
};

const Harness = () => {
  const [query, setQuery] = useActionsQuery();
  return (
    <>
      <Probe />
      <div data-testid="q-state">{query.state}</div>
      <div data-testid="q-cursor">{query.cursor ?? 'none'}</div>
      <button data-testid="set-state" onClick={() => setQuery({ state: 'planned' })}>
        set state
      </button>
      <button data-testid="set-cursor" onClick={() => setQuery({ cursor: '50' })}>
        set cursor
      </button>
      <button data-testid="reset" onClick={() => setQuery({ state: 'all' })}>
        reset
      </button>
    </>
  );
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sites/:siteId" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );

describe('useActionsQuery', () => {
  it('reads the URL and defaults invalid values', () => {
    renderAt('/sites/s1?tab=actions&state=bogus&cursor=50');
    expect(screen.getByTestId('q-state')).toHaveTextContent('all');
    expect(screen.getByTestId('q-cursor')).toHaveTextContent('50');
  });

  it('writes with replace semantics, preserving ?tab= and clearing the cursor', async () => {
    renderAt('/sites/s1?tab=actions&cursor=50');
    const before = historyLength;
    const user = userEvent.setup();
    await user.click(screen.getByTestId('set-state'));
    await waitFor(() => expect(capturedSearch).toBe('?tab=actions&state=planned'));
    expect(historyLength).toBe(before);
  });

  it('pagination writes keep the active filters', async () => {
    renderAt('/sites/s1?tab=actions&state=planned');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('set-cursor'));
    await waitFor(() =>
      expect(capturedSearch).toBe('?tab=actions&state=planned&cursor=50'),
    );
  });

  it('reset removes the filter param from the URL', async () => {
    renderAt('/sites/s1?tab=actions&state=planned');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('reset'));
    await waitFor(() => expect(capturedSearch).toBe('?tab=actions'));
    expect(screen.getByTestId('q-state')).toHaveTextContent('all');
  });
});

describe('safeInternalHref', () => {
  it('accepts a plain relative path', () => {
    expect(safeInternalHref('/sites/s1?tab=report')).toBe('/sites/s1?tab=report');
  });

  it.each([
    ['absolute URL', 'https://evil.example/x'],
    ['protocol-relative', '//evil.example/x'],
    ['no leading slash', 'sites/s1'],
    ['empty', ''],
    ['backslash', '/sites\\evil'],
    ['encoded backslash', '/sites/%5cevil'],
    ['encoded protocol-relative prefix', '/%2f%2fevil.example/x'],
    ['encoded control character', '/sites/%0aevil'],
    ['whitespace', '/sites/s1 ?x=1'],
    ['control character', '/sites/s1\u0007'],
    ['c1 control character', '/sites/s1\u0085x'],
    ['oversized', `/${'a'.repeat(2050)}`],
  ])('rejects %s', (_label, value) => {
    expect(safeInternalHref(value)).toBeNull();
  });

  it('rejects non-string input defensively', () => {
    expect(safeInternalHref(undefined as unknown as string)).toBeNull();
  });
});

describe('nextActionsRequestSeq', () => {
  it('is strictly monotonic', () => {
    const a = nextActionsRequestSeq();
    const b = nextActionsRequestSeq();
    expect(b).toBe(a + 1);
  });
});
