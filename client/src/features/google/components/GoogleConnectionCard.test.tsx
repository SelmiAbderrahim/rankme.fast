import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from '../api';
import { googleReducer } from '../store/slice';
import { GoogleConnectionCard } from './GoogleConnectionCard';
import type {
  GoogleConnection,
  GoogleConnectionState,
  GscProperty,
} from '../types';

vi.mock('../api', () => ({
  getConnection: vi.fn(),
  getConnectionConfiguration: vi.fn(),
  completeConnection: vi.fn(),
  setConnectionProperty: vi.fn(),
  disconnectConnection: vi.fn(),
  revokeGoogleCredential: vi.fn(),
}));

vi.mock('@features/auth', () => ({
  authClient: { linkSocial: vi.fn() },
  RequireVerified: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockedApi = vi.mocked(api);
const { authClient } = await import('@features/auth');
const linkSocial = authClient.linkSocial as unknown as Mock;

const connected: GoogleConnection = {
  status: 'connected',
  googleAccountEmail: 'jane@example.com',
  propertyUrl: 'https://example.com/',
  connectedAt: '2026-06-01T00:00:00.000Z',
  lastUsedAt: '2026-06-15T00:00:00.000Z',
};

const properties: GscProperty[] = [
  { siteUrl: 'https://example.com/', permissionLevel: 'siteOwner' },
  { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
];

const baseState = (): GoogleConnectionState => googleReducer(undefined, { type: '@@init' });

const makeStore = (preloaded?: Partial<GoogleConnectionState>) =>
  configureStore({
    reducer: { google: googleReducer },
    ...(preloaded
      ? {
          preloadedState: {
            google: {
              ...baseState(),
              connectionSiteId: 'site-1',
              ...preloaded,
            },
          },
        }
      : {}),
  });

type GStore = ReturnType<typeof makeStore>;

const renderWith = (store: GStore = makeStore()) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <GoogleConnectionCard siteId="site-1" />
      </I18nextProvider>
    </Provider>,
  );
  return store;
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  mockedApi.getConnection.mockResolvedValue({ connection: null });
  mockedApi.disconnectConnection.mockResolvedValue({
    message: 'site_unlinked',
    connection: null,
  });
  mockedApi.revokeGoogleCredential.mockResolvedValue({
    ok: true,
    affectedSiteCount: 1,
  });
  linkSocial.mockResolvedValue({ error: null });
  // Reset URL between tests so the callback effect doesn't misfire.
  window.history.replaceState(null, '', '/sites/site-1?tab=google');
});

describe('GoogleConnectionCard — loading', () => {
  it('shows a skeleton before the connection lookup resolves', () => {
    renderWith(makeStore({ loading: true }));
    expect(screen.getByTestId('google-skeleton')).toBeInTheDocument();
  });

  it('dispatches loadConnection on mount when not loaded', async () => {
    renderWith();
    await waitFor(() => expect(mockedApi.getConnection).toHaveBeenCalled());
  });
});

describe('GoogleConnectionCard — not-connected state', () => {
  it('renders the connect CTA and scope note', async () => {
    renderWith(makeStore({ loaded: true, connection: null }));
    expect(await screen.findByText('Connect Google Search Console')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /connect with google/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('We request read-only access to your Search Console data.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('docs-link-google-search-console')).toHaveAttribute(
      'href',
      '/docs/google-search-console',
    );
  });

  it('invokes linkSocial with the webmasters.readonly scope', async () => {
    const user = userEvent.setup();
    renderWith(makeStore({ loaded: true, connection: null }));
    await user.click(screen.getByRole('button', { name: /connect with google/i }));
    expect(linkSocial).toHaveBeenCalledWith({
      provider: 'google',
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      callbackURL: '/sites/site-1?tab=google&google_linked=1',
      errorCallbackURL: '/sites/site-1?tab=google&google_error=1',
    });
  });

  it('surfaces a connect error when linkSocial fails', async () => {
    const user = userEvent.setup();
    linkSocial.mockResolvedValue({ error: { message: 'link failed' } });
    renderWith(makeStore({ loaded: true, connection: null }));
    await user.click(screen.getByRole('button', { name: /connect with google/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't reach Google Search Console. Try again in a moment.",
    );
  });

  it('shows the busy label while connecting', () => {
    renderWith(makeStore({ loaded: true, connection: null, connecting: true }));
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
  });
});

describe('GoogleConnectionCard — callback capture', () => {
  it('dispatches connectGoogle when the URL carries ?google_linked=1', async () => {
    window.history.replaceState(null, '', '/sites/site-1?tab=google&google_linked=1');
    mockedApi.completeConnection.mockResolvedValue({ connection: connected });
    const store = renderWith(makeStore({ loaded: true, connection: null }));
    await waitFor(() =>
      expect(mockedApi.completeConnection).toHaveBeenCalledWith('site-1', {
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      }),
    );
    // Query param is stripped from the URL after success.
    await waitFor(() => expect(window.location.search).toBe('?tab=google'));
    // Connection is now in state.
    await waitFor(() => expect(store.getState().google.connection).toEqual(connected));
  });

  it('does not dispatch when the callback param is missing', async () => {
    renderWith(makeStore({ loaded: true, connection: null }));
    // small yield to let effects run
    await Promise.resolve();
    expect(mockedApi.completeConnection).not.toHaveBeenCalled();
  });

  it('preserves other query params after stripping the callback flag', async () => {
    window.history.replaceState(
      null,
      '',
      '/sites/site-1?tab=google&google_linked=1&keep=me',
    );
    mockedApi.completeConnection.mockResolvedValue({ connection: connected });
    renderWith(makeStore({ loaded: true, connection: null }));
    await waitFor(() => expect(window.location.search).toBe('?tab=google&keep=me'));
  });

  it('strips a lone successful callback flag to a clean query string', async () => {
    window.history.replaceState(null, '', '/sites/site-1?google_linked=1');
    mockedApi.completeConnection.mockResolvedValue({ connection: connected });
    renderWith(makeStore({ loaded: true, connection: null }));

    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('surfaces a link error when the URL carries ?google_error=1', async () => {
    window.history.replaceState(
      null,
      '',
      '/sites/site-1?tab=google&google_error=1&keep=me',
    );
    renderWith(makeStore({ loaded: true, connection: null }));
    // The link failure is surfaced inline and the error flag is stripped.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't connect that Google account. Pick the same account you signed in with, and grant Search Console access.",
    );
    await waitFor(() => expect(window.location.search).toBe('?tab=google&keep=me'));
    // The complete endpoint is never called on the error path.
    expect(mockedApi.completeConnection).not.toHaveBeenCalled();
  });

  it('strips a lone ?google_error=1 to a clean querystring', async () => {
    window.history.replaceState(null, '', '/sites/site-1?google_error=1');
    renderWith(makeStore({ loaded: true, connection: null }));
    await screen.findByRole('alert');
    // No other params remain → the search string is fully cleared.
    await waitFor(() => expect(window.location.search).toBe(''));
  });

  it('does not strip the param when connectGoogle is rejected — false branch at line 117', async () => {
    // completeConnection rejects → connectGoogle thunk produces a rejected action
    // → connectGoogle.fulfilled.match(result) is false → URL left untouched.
    window.history.replaceState(null, '', '/sites/site-1?tab=google&google_linked=1');
    mockedApi.completeConnection.mockRejectedValue(new Error('oauth fail'));
    renderWith(makeStore({ loaded: true, connection: null }));
    await waitFor(() => expect(mockedApi.completeConnection).toHaveBeenCalledTimes(1));
    // URL param is NOT stripped (only happens on fulfilled path).
    await Promise.resolve();
    expect(window.location.search).toContain('google_linked=1');
  });
});

describe('GoogleConnectionCard — needs_reconnect state', () => {
  const needing: GoogleConnection = { ...connected, status: 'needs_reconnect' };

  it('renders the destructive alert and a Reconnect button', () => {
    renderWith(makeStore({ loaded: true, connection: needing }));
    expect(screen.getByText('Your Google connection needs to be reconnected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument();
  });

  it('reconnect click calls linkSocial with the same scope', async () => {
    const user = userEvent.setup();
    renderWith(makeStore({ loaded: true, connection: needing }));
    await user.click(screen.getByRole('button', { name: /reconnect/i }));
    expect(linkSocial).toHaveBeenCalledWith({
      provider: 'google',
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
      callbackURL: '/sites/site-1?tab=google&google_linked=1',
      errorCallbackURL: '/sites/site-1?tab=google&google_error=1',
    });
  });

  it('shows the connectError message inline', () => {
    renderWith(
      makeStore({ loaded: true, connection: needing, connectError: 'server hates you' }),
    );
    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((el) => el.textContent === 'server hates you')).toBe(true);
  });

  it('shows the busy label on the reconnect button while connecting', () => {
    renderWith(
      makeStore({ loaded: true, connection: needing, connecting: true }),
    );
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled();
  });

  it('revoked status is treated the same as needs_reconnect', () => {
    renderWith(
      makeStore({ loaded: true, connection: { ...connected, status: 'revoked' } }),
    );
    expect(screen.getByText('Your Google connection needs to be reconnected')).toBeInTheDocument();
  });
});

describe('GoogleConnectionCard — connected state', () => {
  it('shows the email, property, and last-used labels', () => {
    renderWith(makeStore({ loaded: true, connection: connected }));
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/')).toBeInTheDocument();
    expect(screen.getByText(/Connected on/)).toBeInTheDocument();
    expect(screen.getByText(/Last used/)).toBeInTheDocument();
  });

  it('shows the empty-list fallback when no properties and propertyUrl is null', () => {
    renderWith(
      makeStore({
        loaded: true,
        connection: { ...connected, propertyUrl: null },
        properties: [],
      }),
    );
    expect(
      screen.getByText(/No verified properties found/),
    ).toBeInTheDocument();
    // No picker when the account has no verified properties.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows "Never used" when lastUsedAt is null', () => {
    renderWith(
      makeStore({ loaded: true, connection: { ...connected, lastUsedAt: null } }),
    );
    expect(screen.getByText(/Never used/)).toBeInTheDocument();
  });

  it('shows the success message after disconnect', () => {
    renderWith(
      makeStore({ loaded: true, connection: connected, message: 'Google Search Console disconnected.' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Google Search Console disconnected.');
  });

  it('shows the disconnect error inline', () => {
    renderWith(
      makeStore({ loaded: true, connection: connected, disconnectError: 'nope' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('nope');
  });

  it('localizes the stable site-unlinked message code', () => {
    renderWith(
      makeStore({ loaded: true, connection: connected, message: 'site_unlinked' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Google was unlinked from this site.',
    );
  });

  it('shows a revoke error inline', () => {
    renderWith(
      makeStore({ loaded: true, connection: connected, revokeError: 'revoke failed' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('revoke failed');
  });

  it('polls while automatic property matching is pending', async () => {
    vi.useFakeTimers();
    try {
      mockedApi.getConnectionConfiguration.mockResolvedValue({
        ...connected,
        gscStatus: 'bound',
      });
      renderWith(
        makeStore({
          loaded: true,
          connection: { ...connected, gscStatus: 'queued' },
        }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_500);
      });
      expect(mockedApi.getConnectionConfiguration).toHaveBeenCalledWith('site-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a semantic status while automatic property matching is active', () => {
    renderWith(
      makeStore({
        loaded: true,
        connection: { ...connected, gscStatus: 'queued' },
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      "Checking this site's Google properties…",
    );
  });

  it.each(['bound', 'unbound'] as const)(
    'does not show a transient auto-match message for %s bindings',
    (gscStatus) => {
      renderWith(
        makeStore({
          loaded: true,
          connection: { ...connected, gscStatus },
        }),
      );
      expect(
        screen.queryByText("Checking this site's Google properties…"),
      ).not.toBeInTheDocument();
    },
  );

  it('disconnect flow: trigger → confirm → API call', async () => {
    const user = userEvent.setup();
    const store = renderWith(makeStore({ loaded: true, connection: connected }));
    await user.click(screen.getByRole('button', { name: 'Unlink this site' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Unlink Google from this site?');
    await user.click(within(dialog).getByRole('button', { name: 'Unlink site' }));
    await waitFor(() =>
      expect(mockedApi.disconnectConnection).toHaveBeenCalledWith('site-1'),
    );
    await waitFor(() => expect(store.getState().google.connection).toBeNull());
  });

  it('cancel closes the dialog without calling the API', async () => {
    const user = userEvent.setup();
    renderWith(makeStore({ loaded: true, connection: connected }));
    await user.click(screen.getByRole('button', { name: 'Unlink this site' }));
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(mockedApi.disconnectConnection).not.toHaveBeenCalled();
  });

  it('warns before revoking the shared credential from every site', async () => {
    const user = userEvent.setup();
    const store = renderWith(
      makeStore({
        loaded: true,
        connection: { ...connected, connectedSiteCount: 3 },
      }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Revoke Google access everywhere' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('unlinks all 3 connected sites');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke everywhere' }));
    await waitFor(() =>
      expect(mockedApi.revokeGoogleCredential).toHaveBeenCalledWith('site-1'),
    );
    await waitFor(() => expect(store.getState().google.connection).toBeNull());
  });
});

describe('GoogleConnectionCard — scopes row', () => {
  const GSC = 'https://www.googleapis.com/auth/webmasters.readonly';
  const GA4 = 'https://www.googleapis.com/auth/analytics.readonly';

  it('a legacy connection without scopes shows Search Console granted and Analytics not granted', () => {
    renderWith(makeStore({ loaded: true, connection: connected }));
    const row = screen.getByTestId('google-scopes-row');
    expect(within(row).getByText('Search Console')).toBeInTheDocument();
    expect(within(row).getByText('Analytics')).toBeInTheDocument();
    expect(screen.getByTestId('google-scope-gsc')).toHaveAttribute('data-granted', 'true');
    expect(screen.getByTestId('google-scope-ga4')).toHaveAttribute('data-granted', 'false');
    // Not color-only: sr-only text carries the state.
    expect(within(screen.getByTestId('google-scope-gsc')).getByText('granted')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('google-scope-ga4')).getByText('not granted'),
    ).toBeInTheDocument();
  });

  it('shows both scopes granted when the connection carries them', () => {
    renderWith(
      makeStore({
        loaded: true,
        connection: { ...connected, scopes: [GSC, GA4] },
      }),
    );
    expect(screen.getByTestId('google-scope-gsc')).toHaveAttribute('data-granted', 'true');
    expect(screen.getByTestId('google-scope-ga4')).toHaveAttribute('data-granted', 'true');
    expect(
      within(screen.getByTestId('google-scope-ga4')).getByText('granted'),
    ).toBeInTheDocument();
  });

  it('marks Search Console not granted when the scopes list omits it', () => {
    renderWith(
      makeStore({
        loaded: true,
        connection: { ...connected, scopes: [GA4] },
      }),
    );
    expect(screen.getByTestId('google-scope-gsc')).toHaveAttribute('data-granted', 'false');
    expect(screen.getByTestId('google-scope-ga4')).toHaveAttribute('data-granted', 'true');
    expect(
      within(screen.getByTestId('google-scope-gsc')).getByText('not granted'),
    ).toBeInTheDocument();
  });
});

describe('GoogleConnectionCard — property picker', () => {
  it('renders a property select seeded from the verified list', () => {
    renderWith(makeStore({ loaded: true, connection: connected, properties }));
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('https://example.com/');
  });

  it('shows the placeholder when connected without a chosen property', () => {
    renderWith(
      makeStore({
        loaded: true,
        connection: { ...connected, propertyUrl: null },
        properties,
      }),
    );
    expect(screen.getByRole('combobox')).toHaveTextContent('Select a property');
  });

  it('dispatches setGoogleProperty with the chosen property', async () => {
    const user = userEvent.setup();
    mockedApi.setConnectionProperty.mockResolvedValue({
      connection: { ...connected, propertyUrl: 'sc-domain:example.com' },
    });
    const store = renderWith(
      makeStore({ loaded: true, connection: connected, properties }),
    );
    await user.click(screen.getByRole('combobox'));
    await user.click(
      await screen.findByRole('option', { name: 'sc-domain:example.com' }),
    );
    await waitFor(() =>
      expect(mockedApi.setConnectionProperty).toHaveBeenCalledWith('site-1', {
        propertyUrl: 'sc-domain:example.com',
      }),
    );
    await waitFor(() =>
      expect(store.getState().google.connection?.propertyUrl).toBe(
        'sc-domain:example.com',
      ),
    );
  });

  it('disables the select while a save is in flight', () => {
    renderWith(
      makeStore({
        loaded: true,
        connection: connected,
        properties,
        settingProperty: true,
      }),
    );
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('shows the set-property error inline', () => {
    renderWith(
      makeStore({
        loaded: true,
        connection: connected,
        properties,
        setPropertyError: 'That property is not in your verified list.',
      }),
    );
    const alerts = screen.getAllByRole('alert');
    expect(
      alerts.some(
        (el) => el.textContent === 'That property is not in your verified list.',
      ),
    ).toBe(true);
  });

  it('labels reused properties with display-name and domain fallbacks', async () => {
    const user = userEvent.setup();
    renderWith(
      makeStore({
        loaded: true,
        connection: connected,
        properties: [
          {
            siteUrl: 'sc-domain:shared.example',
            permissionLevel: 'siteOwner',
            inUseBy: [
              { siteId: 'site-a', domain: 'primary.example', displayName: 'Primary site' },
              { siteId: 'site-b', domain: 'fallback.example', displayName: '' },
            ],
          },
        ],
      }),
    );

    await user.click(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', {
      name: 'sc-domain:shared.example — Primary site, fallback.example',
    })).toBeInTheDocument();
  });

  it('does not dispatch when the same property is re-selected — false branch at line 294', async () => {
    // connection.propertyUrl matches the option the user picks → value === propertyUrl
    // → `if (value !== connection.propertyUrl)` is false → setConnectionProperty skipped.
    const user = userEvent.setup();
    renderWith(makeStore({ loaded: true, connection: connected, properties }));
    await user.click(screen.getByRole('combobox'));
    await user.click(
      await screen.findByRole('option', { name: 'https://example.com/' }),
    );
    expect(mockedApi.setConnectionProperty).not.toHaveBeenCalled();
  });
});

describe('GoogleConnectionCard — load-error state', () => {
  it('renders the localized load error and a retry button', async () => {
    const user = userEvent.setup();
    renderWith(makeStore({ loaded: true, error: 'Could not load your Google connection.' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load your Google connection.');
    mockedApi.getConnection.mockResolvedValue({ connection: connected });
    await user.click(screen.getByRole('button', { name: /connect with google/i }));
    await waitFor(() => expect(mockedApi.getConnection).toHaveBeenCalled());
  });
});
