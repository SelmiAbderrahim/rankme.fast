import { act, renderHook } from '@testing-library/react';
import i18next from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useI18nDirection } from './useDirection';

const makeI18n = async (lng: string) => {
  const instance = i18next.createInstance();
  await instance.init({
    lng,
    fallbackLng: false,
    resources: {},
    interpolation: { escapeValue: false },
  });
  return instance;
};

describe('useI18nDirection', () => {
  let testI18n: Awaited<ReturnType<typeof makeI18n>>;

  beforeEach(async () => {
    testI18n = await makeI18n('en');
  });

  it('returns ltr for en, flips to rtl on languageChanged to ar', async () => {
    const { result } = renderHook(() => useI18nDirection(testI18n));

    expect(result.current).toBe('ltr');
    await act(async () => {
      await testI18n.changeLanguage('ar');
    });
    expect(result.current).toBe('rtl');
  });

  it('flips back to ltr on ar to fr', async () => {
    await testI18n.changeLanguage('ar');
    const { result } = renderHook(() => useI18nDirection(testI18n));

    expect(result.current).toBe('rtl');
    await act(async () => {
      await testI18n.changeLanguage('fr');
    });
    expect(result.current).toBe('ltr');
  });

  it('unsubscribes on unmount', () => {
    const offSpy = vi.spyOn(testI18n, 'off');
    const { unmount } = renderHook(() => useI18nDirection(testI18n));

    unmount();

    expect(offSpy).toHaveBeenCalledWith('languageChanged', expect.any(Function));
  });

  it('treats an unsupported lng as ltr', async () => {
    testI18n = await makeI18n('not-a-locale');
    const { result } = renderHook(() => useI18nDirection(testI18n));

    expect(result.current).toBe('ltr');
  });
});
