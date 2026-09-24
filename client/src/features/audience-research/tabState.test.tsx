import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import {
  CONFIDENCE_FILTERS,
  DECISION_FILTERS,
  SIGNAL_TYPE_FILTERS,
  SOURCE_TYPE_FILTERS,
  closeSignalDrawer,
  isConfidenceFilter,
  isDecisionFilter,
  isSignalTypeFilter,
  isSourceTypeFilter,
  parseAudienceResearchQuery,
  serializeAudienceResearchQuery,
  useAudienceResearchQuery,
} from './tabState';

describe('parseAudienceResearchQuery', () => {
  it('normalizes every param when all are present (deep link)', () => {
    const state = parseAudienceResearchQuery(
      'run=run-1&signal=sig-1&signalType=complaint&confidence=high&sourceType=forum&decision=accepted',
    );
    expect(state).toEqual({
      run: 'run-1',
      signal: 'sig-1',
      signalType: 'complaint',
      confidence: 'high',
      sourceType: 'forum',
      decision: 'accepted',
    });
  });

  it('defaults every param when absent', () => {
    const state = parseAudienceResearchQuery('');
    expect(state).toEqual({
      run: null,
      signal: null,
      signalType: 'all',
      confidence: 'all',
      sourceType: 'all',
      decision: 'all',
    });
  });

  it('normalizes garbage enum values to their default', () => {
    const state = parseAudienceResearchQuery(
      'signalType=bogus&confidence=bogus&sourceType=bogus&decision=bogus',
    );
    expect(state.signalType).toBe('all');
    expect(state.confidence).toBe('all');
    expect(state.sourceType).toBe('all');
    expect(state.decision).toBe('all');
  });

  it('rejects malformed run/signal ids', () => {
    const state = parseAudienceResearchQuery('run=<script>&signal=' + 'x'.repeat(200));
    expect(state.run).toBeNull();
    expect(state.signal).toBeNull();
  });

  it('accepts a URLSearchParams instance directly', () => {
    const params = new URLSearchParams('run=abc123');
    expect(parseAudienceResearchQuery(params).run).toBe('abc123');
  });
});

describe('serializeAudienceResearchQuery', () => {
  it('preserves unrelated params (tab) while writing grammar keys', () => {
    const current = new URLSearchParams('tab=audience-research&other=1');
    const next = serializeAudienceResearchQuery(current, { run: 'r1', signalType: 'question' });
    expect(next.get('tab')).toBe('audience-research');
    expect(next.get('other')).toBe('1');
    expect(next.get('run')).toBe('r1');
    expect(next.get('signalType')).toBe('question');
  });

  it('removes a key when patched to null or its documented default', () => {
    const current = new URLSearchParams('run=r1&signalType=complaint&decision=accepted');
    const next = serializeAudienceResearchQuery(current, {
      run: null,
      signalType: 'all',
      decision: 'accepted',
    });
    expect(next.has('run')).toBe(false);
    expect(next.has('signalType')).toBe(false);
    expect(next.get('decision')).toBe('accepted');
  });
});

describe('closeSignalDrawer', () => {
  it('removes only signal, preserving every other param', () => {
    const current = new URLSearchParams(
      'tab=audience-research&run=r1&signal=s1&signalType=complaint&confidence=high',
    );
    const next = closeSignalDrawer(current);
    expect(next.has('signal')).toBe(false);
    expect(next.get('run')).toBe('r1');
    expect(next.get('signalType')).toBe('complaint');
    expect(next.get('confidence')).toBe('high');
    expect(next.get('tab')).toBe('audience-research');
  });
});

describe('guards', () => {
  it('accept every declared value and reject garbage', () => {
    for (const v of SIGNAL_TYPE_FILTERS) expect(isSignalTypeFilter(v)).toBe(true);
    for (const v of CONFIDENCE_FILTERS) expect(isConfidenceFilter(v)).toBe(true);
    for (const v of SOURCE_TYPE_FILTERS) expect(isSourceTypeFilter(v)).toBe(true);
    for (const v of DECISION_FILTERS) expect(isDecisionFilter(v)).toBe(true);
    expect(isSignalTypeFilter('nope')).toBe(false);
    expect(isSignalTypeFilter(42)).toBe(false);
    expect(isConfidenceFilter(null)).toBe(false);
    expect(isSourceTypeFilter(undefined)).toBe(false);
    expect(isDecisionFilter({})).toBe(false);
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

const Harness = () => {
  const [state, setState] = useAudienceResearchQuery();
  return (
    <>
      <HistoryProbe />
      <div data-testid="run">{state.run ?? 'none'}</div>
      <div data-testid="signal">{state.signal ?? 'none'}</div>
      <div data-testid="signalType">{state.signalType}</div>
      <div data-testid="decision">{state.decision}</div>
      <button data-testid="select-run" onClick={() => setState({ run: 'run-9' })}>
        select-run
      </button>
      <button
        data-testid="open-signal"
        onClick={() => setState({ signal: 'sig-9', signalType: 'complaint' })}
      >
        open-signal
      </button>
      <button data-testid="close-signal" onClick={() => setState({ signal: null })}>
        close-signal
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

describe('useAudienceResearchQuery', () => {
  it('deep-links every param from the URL', () => {
    renderAt(
      '/sites/s1?tab=audience-research&run=r1&signal=s1&signalType=request&decision=pending',
    );
    expect(screen.getByTestId('run')).toHaveTextContent('r1');
    expect(screen.getByTestId('signal')).toHaveTextContent('s1');
    expect(screen.getByTestId('signalType')).toHaveTextContent('request');
    expect(screen.getByTestId('decision')).toHaveTextContent('pending');
  });

  it('writes without pushing browser history (replace: true) — back/forward stays on the outer route', async () => {
    renderAt('/sites/s1?tab=audience-research');
    const before = historyLength;
    const user = userEvent.setup();
    await user.click(screen.getByTestId('select-run'));
    await waitFor(() => expect(capturedSearch).toContain('run=run-9'));
    expect(capturedSearch).toContain('tab=audience-research');
    expect(historyLength).toBe(before);
  });

  it('opening the drawer sets signal + signalType while keeping tab', async () => {
    renderAt('/sites/s1?tab=audience-research&run=r1');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('open-signal'));
    await waitFor(() => expect(capturedSearch).toContain('signal=sig-9'));
    expect(capturedSearch).toContain('signalType=complaint');
    expect(capturedSearch).toContain('run=r1');
    expect(capturedSearch).toContain('tab=audience-research');
  });

  it('closing the drawer removes only signal, preserving run and tab', async () => {
    renderAt('/sites/s1?tab=audience-research&run=r1&signal=s1&signalType=complaint');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('close-signal'));
    await waitFor(() => expect(capturedSearch).not.toContain('signal='));
    expect(capturedSearch).toContain('run=r1');
    expect(capturedSearch).toContain('signalType=complaint');
    expect(capturedSearch).toContain('tab=audience-research');
  });

  it('invalid query values normalize to defaults on read', () => {
    renderAt('/sites/s1?tab=audience-research&signalType=bogus&decision=bogus');
    expect(screen.getByTestId('signalType')).toHaveTextContent('all');
    expect(screen.getByTestId('decision')).toHaveTextContent('all');
  });
});
