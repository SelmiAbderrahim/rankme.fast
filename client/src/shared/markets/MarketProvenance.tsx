import { useTranslation } from 'react-i18next';
import { Info, TriangleAlert } from 'lucide-react';
import { Button } from '@shared/ui/button';
import { cn } from '@shared/lib/utils';
import { isolateText } from '@shared/lib/bidi';
import { countryCodeForLocation, countryName, languageName } from './format';
import { useSiteMarket } from './siteMarket';

export interface MarketProvenanceProps {
  current?: { locationCode: number; languageCode: string } | null;
  hint?: string;
  className?: string;
  'data-testid'?: string;
}

/** An inferred default is explained only while the picker still uses it. */
export function MarketProvenance({ current, hint, className, 'data-testid': testId = 'market-provenance' }: MarketProvenanceProps) {
  const { t, i18n } = useTranslation('common');
  const site = useSiteMarket();
  if (!site?.market?.source) return null;
  const { market, onEditMarket } = site;
  if (current && (current.locationCode !== market.locationCode || current.languageCode !== market.languageCode)) return null;
  const countryCode = countryCodeForLocation(market.locationCode);
  const country = (countryCode ? countryName(countryCode, i18n.language) : null) ?? t('market.unknownCountry');
  const language = languageName(market.languageCode, i18n.language) ?? t('market.unknownLanguage');
  const assumed = market.source === 'assumed';
  const Icon = assumed ? TriangleAlert : Info;
  return (
    <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-sm', assumed ? 'text-warning' : 'text-muted-foreground', className)} role={assumed ? 'status' : undefined} data-testid={testId} data-source={market.source}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{t(`market.provenance.${market.source}`, { country: isolateText(country), language: isolateText(language) })}{assumed ? null : ` ${hint ?? t('market.provenance.hint')}`}</span>
      {onEditMarket ? <Button type="button" variant="link" size="sm" onClick={onEditMarket} data-testid={`${testId}-edit`}>{t('market.provenance.edit')}</Button> : null}
    </p>
  );
}
