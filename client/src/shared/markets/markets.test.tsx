import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import common from '@shared/i18n/locales/en/common.json';

const mockedApiClient = vi.hoisted(() => vi.fn());
vi.mock('@shared/api/client', () => ({ apiClient: mockedApiClient }));

import { fetchMarketCatalog } from './api';
import { CountryCombobox } from './CountryCombobox';
import {
  countryCodeForLocation,
  countryName,
  formatCountryFromLocation,
  languageName,
  locationCodeForCountry,
} from './format';
import type { MarketCatalogEntry, MarketCatalogSurface } from './types';
import { useMarketCatalog } from './useMarketCatalog';

const i18n = i18next.createInstance();
await i18n.init({ lng: 'en', resources: { en: { common } } });

const markets: MarketCatalogEntry[] = [
  { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
  { countryCode: 'FR', locationCode: 2250, languageCodes: ['fr'] },
];

const catalog = (surface: MarketCatalogSurface = 'seo') => ({
  surface,
  markets,
  fetchedAt: '2026-08-11T00:00:00.000Z',
  cached: false,
});

function withI18n(node: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);
}

beforeEach(() => mockedApiClient.mockReset());

describe('market catalog API and hook', () => {
  it('loads and validates a surface catalog', async () => {
    mockedApiClient.mockResolvedValue(catalog());
    await expect(fetchMarketCatalog('seo')).resolves.toEqual(catalog());
    expect(mockedApiClient).toHaveBeenCalledWith('/market-catalogs/seo', {});
  });

  it('forwards cancellation and rejects malformed payloads', async () => {
    const controller = new AbortController();
    mockedApiClient.mockResolvedValueOnce(catalog());
    await fetchMarketCatalog('seo', controller.signal);
    expect(mockedApiClient).toHaveBeenLastCalledWith('/market-catalogs/seo', {
      signal: controller.signal,
    });
    mockedApiClient.mockResolvedValueOnce({ bad: true });
    await expect(fetchMarketCatalog('seo')).rejects.toThrow();
  });

  it('reports loading, success, surface changes, and failures', async () => {
    mockedApiClient
      .mockResolvedValueOnce(catalog('seo'))
      .mockRejectedValueOnce(new Error('offline'));
    function Probe() {
      const [surface, setSurface] = useState<MarketCatalogSurface>('seo');
      const state = useMarketCatalog(surface);
      return (
        <div>
          <span data-testid="catalog-state">
            {state.loading ? 'loading' : state.error ? 'error' : state.markets[0]?.countryCode}
          </span>
          <button type="button" onClick={() => setSurface('brand-radar')}>change</button>
        </div>
      );
    }
    const user = userEvent.setup();
    const view = render(<Probe />);
    expect(screen.getByTestId('catalog-state')).toHaveTextContent('loading');
    expect(await screen.findByTestId('catalog-state')).toHaveTextContent('US');
    await user.click(screen.getByRole('button', { name: 'change' }));
    expect(await screen.findByTestId('catalog-state')).toHaveTextContent('error');
    view.unmount();
  });

  it('ignores both a late success and a late failure after unmount', async () => {
    function HookProbe() {
      useMarketCatalog('seo');
      return <span>mounted</span>;
    }
    let resolveCatalog!: (value: ReturnType<typeof catalog>) => void;
    mockedApiClient.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCatalog = resolve;
      }),
    );
    const success = render(<HookProbe />);
    success.unmount();
    resolveCatalog(catalog());
    await Promise.resolve();

    let rejectCatalog!: (reason: unknown) => void;
    mockedApiClient.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectCatalog = reject;
      }),
    );
    const failure = render(<HookProbe />);
    failure.unmount();
    rejectCatalog(new Error('late offline'));
    await Promise.resolve();
  });
});

describe('market formatting', () => {
  it('maps legacy and provider codes without exposing unknown numbers', () => {
    expect(countryCodeForLocation(2250)).toBe('FR');
    expect(countryCodeForLocation(2392)).toBe('JP');
    expect(countryCodeForLocation(999, [{ countryCode: 'CA', locationCode: 999, languageCodes: ['en'] }])).toBe('CA');
    expect(countryCodeForLocation(null)).toBeNull();
    expect(countryCodeForLocation(999)).toBeNull();
    expect(locationCodeForCountry(' fr ')).toBe(2250);
    expect(locationCodeForCountry('ZZ')).toBeNull();
    expect(formatCountryFromLocation(2250, 'en', 'Unknown')).toBe('France');
    expect(formatCountryFromLocation(2392, 'en', 'Unknown')).toBe('Japan');
    expect(formatCountryFromLocation(999, 'en', 'Unknown')).toBe('Unknown');
  });

  it('localizes names and returns null when Intl rejects the locale', () => {
    expect(countryName('US', 'en')).toBe('United States');
    expect(languageName('fr', 'en')).toBe('French');
    expect(countryName('US', 'not_a_locale')).toBeNull();
    expect(languageName('fr', 'not_a_locale')).toBeNull();
    expect(countryName('', 'en')).toBeNull();
    expect(languageName(' ', 'en')).toBeNull();
    expect(languageName('not-a-language', 'en')).toBeNull();
    expect(languageName('pt-BR', 'en')).toBe('Brazilian Portuguese');
  });
});

describe('CountryCombobox', () => {
  it('searches localized names and ISO codes, then selects with the keyboard', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    withI18n(
      <CountryCombobox
        value="US"
        markets={markets}
        onValueChange={onValueChange}
        ariaLabel="Country"
      />,
    );
    await user.click(screen.getByRole('combobox', { name: 'Country' }));
    const search = screen.getByRole('textbox', { name: 'Search countries' });
    await user.type(search, 'fr');
    expect(screen.queryByRole('option', { name: /United States/ })).toBeNull();
    await user.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('FR', markets[1]);
  });

  it('supports the worldwide option, no-results state, escape, and pointer selection', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    withI18n(
      <CountryCombobox value={null} markets={markets} allowAll onValueChange={onValueChange} />,
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('All countries');
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: /France/ }));
    expect(onValueChange).toHaveBeenCalledWith('FR', markets[1]);
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: 'All countries' }));
    expect(onValueChange).toHaveBeenLastCalledWith(null, null);
    await user.click(trigger);
    await user.type(screen.getByRole('textbox'), 'zzz');
    expect(screen.getByRole('option', { name: 'All countries' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
  });

  it('exposes disabled, loading, invalid, and empty states accessibly', async () => {
    const first = withI18n(
      <CountryCombobox
        value={null}
        markets={[]}
        onValueChange={vi.fn()}
        loading
        invalid
        describedBy="country-error"
      />,
    );
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveTextContent('Loading countries');
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-describedby', 'country-error');
    first.unmount();

    const user = userEvent.setup();
    withI18n(<CountryCombobox value={null} markets={[]} onValueChange={vi.fn()} />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('status')).toHaveTextContent('No countries match your search.');
  });

  it('navigates worldwide and country choices with both arrow keys', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    withI18n(
      <CountryCombobox
        value="US"
        markets={markets}
        allowAll
        onValueChange={onValueChange}
      />,
    );
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    const search = screen.getByRole('textbox', { name: 'Search countries' });
    await user.type(search, '{Enter}');
    expect(onValueChange).toHaveBeenLastCalledWith(null, null);

    await user.click(trigger);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onValueChange).toHaveBeenLastCalledWith('FR', markets[1]);

    await user.click(trigger);
    await user.keyboard('{ArrowUp}{Enter}');
    expect(onValueChange).toHaveBeenLastCalledWith('US', markets[0]);
  });

  it('falls back for an unknown selection and invalid catalog country code', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    const unusualMarkets = [
      { countryCode: 'invalid_code', locationCode: null, languageCodes: ['en'] },
    ];
    const missing = withI18n(
      <CountryCombobox
        value="missing"
        markets={unusualMarkets}
        onValueChange={onValueChange}
      />,
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Select a country');
    await user.click(trigger);
    expect(screen.getByRole('option')).toHaveTextContent('invalid_code');
    await user.click(screen.getByRole('option'));
    expect(onValueChange).toHaveBeenCalledWith('invalid_code', unusualMarkets[0]);
    missing.unmount();

    withI18n(
      <CountryCombobox
        value="invalid_code"
        markets={unusualMarkets}
        onValueChange={onValueChange}
      />,
    );
    expect(screen.getByRole('combobox')).toHaveTextContent('invalid_code');
  });

  it('ignores Enter and wraps arrow navigation when no countries match', async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    withI18n(<CountryCombobox value={null} markets={markets} onValueChange={onValueChange} />);
    await user.click(screen.getByRole('combobox'));
    const search = screen.getByRole('textbox');
    await user.type(search, 'no-match');
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
