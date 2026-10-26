import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { legacyAppRedirectRoutes, LEGACY_APP_REDIRECTS } from '@app/legacyRedirects';

describe('legacy account redirects', () => {
  it('declares only the portable profile aliases', () => {
    expect(LEGACY_APP_REDIRECTS).toEqual([{ from: 'profile', to: '/settings/profile' }, { from: 'settings', to: '/settings/profile' }]);
  });
  it('preserves search, hash, and router state while replacing history', async () => {
    const state = { returnTo: '/sites' };
    const router = createMemoryRouter([
      ...legacyAppRedirectRoutes,
      { path: '/settings/profile', element: <p>Profile destination</p> },
      { path: '/before', element: <p>Before</p> },
    ], { initialEntries: ['/before', { pathname: '/profile', search: '?tab=security', hash: '#name', state }], initialIndex: 1 });
    render(<RouterProvider router={router} />);
    await screen.findByText('Profile destination');
    expect(router.state.location).toMatchObject({ pathname: '/settings/profile', search: '?tab=security', hash: '#name', state });
    await router.navigate(-1);
    await waitFor(() => expect(router.state.location.pathname).toBe('/before'));
  });
});
