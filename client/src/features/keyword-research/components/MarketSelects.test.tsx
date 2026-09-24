import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { i18n, initI18n } from '@shared/i18n';
import { MarketSelects } from './MarketSelects';

const catalog = vi.hoisted(() => ({
  current: {
    markets: [
      { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'fr'] },
      { countryCode: 'FR', locationCode: 2250, languageCodes: ['fr'] },
    ],
    loading: false,
    error: false,
  },
}));

vi.mock('@shared/markets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/markets')>()),
  useMarketCatalog: () => catalog.current,
}));

function renderSelects(
  props: Partial<React.ComponentProps<typeof MarketSelects>> = {},
) {
  const defaults = {
    locationCode: 2840,
    languageCode: 'en',
    onLocationChange: vi.fn(),
    onLanguageChange: vi.fn(),
    testIdPrefix: 'market',
    ...props,
  };
  return {
    ...render(
      <I18nextProvider i18n={i18n}>
        <MarketSelects {...defaults} />
      </I18nextProvider>,
    ),
    props: defaults,
  };
}

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  catalog.current = {
    markets: [
      { countryCode: 'US', locationCode: 2840, languageCodes: ['en', 'fr'] },
      { countryCode: 'FR', locationCode: 2250, languageCodes: ['fr'] },
    ],
    loading: false,
    error: false,
  };
});

describe('MarketSelects', () => {
  it('selects a catalog country and language', async () => {
    const user = userEvent.setup();
    const view = renderSelects();
    await user.click(screen.getByTestId('market-location'));
    await user.click(screen.getByRole('option', { name: /France/ }));
    expect(view.props.onLocationChange).toHaveBeenCalledWith(2250);

    fireEvent.change(screen.getByTestId('market-language'), { target: { value: 'fr' } });
    expect(view.props.onLanguageChange).toHaveBeenCalledWith('fr');
  });

  it('normalizes an unknown location to the US market and invalid language to its first choice', () => {
    const view = renderSelects({ locationCode: 9999, languageCode: 'zz' });
    expect(view.props.onLocationChange).toHaveBeenCalledWith(2840);
    expect(view.props.onLanguageChange).toHaveBeenCalledWith('en');
  });

  it('falls back to the first market when US is unavailable', () => {
    catalog.current = {
      ...catalog.current,
      markets: [{ countryCode: 'FR', locationCode: 2250, languageCodes: ['fr'] }],
    };
    const view = renderSelects({ locationCode: 9999, languageCode: 'fr' });
    expect(view.props.onLocationChange).toHaveBeenCalledWith(2250);
    expect(view.props.onLanguageChange).not.toHaveBeenCalled();
  });

  it('does not invent a location or language from an empty catalog', () => {
    catalog.current = { markets: [], loading: false, error: false };
    const view = renderSelects({ locationCode: 9999, languageCode: 'en' });
    expect(view.props.onLocationChange).not.toHaveBeenCalled();
    expect(view.props.onLanguageChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('market-language').querySelectorAll('option').length).toBeGreaterThan(0);
  });

  it('does not invent a language for a selected market with no languages', () => {
    catalog.current = {
      markets: [{ countryCode: 'US', locationCode: 2840, languageCodes: [] }],
      loading: false,
      error: false,
    };
    const view = renderSelects({ locationCode: 2840, languageCode: 'zz' });
    expect(view.props.onLanguageChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('market-language')).toBeEmptyDOMElement();
  });

  it('uses fallback languages when the location is not in a non-empty catalog', () => {
    const view = renderSelects({ locationCode: 9999, languageCode: 'zz' });
    expect(view.props.onLanguageChange).toHaveBeenCalledWith('en');
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument();
  });

  it('renders loading and error states without normalizing selections', () => {
    catalog.current = { ...catalog.current, loading: true };
    const loading = renderSelects({ locationCode: 9999, languageCode: 'zz' });
    expect(screen.getByTestId('market-location')).toBeDisabled();
    expect(screen.getByTestId('market-language')).toBeDisabled();
    expect(loading.props.onLocationChange).not.toHaveBeenCalled();
    loading.unmount();

    catalog.current = { ...catalog.current, loading: false, error: true };
    const errored = renderSelects({ locationCode: 9999, languageCode: 'zz' });
    expect(screen.getByRole('alert')).toHaveTextContent('Countries could not be loaded. Try again.');
    expect(errored.props.onLocationChange).not.toHaveBeenCalled();
  });

  it('ignores a combobox selection that has no provider location code', async () => {
    const user = userEvent.setup();
    const invalidMarket = { countryCode: 'US', locationCode: 2840, languageCodes: ['en'] };
    Reflect.set(invalidMarket, 'locationCode', null);
    catalog.current = {
      ...catalog.current,
      markets: [invalidMarket],
    };
    const view = renderSelects({ locationCode: 9999 });
    await user.click(screen.getByTestId('market-location'));
    await user.click(screen.getByRole('option', { name: /United States/ }));
    expect(view.props.onLocationChange).not.toHaveBeenCalled();
  });

  it('falls back to a raw language code when Intl cannot name it', () => {
    catalog.current = {
      ...catalog.current,
      markets: [{ countryCode: 'US', locationCode: 2840, languageCodes: ['invalid_language'] }],
    };
    renderSelects({ languageCode: 'invalid_language' });
    expect(screen.getByRole('option')).toHaveTextContent('invalid_language');
  });
});
