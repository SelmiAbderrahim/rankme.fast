import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from '../api';
import { sitesReducer } from '../store/slice';
import { SiteMarketDialog } from './SiteMarketDialog';
import type { Site } from '../types';

const catalogState = vi.hoisted(() => ({
  value: {
    markets: [
      { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
      { countryCode: 'DE', locationCode: 2276, languageCodes: ['de'] },
      { countryCode: 'ZZ', locationCode: 0, languageCodes: ['en'] },
    ],
    loading: false,
    error: false,
    retry: vi.fn(),
  },
}));
vi.mock('@shared/markets', async (importOriginal) => ({
  ...await importOriginal<typeof import('@shared/markets')>(),
  useMarketCatalog: () => catalogState.value,
}));

vi.mock('../api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../api')>(),
  updateSiteMarketRequest: vi.fn(),
}));

const site: Site = {
  id: 'site-1', url: 'https://example.com', domain: 'example.com', displayName: '',
  paused: false, pausedAt: null,
  defaultMarket: { locationCode: 2840, languageCode: 'en', device: 'desktop', source: 'inferred' },
  createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
};

const loadedCatalog = () => ({
  markets: [
    { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'es'] },
    { countryCode: 'DE', locationCode: 2276, languageCodes: ['de'] },
    { countryCode: 'ZZ', locationCode: 0, languageCodes: ['en'] },
  ],
  loading: false,
  error: false,
  retry: vi.fn(),
});

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  catalogState.value = loadedCatalog();
});

const mount = (props: Partial<Parameters<typeof SiteMarketDialog>[0]> = {}) => {
  const close = vi.fn();
  const store = configureStore({ reducer: { sites: sitesReducer } });
  render(<Provider store={store}><I18nextProvider i18n={i18n}>
    <SiteMarketDialog site={site} onClose={close} {...props} />
  </I18nextProvider></Provider>);
  return close;
};

describe('SiteMarketDialog', () => {
  it('saves the selected country with a supported language and closes on success', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    vi.mocked(api.updateSiteMarketRequest).mockResolvedValue({
      site: { ...site, defaultMarket: { locationCode: 2276, languageCode: 'de', device: 'desktop', source: 'owner' } },
      message: 'Site updated.',
    });
    const store = configureStore({ reducer: { sites: sitesReducer } });
    render(<Provider store={store}><I18nextProvider i18n={i18n}>
      <SiteMarketDialog site={site} onClose={close} />
    </I18nextProvider></Provider>);

    await user.click(screen.getByRole('combobox', { name: 'Country' }));
    await user.click(screen.getByRole('option', { name: /Germany/ }));
    await user.click(screen.getByRole('button', { name: 'Save market' }));

    await waitFor(() => expect(api.updateSiteMarketRequest).toHaveBeenCalledWith('site-1', {
      locationCode: 2276, languageCode: 'de', device: 'desktop',
    }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('saves a new device and language, and closes without saving on cancel', async () => {
    const user = userEvent.setup();
    const close = mount();
    vi.mocked(api.updateSiteMarketRequest).mockResolvedValue({ site, message: 'Site updated.' });
    await user.click(screen.getByRole('combobox', { name: 'Device' }));
    await user.click(await screen.findByRole('option', { name: /Mobile/ }));
    await user.click(screen.getByRole('combobox', { name: 'Language' }));
    await user.click(await screen.findByRole('option', { name: /Spanish/ }));
    await user.click(screen.getByRole('button', { name: 'Save market' }));
    await waitFor(() => expect(api.updateSiteMarketRequest).toHaveBeenCalledWith('site-1', {
      locationCode: 2840, languageCode: 'es', device: 'mobile',
    }));
    await user.click(screen.getByRole('button', { name: i18n.t('market.cancel', { ns: 'sites' }) }));
    expect(close).toHaveBeenCalled();
  });

  it('ignores a country entry that has no location code', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('combobox', { name: 'Country' }));
    const zz = screen.queryByRole('option', { name: /ZZ/ });
    if (zz) await user.click(zz);
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent(/English/);
  });

  it('starts from the fallback or an offered market when the site has none stored', () => {
    mount({ site: { ...site, defaultMarket: undefined } });
    expect(screen.getByRole('combobox', { name: 'Country' })).toBeInTheDocument();
  });

  it('starts from the suggested market when the site has none stored', () => {
    mount({ site: { ...site, defaultMarket: undefined }, initialMarket: { locationCode: 2276, languageCode: 'de', device: 'mobile' } });
    expect(screen.getByRole('combobox', { name: 'Device' })).toHaveTextContent(/Mobile/);
  });

  it('shows the catalog error with a retry and keeps saving disabled', async () => {
    const retry = vi.fn();
    catalogState.value = { ...loadedCatalog(), error: true, retry };
    mount();
    await userEvent.setup().click(screen.getByRole('button', { name: i18n.t('retry', { ns: 'sites' }) }));
    expect(retry).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save market' })).toBeDisabled();
  });

  it('keeps saving disabled while the catalog loads', () => {
    catalogState.value = { ...loadedCatalog(), loading: true };
    mount();
    expect(screen.getByRole('button', { name: 'Save market' })).toBeDisabled();
  });

  it('flags a stored language the country no longer offers', () => {
    mount({ site: { ...site, defaultMarket: { locationCode: 2276, languageCode: 'fr', device: 'desktop', source: 'owner' } } });
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save market' })).toBeDisabled();
  });

  it('keeps the stored language selectable when the country is not in the catalog', () => {
    mount({ site: { ...site, defaultMarket: { locationCode: 999999, languageCode: 'xx', device: 'desktop', source: 'owner' } } });
    expect(screen.getByRole('combobox', { name: 'Language' })).toHaveTextContent('xx');
  });

  it('shows the server message when saving fails and keeps the dialog open', async () => {
    vi.mocked(api.updateSiteMarketRequest).mockRejectedValue(new Error('offline'));
    const close = mount();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save market' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  });
});
