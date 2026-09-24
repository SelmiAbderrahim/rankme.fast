import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAuthSession } from '@features/auth';
import {
  DEFAULT_LOCALE,
  changeLanguage,
  isSupportedLocale,
} from '@shared/i18n';
import {
  LocaleContextProvider,
  type LocaleContextValue,
} from '@shared/i18n/LocaleContext';
import {
  getLanguagePreference,
  patchLanguagePreference,
} from '@shared/i18n/preferenceApi';
import type { SupportedLocale } from '@shared/i18n';

interface AuthenticatedLocaleBoundaryProps {
  children: ReactNode;
}

const currentLocale = (resolvedLanguage: string | undefined): SupportedLocale =>
  isSupportedLocale(resolvedLanguage) ? resolvedLanguage : DEFAULT_LOCALE;

const BrowserAuthenticatedLocaleBoundary = ({
  children,
}: AuthenticatedLocaleBoundaryProps) => {
  const { authenticated, isPending, user } = useAuthSession();
  const { i18n } = useTranslation('language');
  const principalId = authenticated ? (user?.id ?? null) : null;
  const principalRef = useRef<string | null>(principalId);
  principalRef.current = principalId;

  const [readyPrincipal, setReadyPrincipal] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const hydrationGeneration = useRef(0);
  const switchGeneration = useRef(0);
  const switchController = useRef<AbortController | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    const generation = ++hydrationGeneration.current;
    ++switchGeneration.current;
    switchController.current?.abort();
    switchController.current = null;
    savingRef.current = false;
    setIsSaving(false);

    if (isPending || principalId === null) {
      setReadyPrincipal(null);
      return;
    }

    const controller = new AbortController();
    setReadyPrincipal(null);

    void (async () => {
      try {
        const stored = await getLanguagePreference(controller.signal);
        if (
          controller.signal.aborted ||
          hydrationGeneration.current !== generation ||
          principalRef.current !== principalId
        ) {
          return;
        }

        const storedLocale = isSupportedLocale(stored.language) ? stored.language : null;
        const winner = storedLocale === null
          ? (
              await patchLanguagePreference(
                currentLocale(i18n.resolvedLanguage),
                { ifUnset: true, signal: controller.signal },
              )
            ).language
          : storedLocale;

        if (!isSupportedLocale(winner)) return;

        if (
          controller.signal.aborted ||
          hydrationGeneration.current !== generation ||
          principalRef.current !== principalId
        ) {
          return;
        }
        await changeLanguage(winner);
        if (
          !controller.signal.aborted &&
          hydrationGeneration.current === generation &&
          principalRef.current === principalId
        ) {
          setReadyPrincipal(principalId);
        }
      } catch (error) {
        if (
          !(error instanceof DOMException && error.name === 'AbortError') &&
          hydrationGeneration.current === generation &&
          principalRef.current === principalId
        ) {
          setReadyPrincipal(principalId);
        }
      }
    })();

    return () => controller.abort();
  }, [i18n, isPending, principalId]);

  useEffect(() => () => switchController.current?.abort(), []);

  const changeLocale = useCallback<LocaleContextValue['changeLocale']>(
    async (next) => {
      if (!isSupportedLocale(next)) return false;
      const previous = currentLocale(i18n.resolvedLanguage);
      if (next === previous || savingRef.current) return false;

      if (principalId === null || readyPrincipal !== principalId) {
        await changeLanguage(next);
        return true;
      }

      const generation = ++switchGeneration.current;
      const controller = new AbortController();
      switchController.current?.abort();
      switchController.current = controller;
      savingRef.current = true;
      setIsSaving(true);

      try {
        await changeLanguage(next);
        const stored = await patchLanguagePreference(next, {
          signal: controller.signal,
        });
        if (
          controller.signal.aborted ||
          switchGeneration.current !== generation ||
          principalRef.current !== principalId
        ) {
          return false;
        }
        if (!isSupportedLocale(stored.language)) throw new Error('invalid language preference');
        await changeLanguage(stored.language);
        return true;
      } catch {
        if (
          controller.signal.aborted ||
          switchGeneration.current !== generation ||
          principalRef.current !== principalId
        ) {
          return false;
        }
        await changeLanguage(previous);
        toast.error(i18n.t('language:switcher.saveError'));
        return false;
      } finally {
        if (switchGeneration.current === generation) {
          switchController.current = null;
          savingRef.current = false;
          setIsSaving(false);
        }
      }
    },
    [i18n, principalId, readyPrincipal],
  );

  const context = useMemo<LocaleContextValue>(
    () => ({ isSaving, changeLocale }),
    [changeLocale, isSaving],
  );

  const isReady = isPending || principalId === null || readyPrincipal === principalId;
  return (
    <LocaleContextProvider value={context}>
      {isReady ? children : null}
    </LocaleContextProvider>
  );
};

export const AuthenticatedLocaleBoundary = ({
  children,
}: AuthenticatedLocaleBoundaryProps) => {
  if (typeof window === 'undefined') return <>{children}</>;
  return (
    <BrowserAuthenticatedLocaleBoundary>
      {children}
    </BrowserAuthenticatedLocaleBoundary>
  );
};
