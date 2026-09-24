/**
 * Country + language pickers shared by the workspace forms.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CountryCombobox,
  countryCodeForLocation,
  languageName,
  useMarketCatalog,
} from '@shared/markets';
import { LANGUAGE_OPTIONS } from '../validation';

const FALLBACK_LANGUAGES = LANGUAGE_OPTIONS.map((option) => option.value);

interface MarketSelectsProps {
  locationCode: number;
  languageCode: string;
  onLocationChange: (code: number) => void;
  onLanguageChange: (code: string) => void;
  testIdPrefix: string;
}

export const MarketSelects = ({
  locationCode,
  languageCode,
  onLocationChange,
  onLanguageChange,
  testIdPrefix,
}: MarketSelectsProps) => {
  const { t, i18n } = useTranslation();
  const catalog = useMarketCatalog('seo');
  const selectedMarket = catalog.markets.find((market) => market.locationCode === locationCode);
  const languages = selectedMarket?.languageCodes ?? FALLBACK_LANGUAGES;

  useEffect(() => {
    if (catalog.loading || catalog.error || selectedMarket) return;
    const fallback = catalog.markets.find((market) => market.countryCode === 'US')
      ?? catalog.markets[0];
    if (fallback?.locationCode) onLocationChange(fallback.locationCode);
  }, [catalog.error, catalog.loading, catalog.markets, onLocationChange, selectedMarket]);

  useEffect(() => {
    if (languages.includes(languageCode)) return;
    const first = languages[0];
    if (first) onLanguageChange(first);
  }, [languageCode, languages, onLanguageChange]);

  return (
    <div className="flex flex-wrap gap-2">
      <CountryCombobox
        value={selectedMarket?.countryCode ?? countryCodeForLocation(locationCode)}
        markets={catalog.markets}
        loading={catalog.loading}
        disabled={catalog.error}
        invalid={catalog.error}
        ariaLabel={t('keywordResearch:locationLabel')}
        testId={`${testIdPrefix}-location`}
        className="w-56"
        onValueChange={(_countryCode, market) => {
          if (market?.locationCode) onLocationChange(market.locationCode);
        }}
      />
      <select
        aria-label={t('keywordResearch:languageLabel')}
        value={languageCode}
        onChange={(e) => onLanguageChange(e.target.value)}
        disabled={catalog.loading || catalog.error}
        className="border-input h-9 cursor-pointer rounded-md border px-2 text-sm"
        data-testid={`${testIdPrefix}-language`}
      >
        {languages.map((language) => (
          <option key={language} value={language}>
            {languageName(language, i18n.language) ?? language}
          </option>
        ))}
      </select>
      {catalog.error ? (
        <p className="text-destructive basis-full text-sm" role="alert">
          {t('common:market.loadError')}
        </p>
      ) : null}
    </div>
  );
};
