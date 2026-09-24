import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/ui/popover';
import { cn } from '@shared/lib/utils';
import { countryName } from './format';
import type { MarketCatalogEntry } from './types';

interface CountryComboboxProps {
  id?: string;
  value: string | null;
  markets: readonly MarketCatalogEntry[];
  onValueChange: (countryCode: string | null, market: MarketCatalogEntry | null) => void;
  allowAll?: boolean;
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  describedBy?: string;
  ariaLabel?: string;
  testId?: string;
  className?: string;
}

export function CountryCombobox({
  id,
  value,
  markets,
  onValueChange,
  allowAll = false,
  disabled = false,
  loading = false,
  invalid = false,
  describedBy,
  ariaLabel,
  testId,
  className,
}: CountryComboboxProps) {
  const { t, i18n } = useTranslation('common');
  const generatedId = useId();
  const controlId = id ?? `country-${generatedId}`;
  const listId = `${controlId}-listbox`;
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const choices = useMemo(() => {
    const collator = new Intl.Collator(i18n.language, { sensitivity: 'base' });
    const named = markets.map((market) => ({
      market,
      label: countryName(market.countryCode, i18n.language) ?? market.countryCode,
    }));
    named.sort((a, b) => collator.compare(a.label, b.label));
    const needle = query.trim().toLocaleLowerCase(i18n.language);
    if (!needle) return named;
    return named.filter(({ market, label }) =>
      label.toLocaleLowerCase(i18n.language).includes(needle)
      || market.countryCode.toLocaleLowerCase(i18n.language).includes(needle),
    );
  }, [i18n.language, markets, query]);

  const selected = value === null
    ? null
    : markets.find((market) => market.countryCode === value) ?? null;
  const selectedLabel = selected
    ? countryName(selected.countryCode, i18n.language) ?? selected.countryCode
    : allowAll && value === null
      ? t('market.allCountries')
      : t('market.selectCountry');

  const choose = (market: MarketCatalogEntry | null) => {
    onValueChange(market?.countryCode ?? null, market);
    setQuery('');
    setOpen(false);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = choices.length + (allowAll ? 1 : 0);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + delta + Math.max(count, 1)) % Math.max(count, 1));
    } else if (event.key === 'Enter' && count > 0) {
      event.preventDefault();
      choose(
        allowAll && activeIndex === 0
          ? null
          : choices[activeIndex - (allowAll ? 1 : 0)]!.market,
      );
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      setActiveIndex(0);
      if (!next) setQuery('');
    }}>
      <PopoverTrigger asChild>
        <Button
          id={controlId}
          type="button"
          variant="outline"
          role="combobox"
          aria-controls={listId}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled || loading}
          data-testid={testId}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span className="truncate">{loading ? t('market.loading') : selectedLabel}</span>
          <ChevronsUpDown className="size-4 opacity-50" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-2"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute start-2.5 top-2.5 size-4" aria-hidden="true" />
          <Input
            ref={searchRef}
            value={query}
            className="ps-8"
            aria-label={t('market.searchLabel')}
            placeholder={t('market.searchPlaceholder')}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onSearchKeyDown}
          />
        </div>
        <div id={listId} role="listbox" className="mt-2 max-h-64 overflow-y-auto">
          {allowAll ? (
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              className={cn(
                'focus-visible:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-2 text-start text-sm outline-none',
                activeIndex === 0 && 'bg-accent',
              )}
              onClick={() => choose(null)}
            >
              <Check className={cn('size-4', value === null ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
              {t('market.allCountries')}
            </button>
          ) : null}
          {choices.map(({ market, label }, index) => {
            const optionIndex = index + (allowAll ? 1 : 0);
            return (
              <button
                key={`${market.countryCode}-${market.locationCode ?? 'all'}`}
                type="button"
                role="option"
                aria-selected={value === market.countryCode}
                className={cn(
                  'focus-visible:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-2 text-start text-sm outline-none',
                  activeIndex === optionIndex && 'bg-accent',
                )}
                onClick={() => choose(market)}
              >
                <Check className={cn('size-4', value === market.countryCode ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span className="text-muted-foreground text-xs">{market.countryCode}</span>
              </button>
            );
          })}
          {choices.length === 0 && !allowAll ? (
            <p className="text-muted-foreground px-2 py-3 text-sm" role="status">
              {t('market.noResults')}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
