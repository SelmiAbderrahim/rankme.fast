import { createContext, useContext, type ReactNode } from 'react';
import { changeLanguage } from './index';
import type { SupportedLocale } from './locales';

export interface LocaleContextValue {
  isSaving: boolean;
  changeLocale: (locale: SupportedLocale) => Promise<boolean>;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export const LocaleContextProvider = ({
  value,
  children,
}: {
  value: LocaleContextValue;
  children: ReactNode;
}) => <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;

export function useLocaleContext(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (value) return value;
  return {
    isSaving: false,
    async changeLocale(locale) {
      await changeLanguage(locale);
      return true;
    },
  };
}
