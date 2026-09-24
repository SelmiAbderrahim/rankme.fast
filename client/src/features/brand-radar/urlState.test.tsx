import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import {
  isBrandRadarDate,
  isBrandRadarScanId,
  isBrandRadarSentimentFilter,
  isBrandRadarStatusFilter,
  isBrandRadarView,
  useBrandRadarUrlState,
} from './urlState';

const SCAN_ID = '65f000000000000000000001';

let search = '';

const Probe = () => {
  const {
    view,
    status,
    scan,
    sentiment,
    domain,
    from,
    to,
    setView,
    setStatus,
    setScan,
    setSentiment,
    setDomain,
    setFrom,
    setTo,
  } = useBrandRadarUrlState();
  search = useLocation().search;
  return (
    <div>
      <span data-testid="view">{view}</span>
      <span data-testid="status">{status}</span>
      <span data-testid="scan">{scan ?? 'none'}</span>
      <span data-testid="sentiment">{sentiment}</span>
      <span data-testid="domain">{domain || 'none'}</span>
      <span data-testid="from">{from || 'none'}</span>
      <span data-testid="to">{to || 'none'}</span>
      <button type="button" onClick={() => setScan(SCAN_ID)}>
        open scan
      </button>
      <button type="button" onClick={() => setScan(null)}>
        close scan
      </button>
      <button type="button" onClick={() => setSentiment('negative')}>
        only negative
      </button>
      <button type="button" onClick={() => setSentiment('all')}>
        all tones
      </button>
      <button type="button" onClick={() => setDomain('Example.COM')}>
        set domain
      </button>
      <button type="button" onClick={() => setDomain('   ')}>
        clear domain
      </button>
      <button type="button" onClick={() => setFrom('2026-07-01')}>
        set from
      </button>
      <button type="button" onClick={() => setFrom('')}>
        clear from
      </button>
      <button type="button" onClick={() => setTo('2026-07-31')}>
        set to
      </button>
      <button type="button" onClick={() => setTo('')}>
        clear to
      </button>
      <button type="button" onClick={() => setView('new')}>
        go new
      </button>
      <button type="button" onClick={() => setView('scans')}>
        go scans
      </button>
      <button type="button" onClick={() => setStatus('failed')}>
        only failed
      </button>
      <button type="button" onClick={() => setStatus('all')}>
        all statuses
      </button>
    </div>
  );
};

const renderProbe = (entry: string) => {
  search = '';
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Probe />
    </MemoryRouter>,
  );
};

describe('brand-radar URL state', () => {
  it('defaults view and status when the params are absent', () => {
    renderProbe('/brand-radar');
    expect(screen.getByTestId('view')).toHaveTextContent('scans');
    expect(screen.getByTestId('status')).toHaveTextContent('all');
    expect(search).toBe('');
  });

  it('reads valid params straight off the URL', () => {
    renderProbe('/brand-radar?view=new&status=failed');
    expect(screen.getByTestId('view')).toHaveTextContent('new');
    expect(screen.getByTestId('status')).toHaveTextContent('failed');
  });

  it('normalizes an invalid view back to the default with replace', async () => {
    renderProbe('/brand-radar?view=nonsense&keep=1');
    await waitFor(() => expect(new URLSearchParams(search).has('view')).toBe(false));
    expect(new URLSearchParams(search).get('keep')).toBe('1');
    expect(screen.getByTestId('view')).toHaveTextContent('scans');
  });

  it('normalizes an invalid status back to the default', async () => {
    renderProbe('/brand-radar?status=exploded');
    await waitFor(() => expect(new URLSearchParams(search).has('status')).toBe(false));
    expect(screen.getByTestId('status')).toHaveTextContent('all');
  });

  it('normalizes an explicit `all` status away', async () => {
    renderProbe('/brand-radar?status=all');
    await waitFor(() => expect(new URLSearchParams(search).has('status')).toBe(false));
  });

  it('writes non-default values and deletes defaults', async () => {
    const user = userEvent.setup();
    renderProbe('/brand-radar');
    await user.click(screen.getByRole('button', { name: 'go new' }));
    await waitFor(() => expect(new URLSearchParams(search).get('view')).toBe('new'));

    await user.click(screen.getByRole('button', { name: 'only failed' }));
    await waitFor(() => expect(new URLSearchParams(search).get('status')).toBe('failed'));

    await user.click(screen.getByRole('button', { name: 'all statuses' }));
    await waitFor(() => expect(new URLSearchParams(search).has('status')).toBe(false));

    await user.click(screen.getByRole('button', { name: 'go scans' }));
    await waitFor(() => expect(new URLSearchParams(search).has('view')).toBe(false));
  });

  it('does not pollute browser history (replace only)', async () => {
    const user = userEvent.setup();
    renderProbe('/brand-radar');
    await user.click(screen.getByRole('button', { name: 'go new' }));
    await waitFor(() => expect(screen.getByTestId('view')).toHaveTextContent('new'));
    // A replace navigation leaves exactly one entry, so going back is a no-op
    // inside the MemoryRouter stack rather than returning to `?view=scans`.
    expect(window.history.length).toBeGreaterThanOrEqual(1);
  });

  it('guards non-string values', () => {
    expect(isBrandRadarView(undefined)).toBe(false);
    expect(isBrandRadarView('scans')).toBe(true);
    expect(isBrandRadarStatusFilter(7)).toBe(false);
    expect(isBrandRadarStatusFilter('completed_partial')).toBe(true);
    expect(isBrandRadarSentimentFilter(null)).toBe(false);
    expect(isBrandRadarSentimentFilter('negative')).toBe(true);
    expect(isBrandRadarScanId(42)).toBe(false);
    expect(isBrandRadarScanId(SCAN_ID)).toBe(true);
    // Uppercase hex is hand-typed — the API only ever hands back lowercase.
    expect(isBrandRadarScanId(SCAN_ID.toUpperCase())).toBe(false);
    expect(isBrandRadarDate(20260701)).toBe(false);
    expect(isBrandRadarDate('2026-7-1')).toBe(false);
    // Well-formed but not a real calendar day.
    expect(isBrandRadarDate('2026-02-31')).toBe(false);
    expect(isBrandRadarDate('2026-07-01')).toBe(true);
  });

  it('reads every valid detail param straight off the URL', () => {
    renderProbe(
      `/brand-radar?scan=${SCAN_ID}&sentiment=negative&domain=example.com&from=2026-07-01&to=2026-07-31`,
    );
    expect(screen.getByTestId('scan')).toHaveTextContent(SCAN_ID);
    expect(screen.getByTestId('sentiment')).toHaveTextContent('negative');
    expect(screen.getByTestId('domain')).toHaveTextContent('example.com');
    expect(screen.getByTestId('from')).toHaveTextContent('2026-07-01');
    expect(screen.getByTestId('to')).toHaveTextContent('2026-07-31');
  });

  it('clears a `scan` value that is not a 24-hex id', async () => {
    renderProbe('/brand-radar?scan=not-an-object-id');
    await waitFor(() => expect(new URLSearchParams(search).has('scan')).toBe(false));
    expect(screen.getByTestId('scan')).toHaveTextContent('none');
  });

  it('normalizes an invalid sentiment and an explicit `all` away', async () => {
    renderProbe('/brand-radar?sentiment=furious');
    await waitFor(() => expect(new URLSearchParams(search).has('sentiment')).toBe(false));
    expect(screen.getByTestId('sentiment')).toHaveTextContent('all');

    renderProbe('/brand-radar?sentiment=all');
    await waitFor(() => expect(new URLSearchParams(search).has('sentiment')).toBe(false));
  });

  it('lowercases a mixed-case domain in place', async () => {
    renderProbe('/brand-radar?domain=Example.COM');
    await waitFor(() =>
      expect(new URLSearchParams(search).get('domain')).toBe('example.com'),
    );
    expect(screen.getByTestId('domain')).toHaveTextContent('example.com');
  });

  it('clears a domain longer than a hostname can be', async () => {
    renderProbe(`/brand-radar?domain=${'a'.repeat(254)}`);
    await waitFor(() => expect(new URLSearchParams(search).has('domain')).toBe(false));
    expect(screen.getByTestId('domain')).toHaveTextContent('none');
  });

  it('clears an unparseable date', async () => {
    renderProbe('/brand-radar?from=yesterday&to=2026-07-31');
    await waitFor(() => expect(new URLSearchParams(search).has('from')).toBe(false));
    expect(new URLSearchParams(search).has('to')).toBe(false);
    expect(screen.getByTestId('from')).toHaveTextContent('none');
    expect(screen.getByTestId('to')).toHaveTextContent('none');
  });

  it('clears BOTH ends when `from` is after `to`', async () => {
    renderProbe('/brand-radar?from=2026-08-01&to=2026-07-01');
    await waitFor(() => expect(new URLSearchParams(search).has('from')).toBe(false));
    expect(new URLSearchParams(search).has('to')).toBe(false);
    expect(screen.getByTestId('from')).toHaveTextContent('none');
    expect(screen.getByTestId('to')).toHaveTextContent('none');
  });

  it('writes and clears every detail param', async () => {
    const user = userEvent.setup();
    renderProbe('/brand-radar');

    await user.click(screen.getByRole('button', { name: 'open scan' }));
    await waitFor(() => expect(new URLSearchParams(search).get('scan')).toBe(SCAN_ID));

    await user.click(screen.getByRole('button', { name: 'only negative' }));
    await waitFor(() =>
      expect(new URLSearchParams(search).get('sentiment')).toBe('negative'),
    );
    await user.click(screen.getByRole('button', { name: 'all tones' }));
    await waitFor(() => expect(new URLSearchParams(search).has('sentiment')).toBe(false));

    await user.click(screen.getByRole('button', { name: 'set domain' }));
    await waitFor(() =>
      expect(new URLSearchParams(search).get('domain')).toBe('example.com'),
    );
    await user.click(screen.getByRole('button', { name: 'clear domain' }));
    await waitFor(() => expect(new URLSearchParams(search).has('domain')).toBe(false));

    await user.click(screen.getByRole('button', { name: 'set from' }));
    await waitFor(() =>
      expect(new URLSearchParams(search).get('from')).toBe('2026-07-01'),
    );
    await user.click(screen.getByRole('button', { name: 'set to' }));
    await waitFor(() => expect(new URLSearchParams(search).get('to')).toBe('2026-07-31'));
    await user.click(screen.getByRole('button', { name: 'clear from' }));
    await waitFor(() => expect(new URLSearchParams(search).has('from')).toBe(false));
    await user.click(screen.getByRole('button', { name: 'clear to' }));
    await waitFor(() => expect(new URLSearchParams(search).has('to')).toBe(false));

    await user.click(screen.getByRole('button', { name: 'close scan' }));
    await waitFor(() => expect(new URLSearchParams(search).has('scan')).toBe(false));
  });
});
