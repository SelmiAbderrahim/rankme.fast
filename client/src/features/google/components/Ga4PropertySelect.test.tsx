/**
 * Ga4PropertySelect tests — properties loading skeleton, error + retry, the
 * zero-property fallback, explicit manual selection (PATCH), no guessing when
 * only one property exists, the disabled-while-saving state, and save errors.
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
import { Ga4PropertySelect } from './Ga4PropertySelect';
import type { Ga4Property, GoogleConnection, GoogleConnectionState } from '../types';

vi.mock('../api', () => ({
  getConnection: vi.fn(),
  completeConnection: vi.fn(),
  setConnectionProperty: vi.fn(),
  disconnectConnection: vi.fn(),
  fetchAnalyticsProperties: vi.fn(),
}));

const mockedApi = vi.mocked(api);

const GSC = 'https://www.googleapis.com/auth/webmasters.readonly';
const GA4 = 'https://www.googleapis.com/auth/analytics.readonly';

const connected: GoogleConnection = {
  status: 'connected',
  googleAccountEmail: 'jane@example.com',
  propertyUrl: 'https://example.com/',
  connectedAt: '2026-06-01T00:00:00.000Z',
  lastUsedAt: null,
  scopes: [GSC, GA4],
  ga4PropertyId: null,
  ga4PropertyDisplayName: null,
};

const twoProperties: Ga4Property[] = [
  { propertyId: 'properties/1', displayName: 'Site one' },
  { propertyId: 'properties/2', displayName: 'Site two' },
];

const baseState = (): GoogleConnectionState => googleReducer(undefined, { type: '@@init' });

const makeStore = (preloaded?: Partial<GoogleConnectionState>) =>
  configureStore({
    reducer: { google: googleReducer },
    preloadedState: { google: { ...baseState(), ...preloaded } },
  });

type GStore = ReturnType<typeof makeStore>;

const renderSelect = (store: GStore) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <Ga4PropertySelect siteId="site-1" />
      </I18nextProvider>
    </Provider>,
  );
  return store;
};

const withAnalytics = (
  analytics: Partial<GoogleConnectionState['analytics']>,
  connection: GoogleConnection | null = connected,
): Partial<GoogleConnectionState> => ({
  loaded: true,
  connectionSiteId: 'site-1',
  connection,
  analytics: { ...baseState().analytics, ...analytics },
});

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  mockedApi.fetchAnalyticsProperties.mockResolvedValue({ properties: twoProperties });
});

describe('Ga4PropertySelect', () => {
  it('loads the property list on mount and renders the picker', async () => {
    renderSelect(makeStore(withAnalytics({})));
    expect(screen.getByTestId('ga4-property-skeleton')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ga4-property-select')).toBeInTheDocument());
    expect(mockedApi.fetchAnalyticsProperties).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Analytics property')).toBeInTheDocument();
    expect(screen.getByTestId('ga4-property-select')).toHaveTextContent('Select a property');
  });

  it('does not refetch when the list is already loaded', () => {
    renderSelect(makeStore(withAnalytics({ propertiesLoaded: true, properties: twoProperties })));
    expect(mockedApi.fetchAnalyticsProperties).not.toHaveBeenCalled();
    expect(screen.getByTestId('ga4-property-select')).toBeInTheDocument();
  });

  it('shows the error state with a working retry button', async () => {
    const user = userEvent.setup();
    renderSelect(makeStore(withAnalytics({ propertiesLoaded: true, propertiesError: 'boom' })));
    const error = screen.getByTestId('ga4-property-error');
    expect(error).toHaveTextContent('boom');
    await user.click(screen.getByTestId('ga4-property-retry'));
    await waitFor(() => expect(mockedApi.fetchAnalyticsProperties).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('ga4-property-select')).toBeInTheDocument();
  });

  it('renders the zero-property fallback', () => {
    renderSelect(makeStore(withAnalytics({ propertiesLoaded: true, properties: [] })));
    expect(screen.getByTestId('ga4-property-none')).toHaveTextContent(
      'No Google Analytics properties found for this account.',
    );
  });

  it('selecting a property PATCHes the connection with its id', async () => {
    const user = userEvent.setup();
    mockedApi.setConnectionProperty.mockResolvedValue({
      connection: {
        ...connected,
        ga4PropertyId: 'properties/2',
        ga4PropertyDisplayName: 'Site two',
      },
    });
    const store = renderSelect(
      makeStore(withAnalytics({ propertiesLoaded: true, properties: twoProperties })),
    );
    await user.click(screen.getByTestId('ga4-property-select'));
    await user.click(await screen.findByRole('option', { name: 'Site two' }));
    await waitFor(() =>
      expect(mockedApi.setConnectionProperty).toHaveBeenCalledWith('site-1', {
        ga4PropertyId: 'properties/2',
      }),
    );
    await waitFor(() =>
      expect(store.getState().google.connection?.ga4PropertyId).toBe('properties/2'),
    );
  });

  it('does not guess when the account has exactly one property', async () => {
    const only = twoProperties[0] as Ga4Property;
    renderSelect(makeStore(withAnalytics({ propertiesLoaded: true, properties: [only] })));
    expect(screen.getByTestId('ga4-property-select')).toHaveTextContent('Select a property');
    await Promise.resolve();
    expect(mockedApi.setConnectionProperty).not.toHaveBeenCalled();
  });

  it('does not save again when a property is already chosen', async () => {
    renderSelect(
      makeStore(
        withAnalytics(
          { propertiesLoaded: true, properties: [twoProperties[0] as Ga4Property] },
          { ...connected, ga4PropertyId: 'properties/1' },
        ),
      ),
    );
    await Promise.resolve();
    expect(mockedApi.setConnectionProperty).not.toHaveBeenCalled();
  });

  it('does not select anything while there are two or more properties', async () => {
    renderSelect(makeStore(withAnalytics({ propertiesLoaded: true, properties: twoProperties })));
    await Promise.resolve();
    expect(mockedApi.setConnectionProperty).not.toHaveBeenCalled();
  });

  it('disables the select while a save is in flight', () => {
    renderSelect(
      makeStore(
        withAnalytics({
          propertiesLoaded: true,
          properties: twoProperties,
          settingProperty: true,
        }),
      ),
    );
    const trigger = screen.getByTestId('ga4-property-select');
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the save error inline', () => {
    renderSelect(
      makeStore(
        withAnalytics({
          propertiesLoaded: true,
          properties: twoProperties,
          setPropertyError: 'That property could not be saved.',
        }),
      ),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('That property could not be saved.');
  });

  it('does not reuse a selected property from another site', () => {
    renderSelect(
      makeStore({
        ...withAnalytics(
          { propertiesLoaded: true, properties: twoProperties },
          { ...connected, ga4PropertyId: 'properties/1' },
        ),
        connectionSiteId: 'site-2',
      }),
    );

    expect(screen.getByTestId('ga4-property-select')).toHaveTextContent('Select a property');
  });

  it('labels shared properties with display-name and domain fallbacks', async () => {
    const user = userEvent.setup();
    const shared: Ga4Property = {
      propertyId: 'properties/shared',
      displayName: 'Shared property',
      inUseBy: [
        { siteId: 'site-a', domain: 'primary.example', displayName: 'Primary site' },
        { siteId: 'site-b', domain: 'fallback.example', displayName: '' },
      ],
    };
    renderSelect(
      makeStore(withAnalytics({ propertiesLoaded: true, properties: [shared] })),
    );

    await user.click(screen.getByTestId('ga4-property-select'));
    expect(await screen.findByRole('option', {
      name: 'Shared property — Primary site, fallback.example',
    })).toBeInTheDocument();
  });
});
