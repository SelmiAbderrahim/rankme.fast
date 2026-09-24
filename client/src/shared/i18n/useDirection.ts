import { useEffect, useState } from 'react';
import type { i18n as I18nType } from 'i18next';
import { isRtl, isSupportedLocale } from './locales';

export type TextDirection = 'ltr' | 'rtl';

const directionForLanguage = (lng: string | undefined): TextDirection =>
  isSupportedLocale(lng) && isRtl(lng) ? 'rtl' : 'ltr';

export function useI18nDirection(i18n: I18nType): TextDirection {
  const [dir, setDir] = useState<TextDirection>(() =>
    directionForLanguage(i18n.language),
  );

  useEffect(() => {
    const onLanguageChanged = (lng: string) => setDir(directionForLanguage(lng));
    i18n.on('languageChanged', onLanguageChanged);
    return () => i18n.off('languageChanged', onLanguageChanged);
  }, [i18n]);

  return dir;
}
