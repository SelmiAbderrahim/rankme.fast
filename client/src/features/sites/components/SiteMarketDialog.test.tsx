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

vi.mock('@shared/markets', async (importOriginal) => ({
  ...await importOriginal<typeof import('@shared/markets')>(),
  useMarketCatalog: () => ({
    markets: [
      { countryCode: 'US', locationCode: 2840, languageCodes: ['en'] },
      { countryCode: 'DE', locationCode: 2276, languageCodes: ['de'] },
    ],
    loading: false,
    error: false,
    retry: vi.fn(),
  }),
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

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
});

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
});
