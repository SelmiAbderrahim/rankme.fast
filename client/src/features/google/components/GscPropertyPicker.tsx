import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Bdi } from '@shared/components/Bdi';
import { isolateText } from '@shared/lib/bidi';
import { Button } from '@shared/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@shared/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
import type { GscProperty } from '../types';

const SEARCH_CONSOLE_URL = 'https://search.google.com/search-console';
const optionText = (property: GscProperty): string => property.inUseBy?.length
  ? `${property.siteUrl} — ${property.inUseBy.map((used) => used.displayName || used.domain).join(', ')}`
  : property.siteUrl;

function propertyName(url: string): string {
  if (url.startsWith('sc-domain:')) return url.slice('sc-domain:'.length);
  try { return new URL(url).hostname; } catch { return url; }
}

export function GscPropertyPicker({ domain, propertyUrl, properties, settingProperty, refreshing, onSelect, onRefresh }: {
  domain: string;
  propertyUrl: string | null;
  properties: readonly GscProperty[];
  settingProperty: boolean;
  refreshing: boolean;
  onSelect: (propertyUrl: string, confirmMismatch: boolean) => void;
  onRefresh: () => void;
}) {
  const { t } = useTranslation('google');
  const matching = properties.filter((property) => property.matchesSite !== false);
  const unrelated = properties.filter((property) => property.matchesSite === false);
  const [advancedOpen, setAdvancedOpen] = useState(unrelated.some((property) => property.siteUrl === propertyUrl));
  const [pending, setPending] = useState<string | null>(null);
  const siteName = domain ? isolateText(domain) : t('propertyPicker.thisSite');

  return <div className="flex flex-col gap-3" data-testid="gsc-property-picker">
    {matching.length ? (
      <Select value={matching.some((property) => property.siteUrl === propertyUrl) ? propertyUrl! : ''}
        disabled={settingProperty} onValueChange={(value) => { if (value !== propertyUrl) onSelect(value, false); }}>
        <SelectTrigger id="gsc-property" className="w-full sm:w-96" aria-busy={settingProperty}>
          <SelectValue placeholder={t('connected.propertyPlaceholder')} />
        </SelectTrigger>
        <SelectContent>{matching.map((property) => <SelectItem key={property.siteUrl} value={property.siteUrl}>{optionText(property)}</SelectItem>)}</SelectContent>
      </Select>
    ) : (
      <div className="flex flex-col items-start gap-2" data-testid="gsc-no-property">
        <p className="text-foreground text-sm">{t('propertyPicker.noneFound', { domain: siteName })}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm"><a href={SEARCH_CONSOLE_URL} target="_blank" rel="noopener noreferrer">
            <ExternalLink data-icon="inline-start" aria-hidden="true" />{t('propertyPicker.openSearchConsole')}
            <span className="sr-only"> {t('propertyPicker.newTab')}</span>
          </a></Button>
          <Button type="button" variant="outline" size="sm" loading={refreshing} loadingLabel={t('propertyPicker.refreshing')}
            onClick={onRefresh} data-testid="gsc-property-refresh">
            <RefreshCw data-icon="inline-start" aria-hidden="true" />{t('propertyPicker.refresh')}
          </Button>
        </div>
      </div>
    )}
    {unrelated.length ? <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="ghost" size="sm" aria-expanded={advancedOpen} aria-controls="gsc-property-other"
        onClick={() => setAdvancedOpen((open) => !open)} data-testid="gsc-property-other-toggle">{t('propertyPicker.linkDifferent')}</Button>
      {advancedOpen ? <div id="gsc-property-other" className="flex w-full flex-col gap-1">
        <p className="text-muted-foreground text-xs">{t('propertyPicker.differentHint', { domain: siteName })}</p>
        <Select value={unrelated.some((property) => property.siteUrl === propertyUrl) ? propertyUrl! : ''}
          disabled={settingProperty} onValueChange={setPending}>
          <SelectTrigger className="w-full sm:w-96" aria-label={t('propertyPicker.otherLabel')} data-testid="gsc-property-other-select">
            <SelectValue placeholder={t('connected.propertyPlaceholder')} />
          </SelectTrigger>
          <SelectContent>{unrelated.map((property) => <SelectItem key={property.siteUrl} value={property.siteUrl}>{optionText(property)}</SelectItem>)}</SelectContent>
        </Select>
      </div> : null}
    </div> : null}
    {pending !== null ? <AlertDialog open onOpenChange={() => setPending(null)}>
      <AlertDialogContent data-testid="gsc-property-mismatch-dialog"><AlertDialogHeader>
        <AlertDialogTitle>{t('propertyPicker.confirmTitle', { site: siteName, property: isolateText(propertyName(pending)) })}</AlertDialogTitle>
        <AlertDialogDescription>{t('propertyPicker.confirmBody', { site: siteName, property: isolateText(propertyName(pending)) })} <Bdi>{pending}</Bdi></AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter>
        <AlertDialogCancel>{t('disconnect.cancel')}</AlertDialogCancel>
        <AlertDialogAction onClick={() => { onSelect(pending, true); setPending(null); }}>{t('propertyPicker.confirm')}</AlertDialogAction>
      </AlertDialogFooter></AlertDialogContent>
    </AlertDialog> : null}
  </div>;
}
