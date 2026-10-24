import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation, useNavigate, Link } from 'react-router-dom';
import { useSiteTab } from './tabState';

const Workspace = () => {
  const [tab, setTab, unknown] = useSiteTab();
  const location = useLocation();
  const navigate = useNavigate();
  return <>
    <output data-testid="tab">{tab}</output>
    <output data-testid="notice">{unknown}</output>
    <output data-testid="url">{location.pathname}{location.search}{location.hash}</output>
    <output data-testid="state">{JSON.stringify(location.state)}</output>
    <button onClick={() => setTab('report')}>Report</button>
    <button onClick={() => setTab('overview')}>Overview</button>
    <button onClick={() => navigate(-1)}>Back</button>
    <button onClick={() => navigate(1)}>Forward</button>
    <Link to="/sites/s1?tab=overview">Overview link</Link>
    <Link to="/sites/s2?tab=pages">Other site</Link>
  </>;
};
const mount = (url: string) => {
  const router = createMemoryRouter([{ path: '*', element: <Workspace /> }], {
    initialEntries: ['/sites/s1?tab=keywords', { pathname: '/sites/s1', search: url, hash: '#details', state: { origin: 'saved-link' } }],
    initialIndex: 1,
  });
  render(<RouterProvider router={router} />);
  return router;
};

describe('workspace URL canonicalization', () => {
  it('rewrites aliases in place with query, hash and state intact, then preserves those on tab selection', async () => {
    const user = userEvent.setup();
    const router = mount('?tab=KEYWORD_RESEARCH&view=queries&source=bookmark');
    await waitFor(() => expect(router.state.location.search).toBe('?tab=research&view=queries&source=bookmark'));
    expect(router.state.location.hash).toBe('#details');
    expect(router.state.location.state).toEqual({ origin: 'saved-link' });
    expect(screen.getByTestId('tab')).toHaveTextContent('research');
    expect(screen.getByTestId('notice')).toBeEmptyDOMElement();
    await user.click(screen.getByText('Report', { selector: 'button' }));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(router.state.location.search).toBe('?tab=report&view=queries&source=bookmark');
    expect(router.state.location.hash).toBe('#details');
    expect(router.state.location.state).toEqual({ origin: 'saved-link' });
    await user.click(screen.getByText('Back'));
    expect(screen.getByTestId('tab')).toHaveTextContent('keywords');
    await user.click(screen.getByText('Forward'));
    expect(screen.getByTestId('tab')).toHaveTextContent('report');
  });
  it.each(['Overview', 'Overview link', 'Other site', 'Back'])('shows an unknown-section notice only until navigating with %s', async (action) => {
    const user = userEvent.setup();
    const router = mount('?tab=unknown&view=queries');
    await waitFor(() => expect(router.state.location.search).toBe('?tab=overview&view=queries'));
    expect(screen.getByTestId('tab')).toHaveTextContent('overview');
    expect(screen.getByTestId('notice')).toHaveTextContent('unknown');
    expect(router.state.location.hash).toBe('#details');
    expect(router.state.location.state).toEqual({ origin: 'saved-link' });
    await user.click(screen.getByText(action, { exact: true }));
    expect(screen.getByTestId('notice')).toBeEmptyDOMElement();
  });
});
