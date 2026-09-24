/**
 * Guard-branch test for GoogleConnectionCard.tsx:294.
 *
 * `if (value !== connection.propertyUrl)` — false branch fires when the user
 * selects the same property that is already active. Radix Select does NOT call
 * onValueChange when the option is already selected, so the false branch is
 * unreachable via normal Radix interaction.
 *
 * Strategy: mock @shared/ui/select with a minimal implementation that renders
 * a synthetic button calling onValueChange(currentValue). Clicking it with
 * currentValue === connection.propertyUrl makes the guard evaluate to false
 * and skips the dispatch call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from '../api';
import { googleReducer } from '../store/slice';
import { GoogleConnectionCard } from './GoogleConnectionCard';
import { Ga4PropertySelect } from './Ga4PropertySelect';
import type { GoogleConnection, GoogleConnectionState, GscProperty } from '../types';

vi.mock('../api', () => ({
  getConnection: vi.fn(),
  getConnectionConfiguration: vi.fn(),
  completeConnection: vi.fn(),
  setConnectionProperty: vi.fn(),
  disconnectConnection: vi.fn(),
  fetchAnalyticsProperties: vi.fn(),
  revokeGoogleCredential: vi.fn(),
}));

vi.mock('@features/auth', () => ({
  authClient: { linkSocial: vi.fn() },
  RequireVerified: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock @shared/ui/select: render children inline and expose a synthetic button
// that calls onValueChange with the Select's current value prop (same as
// connection.propertyUrl). This forces the `value !== propertyUrl` guard to
// evaluate its false branch.
vi.mock('@shared/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
  }) => (
    <div>
      <button
        data-testid="mock-select-same-value"
        onClick={() => onValueChange?.(value ?? '')}
      />
      {children}
    </div>
  ),
  SelectTrigger: ({
    children,
    id,
  }: {
    children: React.ReactNode;
    id?: string;
    className?: string;
    'aria-busy'?: boolean;
  }) => <div id={id}>{children}</div>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <div data-value={value}>{children}</div>,
}));

const mockedApi = vi.mocked(api);

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

const renderWith = (preloaded?: Partial<GoogleConnectionState>) => {
  render(
    <Provider store={makeStore(preloaded)}>
      <I18nextProvider i18n={i18n}>
        <GoogleConnectionCard siteId="site-1" />
      </I18nextProvider>
    </Provider>,
  );
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  mockedApi.getConnection.mockResolvedValue({ connection: null });
  window.history.replaceState(null, '', '/sites/site-1?tab=google');
});

describe('GoogleConnectionCard guard branch — Select onValueChange same-value', () => {
  it('onValueChange with the current propertyUrl no-ops — false branch at GoogleConnectionCard.tsx:294', async () => {
    // Render with a connected state and a properties list.
    // The mock Select renders a synthetic button that calls onValueChange(currentValue)
    // where currentValue === connection.propertyUrl ('https://example.com/').
    // The guard `if (value !== connection.propertyUrl)` evaluates to false →
    // setConnectionProperty is never called.
    const user = userEvent.setup();
    renderWith({ loaded: true, connection: connected, properties });

    // Wait for the component to settle (connected state renders the Select).
    await waitFor(() =>
      expect(screen.getByTestId('mock-select-same-value')).toBeInTheDocument(),
    );

    // Click the synthetic trigger — calls onValueChange('https://example.com/')
    // which equals connection.propertyUrl → guard is false → no dispatch.
    await user.click(screen.getByTestId('mock-select-same-value'));

    expect(mockedApi.setConnectionProperty).not.toHaveBeenCalled();
  });
});

describe('Ga4PropertySelect guard branch — Select onValueChange same-value', () => {
  it('onValueChange with the current ga4PropertyId no-ops', async () => {
    // Same trick as above: the mocked Select re-emits its CURRENT value, which
    // Radix never does for real, so the `value !== ga4PropertyId` guard takes
    // its false branch and the PATCH is skipped.
    const user = userEvent.setup();
    const ga4Connected: GoogleConnection = {
      ...connected,
      scopes: [
        'https://www.googleapis.com/auth/webmasters.readonly',
        'https://www.googleapis.com/auth/analytics.readonly',
      ],
      ga4PropertyId: 'properties/1',
      ga4PropertyDisplayName: 'Site one',
    };
    const store = makeStore({
      loaded: true,
      connection: ga4Connected,
      analytics: {
        ...baseState().analytics,
        propertiesLoaded: true,
        properties: [{ propertyId: 'properties/1', displayName: 'Site one' }],
      },
    });
    render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <Ga4PropertySelect siteId="site-1" />
        </I18nextProvider>
      </Provider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId('mock-select-same-value')).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId('mock-select-same-value'));

    expect(mockedApi.setConnectionProperty).not.toHaveBeenCalled();
  });
});
