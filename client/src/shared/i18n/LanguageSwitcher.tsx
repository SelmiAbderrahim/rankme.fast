import { useState } from 'react';
import { NativeSelect } from '@shared/ui/native-select';
import { Spinner } from '@shared/ui/spinner';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES, isSupportedLocale } from './index';
import type { SupportedLocale } from './locales';
import { useLocaleContext } from './LocaleContext';

interface LanguageSwitcherProps {
  className?: string;
  id?: string;
  onLocaleChange?: (locale: SupportedLocale) => void;
  showLabel?: boolean;
}

export const LanguageSwitcher = ({
  className,
  id = 'language-switcher',
  onLocaleChange,
  showLabel = false,
}: LanguageSwitcherProps) => {
  const { t, i18n } = useTranslation('language');
  const { changeLocale, isSaving } = useLocaleContext();
  const [pending, setPending] = useState<SupportedLocale | null>(null);
  const current = (isSupportedLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en') as SupportedLocale;
  const busy = isSaving || pending !== null;

  const label = t('switcher.label');

  return (
    <div className={className} aria-busy={busy || undefined}>
      <label htmlFor={id} className={showLabel ? 'text-sm font-medium' : 'sr-only'}>
        {label}
      </label>
      <NativeSelect
        id={id}
        aria-label={label}
        value={pending ?? current}
        disabled={busy}
        onChange={(event) => {
          const next = event.target.value;
          if (isSupportedLocale(next)) {
            setPending(next);
            void changeLocale(next)
              .then((changed) => { if (changed) onLocaleChange?.(next); })
              .catch(() => {})
              .finally(() => setPending(null));
          }
        }}
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {t(`names.${locale}`)}
          </option>
        ))}
      </NativeSelect>
      {busy ? (
        <span className="inline-flex items-center gap-2">
          <Spinner className="size-4 shrink-0 text-muted-foreground" />
          <span className="sr-only" role="status">{t('switcher.switching')}</span>
        </span>
      ) : null}
    </div>
  );
};
