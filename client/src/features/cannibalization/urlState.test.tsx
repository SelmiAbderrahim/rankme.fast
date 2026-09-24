/**
 * Direct cover for the URL-state setters the workspace only reaches on one
 * side (clearing a param, writing a default) plus the thunk's optional
 * `windowDays` argument.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { apiClient } from '@shared/api/client';
import { useCannibalizationUrlState } from './urlState';
import { loadCannibalizationReports } from './store/thunks';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const SITE_ID = 'a'.repeat(24);
const REPORT_ID = 'b'.repeat(24);

let search = '';

const Probe = () => {
  const url = useCannibalizationUrlState();
  search = useLocation().search;
  return (
    <div>
      <button type="button" onClick={() => url.setWindow(28)}>
        default-window
      </button>
      <button type="button" onClick={() => url.setConfidence('all')}>
        default-confidence
      </button>
      <button type="button" onClick={() => url.setReport(null)}>
        clear-report
      </button>
      <button type="button" onClick={() => url.setQuery('cannibal-3')}>
        set-query
      </button>
      <button type="button" onClick={() => url.setView('new')}>
        set-view
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

describe('useCannibalizationUrlState setters', () => {
  it('deletes a param when the written value is the default or null', async () => {
    const user = userEvent.setup();
    renderProbe(
      `/sites/${SITE_ID}?tab=cannibalization&window=7&confidence=high&report=${REPORT_ID}`,
    );
    await user.click(screen.getByText('default-window'));
    expect(search).not.toContain('window=');
    await user.click(screen.getByText('default-confidence'));
    expect(search).not.toContain('confidence=');
    await user.click(screen.getByText('clear-report'));
    expect(search).not.toContain('report=');
    await user.click(screen.getByText('set-query'));
    expect(search).toContain('query=cannibal-3');
    await user.click(screen.getByText('set-view'));
    expect(search).toContain('view=new');
  });

  it('normalizes an invalid view out of the URL', async () => {
    renderProbe(`/sites/${SITE_ID}?tab=cannibalization&view=nonsense`);
    await act(async () => {});
    expect(search).not.toContain('view=');
  });
});

describe('loadCannibalizationReports', () => {
  it('omits the window query when the caller supplies none', async () => {
    vi.mocked(apiClient).mockResolvedValue({ items: [] } as never);
    const dispatch = vi.fn();
    await loadCannibalizationReports({ siteId: 'site-1' })(dispatch, () => ({}), undefined);
    expect(vi.mocked(apiClient)).toHaveBeenCalledWith(
      '/sites/site-1/cannibalization-reports',
      {},
    );
  });
});
