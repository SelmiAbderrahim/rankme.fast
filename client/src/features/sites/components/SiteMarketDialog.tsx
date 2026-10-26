import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bdi } from '@shared/components/Bdi';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@shared/ui/dialog';
import { Field, FieldLabel } from '@shared/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import {
  CountryCombobox, FALLBACK_MARKET, countryCodeForLocation, languageName,
  marketLanguages, pickMarketLanguage, useMarketCatalog,
  type MarketChoice, type MarketDevice,
} from '@shared/markets';
import { clearSiteMarketError } from '../store/slice';
import { updateSiteMarket } from '../store/thunks';
import { selectMarketSavingSiteId, selectSiteMarketError } from '../store/selectors';
import type { Site } from '../types';

export interface SiteMarketDialogProps {
  site: Site;
  initialMarket?: MarketChoice | null;
  onClose: () => void;
}

/** A site owner can replace the inferred default with a supported market. */
export const SiteMarketDialog = ({ site, initialMarket = null, onClose }: SiteMarketDialogProps) => {
  const { t, i18n } = useTranslation(['sites', 'common']);
  const dispatch = useAppDispatch();
  const catalog = useMarketCatalog('seo');
  const savingId = useAppSelector(selectMarketSavingSiteId);
  const error = useAppSelector(selectSiteMarketError);
  const [market, setMarket] = useState<MarketChoice>(() => {
    const stored = site.defaultMarket ?? initialMarket;
    return stored ? {
      locationCode: stored.locationCode, languageCode: stored.languageCode, device: stored.device,
    } : FALLBACK_MARKET;
  });

  useEffect(() => {
    dispatch(clearSiteMarketError());
    return () => { dispatch(clearSiteMarketError()); };
  }, [dispatch]);

  const offered = marketLanguages(catalog.markets, market.locationCode);
  const languages = offered.length ? offered : [market.languageCode];
  const invalid = !catalog.loading && !catalog.error && !offered.includes(market.languageCode);

  const save = async () => {
    const result = await dispatch(updateSiteMarket({ id: site.id, market }));
    if (updateSiteMarket.fulfilled.match(result)) onClose();
  };

  return <Dialog open onOpenChange={onClose}>
    <DialogContent data-testid="site-market-dialog">
      <DialogHeader>
        <DialogTitle>{t('market.title')}</DialogTitle>
        <DialogDescription>{t('market.description')} <Bdi>{site.domain}</Bdi></DialogDescription>
      </DialogHeader>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        {site.defaultMarket?.source === 'inferred' ? <p className="text-muted-foreground text-sm">
          {t('market.inferredNote')}
        </p> : null}
        <Field>
          <FieldLabel htmlFor="site-market-country">{t('market.country')}</FieldLabel>
          <CountryCombobox id="site-market-country" value={countryCodeForLocation(market.locationCode, catalog.markets)}
            markets={catalog.markets} loading={catalog.loading} disabled={catalog.error} testId="site-market-country"
            onValueChange={(_country, entry) => {
              if (!entry?.locationCode) return;
              setMarket({ ...market, locationCode: entry.locationCode,
                languageCode: pickMarketLanguage(entry.languageCodes, market.languageCode) });
            }} />
        </Field>
        <Field>
          <FieldLabel htmlFor="site-market-language">{t('market.language')}</FieldLabel>
          <Select value={market.languageCode} disabled={catalog.loading || catalog.error}
            onValueChange={(languageCode) => { if (languageCode) setMarket({ ...market, languageCode }); }}>
            <SelectTrigger id="site-market-language" className="w-full" aria-invalid={invalid}><SelectValue /></SelectTrigger>
            <SelectContent>{languages.map((language) => <SelectItem key={language} value={language}>
              {languageName(language, i18n.language) ?? language}
            </SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="site-market-device">{t('market.device')}</FieldLabel>
          <Select value={market.device} onValueChange={(device) => setMarket({ ...market, device: device as MarketDevice })}>
            <SelectTrigger id="site-market-device" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{(['desktop', 'mobile'] as const).map((device) => <SelectItem key={device} value={device}>
              {t(`market.devices.${device}`)}
            </SelectItem>)}</SelectContent>
          </Select>
        </Field>
        {catalog.error ? <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-destructive text-sm">{t('common:market.loadError')}</p>
          <Button type="button" variant="outline" onClick={catalog.retry}>{t('retry')}</Button>
        </div> : null}
        {error ? <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('market.cancel')}</Button>
          <Button type="submit" loading={savingId === site.id} loadingLabel={t('market.saving')}
            disabled={catalog.loading || catalog.error || invalid}>{t('market.save')}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
};
