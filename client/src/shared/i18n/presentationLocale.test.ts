import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  __resetPresentationLocaleForTests,
  getPresentationLocale,
  getPresentationLocaleSnapshot,
  isCurrentPresentationSnapshot,
  requestPresentationRefresh,
  setPresentationLocale,
  subscribePresentationLocale,
  subscribePresentationRefresh,
} from './presentationLocale';
import {
  isCurrentPresentationRequest,
  presentationCacheKey,
  presentationRequestIdentity,
} from './requestIdentity';
import {
  useClearOnPresentationRefresh,
  usePresentationLocaleSnapshot,
} from './usePresentationLocale';

describe('presentation locale request identity', () => {
  beforeEach(() => {
    __resetPresentationLocaleForTests();
  });

  it('exposes one typed getter and advances a monotonic generation on change', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePresentationLocale(listener);
    const english = getPresentationLocaleSnapshot();

    expect(getPresentationLocale()).toBe('en');
    expect(setPresentationLocale('en')).toBe(english);
    const arabic = setPresentationLocale('ar');
    const french = setPresentationLocale('fr');

    expect(arabic).toEqual({ locale: 'ar', generation: 1 });
    expect(french).toEqual({ locale: 'fr', generation: 2 });
    expect(listener).toHaveBeenNthCalledWith(1, arabic);
    expect(listener).toHaveBeenNthCalledWith(2, french);
    expect(isCurrentPresentationSnapshot(english)).toBe(false);
    expect(isCurrentPresentationSnapshot(french)).toBe(true);
    unsubscribe();
  });

  it('emits language and stale-mutation refresh reasons without changing locale', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePresentationRefresh(listener);

    setPresentationLocale('ar');
    const refresh = requestPresentationRefresh();

    expect(listener.mock.calls).toEqual([
      [{ locale: 'ar', generation: 1, refreshGeneration: 1, reason: 'language-changed' }],
      [{ locale: 'ar', generation: 1, refreshGeneration: 2, reason: 'stale-mutation' }],
    ]);
    expect(refresh.reason).toBe('stale-mutation');
    expect(getPresentationLocale()).toBe('ar');
    unsubscribe();
    setPresentationLocale('fr');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores an unsupported runtime value defensively', () => {
    const current = getPresentationLocaleSnapshot();
    expect(setPresentationLocale('xx' as never)).toBe(current);
    expect(getPresentationLocaleSnapshot()).toBe(current);
  });

  it('clears component-local presentation copy once per refresh without remounting', () => {
    const clear = vi.fn();
    const view = renderHook(() => useClearOnPresentationRefresh(clear));

    act(() => {
      setPresentationLocale('ar');
    });
    expect(clear).toHaveBeenCalledTimes(1);
    view.rerender();
    expect(clear).toHaveBeenCalledTimes(1);

    act(() => {
      requestPresentationRefresh();
    });
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it('exposes the current request identity, locale cache key, and reactive snapshot', () => {
    const view = renderHook(() => usePresentationLocaleSnapshot());
    const english = presentationRequestIdentity();

    expect(english).toEqual({ presentationLocale: 'en', presentationGeneration: 0 });
    expect(presentationCacheKey('report:run-1', english)).toBe('report:run-1::en');
    expect(isCurrentPresentationRequest(english)).toBe(true);

    act(() => {
      setPresentationLocale('ar');
    });

    expect(view.result.current).toEqual({ locale: 'ar', generation: 1 });
    expect(isCurrentPresentationRequest(english)).toBe(false);
    expect(
      isCurrentPresentationRequest({
        presentationLocale: 'ar',
        presentationGeneration: 0,
      }),
    ).toBe(false);
  });
});
