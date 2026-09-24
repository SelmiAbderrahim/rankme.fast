import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES, isSupportedLocale } from './index';
import type { SupportedLocale } from './locales';
import { useLocaleContext } from './LocaleContext';

interface LanguageSwitcherProps {
  className?: string;
  id?: string;
  onLocaleChange?: (locale: SupportedLocale) => void;
}

export const LanguageSwitcher = ({
  className,
  id = 'language-switcher',
  onLocaleChange,
}: LanguageSwitcherProps) => {
  const { t, i18n } = useTranslation('language');
  const { changeLocale, isSaving } = useLocaleContext();
  const current = (isSupportedLocale(i18n.resolvedLanguage) ? i18n.resolvedLanguage : 'en') as SupportedLocale;

  const label = t('switcher.label');

  return (
    <div className={className}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        aria-label={label}
        value={current}
        disabled={isSaving}
        onChange={(event) => {
          const next = event.target.value;
          if (isSupportedLocale(next)) {
            void changeLocale(next).then((changed) => {
              if (changed) onLocaleChange?.(next);
            });
          }
        }}
        className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-2 text-sm shadow-xs focus-visible:ring-2 focus-visible:outline-none"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {t(`names.${locale}`)}
          </option>
        ))}
      </select>
    </div>
  );
};
