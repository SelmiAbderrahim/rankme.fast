import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePhraseChipsInput } from '@shared/hooks/usePhraseChipsInput';
import { COMPETITOR_DOMAINS_MAX, COMPETITOR_DOMAIN_MAX_LENGTH, competitorDomainNormalizer } from '@shared/lib/competitorDomains';
import { isolateText } from '@shared/lib/bidi';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Button } from '@shared/ui/button';
import { Bdi } from './Bdi';

export interface CompetitorDomainsInputProps {
  id: string;
  label: string;
  value: string[];
  onChange: (domains: string[]) => void;
  ownDomain?: string;
  testIdPrefix: string;
  error?: string;
  help?: ReactNode;
}

export function CompetitorDomainsInput({ id, label, value, onChange, ownDomain, testIdPrefix, error, help }: CompetitorDomainsInputProps) {
  const { t, i18n } = useTranslation('common');
  const describedById = useId();
  const { notice, clearNotice, inputProps } = usePhraseChipsInput({ chips: value, onChange, max: COMPETITOR_DOMAINS_MAX, maxLength: COMPETITOR_DOMAIN_MAX_LENGTH, normalizePhrase: competitorDomainNormalizer(ownDomain) });
  const invalid = notice.rejected.filter((item) => item.reason === 'invalid');
  const own = notice.rejected.filter((item) => item.reason === 'own');
  const format = new Intl.NumberFormat(i18n.language);
  const max = format.format(COMPETITOR_DOMAINS_MAX);
  return (
    <div className="flex flex-col gap-1.5" data-testid={`${testIdPrefix}-field`}>
      <Label htmlFor={id}>{label}</Label>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((domain, index) => (
            <li key={domain} className="border-border bg-muted inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs" data-testid={`${testIdPrefix}-chip-${domain}`}>
              <span className="max-w-48 truncate"><Bdi>{domain}</Bdi></span>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t('competitorDomains.remove', { domain: isolateText(domain) })} onClick={() => { onChange(value.filter((_, i) => i !== index)); clearNotice(); }}><X className="size-3" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Input id={id} placeholder={isolateText(t('competitorDomains.placeholder'))} inputMode="url" dir="ltr" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={2048} aria-invalid={error || invalid.length > 0 || own.length > 0 ? true : undefined} aria-describedby={describedById} data-testid={`${testIdPrefix}-input`} {...inputProps} />
      <div id={describedById} className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs" data-testid={`${testIdPrefix}-count`}>{t('competitorDomains.count', { used: format.format(value.length), max })}</p>
        {help}
        <p className="text-muted-foreground text-xs" aria-live="polite" data-testid={`${testIdPrefix}-duplicate`}>{notice.duplicates.length > 0 ? t('competitorDomains.alreadyAdded', { domains: isolateText(notice.duplicates.join(', ')) }) : null}</p>
        {invalid.length > 0 ? <p role="alert" className="text-destructive text-xs" data-testid={`${testIdPrefix}-invalid`}>{t('competitorDomains.invalid', { domains: isolateText(invalid.map((item) => item.phrase).join(', ')) })}</p> : null}
        {own.length > 0 ? <p role="alert" className="text-destructive text-xs" data-testid={`${testIdPrefix}-own`}>{t('competitorDomains.own', { domains: isolateText(own.map((item) => item.phrase).join(', ')) })}</p> : null}
        {notice.limitHit ? <p role="alert" className="text-destructive text-xs" data-testid={`${testIdPrefix}-limit`}>{t('competitorDomains.limit', { max })}</p> : null}
        {error ? <p role="alert" className="text-destructive text-sm" data-testid={`${testIdPrefix}-error`}>{error}</p> : null}
      </div>
    </div>
  );
}
