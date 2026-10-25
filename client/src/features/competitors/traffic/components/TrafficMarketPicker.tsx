import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, FieldLabel } from '@shared/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import {
  CountryCombobox,
  countryCodeForLocation,
  languageName,
  pickFallbackLanguage,
  useMarketCatalog,
} from '@shared/markets';
import type { TrafficMarket } from '../types';

interface TrafficMarketPickerProps {
  value: TrafficMarket;
  onChange: (market: TrafficMarket) => void;
  /** Automatic language snapping; defaults to `onChange`. Not the owner's choice. */
  onAdjust?: (market: TrafficMarket) => void;
  disabled?: boolean;
}

/**
 * Country + language for a snapshot, offered from the same provider market
 * catalog keyword research uses (`seo` surface = the Labs locations the traffic
 * estimates are drawn from). The starting market (the site's) stays selectable
 * while the catalog loads or fails.
 */
export const TrafficMarketPicker = ({
  value,
  onChange,
  onAdjust = onChange,
  disabled = false,
}: TrafficMarketPickerProps) => {
  const { t, i18n } = useTranslation('competitorsTraffic');
  const catalog = useMarketCatalog('seo');
  const selected = catalog.markets.find((market) => market.locationCode === value.locationCode);
  // Until the catalog answers (or for an entry listing no language) keep the
  // current language selectable instead of rendering an empty select.
  const languages =
    selected && selected.languageCodes.length > 0 ? selected.languageCodes : [value.languageCode];

  // A default outside the live catalog snaps to the first valid language.
  useEffect(() => {
    if (!selected) return;
    const language = pickFallbackLanguage(selected.languageCodes, value.languageCode, i18n.language);
    if (language !== value.languageCode) onAdjust({ ...value, languageCode: language });
  }, [i18n.language, onAdjust, selected, value]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        <Field className="w-auto">
          <FieldLabel htmlFor="traffic-market-country">{t('request.countryLabel')}</FieldLabel>
          <CountryCombobox
            id="traffic-market-country"
            value={selected?.countryCode ?? countryCodeForLocation(value.locationCode)}
            markets={catalog.markets}
            loading={catalog.loading}
            disabled={disabled || catalog.error}
            testId="traffic-market-country"
            className="w-56"
            onValueChange={(_countryCode, market) => {
              // allowAll is off, so only catalog entries arrive; location-less
              // entries cannot be requested from the Labs endpoints.
              if (!market?.locationCode) return;
              onChange({
                locationCode: market.locationCode,
                languageCode: pickFallbackLanguage(market.languageCodes, value.languageCode, i18n.language),
              });
            }}
          />
        </Field>
        <Field className="w-auto">
          <FieldLabel htmlFor="traffic-market-language">{t('request.languageLabel')}</FieldLabel>
          <Select
            value={value.languageCode}
            onValueChange={(language) => onChange({ ...value, languageCode: language })}
            disabled={disabled || catalog.loading || catalog.error}
          >
            <SelectTrigger
              id="traffic-market-language"
              className="min-w-40"
              data-testid="traffic-market-language"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languages.map((language) => (
                <SelectItem key={language} value={language}>
                  {languageName(language, i18n.language) ?? language}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      {catalog.error ? (
        <p className="text-destructive text-sm" role="alert">
          {t('common:market.loadError')}
        </p>
      ) : null}
    </div>
  );
};
