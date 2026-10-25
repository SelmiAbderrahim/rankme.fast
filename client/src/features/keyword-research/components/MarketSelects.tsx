/**
 * Country + language pickers shared by the workspace forms.
 */
import { useEffect, useMemo } from 'react';
import { Button } from '@shared/ui/button';
import { NativeSelect } from '@shared/ui/native-select';
import { useTranslation } from 'react-i18next';
import {
  CountryCombobox,
  countryCodeForLocation,
  languageName,
  pickFallbackLanguage,
  pickFallbackMarket,
  useMarketCatalog,
} from '@shared/markets';
import { LANGUAGE_OPTIONS } from '../validation';

const FALLBACK_LANGUAGES = LANGUAGE_OPTIONS.map((option) => option.value);

interface MarketSelectsProps {
  locationCode: number;
  languageCode: string;
  onLocationChange: (code: number) => void;
  onLanguageChange: (code: string) => void;
  /**
   * Automatic corrections (a country the catalog lacks, a language it does
   * not offer for the country). They default to the change handlers; views
   * with a seeded market pass handlers that do not count as the owner's choice.
   */
  onLocationAdjust?: (code: number) => void;
  onLanguageAdjust?: (code: string) => void;
  /**
   * Countries this view can actually run (ISO 3166 alpha-2). The picker offers
   * only these, and a starting market outside them is corrected instead of
   * failing on submit.
   */
  countryCodes?: readonly string[];
  testIdPrefix: string;
}

export const MarketSelects = ({
  locationCode,
  languageCode,
  onLocationChange,
  onLanguageChange,
  onLocationAdjust = onLocationChange,
  onLanguageAdjust = onLanguageChange,
  countryCodes,
  testIdPrefix,
}: MarketSelectsProps) => {
  const { t, i18n } = useTranslation();
  const catalog = useMarketCatalog('seo');
  const markets = useMemo(
    () =>
      countryCodes
        ? catalog.markets.filter((market) => countryCodes.includes(market.countryCode))
        : catalog.markets,
    [catalog.markets, countryCodes],
  );
  const selectedMarket = markets.find((market) => market.locationCode === locationCode);
  const languages = selectedMarket?.languageCodes ?? FALLBACK_LANGUAGES;

  useEffect(() => {
    if (catalog.loading || catalog.error || selectedMarket) return;
    const fallback = pickFallbackMarket(markets, { locale: i18n.language });
    if (fallback?.locationCode) onLocationAdjust(fallback.locationCode);
  }, [catalog.error, catalog.loading, i18n.language, markets, onLocationAdjust, selectedMarket]);

  // Only correct the language against a loaded catalog: while it reloads (a
  // language switch refetches it) the fallback list would "correct" an Arabic
  // or Russian market to English.
  useEffect(() => {
    if (catalog.loading || catalog.error || languages.includes(languageCode)) return;
    const next = pickFallbackLanguage(languages, languageCode, i18n.language);
    if (next && next !== languageCode) onLanguageAdjust(next);
  }, [catalog.error, catalog.loading, i18n.language, languageCode, languages, onLanguageAdjust]);

  return (
    <div className="flex flex-wrap gap-2">
      <CountryCombobox
        value={selectedMarket?.countryCode ?? countryCodeForLocation(locationCode)}
        markets={markets}
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
      <NativeSelect
        aria-label={t('keywordResearch:languageLabel')}
        value={languageCode}
        onChange={(e) => onLanguageChange(e.target.value)}
        disabled={catalog.loading || catalog.error}
        data-testid={`${testIdPrefix}-language`}
      >
        {languages.map((language) => (
          <option key={language} value={language}>
            {languageName(language, i18n.language) ?? language}
          </option>
        ))}
      </NativeSelect>
      {catalog.error ? (
        <div className="flex basis-full flex-wrap items-center gap-2" role="alert">
          <p className="text-destructive text-sm">{t('common:market.loadError')}</p>
          <Button type="button" variant="outline" size="sm" onClick={catalog.retry}>
            {t('common:retry')}
          </Button>
        </div>
      ) : null}
    </div>
  );
};
